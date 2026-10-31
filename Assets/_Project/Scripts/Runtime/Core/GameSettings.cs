using System;
using UnityEngine;

namespace FPS.Core
{
    /// <summary>
    /// Persistent user preferences (PlayerPrefs backed). Exposed as static properties so menus, camera and HUD
    /// can read/write them without scene references. Raises <see cref="Changed"/> after every write.
    /// </summary>
    public static class GameSettings
    {
        private const string k_Prefix = "fps.";

        public static event Action Changed;

        public static float MouseSensitivity
        {
            get => PlayerPrefs.GetFloat(k_Prefix + "sensitivity", 1.0f);
            set => SetFloat("sensitivity", Mathf.Clamp(value, 0.05f, 10f));
        }

        public static float AdsSensitivityMultiplier
        {
            get => PlayerPrefs.GetFloat(k_Prefix + "adsSensitivity", 0.75f);
            set => SetFloat("adsSensitivity", Mathf.Clamp(value, 0.1f, 2f));
        }

        public static bool InvertY
        {
            get => PlayerPrefs.GetInt(k_Prefix + "invertY", 0) == 1;
            set => SetInt("invertY", value ? 1 : 0);
        }

        public static float FieldOfView
        {
            get => PlayerPrefs.GetFloat(k_Prefix + "fov", 78f);
            set => SetFloat("fov", Mathf.Clamp(value, 60f, 110f));
        }

        public static float LookSmoothing
        {
            get => PlayerPrefs.GetFloat(k_Prefix + "lookSmoothing", 0.015f);
            set => SetFloat("lookSmoothing", Mathf.Clamp(value, 0f, 0.1f));
        }

        public static float MasterVolume
        {
            get => PlayerPrefs.GetFloat(k_Prefix + "volume", 0.8f);
            set
            {
                SetFloat("volume", Mathf.Clamp01(value));
                AudioListener.volume = MasterVolume;
            }
        }

        public static bool ToggleCrouch
        {
            get => PlayerPrefs.GetInt(k_Prefix + "toggleCrouch", 0) == 1;
            set => SetInt("toggleCrouch", value ? 1 : 0);
        }

        public static bool ToggleAim
        {
            get => PlayerPrefs.GetInt(k_Prefix + "toggleAim", 0) == 1;
            set => SetInt("toggleAim", value ? 1 : 0);
        }

        public static int CrosshairColorIndex
        {
            get => PlayerPrefs.GetInt(k_Prefix + "crosshairColor", 0);
            set => SetInt("crosshairColor", value);
        }

        public static float HudScale
        {
            get => PlayerPrefs.GetFloat(k_Prefix + "hudScale", 1f);
            set => SetFloat("hudScale", Mathf.Clamp(value, 0.6f, 1.6f));
        }

        public static string PlayerName
        {
            get
            {
                string stored = PlayerPrefs.GetString(k_Prefix + "playerName", string.Empty);
                if (string.IsNullOrWhiteSpace(stored))
                {
                    stored = "Player" + UnityEngine.Random.Range(100, 999);
                    PlayerPrefs.SetString(k_Prefix + "playerName", stored);
                }

                return stored;
            }
            set => SetString("playerName", SanitizeName(value));
        }

        public static string LastAddress
        {
            get => PlayerPrefs.GetString(k_Prefix + "address", "127.0.0.1");
            set => SetString("address", string.IsNullOrWhiteSpace(value) ? "127.0.0.1" : value.Trim());
        }

        public static ushort LastPort
        {
            get => (ushort)Mathf.Clamp(PlayerPrefs.GetInt(k_Prefix + "port", 7777), 1, 65535);
            set => SetInt("port", value);
        }

        public static int BotCount
        {
            get => PlayerPrefs.GetInt(k_Prefix + "botCount", 7);
            set => SetInt("botCount", Mathf.Clamp(value, 0, 31));
        }

        public static int BotDifficultyIndex
        {
            get => PlayerPrefs.GetInt(k_Prefix + "botDifficulty", 1);
            set => SetInt("botDifficulty", Mathf.Max(0, value));
        }

        public static readonly Color[] CrosshairPalette =
        {
            new Color(1f, 1f, 1f, 0.95f),
            new Color(0.25f, 1f, 0.35f, 0.95f),
            new Color(0.2f, 0.95f, 1f, 0.95f),
            new Color(1f, 0.92f, 0.2f, 0.95f),
            new Color(1f, 0.3f, 0.9f, 0.95f),
            new Color(1f, 0.25f, 0.25f, 0.95f)
        };

        public static Color CrosshairColor => CrosshairPalette[Mathf.Abs(CrosshairColorIndex) % CrosshairPalette.Length];

        public static string SanitizeName(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return "Player";
            }

            value = value.Trim();
            var builder = new System.Text.StringBuilder(value.Length);
            foreach (char c in value)
            {
                if (char.IsLetterOrDigit(c) || c == '_' || c == '-' || c == ' ')
                {
                    builder.Append(c);
                }
            }

            string result = builder.ToString();
            if (result.Length > 20)
            {
                result = result.Substring(0, 20);
            }

            return result.Length == 0 ? "Player" : result;
        }

        private static void SetFloat(string key, float value)
        {
            PlayerPrefs.SetFloat(k_Prefix + key, value);
            Changed?.Invoke();
        }

        private static void SetInt(string key, int value)
        {
            PlayerPrefs.SetInt(k_Prefix + key, value);
            Changed?.Invoke();
        }

        private static void SetString(string key, string value)
        {
            PlayerPrefs.SetString(k_Prefix + key, value);
            Changed?.Invoke();
        }

        public static void Save()
        {
            PlayerPrefs.Save();
        }
    }

    /// <summary>Single place that owns the cursor lock state, so menus and gameplay never fight over it.</summary>
    public static class CursorController
    {
        private static int s_UnlockRequests;

        public static bool GameplayHasFocus => s_UnlockRequests == 0;

        public static void PushUnlock()
        {
            s_UnlockRequests++;
            Apply();
        }

        public static void PopUnlock()
        {
            s_UnlockRequests = Mathf.Max(0, s_UnlockRequests - 1);
            Apply();
        }

        public static void ResetToGameplay()
        {
            s_UnlockRequests = 0;
            Apply();
        }

        public static void ForceUnlocked()
        {
            s_UnlockRequests = Mathf.Max(1, s_UnlockRequests);
            Apply();
        }

        private static void Apply()
        {
            bool locked = s_UnlockRequests == 0;
            Cursor.lockState = locked ? CursorLockMode.Locked : CursorLockMode.None;
            Cursor.visible = !locked;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            s_UnlockRequests = 0;
        }
    }
}
