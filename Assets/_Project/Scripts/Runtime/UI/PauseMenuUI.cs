using FPS.Controls;
using FPS.Core;
using FPS.Data;
using FPS.Networking;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace FPS.UI
{
    /// <summary>
    /// In-match overlay (ESC): settings (sensitivity, ADS multiplier, FOV, smoothing, volume, HUD scale, crosshair
    /// colour, invert Y, toggle crouch/aim) and leave match. The simulation keeps running - it is a multiplayer game.
    /// </summary>
    public class PauseMenuUI : MonoBehaviour
    {
        [SerializeField] private HUDTheme m_Theme;

        private GameObject m_Panel;
        private Text m_CrosshairLabel;
        private bool m_Open;

        private void Awake()
        {
            if (SystemInfo.graphicsDeviceType == GraphicsDeviceType.Null)
            {
                enabled = false;
                return;
            }

            if (m_Theme == null && GameConfig.Instance != null)
            {
                m_Theme = GameConfig.Instance.hudTheme;
            }

            if (m_Theme == null)
            {
                m_Theme = ScriptableObject.CreateInstance<HUDTheme>();
            }

            UIFactory.EnsureEventSystem();
            Build();
            AudioListener.volume = GameSettings.MasterVolume;
        }

        private void Build()
        {
            HUDTheme t = m_Theme;
            Canvas canvas = UIFactory.CreateCanvas("PauseCanvas", 30, transform);
            Image shade = UIFactory.CreateImage("Shade", canvas.transform, new Color(0f, 0f, 0f, 0.6f), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            UIFactory.Stretch(shade.rectTransform);
            shade.raycastTarget = true;
            m_Panel = shade.gameObject;

            Image panel = UIFactory.CreateImage("Panel", shade.transform, t.panel, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(720f, 820f));
            Transform p = panel.transform;
            UIFactory.CreateText("Title", p, "SETTINGS", 40, TextAnchor.UpperCenter, t.primary, new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0f, -24f), new Vector2(600f, 50f));

            float y = -100f;
            SliderRow(p, "Mouse sensitivity", 0.1f, 5f, GameSettings.MouseSensitivity, v => GameSettings.MouseSensitivity = v, ref y);
            SliderRow(p, "ADS sensitivity", 0.2f, 1.5f, GameSettings.AdsSensitivityMultiplier, v => GameSettings.AdsSensitivityMultiplier = v, ref y);
            SliderRow(p, "Field of view", 60f, 110f, GameSettings.FieldOfView, v => GameSettings.FieldOfView = v, ref y);
            SliderRow(p, "Look smoothing", 0f, 0.08f, GameSettings.LookSmoothing, v => GameSettings.LookSmoothing = v, ref y);
            SliderRow(p, "Master volume", 0f, 1f, GameSettings.MasterVolume, v => GameSettings.MasterVolume = v, ref y);
            SliderRow(p, "HUD scale", 0.6f, 1.6f, GameSettings.HudScale, v => GameSettings.HudScale = v, ref y);

            UIFactory.CreateText("CrosshairTitle", p, "Crosshair colour", 22, TextAnchor.MiddleLeft, t.primary, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(40f, y), new Vector2(300f, 40f), false);
            UIFactory.CreateButton("CrosshairCycle", p, "CHANGE", CycleCrosshair, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(380f, y), new Vector2(140f, 40f), new Color(1f, 1f, 1f, 0.15f), t.primary, 20);
            m_CrosshairLabel = UIFactory.CreateText("CrosshairSwatch", p, "+", 40, TextAnchor.MiddleCenter, GameSettings.CrosshairColor, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(540f, y), new Vector2(60f, 40f));
            y -= 56f;

            UIFactory.CreateToggle("InvertY", p, "Invert Y axis", GameSettings.InvertY, v => GameSettings.InvertY = v, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(40f, y), new Vector2(300f, 32f), t.accent);
            UIFactory.CreateToggle("ToggleCrouch", p, "Toggle crouch", GameSettings.ToggleCrouch, v => GameSettings.ToggleCrouch = v, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(380f, y), new Vector2(300f, 32f), t.accent);
            y -= 48f;
            UIFactory.CreateToggle("ToggleAim", p, "Toggle aim", GameSettings.ToggleAim, v => GameSettings.ToggleAim = v, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(40f, y), new Vector2(300f, 32f), t.accent);
            y -= 70f;

            UIFactory.CreateButton("Resume", p, "RESUME", () => SetOpen(false), new Vector2(0.5f, 1f), new Vector2(1f, 1f), new Vector2(-10f, y), new Vector2(300f, 54f), t.accent, Color.black, 24);
            UIFactory.CreateButton("Leave", p, "LEAVE MATCH", Leave, new Vector2(0.5f, 1f), new Vector2(0f, 1f), new Vector2(10f, y), new Vector2(300f, 54f), new Color(t.danger.r, t.danger.g, t.danger.b, 0.8f), Color.white, 24);

            m_Panel.SetActive(false);
        }

        private void SliderRow(Transform parent, string label, float min, float max, float value, System.Action<float> onChanged, ref float y)
        {
            UIFactory.CreateText(label, parent, label, 22, TextAnchor.MiddleLeft, m_Theme.primary, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(40f, y), new Vector2(300f, 40f), false);
            Text valueText = UIFactory.CreateText(label + "Value", parent, value.ToString("0.00"), 20, TextAnchor.MiddleRight, m_Theme.secondary, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(560f, y), new Vector2(100f, 40f), false);
            UIFactory.CreateSlider(label + "Slider", parent, min, max, value, v =>
            {
                onChanged(v);
                valueText.text = v.ToString("0.00");
            }, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(330f, y), new Vector2(220f, 40f), m_Theme.accent);
            y -= 56f;
        }

        private void CycleCrosshair()
        {
            GameSettings.CrosshairColorIndex = (GameSettings.CrosshairColorIndex + 1) % GameSettings.CrosshairPalette.Length;
            m_CrosshairLabel.color = GameSettings.CrosshairColor;
        }

        private void Update()
        {
            if (InputService.Actions.Pause.WasPressedThisFrame())
            {
                SetOpen(!m_Open);
            }
        }

        private void SetOpen(bool open)
        {
            if (m_Open == open)
            {
                return;
            }

            m_Open = open;
            m_Panel.SetActive(open);
            if (open)
            {
                CursorController.PushUnlock();
            }
            else
            {
                CursorController.PopUnlock();
                GameSettings.Save();
            }

            EventBus<PauseMenuToggledEvent>.Raise(new PauseMenuToggledEvent { IsOpen = open });
        }

        private void Leave()
        {
            GameSettings.Save();
            m_Open = false;
            m_Panel.SetActive(false);
            if (NetworkManagerSetup.Instance != null)
            {
                NetworkManagerSetup.Instance.Disconnect();
            }
        }

        private void OnDisable()
        {
            if (m_Open)
            {
                m_Open = false;
                CursorController.PopUnlock();
            }
        }
    }
}
