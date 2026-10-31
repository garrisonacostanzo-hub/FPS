using FPS.Core;
using UnityEngine;

namespace FPS.Combat
{
    /// <summary>
    /// Body region collider (head / torso / limb) on the Hitbox layer. Forwards damage to the owning
    /// <see cref="HealthSystem"/> tagged with its region, so weapons can apply region multipliers.
    /// Hitbox colliders never collide physically (see <see cref="GameLayers"/>); they only receive raycasts.
    /// </summary>
    [RequireComponent(typeof(Collider))]
    public class Hitbox : MonoBehaviour, IDamageable
    {
        [SerializeField] private HitboxRegion m_Region = HitboxRegion.Torso;
        [SerializeField] private HealthSystem m_Owner;

        private Combatant m_Combatant;

        public HitboxRegion Region => m_Region;
        public HealthSystem Owner => m_Owner;
        public Combatant Combatant => m_Combatant;
        public bool CanTakeDamage => m_Owner != null && m_Owner.CanTakeDamage;

        private void Awake()
        {
            if (m_Owner == null)
            {
                m_Owner = GetComponentInParent<HealthSystem>();
            }

            m_Combatant = m_Owner != null ? m_Owner.GetComponent<Combatant>() : GetComponentInParent<Combatant>();
            gameObject.layer = GameLayers.Hitbox;
        }

        public void Configure(HitboxRegion region, HealthSystem owner)
        {
            m_Region = region;
            m_Owner = owner;
            m_Combatant = owner != null ? owner.GetComponent<Combatant>() : null;
        }

        public void ApplyDamage(in DamageInfo damage)
        {
            if (m_Owner == null)
            {
                return;
            }

            DamageInfo regional = damage;
            regional.Region = m_Region;
            m_Owner.ApplyDamage(regional);
        }
    }
}
