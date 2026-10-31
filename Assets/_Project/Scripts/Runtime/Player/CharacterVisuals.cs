using FPS.Core;
using UnityEngine;
using UnityEngine.Rendering;

namespace FPS.Player
{
    /// <summary>
    /// Presentation of a character body (players and bots): team colours, stance, aim pitch, a simple death
    /// topple, first-person shadow-only mode and footstep audio for remotely simulated characters.
    /// </summary>
    public class CharacterVisuals : MonoBehaviour
    {
        [SerializeField] private Transform m_Body;
        [SerializeField] private Transform m_AimPivot;
        [SerializeField] private Renderer[] m_TeamColoredRenderers = new Renderer[0];
        [SerializeField] private Renderer[] m_AllRenderers = new Renderer[0];
        [SerializeField, Range(0.3f, 1f)] private float m_CrouchScale = 0.66f;
        [SerializeField] private float m_StrideLength = 1.1f;

        private float m_DeathBlend;
        private bool m_Dead;
        private float m_DeathYaw;
        private float m_Crouch;
        private float m_Stride;
        private Vector3 m_LastPosition;
        private bool m_FirstPerson;
        private float m_AimPivotStandingHeight = -1f;

        public Transform AimPivot => m_AimPivot;
        public Transform Body => m_Body;

        public void Configure(Transform body, Transform aimPivot, Renderer[] teamColored, Renderer[] all)
        {
            m_Body = body;
            m_AimPivot = aimPivot;
            m_TeamColoredRenderers = teamColored;
            m_AllRenderers = all;
        }

        private void Awake()
        {
            m_LastPosition = transform.position;
            if (m_AimPivot != null)
            {
                m_AimPivotStandingHeight = m_AimPivot.localPosition.y;
            }
        }

        public void SetTeam(Team team)
        {
            Material material = RuntimeMaterials.Lit(TeamUtility.GetColor(team));
            foreach (Renderer renderer in m_TeamColoredRenderers)
            {
                if (renderer != null)
                {
                    renderer.sharedMaterial = material;
                }
            }
        }

        /// <summary>Local player: hide the body from the own camera but keep its shadow.</summary>
        public void SetFirstPerson(bool firstPerson)
        {
            m_FirstPerson = firstPerson;
            foreach (Renderer renderer in m_AllRenderers)
            {
                if (renderer != null)
                {
                    renderer.shadowCastingMode = firstPerson ? ShadowCastingMode.ShadowsOnly : ShadowCastingMode.On;
                }
            }
        }

        public void SetStance(float crouchAmount)
        {
            m_Crouch = Mathf.Clamp01(crouchAmount);
        }

        public void SetAimPitch(float pitchDegrees)
        {
            if (m_AimPivot != null)
            {
                m_AimPivot.localRotation = Quaternion.Euler(-Mathf.Clamp(pitchDegrees, -80f, 80f), 0f, 0f);
            }
        }

        public void SetDead(bool dead)
        {
            if (dead && !m_Dead)
            {
                m_DeathYaw = Random.Range(-40f, 40f);
            }

            m_Dead = dead;
            if (!dead)
            {
                m_DeathBlend = 0f;
                ApplyPose();
            }
        }

        public void SetVisible(bool visible)
        {
            foreach (Renderer renderer in m_AllRenderers)
            {
                if (renderer != null)
                {
                    renderer.enabled = visible;
                }
            }
        }

        /// <summary>Plays positional footsteps for characters moved by interpolation (remote players, bots on clients).</summary>
        public void TickRemoteFootsteps(bool grounded)
        {
            Vector3 position = transform.position;
            Vector3 delta = position - m_LastPosition;
            m_LastPosition = position;
            if (m_Dead || !grounded || m_FirstPerson)
            {
                return;
            }

            float distance = new Vector2(delta.x, delta.z).magnitude;
            if (distance > 3f)
            {
                return; // teleport
            }

            m_Stride += distance;
            if (m_Stride >= m_StrideLength)
            {
                m_Stride = 0f;
                float volume = Mathf.Lerp(0.15f, 0.45f, Mathf.Clamp01(distance / Mathf.Max(0.0001f, Time.deltaTime) / 7f)) * (1f - m_Crouch * 0.8f);
                AudioPool.PlayAt(ProceduralAudio.Get(ProceduralSound.Footstep), position, volume, Random.Range(0.9f, 1.1f), 1f, 30f);
            }
        }

        private void LateUpdate()
        {
            m_DeathBlend = Mathf.MoveTowards(m_DeathBlend, m_Dead ? 1f : 0f, Time.deltaTime * 3f);
            ApplyPose();
        }

        private void ApplyPose()
        {
            if (m_Body == null)
            {
                return;
            }

            float verticalScale = Mathf.Lerp(1f, m_CrouchScale, m_Crouch);
            m_Body.localScale = new Vector3(1f, verticalScale, 1f);
            float topple = Mathf.SmoothStep(0f, 1f, m_DeathBlend);
            m_Body.localRotation = Quaternion.Euler(0f, m_DeathYaw * topple, 0f) * Quaternion.Euler(-88f * topple, 0f, 0f);
            m_Body.localPosition = new Vector3(0f, 0.25f * topple, 0f);

            if (m_AimPivot != null && m_AimPivotStandingHeight > 0f)
            {
                Vector3 local = m_AimPivot.localPosition;
                local.y = m_AimPivotStandingHeight * verticalScale * (1f - 0.75f * topple);
                m_AimPivot.localPosition = local;
            }
        }
    }
}
