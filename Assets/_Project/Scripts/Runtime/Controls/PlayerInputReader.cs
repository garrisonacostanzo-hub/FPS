using FPS.Core;
using UnityEngine;
using UnityEngine.InputSystem;

namespace FPS.Controls
{
    /// <summary>Lazily created, process-wide input actions instance (there is exactly one local player per process).</summary>
    public static class InputService
    {
        private const string k_BindingPrefsKey = "fps.bindings";
        private static FPSInputActions s_Actions;

        public static FPSInputActions Actions
        {
            get
            {
                if (s_Actions == null)
                {
                    s_Actions = new FPSInputActions();
                    s_Actions.LoadBindingOverrides(PlayerPrefs.GetString(k_BindingPrefsKey, string.Empty));
                    s_Actions.Interface.Enable();
                }

                return s_Actions;
            }
        }

        public static void SaveBindings()
        {
            if (s_Actions != null)
            {
                PlayerPrefs.SetString(k_BindingPrefsKey, s_Actions.SaveBindingOverrides());
                PlayerPrefs.Save();
            }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            s_Actions = null;
        }
    }

    /// <summary>
    /// Reads the local player's input every rendered frame and exposes it in a network-friendly form:
    /// continuous values are sampled when the network tick builds a command, while one-shot presses are
    /// latched until consumed so that no press is lost between ticks.
    /// </summary>
    [DisallowMultipleComponent]
    public class PlayerInputReader : MonoBehaviour
    {
        private static int s_ActiveReaders;

        private FPSInputActions m_Actions;
        private bool m_Registered;
        private bool m_JumpLatched;
        private bool m_ReloadLatched;
        private int m_SlotRequest = -1;
        private int m_CycleRequest;
        private bool m_CrouchToggled;
        private bool m_AimToggled;
        private bool m_FirePressedThisFrame;

        public Vector2 Move { get; private set; }
        public Vector2 MouseDelta { get; private set; }
        public Vector2 GamepadLook { get; private set; }
        public bool SprintHeld { get; private set; }
        public bool CrouchHeld { get; private set; }
        public bool AimHeld { get; private set; }
        public bool FireHeld { get; private set; }
        public bool FirePressed => m_FirePressedThisFrame;
        public bool ScoreboardHeld { get; private set; }
        public bool HasGameplayFocus => CursorController.GameplayHasFocus;

        private void OnEnable()
        {
            m_Actions = InputService.Actions;
            m_Actions.EnableAll();
            if (!m_Registered)
            {
                m_Registered = true;
                s_ActiveReaders++;
            }
#if !ENABLE_INPUT_SYSTEM
            Debug.LogError("[FPS] The new Input System backend is disabled. Set Project Settings > Player > Active Input Handling to 'Input System Package (New)' or 'Both' and restart the editor.");
#endif
        }

        private void OnDisable()
        {
            if (m_Registered)
            {
                m_Registered = false;
                s_ActiveReaders = Mathf.Max(0, s_ActiveReaders - 1);
            }

            // The action map is shared: only the last active reader may switch gameplay input off.
            if (m_Actions != null && s_ActiveReaders == 0)
            {
                m_Actions.EnableGameplay(false);
            }

            Move = Vector2.zero;
            MouseDelta = Vector2.zero;
            GamepadLook = Vector2.zero;
            FireHeld = false;
        }

        private void Update()
        {
            if (m_Actions == null)
            {
                return;
            }

            ScoreboardHeld = m_Actions.Scoreboard.IsPressed();

            if (!HasGameplayFocus)
            {
                Move = Vector2.zero;
                MouseDelta = Vector2.zero;
                GamepadLook = Vector2.zero;
                SprintHeld = false;
                FireHeld = false;
                m_FirePressedThisFrame = false;
                return;
            }

            Move = Vector2.ClampMagnitude(m_Actions.Move.ReadValue<Vector2>(), 1f);
            MouseDelta = m_Actions.LookMouse.ReadValue<Vector2>();
            GamepadLook = m_Actions.LookGamepad.ReadValue<Vector2>();
            SprintHeld = m_Actions.Sprint.IsPressed();
            FireHeld = m_Actions.Fire.IsPressed();
            m_FirePressedThisFrame = m_Actions.Fire.WasPressedThisFrame();

            if (m_Actions.Jump.WasPressedThisFrame())
            {
                m_JumpLatched = true;
            }

            if (m_Actions.Reload.WasPressedThisFrame())
            {
                m_ReloadLatched = true;
            }

            if (GameSettings.ToggleCrouch)
            {
                if (m_Actions.Crouch.WasPressedThisFrame())
                {
                    m_CrouchToggled = !m_CrouchToggled;
                }

                if (SprintHeld && Move.y > 0.1f)
                {
                    m_CrouchToggled = false;
                }

                CrouchHeld = m_CrouchToggled;
            }
            else
            {
                CrouchHeld = m_Actions.Crouch.IsPressed();
            }

            if (GameSettings.ToggleAim)
            {
                if (m_Actions.Aim.WasPressedThisFrame())
                {
                    m_AimToggled = !m_AimToggled;
                }

                AimHeld = m_AimToggled;
            }
            else
            {
                AimHeld = m_Actions.Aim.IsPressed();
            }

            if (m_Actions.Weapon1.WasPressedThisFrame()) m_SlotRequest = 0;
            if (m_Actions.Weapon2.WasPressedThisFrame()) m_SlotRequest = 1;
            if (m_Actions.Weapon3.WasPressedThisFrame()) m_SlotRequest = 2;
            if (m_Actions.NextWeapon.WasPressedThisFrame()) m_CycleRequest = 1;
            if (m_Actions.PreviousWeapon.WasPressedThisFrame()) m_CycleRequest = -1;

            float scroll = m_Actions.WeaponScroll.ReadValue<float>();
            if (scroll > 0.01f)
            {
                m_CycleRequest = -1;
            }
            else if (scroll < -0.01f)
            {
                m_CycleRequest = 1;
            }
        }

        public bool ConsumeJump()
        {
            bool value = m_JumpLatched;
            m_JumpLatched = false;
            return value;
        }

        public bool ConsumeReload()
        {
            bool value = m_ReloadLatched;
            m_ReloadLatched = false;
            return value;
        }

        /// <summary>Returns the requested slot index (or -1) and clears the request.</summary>
        public int ConsumeSlotRequest()
        {
            int value = m_SlotRequest;
            m_SlotRequest = -1;
            return value;
        }

        /// <summary>Returns -1 / +1 for previous / next weapon (0 when nothing requested) and clears the request.</summary>
        public int ConsumeCycleRequest()
        {
            int value = m_CycleRequest;
            m_CycleRequest = 0;
            return value;
        }

        public void ResetToggles()
        {
            m_CrouchToggled = false;
            m_AimToggled = false;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            s_ActiveReaders = 0;
        }

        public static bool IsGamepadActive()
        {
            return Gamepad.current != null && Gamepad.current.wasUpdatedThisFrame;
        }
    }
}
