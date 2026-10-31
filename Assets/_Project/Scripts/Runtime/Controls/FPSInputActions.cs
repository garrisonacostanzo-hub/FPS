using System;
using UnityEngine.InputSystem;

namespace FPS.Controls
{
    /// <summary>
    /// Code-defined Input System action map (keyboard/mouse + gamepad). Defining actions in code keeps the
    /// project free of generated wrapper classes while still supporting runtime rebinding through
    /// <see cref="InputActionRebindingExtensions"/> and binding overrides saved as JSON.
    /// </summary>
    public sealed class FPSInputActions : IDisposable
    {
        public const string KeyboardMouseScheme = "KeyboardMouse";
        public const string GamepadScheme = "Gamepad";

        public InputActionAsset Asset { get; }
        public InputActionMap Gameplay { get; }
        public InputActionMap Interface { get; }

        public InputAction Move { get; }
        public InputAction LookMouse { get; }
        public InputAction LookGamepad { get; }
        public InputAction Jump { get; }
        public InputAction Sprint { get; }
        public InputAction Crouch { get; }
        public InputAction Fire { get; }
        public InputAction Aim { get; }
        public InputAction Reload { get; }
        public InputAction NextWeapon { get; }
        public InputAction PreviousWeapon { get; }
        public InputAction WeaponScroll { get; }
        public InputAction Weapon1 { get; }
        public InputAction Weapon2 { get; }
        public InputAction Weapon3 { get; }
        public InputAction Scoreboard { get; }
        public InputAction Pause { get; }

        public FPSInputActions()
        {
            Asset = UnityEngine.ScriptableObject.CreateInstance<InputActionAsset>();
            Asset.name = "FPSInputActions";
            Asset.AddControlScheme(KeyboardMouseScheme).WithRequiredDevice("<Keyboard>").WithRequiredDevice("<Mouse>");
            Asset.AddControlScheme(GamepadScheme).WithRequiredDevice("<Gamepad>");

            Gameplay = Asset.AddActionMap("Gameplay");
            Interface = Asset.AddActionMap("Interface");

            Move = Gameplay.AddAction("Move", InputActionType.Value, expectedControlLayout: "Vector2");
            Move.AddCompositeBinding("2DVector")
                .With("Up", "<Keyboard>/w", KeyboardMouseScheme)
                .With("Down", "<Keyboard>/s", KeyboardMouseScheme)
                .With("Left", "<Keyboard>/a", KeyboardMouseScheme)
                .With("Right", "<Keyboard>/d", KeyboardMouseScheme);
            Move.AddCompositeBinding("2DVector")
                .With("Up", "<Keyboard>/upArrow", KeyboardMouseScheme)
                .With("Down", "<Keyboard>/downArrow", KeyboardMouseScheme)
                .With("Left", "<Keyboard>/leftArrow", KeyboardMouseScheme)
                .With("Right", "<Keyboard>/rightArrow", KeyboardMouseScheme);
            Move.AddBinding("<Gamepad>/leftStick", processors: "stickDeadzone", groups: GamepadScheme);

            LookMouse = Gameplay.AddAction("LookMouse", InputActionType.Value, "<Mouse>/delta", expectedControlLayout: "Vector2", groups: KeyboardMouseScheme);
            LookGamepad = Gameplay.AddAction("LookGamepad", InputActionType.Value, "<Gamepad>/rightStick", processors: "stickDeadzone", expectedControlLayout: "Vector2", groups: GamepadScheme);

            Jump = Gameplay.AddAction("Jump", InputActionType.Button, "<Keyboard>/space", groups: KeyboardMouseScheme);
            Jump.AddBinding("<Gamepad>/buttonSouth", groups: GamepadScheme);

            Sprint = Gameplay.AddAction("Sprint", InputActionType.Button, "<Keyboard>/leftShift", groups: KeyboardMouseScheme);
            Sprint.AddBinding("<Gamepad>/leftStickPress", groups: GamepadScheme);

            Crouch = Gameplay.AddAction("Crouch", InputActionType.Button, "<Keyboard>/leftCtrl", groups: KeyboardMouseScheme);
            Crouch.AddBinding("<Keyboard>/c", groups: KeyboardMouseScheme);
            Crouch.AddBinding("<Gamepad>/buttonEast", groups: GamepadScheme);

            Fire = Gameplay.AddAction("Fire", InputActionType.Button, "<Mouse>/leftButton", groups: KeyboardMouseScheme);
            Fire.AddBinding("<Gamepad>/rightTrigger", groups: GamepadScheme);

            Aim = Gameplay.AddAction("Aim", InputActionType.Button, "<Mouse>/rightButton", groups: KeyboardMouseScheme);
            Aim.AddBinding("<Gamepad>/leftTrigger", groups: GamepadScheme);

            Reload = Gameplay.AddAction("Reload", InputActionType.Button, "<Keyboard>/r", groups: KeyboardMouseScheme);
            Reload.AddBinding("<Gamepad>/buttonWest", groups: GamepadScheme);

            NextWeapon = Gameplay.AddAction("NextWeapon", InputActionType.Button, "<Keyboard>/e", groups: KeyboardMouseScheme);
            NextWeapon.AddBinding("<Gamepad>/buttonNorth", groups: GamepadScheme);
            PreviousWeapon = Gameplay.AddAction("PreviousWeapon", InputActionType.Button, "<Keyboard>/q", groups: KeyboardMouseScheme);
            WeaponScroll = Gameplay.AddAction("WeaponScroll", InputActionType.Value, "<Mouse>/scroll/y", groups: KeyboardMouseScheme);

            Weapon1 = Gameplay.AddAction("Weapon1", InputActionType.Button, "<Keyboard>/1", groups: KeyboardMouseScheme);
            Weapon2 = Gameplay.AddAction("Weapon2", InputActionType.Button, "<Keyboard>/2", groups: KeyboardMouseScheme);
            Weapon3 = Gameplay.AddAction("Weapon3", InputActionType.Button, "<Keyboard>/3", groups: KeyboardMouseScheme);

            Scoreboard = Interface.AddAction("Scoreboard", InputActionType.Button, "<Keyboard>/tab", groups: KeyboardMouseScheme);
            Scoreboard.AddBinding("<Gamepad>/select", groups: GamepadScheme);
            Pause = Interface.AddAction("Pause", InputActionType.Button, "<Keyboard>/escape", groups: KeyboardMouseScheme);
            Pause.AddBinding("<Gamepad>/start", groups: GamepadScheme);
        }

        public void EnableGameplay(bool enabled)
        {
            if (enabled)
            {
                Gameplay.Enable();
            }
            else
            {
                Gameplay.Disable();
            }
        }

        public void EnableAll()
        {
            Gameplay.Enable();
            Interface.Enable();
        }

        public void DisableAll()
        {
            Gameplay.Disable();
            Interface.Disable();
        }

        public string SaveBindingOverrides()
        {
            return Asset.SaveBindingOverridesAsJson();
        }

        public void LoadBindingOverrides(string json)
        {
            if (!string.IsNullOrEmpty(json))
            {
                Asset.LoadBindingOverridesFromJson(json);
            }
        }

        public void Dispose()
        {
            DisableAll();
            if (Asset != null)
            {
                UnityEngine.Object.Destroy(Asset);
            }
        }
    }
}
