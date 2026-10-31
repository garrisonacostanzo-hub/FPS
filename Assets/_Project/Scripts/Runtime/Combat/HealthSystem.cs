using System;
using FPS.Data;
using Unity.Netcode;
using UnityEngine;

namespace FPS.Combat
{
    /// <summary>
    /// Server-authoritative health for players and bots.
    /// Health and death state live in NetworkVariables (late joiners receive them automatically);
    /// transient damage/death events are replicated through RPCs for hit feedback and kill cams.
    /// Gameplay systems subscribe to the static server events to award score or trigger respawns.
    /// </summary>
    [DisallowMultipleComponent]
    public class HealthSystem : NetworkBehaviour, IDamageable
    {
        [SerializeField, Min(1f)] private float m_MaxHealth = 100f;
        [SerializeField] private bool m_AllowRegeneration = true;

        private readonly NetworkVariable<float> m_Health = new NetworkVariable<float>(100f);
        private readonly NetworkVariable<bool> m_IsDead = new NetworkVariable<bool>(false);

        private Combatant m_Combatant;
        private float m_LastDamageTime = -999f;
        private float m_InvulnerableUntil;
        private DamageInfo m_LastDamage;

        /// <summary>Server only: raised after any damage was applied.</summary>
        public static event Action<HealthSystem, DamageInfo> ServerDamaged;

        /// <summary>Server only: raised once when an entity dies.</summary>
        public static event Action<HealthSystem, DamageInfo> ServerDied;

        /// <summary>All peers: (current, max).</summary>
        public event Action<float, float> HealthChanged;

        /// <summary>All peers: raised for every confirmed damage event.</summary>
        public event Action<DamageInfo> Damaged;

        /// <summary>All peers: raised when this entity dies.</summary>
        public event Action<DamageInfo> Died;

        /// <summary>All peers: raised when the entity is revived (respawned).</summary>
        public event Action Revived;

        public float Current => m_Health.Value;
        public float Max => m_MaxHealth;
        public float Normalized => m_MaxHealth > 0f ? Mathf.Clamp01(m_Health.Value / m_MaxHealth) : 0f;
        public bool IsDead => m_IsDead.Value;
        public bool CanTakeDamage => IsSpawned && !m_IsDead.Value && Time.time >= m_InvulnerableUntil;
        public Combatant Combatant => m_Combatant;
        public DamageInfo LastDamage => m_LastDamage;
        public float TimeSinceLastDamage => Time.time - m_LastDamageTime;

        private void Awake()
        {
            m_Combatant = GetComponent<Combatant>();
        }

        public override void OnNetworkSpawn()
        {
            if (IsServer)
            {
                m_Health.Value = m_MaxHealth;
                m_IsDead.Value = false;
            }

            m_Health.OnValueChanged += OnHealthValueChanged;
            m_IsDead.OnValueChanged += OnDeadValueChanged;
            HealthChanged?.Invoke(m_Health.Value, m_MaxHealth);
        }

        public override void OnNetworkDespawn()
        {
            m_Health.OnValueChanged -= OnHealthValueChanged;
            m_IsDead.OnValueChanged -= OnDeadValueChanged;
        }

        private void OnHealthValueChanged(float previous, float current)
        {
            HealthChanged?.Invoke(current, m_MaxHealth);
        }

        private void OnDeadValueChanged(bool previous, bool current)
        {
            if (previous && !current)
            {
                Revived?.Invoke();
            }
        }

        /// <summary>Applies damage. Only valid on the server; ignored elsewhere.</summary>
        public void ApplyDamage(in DamageInfo damage)
        {
            if (!IsServer || !CanTakeDamage || damage.Amount <= 0f)
            {
                return;
            }

            if (!PassesFriendlyFireRules(damage))
            {
                return;
            }

            DamageInfo applied = damage;
            applied.Amount = Mathf.Min(damage.Amount, m_Health.Value);
            m_Health.Value = Mathf.Max(0f, m_Health.Value - damage.Amount);
            m_LastDamageTime = Time.time;
            m_LastDamage = applied;

            ServerDamaged?.Invoke(this, applied);
            DamagedRpc(applied);
            if (!IsClient)
            {
                // Dedicated server: ClientsAndHost RPCs do not run here, raise the instance event directly.
                Damaged?.Invoke(applied);
            }

            if (m_Health.Value <= 0f)
            {
                Die(applied);
            }
        }

        private bool PassesFriendlyFireRules(in DamageInfo damage)
        {
            if (!damage.HasAttacker || m_Combatant == null)
            {
                return true;
            }

            if (damage.AttackerId == NetworkObjectId)
            {
                // Self damage (fall, own explosives) is always allowed.
                return true;
            }

            MatchSettings settings = GameConfig.Instance != null ? GameConfig.Instance.matchSettings : null;
            if (settings != null && settings.friendlyFire)
            {
                return true;
            }

            Combatant attacker = CombatantRegistry.Find(damage.AttackerId);
            return attacker == null || attacker.Team != m_Combatant.Team;
        }

        private void Die(in DamageInfo damage)
        {
            if (m_IsDead.Value)
            {
                return;
            }

            m_IsDead.Value = true;
            ServerDied?.Invoke(this, damage);
            DiedRpc(damage);
            if (!IsClient)
            {
                Died?.Invoke(damage);
            }
        }

        /// <summary>Server: kills the entity instantly (out of bounds, admin, suicide).</summary>
        public void Kill(DamageType type = DamageType.World)
        {
            if (!IsServer || m_IsDead.Value)
            {
                return;
            }

            DamageInfo info = DamageInfo.Environmental(m_Health.Value + 1f, transform.position, type);
            info.AttackerId = NetworkObjectId;
            m_Health.Value = 0f;
            m_LastDamage = info;
            ServerDamaged?.Invoke(this, info);
            Die(info);
        }

        /// <summary>Server: restores full health and grants temporary invulnerability.</summary>
        public void Revive(float invulnerabilitySeconds)
        {
            if (!IsServer)
            {
                return;
            }

            m_Health.Value = m_MaxHealth;
            m_IsDead.Value = false;
            m_InvulnerableUntil = Time.time + Mathf.Max(0f, invulnerabilitySeconds);
            m_LastDamageTime = -999f;
        }

        public void Heal(float amount)
        {
            if (!IsServer || m_IsDead.Value || amount <= 0f)
            {
                return;
            }

            m_Health.Value = Mathf.Min(m_MaxHealth, m_Health.Value + amount);
        }

        private void Update()
        {
            if (!IsServer || !IsSpawned || !m_AllowRegeneration || m_IsDead.Value || m_Health.Value >= m_MaxHealth)
            {
                return;
            }

            MatchSettings settings = GameConfig.Instance != null ? GameConfig.Instance.matchSettings : null;
            float delay = settings != null ? settings.healthRegenDelay : 5f;
            float rate = settings != null ? settings.healthRegenPerSecond : 15f;
            if (rate > 0f && Time.time - m_LastDamageTime >= delay)
            {
                m_Health.Value = Mathf.Min(m_MaxHealth, m_Health.Value + rate * Time.deltaTime);
            }
        }

        [Rpc(SendTo.ClientsAndHost, Delivery = RpcDelivery.Reliable)]
        private void DamagedRpc(DamageInfo damage)
        {
            m_LastDamage = damage;
            if (!IsServer)
            {
                m_LastDamageTime = Time.time;
            }

            Damaged?.Invoke(damage);
        }

        [Rpc(SendTo.ClientsAndHost, Delivery = RpcDelivery.Reliable)]
        private void DiedRpc(DamageInfo damage)
        {
            Died?.Invoke(damage);
        }
    }
}
