using System;
using System.Collections.Generic;
using FPS.Core;
using FPS.Data;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace FPS.Networking
{
    /// <summary>
    /// Configures and drives Netcode for GameObjects for a client-server (host) topology with server authority.
    ///  * Applies tick rate, connection approval, scene management and network prefab registration at runtime.
    ///  * Host / Client / Dedicated Server entry points with IP + port (Unity Transport).
    ///  * Connection approval validates game version, player name and capacity; player objects are spawned by the
    ///    MatchManager (not automatically) so it can choose teams and safe spawn points.
    ///  * Loads the battlefield through NetworkSceneManager so every client follows the server's scene.
    ///  * Command line for headless servers: -server -port 7777 -bots 10 -difficulty 2  (or -host / -client 1.2.3.4)
    /// Lives in the Bootstrap scene on the same GameObject as NetworkManager and UnityTransport.
    /// </summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(NetworkManager), typeof(UnityTransport))]
    public class NetworkManagerSetup : MonoBehaviour
    {
        [SerializeField] private ushort m_DefaultPort = 7777;
        [SerializeField] private string m_ListenAddress = "0.0.0.0";
        [SerializeField] private bool m_LoadMainMenuOnStart = true;

        private static readonly Dictionary<ulong, string> s_PlayerNames = new Dictionary<ulong, string>();

        private NetworkManager m_Network;
        private UnityTransport m_Transport;
        private GameConfig m_Config;
        private bool m_ReturningToMenu;

        public static NetworkManagerSetup Instance { get; private set; }

        /// <summary>Set when Play is pressed in a gameplay scene: Bootstrap starts a host immediately.</summary>
        public static bool QuickHostRequested { get; set; }

        public static string LastDisconnectReason { get; private set; } = string.Empty;

        public event Action<string> StatusChanged;

        public NetworkManager Network => m_Network;
        public ushort DefaultPort => m_DefaultPort;

        /// <summary>Server only: display name received in each client's connection payload.</summary>
        public static string GetPlayerName(ulong clientId)
        {
            return s_PlayerNames.TryGetValue(clientId, out string name) ? name : "Player" + clientId;
        }

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);

            m_Network = GetComponent<NetworkManager>();
            m_Transport = GetComponent<UnityTransport>();
            m_Config = GameConfig.Instance;
            ConfigureNetworkManager();
        }

        private void ConfigureNetworkManager()
        {
            NetworkConfig config = m_Network.NetworkConfig;
            config.NetworkTransport = m_Transport;
            config.ConnectionApproval = true;
            config.EnableSceneManagement = true;
            config.PlayerPrefab = null; // MatchManager spawns player objects explicitly.
            config.TickRate = (uint)(m_Config != null && m_Config.matchSettings != null ? m_Config.matchSettings.networkTickRate : 60);
            config.ForceSamePrefabs = true;

            if (m_Config != null)
            {
                foreach (GameObject prefab in m_Config.EnumerateNetworkPrefabs())
                {
                    if (!IsPrefabRegistered(prefab))
                    {
                        m_Network.AddNetworkPrefab(prefab);
                    }
                }
            }

            m_Network.ConnectionApprovalCallback = ApproveConnection;
            m_Network.OnClientConnectedCallback += OnClientConnected;
            m_Network.OnClientDisconnectCallback += OnClientDisconnected;
            m_Network.OnServerStarted += OnServerStarted;
            m_Network.OnTransportFailure += OnTransportFailure;
            m_Network.OnClientStopped += OnLocalStopped;
            m_Network.OnServerStopped += OnLocalStopped;
        }

        private bool IsPrefabRegistered(GameObject prefab)
        {
            NetworkPrefabs prefabs = m_Network.NetworkConfig.Prefabs;
            if (prefabs.Contains(prefab))
            {
                return true;
            }

            foreach (NetworkPrefabsList list in prefabs.NetworkPrefabsLists)
            {
                if (list == null)
                {
                    continue;
                }

                foreach (NetworkPrefab entry in list.PrefabList)
                {
                    if (entry.Prefab == prefab)
                    {
                        return true;
                    }
                }
            }

            return false;
        }

        private void OnDestroy()
        {
            if (Instance == this)
            {
                Instance = null;
            }

            if (m_Network != null)
            {
                m_Network.OnClientConnectedCallback -= OnClientConnected;
                m_Network.OnClientDisconnectCallback -= OnClientDisconnected;
                m_Network.OnServerStarted -= OnServerStarted;
                m_Network.OnTransportFailure -= OnTransportFailure;
                m_Network.OnClientStopped -= OnLocalStopped;
                m_Network.OnServerStopped -= OnLocalStopped;
            }
        }

        private void Start()
        {
            if (TryHandleCommandLine())
            {
                return;
            }

            if (QuickHostRequested)
            {
                QuickHostRequested = false;
                StartHost(m_DefaultPort);
                return;
            }

            if (Application.isBatchMode)
            {
                StartDedicatedServer(m_DefaultPort);
                return;
            }

            if (m_LoadMainMenuOnStart && m_Config != null && SceneManager.GetActiveScene().name == m_Config.bootstrapScene)
            {
                SceneManager.LoadScene(m_Config.mainMenuScene);
            }
        }

        private bool TryHandleCommandLine()
        {
            string[] args = Environment.GetCommandLineArgs();
            ushort port = m_DefaultPort;
            string mode = null;
            string address = "127.0.0.1";

            for (int i = 0; i < args.Length; i++)
            {
                string arg = args[i].ToLowerInvariant();
                string next = i + 1 < args.Length ? args[i + 1] : null;
                switch (arg)
                {
                    case "-server":
                    case "-dedicated":
                        mode = "server";
                        break;
                    case "-host":
                        mode = "host";
                        break;
                    case "-client":
                        mode = "client";
                        if (next != null && !next.StartsWith("-")) address = next;
                        break;
                    case "-port":
                        if (next != null && ushort.TryParse(next, out ushort parsedPort)) port = parsedPort;
                        break;
                    case "-bots":
                        if (next != null && int.TryParse(next, out int bots)) MatchLaunchOptions.BotCount = Mathf.Clamp(bots, 0, 31);
                        break;
                    case "-difficulty":
                        if (next != null && int.TryParse(next, out int difficulty)) MatchLaunchOptions.DifficultyIndex = difficulty;
                        break;
                    case "-name":
                        if (next != null) GameSettings.PlayerName = next;
                        break;
                }
            }

            switch (mode)
            {
                case "server": return StartDedicatedServer(port);
                case "host": return StartHost(port);
                case "client": return StartClient(address, port);
                default: return false;
            }
        }

        // ------------------------------------------------------------------------------------------------
        // Entry points
        // ------------------------------------------------------------------------------------------------

        public bool StartHost(ushort port)
        {
            if (m_Network.IsListening)
            {
                return false;
            }

            m_Transport.SetConnectionData("127.0.0.1", port, m_ListenAddress);
            m_Network.NetworkConfig.ConnectionData = BuildPayload();
            Report("Starting host on port " + port + "...");
            if (!m_Network.StartHost())
            {
                Report("Failed to start host (is port " + port + " already in use?)");
                return false;
            }

            return true;
        }

        public bool StartClient(string address, ushort port)
        {
            if (m_Network.IsListening)
            {
                return false;
            }

            m_Transport.SetConnectionData(string.IsNullOrWhiteSpace(address) ? "127.0.0.1" : address.Trim(), port);
            m_Network.NetworkConfig.ConnectionData = BuildPayload();
            Report("Connecting to " + address + ":" + port + "...");
            if (!m_Network.StartClient())
            {
                Report("Failed to start client.");
                return false;
            }

            return true;
        }

        public bool StartDedicatedServer(ushort port)
        {
            if (m_Network.IsListening)
            {
                return false;
            }

            Application.targetFrameRate = Mathf.Max(30, (int)m_Network.NetworkConfig.TickRate);
            m_Transport.SetConnectionData("0.0.0.0", port, m_ListenAddress);
            Report("Starting dedicated server on port " + port + "...");
            if (!m_Network.StartServer())
            {
                Report("Failed to start server.");
                return false;
            }

            return true;
        }

        /// <summary>Leaves the current session (any role) and returns to the main menu.</summary>
        public void Disconnect()
        {
            if (m_Network.IsListening)
            {
                m_Network.Shutdown();
            }

            ReturnToMenu();
        }

        private byte[] BuildPayload()
        {
            var payload = new ConnectionPayload
            {
                playerName = GameSettings.PlayerName,
                gameVersion = m_Config != null && m_Config.matchSettings != null ? m_Config.matchSettings.gameVersion : Application.version
            };
            return payload.ToBytes();
        }

        // ------------------------------------------------------------------------------------------------
        // Callbacks
        // ------------------------------------------------------------------------------------------------

        private void OnServerStarted()
        {
            Report("Server started.");
            if (m_Config == null)
            {
                return;
            }

            SceneEventProgressStatus status = m_Network.SceneManager.LoadScene(m_Config.battlefieldScene, LoadSceneMode.Single);
            if (status != SceneEventProgressStatus.Started)
            {
                Debug.LogError("[FPS] Could not load scene '" + m_Config.battlefieldScene + "': " + status + ". Is it in the Build Settings?");
            }
        }

        private void ApproveConnection(NetworkManager.ConnectionApprovalRequest request, NetworkManager.ConnectionApprovalResponse response)
        {
            ConnectionPayload payload = ConnectionPayload.FromBytes(request.Payload);
            string expectedVersion = m_Config != null && m_Config.matchSettings != null ? m_Config.matchSettings.gameVersion : Application.version;
            int maxPlayers = m_Config != null && m_Config.matchSettings != null ? m_Config.matchSettings.maxHumanPlayers : 16;

            response.CreatePlayerObject = false;
            response.Pending = false;

            if (payload == null)
            {
                response.Approved = false;
                response.Reason = "Invalid connection payload.";
                return;
            }

            if (payload.gameVersion != expectedVersion)
            {
                response.Approved = false;
                response.Reason = "Version mismatch (server " + expectedVersion + ", client " + payload.gameVersion + ").";
                return;
            }

            if (request.ClientNetworkId != NetworkManager.ServerClientId && m_Network.ConnectedClientsIds.Count >= maxPlayers)
            {
                response.Approved = false;
                response.Reason = "Server is full.";
                return;
            }

            s_PlayerNames[request.ClientNetworkId] = GameSettings.SanitizeName(payload.playerName);
            response.Approved = true;
        }

        private void OnClientConnected(ulong clientId)
        {
            if (m_Network.IsServer)
            {
                Report(GetPlayerName(clientId) + " connected.");
            }
            else if (clientId == m_Network.LocalClientId)
            {
                Report("Connected.");
            }
        }

        private void OnClientDisconnected(ulong clientId)
        {
            if (m_Network.IsServer)
            {
                Report(GetPlayerName(clientId) + " disconnected.");
                s_PlayerNames.Remove(clientId);
                return;
            }

            // We are a client and got disconnected (kicked, server closed, rejected).
            if (clientId == m_Network.LocalClientId || clientId == NetworkManager.ServerClientId)
            {
                LastDisconnectReason = string.IsNullOrEmpty(m_Network.DisconnectReason) ? "Disconnected from server." : m_Network.DisconnectReason;
                Report(LastDisconnectReason);
            }
        }

        private void OnTransportFailure()
        {
            LastDisconnectReason = "Network transport failure.";
            Report(LastDisconnectReason);
            ReturnToMenu();
        }

        private void OnLocalStopped(bool wasHost)
        {
            s_PlayerNames.Clear();
            ReturnToMenu();
        }

        private void ReturnToMenu()
        {
            if (m_ReturningToMenu || m_Config == null || Application.isBatchMode)
            {
                return;
            }

            m_ReturningToMenu = true;
            CursorController.ForceUnlocked();
            if (SceneManager.GetActiveScene().name != m_Config.mainMenuScene)
            {
                SceneManager.LoadScene(m_Config.mainMenuScene);
            }

            m_ReturningToMenu = false;
        }

        private void Report(string message)
        {
            Debug.Log("[FPS][Net] " + message);
            StatusChanged?.Invoke(message);
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            s_PlayerNames.Clear();
            QuickHostRequested = false;
            LastDisconnectReason = string.Empty;
            Instance = null;
        }
    }
}
