using FPS.Core;
using FPS.Data;
using FPS.Networking;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace FPS.UI
{
    /// <summary>
    /// Main menu / lobby front-end: player name, host (port, bot count, bot difficulty), join (address, port),
    /// dedicated server, quick settings and connection status. Built procedurally; lives in the MainMenu scene.
    /// </summary>
    public class MainMenuUI : MonoBehaviour
    {
        [SerializeField] private HUDTheme m_Theme;

        private InputField m_NameField;
        private InputField m_AddressField;
        private InputField m_PortField;
        private Text m_BotsLabel;
        private Text m_DifficultyLabel;
        private Text m_StatusText;
        private int m_BotCount;
        private int m_DifficultyIndex;
        private GameConfig m_Config;

        private void Awake()
        {
            m_Config = GameConfig.Instance;
            if (m_Theme == null && m_Config != null)
            {
                m_Theme = m_Config.hudTheme;
            }

            if (m_Theme == null)
            {
                m_Theme = ScriptableObject.CreateInstance<HUDTheme>();
            }

            m_BotCount = GameSettings.BotCount;
            m_DifficultyIndex = GameSettings.BotDifficultyIndex;
            UIFactory.EnsureEventSystem();
            Build();
        }

        private void OnEnable()
        {
            CursorController.ForceUnlocked();
            if (NetworkManagerSetup.Instance != null)
            {
                NetworkManagerSetup.Instance.StatusChanged += OnStatus;
            }
        }

        private void OnDisable()
        {
            if (NetworkManagerSetup.Instance != null)
            {
                NetworkManagerSetup.Instance.StatusChanged -= OnStatus;
            }
        }

        private void Start()
        {
            if (NetworkManagerSetup.Instance == null && m_Config != null)
            {
                // The menu was opened directly: the network bootstrap must run first.
                SceneManager.LoadScene(m_Config.bootstrapScene);
                return;
            }

            OnStatus(string.IsNullOrEmpty(NetworkManagerSetup.LastDisconnectReason) ? "Ready." : NetworkManagerSetup.LastDisconnectReason);
        }

        private void Build()
        {
            HUDTheme t = m_Theme;
            Canvas canvas = UIFactory.CreateCanvas("MenuCanvas", 20, transform);
            RectTransform root = UIFactory.Stretch(UIFactory.CreateRect("Root", canvas.transform, Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero));
            Image background = UIFactory.CreateImage("Shade", root, new Color(0.02f, 0.03f, 0.05f, 0.55f), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            UIFactory.Stretch(background.rectTransform);

            UIFactory.CreateText("Title", root, "PROJECT <color=#" + UIFactory.ToHex(t.accent) + ">VANGUARD</color>", 72, TextAnchor.MiddleLeft, t.primary,
                new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(120f, -110f), new Vector2(1200f, 90f));
            UIFactory.CreateText("Subtitle", root, "Tactical FPS prototype  -  humans and bots, server-authoritative multiplayer", 24, TextAnchor.MiddleLeft, t.secondary,
                new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(124f, -170f), new Vector2(1200f, 30f));

            Image panel = UIFactory.CreateImage("Panel", root, t.panel, new Vector2(0f, 0.5f), new Vector2(0f, 0.5f), new Vector2(120f, -40f), new Vector2(620f, 640f));
            Transform p = panel.transform;
            float y = -30f;

            Label(p, "PLAYER NAME", ref y);
            m_NameField = UIFactory.CreateInputField("Name", p, GameSettings.PlayerName, "Enter a name", new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(30f, y), new Vector2(560f, 44f));
            y -= 70f;

            Label(p, "HOST A MATCH", ref y);
            m_BotsLabel = Row(p, "Bots", ref y, () => ChangeBots(-1), () => ChangeBots(1));
            m_DifficultyLabel = Row(p, "Difficulty", ref y, () => ChangeDifficulty(-1), () => ChangeDifficulty(1));
            UIFactory.CreateButton("Host", p, "HOST GAME", OnHost, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(30f, y), new Vector2(270f, 54f), t.accent, Color.black, 26);
            UIFactory.CreateButton("Server", p, "DEDICATED SERVER", OnServer, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(320f, y), new Vector2(270f, 54f), new Color(1f, 1f, 1f, 0.15f), t.primary, 20);
            y -= 84f;

            Label(p, "JOIN A MATCH", ref y);
            m_AddressField = UIFactory.CreateInputField("Address", p, GameSettings.LastAddress, "Server IP", new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(30f, y), new Vector2(380f, 44f));
            m_PortField = UIFactory.CreateInputField("Port", p, GameSettings.LastPort.ToString(), "Port", new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(420f, y), new Vector2(170f, 44f));
            m_PortField.contentType = InputField.ContentType.IntegerNumber;
            y -= 60f;
            UIFactory.CreateButton("Join", p, "JOIN GAME", OnJoin, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(30f, y), new Vector2(560f, 54f), t.accent, Color.black, 26);
            y -= 80f;

            UIFactory.CreateButton("Quit", p, "QUIT", OnQuit, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(30f, y), new Vector2(160f, 44f), new Color(1f, 1f, 1f, 0.1f), t.primary, 20);

            m_StatusText = UIFactory.CreateText("Status", root, string.Empty, 22, TextAnchor.LowerLeft, t.secondary, new Vector2(0f, 0f), new Vector2(0f, 0f), new Vector2(124f, 40f), new Vector2(1400f, 30f));

            UIFactory.CreateText("Controls", root,
                "WASD move   SHIFT sprint   SPACE jump   CTRL/C crouch   LMB fire   RMB aim   R reload   1-3 / Q / E / wheel switch   TAB scoreboard   ESC menu",
                18, TextAnchor.LowerRight, t.secondary, new Vector2(1f, 0f), new Vector2(1f, 0f), new Vector2(-60f, 40f), new Vector2(1400f, 30f));

            RefreshLabels();
        }

        private void Label(Transform parent, string text, ref float y)
        {
            UIFactory.CreateText(text, parent, text, 18, TextAnchor.LowerLeft, m_Theme.accent, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(30f, y), new Vector2(560f, 24f), false);
            y -= 30f;
        }

        private Text Row(Transform parent, string label, ref float y, System.Action decrease, System.Action increase)
        {
            UIFactory.CreateText(label, parent, label, 22, TextAnchor.MiddleLeft, m_Theme.primary, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(30f, y), new Vector2(200f, 44f), false);
            UIFactory.CreateButton(label + "Minus", parent, "<", decrease, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(330f, y), new Vector2(44f, 44f), new Color(1f, 1f, 1f, 0.15f), m_Theme.primary);
            Text value = UIFactory.CreateText(label + "Value", parent, string.Empty, 22, TextAnchor.MiddleCenter, m_Theme.primary, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(380f, y), new Vector2(160f, 44f), false);
            UIFactory.CreateButton(label + "Plus", parent, ">", increase, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(546f, y), new Vector2(44f, 44f), new Color(1f, 1f, 1f, 0.15f), m_Theme.primary);
            y -= 54f;
            return value;
        }

        private void ChangeBots(int delta)
        {
            m_BotCount = Mathf.Clamp(m_BotCount + delta, 0, 31);
            RefreshLabels();
        }

        private void ChangeDifficulty(int delta)
        {
            int count = m_Config != null && m_Config.difficulties.Count > 0 ? m_Config.difficulties.Count : 1;
            m_DifficultyIndex = (m_DifficultyIndex + delta + count) % count;
            RefreshLabels();
        }

        private void RefreshLabels()
        {
            m_BotsLabel.text = m_BotCount.ToString();
            BotDifficultyProfile difficulty = m_Config != null ? m_Config.GetDifficulty(m_DifficultyIndex) : null;
            m_DifficultyLabel.text = difficulty != null ? difficulty.displayName : "Normal";
        }

        private ushort ParsePort()
        {
            return ushort.TryParse(m_PortField.text, out ushort port) && port > 0 ? port : (ushort)7777;
        }

        private void SaveSettings()
        {
            GameSettings.PlayerName = m_NameField.text;
            GameSettings.LastAddress = m_AddressField.text;
            GameSettings.LastPort = ParsePort();
            GameSettings.BotCount = m_BotCount;
            GameSettings.BotDifficultyIndex = m_DifficultyIndex;
            GameSettings.Save();
            MatchLaunchOptions.BotCount = m_BotCount;
            MatchLaunchOptions.DifficultyIndex = m_DifficultyIndex;
        }

        private void OnHost()
        {
            SaveSettings();
            if (NetworkManagerSetup.Instance != null)
            {
                NetworkManagerSetup.Instance.StartHost(ParsePort());
            }
        }

        private void OnServer()
        {
            SaveSettings();
            if (NetworkManagerSetup.Instance != null)
            {
                NetworkManagerSetup.Instance.StartDedicatedServer(ParsePort());
            }
        }

        private void OnJoin()
        {
            SaveSettings();
            if (NetworkManagerSetup.Instance != null)
            {
                NetworkManagerSetup.Instance.StartClient(m_AddressField.text, ParsePort());
            }
        }

        private static void OnQuit()
        {
#if UNITY_EDITOR
            UnityEditor.EditorApplication.isPlaying = false;
#else
            Application.Quit();
#endif
        }

        private void OnStatus(string message)
        {
            if (m_StatusText != null)
            {
                m_StatusText.text = message;
            }
        }
    }
}
