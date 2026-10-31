using System;
using System.Collections.Generic;
using FPS.Core;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;

namespace FPS.Combat
{
    /// <summary>
    /// Shared identity of every fighter (human or bot): team, display name, aim points and liveness.
    /// AI perception, scoring, spawning and the HUD all operate on Combatants, which is what lets humans and bots
    /// coexist transparently in the same match.
    /// </summary>
    [DisallowMultipleComponent]
    public class Combatant : NetworkBehaviour
    {
        [SerializeField] private Transform m_EyePoint;
        [SerializeField] private Transform m_ChestPoint;

        private readonly NetworkVariable<Team> m_Team = new NetworkVariable<Team>(Team.Neutral);
        private readonly NetworkVariable<FixedString32Bytes> m_DisplayName = new NetworkVariable<FixedString32Bytes>();
        private readonly NetworkVariable<bool> m_IsBot = new NetworkVariable<bool>(false);

        private HealthSystem m_Health;
        private Vector3 m_LastPosition;
        private Vector3 m_Velocity;

        public event Action<Team> TeamChanged;

        public Team Team => m_Team.Value;
        public string DisplayName => m_DisplayName.Value.ToString();
        public bool IsBot => m_IsBot.Value;
        public HealthSystem Health => m_Health;
        public bool IsAlive => IsSpawned && m_Health != null && !m_Health.IsDead;
        public ulong CombatantId => NetworkObjectId;
        public Vector3 Velocity => m_Velocity;

        /// <summary>Server time of the last shot fired (used by AI to notice muzzle flashes).</summary>
        public float LastFireTime { get; set; } = -999f;

        public Vector3 EyePosition => m_EyePoint != null ? m_EyePoint.position : transform.position + Vector3.up * 1.6f;
        public Vector3 ChestPosition => m_ChestPoint != null ? m_ChestPoint.position : transform.position + Vector3.up * 1.2f;
        public Vector3 HeadPosition => EyePosition + Vector3.up * 0.05f;
        public Vector3 FeetPosition => transform.position;

        /// <summary>Optional AI hook notified about near misses (null for human players).</summary>
        public IThreatReceiver ThreatReceiver { get; private set; }

        private void Awake()
        {
            m_Health = GetComponent<HealthSystem>();
            ThreatReceiver = GetComponent<IThreatReceiver>();
        }

        public void SetAimPoints(Transform eye, Transform chest)
        {
            m_EyePoint = eye;
            m_ChestPoint = chest;
        }

        public override void OnNetworkSpawn()
        {
            m_LastPosition = transform.position;
            m_Team.OnValueChanged += OnTeamValueChanged;
            CombatantRegistry.Register(this);
        }

        public override void OnNetworkDespawn()
        {
            m_Team.OnValueChanged -= OnTeamValueChanged;
            CombatantRegistry.Unregister(this);
        }

        public override void OnDestroy()
        {
            CombatantRegistry.Unregister(this);
            base.OnDestroy();
        }

        private void OnTeamValueChanged(Team previous, Team current)
        {
            TeamChanged?.Invoke(current);
        }

        /// <summary>Server: assigns identity right after spawning.</summary>
        public void ServerInitialize(Team team, string displayName, bool isBot)
        {
            if (!IsServer)
            {
                return;
            }

            m_Team.Value = team;
            m_DisplayName.Value = new FixedString32Bytes(GameSettings.SanitizeName(displayName));
            m_IsBot.Value = isBot;
        }

        public void ServerSetTeam(Team team)
        {
            if (IsServer)
            {
                m_Team.Value = team;
            }
        }

        private void LateUpdate()
        {
            float deltaTime = Time.deltaTime;
            if (deltaTime > 0f)
            {
                Vector3 position = transform.position;
                Vector3 instantaneous = (position - m_LastPosition) / deltaTime;
                if (instantaneous.sqrMagnitude > 900f)
                {
                    // Teleport / respawn: do not report absurd velocities to the AI.
                    instantaneous = Vector3.zero;
                }

                m_Velocity = Vector3.Lerp(m_Velocity, instantaneous, 1f - Mathf.Exp(-10f * deltaTime));
                m_LastPosition = position;
            }
        }

        public bool IsHostileTo(Combatant other)
        {
            return other != null && other != this && other.Team != Team;
        }
    }

    /// <summary>Global lookup of spawned combatants (by id, by team).</summary>
    public static class CombatantRegistry
    {
        private static readonly List<Combatant> s_All = new List<Combatant>(64);
        private static readonly Dictionary<ulong, Combatant> s_ById = new Dictionary<ulong, Combatant>(64);

        public static IReadOnlyList<Combatant> All => s_All;

        public static event Action<Combatant> Registered;
        public static event Action<Combatant> Unregistered;

        internal static void Register(Combatant combatant)
        {
            if (combatant == null || s_All.Contains(combatant))
            {
                return;
            }

            s_All.Add(combatant);
            s_ById[combatant.NetworkObjectId] = combatant;
            Registered?.Invoke(combatant);
        }

        internal static void Unregister(Combatant combatant)
        {
            if (combatant == null || !s_All.Remove(combatant))
            {
                return;
            }

            if (s_ById.TryGetValue(combatant.NetworkObjectId, out Combatant stored) && stored == combatant)
            {
                s_ById.Remove(combatant.NetworkObjectId);
            }

            Unregistered?.Invoke(combatant);
        }

        public static Combatant Find(ulong combatantId)
        {
            return s_ById.TryGetValue(combatantId, out Combatant combatant) && combatant != null ? combatant : null;
        }

        public static int CountAlive(Team team)
        {
            int count = 0;
            for (int i = 0; i < s_All.Count; i++)
            {
                if (s_All[i] != null && s_All[i].Team == team && s_All[i].IsAlive)
                {
                    count++;
                }
            }

            return count;
        }

        public static void GetHostiles(Combatant self, List<Combatant> results)
        {
            results.Clear();
            for (int i = 0; i < s_All.Count; i++)
            {
                Combatant other = s_All[i];
                if (other != null && other.IsAlive && self.IsHostileTo(other))
                {
                    results.Add(other);
                }
            }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            s_All.Clear();
            s_ById.Clear();
            Registered = null;
            Unregistered = null;
        }
    }
}
