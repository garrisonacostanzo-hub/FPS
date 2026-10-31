using UnityEngine;

namespace FPS.Combat
{
    /// <summary>
    /// Keeps hitboxes aligned with the character's stance. Standing layout is authored; the crouched layout is
    /// derived by scaling heights, so a single parameter (crouch amount 0..1) drives every region.
    /// </summary>
    public class HitboxRig : MonoBehaviour
    {
        [SerializeField] private Transform m_Head;
        [SerializeField] private Transform m_Torso;
        [SerializeField] private Transform m_Legs;
        [SerializeField, Range(0.3f, 1f)] private float m_CrouchHeightRatio = 0.64f;

        private Vector3 m_HeadStanding;
        private Vector3 m_TorsoStanding;
        private Vector3 m_LegsStanding;
        private Vector3 m_TorsoScale;
        private Vector3 m_LegsScale;
        private bool m_Captured;
        private float m_CurrentCrouch = -1f;

        public Hitbox[] Hitboxes { get; private set; }

        private void Awake()
        {
            Capture();
        }

        public void Configure(Transform head, Transform torso, Transform legs, float crouchRatio)
        {
            m_Head = head;
            m_Torso = torso;
            m_Legs = legs;
            m_CrouchHeightRatio = crouchRatio;
            m_Captured = false;
            Capture();
        }

        private void Capture()
        {
            if (m_Captured)
            {
                return;
            }

            m_Captured = true;
            if (m_Head != null) m_HeadStanding = m_Head.localPosition;
            if (m_Torso != null)
            {
                m_TorsoStanding = m_Torso.localPosition;
                m_TorsoScale = m_Torso.localScale;
            }

            if (m_Legs != null)
            {
                m_LegsStanding = m_Legs.localPosition;
                m_LegsScale = m_Legs.localScale;
            }

            Hitboxes = GetComponentsInChildren<Hitbox>(true);
        }

        public void SetCrouch(float amount)
        {
            Capture();
            amount = Mathf.Clamp01(amount);
            if (Mathf.Abs(amount - m_CurrentCrouch) < 0.001f)
            {
                return;
            }

            m_CurrentCrouch = amount;
            float ratio = Mathf.Lerp(1f, m_CrouchHeightRatio, amount);
            if (m_Head != null)
            {
                m_Head.localPosition = new Vector3(m_HeadStanding.x, m_HeadStanding.y * ratio, m_HeadStanding.z);
            }

            if (m_Torso != null)
            {
                m_Torso.localPosition = new Vector3(m_TorsoStanding.x, m_TorsoStanding.y * ratio, m_TorsoStanding.z);
                m_Torso.localScale = new Vector3(m_TorsoScale.x, m_TorsoScale.y * Mathf.Lerp(1f, 0.85f, amount), m_TorsoScale.z);
            }

            if (m_Legs != null)
            {
                m_Legs.localPosition = new Vector3(m_LegsStanding.x, m_LegsStanding.y * ratio, m_LegsStanding.z);
                m_Legs.localScale = new Vector3(m_LegsScale.x, m_LegsScale.y * ratio, m_LegsScale.z);
            }
        }

        public void SetEnabled(bool enabled)
        {
            Capture();
            if (Hitboxes == null)
            {
                return;
            }

            for (int i = 0; i < Hitboxes.Length; i++)
            {
                Collider collider = Hitboxes[i].GetComponent<Collider>();
                if (collider != null)
                {
                    collider.enabled = enabled;
                }
            }
        }
    }
}
