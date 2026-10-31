using FPS.Combat;
using UnityEngine;

namespace FPS.AI
{
    public enum CoverHeight : byte
    {
        Low,
        High
    }

    /// <summary>
    /// A tactical position next to an obstacle. Generated automatically by the map builder around every cover
    /// object (and placeable by hand). <see cref="CoverSystem"/> evaluates protection against a threat at runtime.
    /// </summary>
    public class CoverPoint : MonoBehaviour
    {
        [SerializeField] private CoverHeight m_Height = CoverHeight.Low;
        [Tooltip("Direction from the cover point towards the protecting obstacle (local forward by default).")]
        [SerializeField] private bool m_UseLocalForward = true;

        private Combatant m_Occupant;
        private float m_ReservedUntil;

        public CoverHeight Height => m_Height;
        public Vector3 Position => transform.position;
        public Vector3 ObstacleDirection => m_UseLocalForward ? transform.forward : Vector3.forward;
        public bool IsReserved => m_Occupant != null && m_Occupant.IsAlive && Time.time < m_ReservedUntil;
        public Combatant Occupant => IsReserved ? m_Occupant : null;

        /// <summary>Eye height used while hiding behind this cover (crouched for low cover).</summary>
        public float HiddenEyeHeight => m_Height == CoverHeight.Low ? 0.95f : 1.6f;

        public void Configure(CoverHeight height)
        {
            m_Height = height;
        }

        public bool TryReserve(Combatant combatant, float seconds)
        {
            if (IsReserved && m_Occupant != combatant)
            {
                return false;
            }

            m_Occupant = combatant;
            m_ReservedUntil = Time.time + seconds;
            return true;
        }

        public void Release(Combatant combatant)
        {
            if (m_Occupant == combatant)
            {
                m_Occupant = null;
                m_ReservedUntil = 0f;
            }
        }

        private void OnEnable()
        {
            CoverSystem.Register(this);
        }

        private void OnDisable()
        {
            CoverSystem.Unregister(this);
        }

        private void OnDrawGizmos()
        {
            Gizmos.color = IsReserved ? Color.red : m_Height == CoverHeight.Low ? new Color(0.2f, 0.8f, 1f) : new Color(0.2f, 0.4f, 1f);
            Gizmos.DrawWireCube(transform.position + Vector3.up * 0.15f, new Vector3(0.5f, 0.3f, 0.5f));
            Gizmos.DrawLine(transform.position + Vector3.up * 0.3f, transform.position + Vector3.up * 0.3f + ObstacleDirection * 0.6f);
        }
    }
}
