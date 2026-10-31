using System;
using System.Collections.Generic;
using FPS.AI;
using FPS.Combat;
using FPS.Core;
using FPS.Data;
using FPS.Weapons;
using FPS.World;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace FPS.Networking
{
    /// <summary>
    /// Server-authoritative match director (Domination rules): warmup -> match -> post-match loop, team scores
    /// from kills and held capture zones, replicated scoreboard, kill feed, respawn queue, human player spawning,
    /// team balancing and bot back-fill so humans and bots share the same match seamlessly.
    /// Spawned by <see cref="BattlefieldDirector"/> on the server when the battlefield scene loads.
    /// </summary>
    public class MatchManager : NetworkBehaviour
    {
        private struct PendingRespawn
        {
            public Combatant Combatant;
            public float Time;
        }

        private readonly NetworkVariable<MatchPhase> m_Phase = new NetworkVariable<MatchPhase>(MatchPhase.Warmup);
        private readonly NetworkVariable<double> m_PhaseEndTime = new NetworkVariable<double>(0d);
        private readonly NetworkVariable<int> m_AlphaScore = new NetworkVariable<int>(0);
        private readonly NetworkVariable<int> m_BravoScore = new NetworkVariable<int>(0);
        private readonly NetworkVariable<Team> m_Winner = new NetworkVariable<Team>(Team.Neutral);
        private NetworkList<ScoreEntry> m_Scoreboard;

        private readonly List<PendingRespawn> m_Respawns = new List<PendingRespawn>(32);
        private readonly List<Combatant> m_Bots = new List<Combatant>(32);
        private GameConfig m_Config;
        private MatchSettings m_Settings;
        private BotDifficultyProfile m_Difficulty;
        private int m_TargetBotCount;
        private float m_NextZoneTick;
        private int m_BotNameIndex;
        private bool m_RebalancePending;

        public static MatchManager Instance { get; private set; }

        /// <summary>Raised on every peer when the match phase changes.</summary>
        public event Action<MatchPhase> PhaseChanged;

        public MatchPhase Phase => m_Phase.Value;
        public int AlphaScore => m_AlphaScore.Value;
        public int BravoScore => m_BravoScore.Value;
        public Team Winner => m_Winner.Value;
        public int ScoreLimit => m_Settings != null ? m_Settings.scoreLimit : 1000;
        public NetworkList<ScoreEntry> Scoreboard => m_Scoreboard;

        public float PhaseTimeRemaining
        {
            get
            {
                if (!IsSpawned || NetworkManager == null)
                {
                    return 0f;
                }

                return Mathf.Max(0f, (float)(m_PhaseEndTime.Value - NetworkManager.ServerTime.Time));
            }
        }

        private void Awake()
        {
            m_Scoreboard = new NetworkList<ScoreEntry>();
            m_Config = GameConfig.Instance;
            m_Settings = m_Config != null ? m_Config.matchSettings : null;
            if (m_Settings == null)
            {
                m_Settings = ScriptableObject.CreateInstance<MatchSettings>();
            }
        }

        public override void OnNetworkSpawn()
        {
            Instance = this;
            m_Phase.OnValueChanged += OnPhaseValueChanged;

            if (!IsServer)
            {
                return;
            }

            m_TargetBotCount = MatchLaunchOptions.BotCount >= 0 ? MatchLaunchOptions.BotCount : m_Settings.defaultBotCount;
            int difficultyIndex = MatchLaunchOptions.DifficultyIndex >= 0 ? MatchLaunchOptions.DifficultyIndex : (m_Config != null ? m_Config.defaultDifficultyIndex : 1);
            m_Difficulty = m_Config != null ? m_Config.GetDifficulty(difficultyIndex) : null;

            HealthSystem.ServerDied += OnServerDied;
            NetworkManager.OnClientDisconnectCallback += OnClientDisconnected;
            NetworkManager.SceneManager.OnSynchronizeComplete += OnClientSynchronized;
            NetworkManager.SceneManager.OnLoadEventCompleted += OnLoadEventCompleted;

            BeginPhase(MatchPhase.Warmup, m_Settings.warmupDuration);
            foreach (ulong clientId in NetworkManager.ConnectedClientsIds)
            {
                SpawnPlayer(clientId);
            }

            RebalanceBots();
        }

        public override void OnNetworkDespawn()
        {
            m_Phase.OnValueChanged -= OnPhaseValueChanged;
            if (Instance == this)
            {
                Instance = null;
            }

            if (!IsServer)
            {
                return;
            }

            HealthSystem.ServerDied -= OnServerDied;
            if (NetworkManager != null)
            {
                NetworkManager.OnClientDisconnectCallback -= OnClientDisconnected;
                if (NetworkManager.SceneManager != null)
                {
                    NetworkManager.SceneManager.OnSynchronizeComplete -= OnClientSynchronized;
                    NetworkManager.SceneManager.OnLoadEventCompleted -= OnLoadEventCompleted;
                }
            }

            BotSquadManager.Clear();
        }

        private void OnPhaseValueChanged(MatchPhase previous, MatchPhase current)
        {
            PhaseChanged?.Invoke(current);
        }

        // ------------------------------------------------------------------------------------------------
        // Connections & spawning (server)
        // ------------------------------------------------------------------------------------------------

        private void OnClientSynchronized(ulong clientId)
        {
            SpawnPlayer(clientId);
        }

        private void OnLoadEventCompleted(string sceneName, LoadSceneMode mode, List<ulong> completed, List<ulong> timedOut)
        {
            foreach (ulong clientId in completed)
            {
                SpawnPlayer(clientId);
            }
        }

        private void OnClientDisconnected(ulong clientId)
        {
            for (int i = m_Scoreboard.Count - 1; i >= 0; i--)
            {
                if (!m_Scoreboard[i].IsBot && m_Scoreboard[i].ClientId == clientId)
                {
                    m_Scoreboard.RemoveAt(i);
                }
            }

            // The player object is despawned after this callback; rebalance on the next frame.
            m_RebalancePending = true;
        }

        private void SpawnPlayer(ulong clientId)
        {
            if (m_Config == null || m_Config.playerPrefab == null || !NetworkManager.ConnectedClients.ContainsKey(clientId))
            {
                return;
            }

            if (NetworkManager.SpawnManager.GetPlayerNetworkObject(clientId) != null)
            {
                return;
            }

            Team team = PickTeamForHuman();
            SpawnSelector.TryPick(team, out Vector3 position, out Quaternion rotation);
            GameObject instance = Instantiate(m_Config.playerPrefab, position, rotation);
            var networkObject = instance.GetComponent<NetworkObject>();
            networkObject.SpawnAsPlayerObject(clientId, true);

            var combatant = instance.GetComponent<Combatant>();
            combatant.ServerInitialize(team, NetworkManagerSetup.GetPlayerName(clientId), false);
            AddScoreEntry(combatant, clientId);
            RebalanceBots();
        }

        private Team PickTeamForHuman()
        {
            int alphaHumans = 0;
            int bravoHumans = 0;
            int alphaTotal = 0;
            int bravoTotal = 0;
            foreach (Combatant combatant in CombatantRegistry.All)
            {
                if (combatant == null) continue;
                if (combatant.Team == Team.Alpha) { alphaTotal++; if (!combatant.IsBot) alphaHumans++; }
                if (combatant.Team == Team.Bravo) { bravoTotal++; if (!combatant.IsBot) bravoHumans++; }
            }

            if (alphaHumans != bravoHumans)
            {
                return alphaHumans < bravoHumans ? Team.Alpha : Team.Bravo;
            }

            return alphaTotal <= bravoTotal ? Team.Alpha : Team.Bravo;
        }

        /// <summary>Keeps both teams the same size by adding/removing bots around the human players.</summary>
        private void RebalanceBots()
        {
            if (!IsServer || m_Config == null || m_Config.botPrefab == null)
            {
                return;
            }

            m_Bots.RemoveAll(b => b == null || !b.IsSpawned);
            int humansAlpha = 0;
            int humansBravo = 0;
            foreach (Combatant combatant in CombatantRegistry.All)
            {
                if (combatant == null || combatant.IsBot) continue;
                if (combatant.Team == Team.Alpha) humansAlpha++;
                else if (combatant.Team == Team.Bravo) humansBravo++;
            }

            int total = humansAlpha + humansBravo + m_TargetBotCount;
            int targetAlpha = Mathf.CeilToInt(total * 0.5f);
            int targetBravo = total - targetAlpha;
            int wantedAlpha = Mathf.Max(0, targetAlpha - humansAlpha);
            int wantedBravo = Mathf.Max(0, targetBravo - humansBravo);

            AdjustBots(Team.Alpha, wantedAlpha);
            AdjustBots(Team.Bravo, wantedBravo);
        }

        private void AdjustBots(Team team, int wanted)
        {
            int current = 0;
            foreach (Combatant bot in m_Bots)
            {
                if (bot.Team == team) current++;
            }

            while (current < wanted)
            {
                SpawnBot(team);
                current++;
            }

            for (int i = m_Bots.Count - 1; i >= 0 && current > wanted; i--)
            {
                if (m_Bots[i].Team == team)
                {
                    DespawnBot(m_Bots[i]);
                    current--;
                }
            }
        }

        private void SpawnBot(Team team)
        {
            SpawnSelector.TryPick(team, out Vector3 position, out Quaternion rotation);
            GameObject instance = Instantiate(m_Config.botPrefab, position, rotation);
            var networkObject = instance.GetComponent<NetworkObject>();
            networkObject.Spawn(true);

            var combatant = instance.GetComponent<Combatant>();
            string[] names = m_Config.botNames;
            string botName = names != null && names.Length > 0 ? "BOT " + names[m_BotNameIndex++ % names.Length] : "BOT " + m_BotNameIndex++;
            combatant.ServerInitialize(team, botName, true);

            var weapons = instance.GetComponent<WeaponSystem>();
            List<WeaponData> pool = m_Config.botLoadoutPool != null && m_Config.botLoadoutPool.Count > 0 ? m_Config.botLoadoutPool : m_Config.playerLoadout;
            if (weapons != null && pool != null && pool.Count > 0)
            {
                weapons.ServerSetLoadout(new List<WeaponData> { pool[UnityEngine.Random.Range(0, pool.Count)] });
            }

            var brain = instance.GetComponent<AdvancedBotAI>();
            if (brain != null)
            {
                brain.ServerConfigure(m_Difficulty);
            }

            m_Bots.Add(combatant);
            AddScoreEntry(combatant, ulong.MaxValue);
        }

        private void DespawnBot(Combatant bot)
        {
            m_Bots.Remove(bot);
            RemoveScoreEntry(bot.CombatantId);
            m_Respawns.RemoveAll(r => r.Combatant == bot);
            if (bot.NetworkObject != null && bot.NetworkObject.IsSpawned)
            {
                bot.NetworkObject.Despawn(true);
            }
        }

        // ------------------------------------------------------------------------------------------------
        // Scoreboard
        // ------------------------------------------------------------------------------------------------

        private void AddScoreEntry(Combatant combatant, ulong clientId)
        {
            RemoveScoreEntry(combatant.CombatantId);
            m_Scoreboard.Add(new ScoreEntry
            {
                CombatantId = combatant.CombatantId,
                ClientId = clientId,
                Name = new FixedString32Bytes(combatant.DisplayName),
                Team = combatant.Team,
                IsBot = combatant.IsBot
            });
        }

        private void RemoveScoreEntry(ulong combatantId)
        {
            for (int i = m_Scoreboard.Count - 1; i >= 0; i--)
            {
                if (m_Scoreboard[i].CombatantId == combatantId)
                {
                    m_Scoreboard.RemoveAt(i);
                }
            }
        }

        private void ModifyEntry(ulong combatantId, int kills, int deaths, int score, int captures)
        {
            for (int i = 0; i < m_Scoreboard.Count; i++)
            {
                if (m_Scoreboard[i].CombatantId != combatantId)
                {
                    continue;
                }

                ScoreEntry entry = m_Scoreboard[i];
                entry.Kills += kills;
                entry.Deaths += deaths;
                entry.Score += score;
                entry.Captures += captures;
                m_Scoreboard[i] = entry;
                return;
            }
        }

        public void CopyScoreboard(List<ScoreEntry> results)
        {
            results.Clear();
            if (m_Scoreboard == null)
            {
                return;
            }

            for (int i = 0; i < m_Scoreboard.Count; i++)
            {
                results.Add(m_Scoreboard[i]);
            }
        }

        private void AddTeamScore(Team team, int points)
        {
            if (m_Phase.Value != MatchPhase.InProgress || points == 0)
            {
                return;
            }

            if (team == Team.Alpha) m_AlphaScore.Value += points;
            else if (team == Team.Bravo) m_BravoScore.Value += points;
        }

        // ------------------------------------------------------------------------------------------------
        // Combat events (server)
        // ------------------------------------------------------------------------------------------------

        private void OnServerDied(HealthSystem victimHealth, DamageInfo damage)
        {
            Combatant victim = victimHealth != null ? victimHealth.Combatant : null;
            if (victim == null)
            {
                return;
            }

            Combatant killer = damage.HasAttacker ? CombatantRegistry.Find(damage.AttackerId) : null;
            bool suicide = killer == null || killer == victim;
            bool inProgress = m_Phase.Value == MatchPhase.InProgress;

            ModifyEntry(victim.CombatantId, 0, 1, 0, 0);
            if (!suicide && killer.Team != victim.Team)
            {
                int points = m_Settings.killScore + (damage.IsHeadshot ? m_Settings.headshotBonus : 0);
                ModifyEntry(killer.CombatantId, 1, 0, points, 0);
                if (inProgress)
                {
                    AddTeamScore(killer.Team, Mathf.Max(1, m_Settings.killScore / 2));
                }
            }

            WeaponData weapon = m_Config != null ? m_Config.FindWeapon(damage.WeaponId) : null;
            string weaponName = weapon != null ? weapon.displayName : damage.Type.ToString();
            KillFeedRpc(suicide ? string.Empty : killer.DisplayName, victim.DisplayName, weaponName,
                suicide ? Team.Neutral : killer.Team, victim.Team, damage.IsHeadshot);

            m_Respawns.Add(new PendingRespawn { Combatant = victim, Time = Time.time + m_Settings.respawnDelay });
        }

        /// <summary>Called by CaptureZone on the server when a team completes a capture.</summary>
        public void ServerOnZoneCaptured(CaptureZone zone, Team team, List<Combatant> capturers)
        {
            if (!IsServer)
            {
                return;
            }

            AddTeamScore(team, m_Settings.captureScore);
            if (capturers != null)
            {
                foreach (Combatant capturer in capturers)
                {
                    if (capturer != null && capturer.Team == team)
                    {
                        ModifyEntry(capturer.CombatantId, 0, 0, m_Settings.captureScore, 1);
                    }
                }
            }

            AnnounceRpc(TeamUtility.GetName(team) + " captured " + zone.DisplayName, (byte)team);
        }

        [Rpc(SendTo.ClientsAndHost, Delivery = RpcDelivery.Reliable)]
        private void KillFeedRpc(string killer, string victim, string weapon, Team killerTeam, Team victimTeam, bool headshot)
        {
            EventBus<KillFeedEvent>.Raise(new KillFeedEvent
            {
                KillerName = killer,
                VictimName = victim,
                WeaponName = weapon,
                KillerTeam = killerTeam,
                VictimTeam = victimTeam,
                Headshot = headshot
            });
        }

        [Rpc(SendTo.ClientsAndHost, Delivery = RpcDelivery.Reliable)]
        private void AnnounceRpc(string message, byte team)
        {
            EventBus<MatchAnnouncementEvent>.Raise(new MatchAnnouncementEvent
            {
                Message = message,
                Color = TeamUtility.GetColor((Team)team),
                Duration = 3.5f
            });
        }

        // ------------------------------------------------------------------------------------------------
        // Match flow (server)
        // ------------------------------------------------------------------------------------------------

        private void Update()
        {
            if (!IsServer || !IsSpawned)
            {
                return;
            }

            BotSquadManager.Tick();
            ProcessRespawns();
            if (m_RebalancePending)
            {
                m_RebalancePending = false;
                RebalanceBots();
            }

            double now = NetworkManager.ServerTime.Time;
            switch (m_Phase.Value)
            {
                case MatchPhase.Warmup:
                    if (now >= m_PhaseEndTime.Value)
                    {
                        StartMatch();
                    }

                    break;

                case MatchPhase.InProgress:
                    if (Time.time >= m_NextZoneTick)
                    {
                        m_NextZoneTick = Time.time + m_Settings.zoneTickInterval;
                        foreach (IObjective objective in ObjectiveRegistry.All)
                        {
                            if (objective.OwnerTeam != Team.Neutral)
                            {
                                AddTeamScore(objective.OwnerTeam, m_Settings.zoneTickPoints);
                            }
                        }
                    }

                    if (m_AlphaScore.Value >= m_Settings.scoreLimit || m_BravoScore.Value >= m_Settings.scoreLimit || now >= m_PhaseEndTime.Value)
                    {
                        EndMatch();
                    }

                    break;

                case MatchPhase.PostMatch:
                    if (now >= m_PhaseEndTime.Value)
                    {
                        RestartToWarmup();
                    }

                    break;
            }
        }

        private void BeginPhase(MatchPhase phase, float duration)
        {
            m_Phase.Value = phase;
            m_PhaseEndTime.Value = NetworkManager.ServerTime.Time + Mathf.Max(0f, duration);
        }

        private void StartMatch()
        {
            m_AlphaScore.Value = 0;
            m_BravoScore.Value = 0;
            m_Winner.Value = Team.Neutral;
            for (int i = 0; i < m_Scoreboard.Count; i++)
            {
                ScoreEntry entry = m_Scoreboard[i];
                entry.Kills = 0;
                entry.Deaths = 0;
                entry.Score = 0;
                entry.Captures = 0;
                m_Scoreboard[i] = entry;
            }

            ResetZones();
            RespawnEveryone();
            BeginPhase(MatchPhase.InProgress, m_Settings.matchDuration);
            m_NextZoneTick = Time.time + m_Settings.zoneTickInterval;
            AnnounceRpc("MATCH STARTED - CAPTURE AND HOLD THE OBJECTIVES", (byte)Team.Neutral);
        }

        private void EndMatch()
        {
            Team winner = m_AlphaScore.Value == m_BravoScore.Value ? Team.Neutral : m_AlphaScore.Value > m_BravoScore.Value ? Team.Alpha : Team.Bravo;
            m_Winner.Value = winner;
            BeginPhase(MatchPhase.PostMatch, m_Settings.postMatchDuration);
            AnnounceRpc(winner == Team.Neutral ? "DRAW" : TeamUtility.GetName(winner) + " WINS", (byte)winner);
        }

        private void RestartToWarmup()
        {
            ResetZones();
            RespawnEveryone();
            BeginPhase(MatchPhase.Warmup, m_Settings.warmupDuration);
            AnnounceRpc("WARMUP", (byte)Team.Neutral);
        }

        private static void ResetZones()
        {
            foreach (IObjective objective in ObjectiveRegistry.All)
            {
                if (objective is CaptureZone zone)
                {
                    zone.ServerReset();
                }
            }
        }

        private void RespawnEveryone()
        {
            m_Respawns.Clear();
            foreach (Combatant combatant in CombatantRegistry.All)
            {
                RespawnCombatant(combatant);
            }
        }

        private void ProcessRespawns()
        {
            for (int i = m_Respawns.Count - 1; i >= 0; i--)
            {
                PendingRespawn pending = m_Respawns[i];
                if (Time.time < pending.Time)
                {
                    continue;
                }

                m_Respawns.RemoveAt(i);
                if (pending.Combatant != null && pending.Combatant.IsSpawned && !pending.Combatant.IsAlive)
                {
                    RespawnCombatant(pending.Combatant);
                }
            }
        }

        private void RespawnCombatant(Combatant combatant)
        {
            if (combatant == null || !combatant.IsSpawned)
            {
                return;
            }

            var respawnable = combatant.GetComponent<IRespawnable>();
            if (respawnable == null)
            {
                return;
            }

            SpawnSelector.TryPick(combatant.Team, out Vector3 position, out Quaternion rotation);
            respawnable.ServerRespawn(position, rotation, m_Settings.spawnProtection);
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            Instance = null;
        }
    }
}
