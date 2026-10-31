using FPS.Data;
using UnityEngine;
using UnityEngine.AI;

namespace FPS.AI
{
    public enum BotMoveSpeed
    {
        Crouch,
        Walk,
        Run,
        Sprint
    }

    /// <summary>
    /// Thin, robust wrapper around <see cref="NavMeshAgent"/>: destination sampling, speed modes matching player
    /// speeds, de-duplicated re-pathing, stuck detection/recovery and path-length queries used by tactical scoring.
    /// Rotation is driven by the AI aim controller (agent.updateRotation = false) so bots can strafe while aiming.
    /// </summary>
    [RequireComponent(typeof(NavMeshAgent))]
    public class BotNavigator : MonoBehaviour
    {
        [SerializeField] private PlayerMovementSettings m_MovementSettings;
        [SerializeField] private float m_RepathDistance = 0.75f;
        [SerializeField] private float m_StuckTime = 1.6f;

        private static NavMeshPath s_PathScratch;

        private NavMeshAgent m_Agent;
        private Vector3 m_Destination;
        private bool m_HasDestination;
        private BotMoveSpeed m_Speed = BotMoveSpeed.Run;
        private Vector3 m_StuckCheckPosition;
        private float m_StuckTimer;
        private int m_StuckRecoveries;
        private bool m_Recovering;

        public NavMeshAgent Agent => m_Agent;
        public bool HasDestination => m_HasDestination;
        public Vector3 Destination => m_Destination;
        public Vector3 Velocity => m_Agent != null && m_Agent.enabled ? m_Agent.velocity : Vector3.zero;
        public float SpeedFraction => Velocity.magnitude / Mathf.Max(0.1f, SprintSpeed);
        public bool IsCrouchSpeed => m_Speed == BotMoveSpeed.Crouch;
        public bool IsOnNavMesh => m_Agent != null && m_Agent.enabled && m_Agent.isOnNavMesh;

        private float SprintSpeed => m_MovementSettings != null ? m_MovementSettings.sprintSpeed : 7f;

        public bool HasArrived
        {
            get
            {
                if (!m_HasDestination)
                {
                    return true;
                }

                if (!IsOnNavMesh || m_Agent.pathPending)
                {
                    return false;
                }

                if (m_Recovering)
                {
                    return false;
                }

                Vector3 flat = m_Destination - transform.position;
                flat.y = 0f;
                float tolerance = Mathf.Max(m_Agent.stoppingDistance, 0.35f);
                return m_Agent.remainingDistance <= tolerance + 0.05f && flat.magnitude <= tolerance + 1f;
            }
        }

        public float RemainingDistance => IsOnNavMesh && !m_Agent.pathPending ? m_Agent.remainingDistance : float.PositiveInfinity;

        private void Awake()
        {
            m_Agent = GetComponent<NavMeshAgent>();
            m_Agent.updateRotation = false;
            m_Agent.autoBraking = true;
            m_Agent.acceleration = 28f;
            m_Agent.angularSpeed = 720f;
            m_Agent.obstacleAvoidanceType = ObstacleAvoidanceType.MedQualityObstacleAvoidance;
            m_Agent.avoidancePriority = Random.Range(35, 65);
            if (m_MovementSettings == null && GameConfig.Instance != null)
            {
                m_MovementSettings = GameConfig.Instance.movementSettings;
            }
        }

        public void SetAgentEnabled(bool enabled)
        {
            if (m_Agent == null)
            {
                return;
            }

            if (enabled && !m_Agent.enabled)
            {
                m_Agent.enabled = true;
                if (!m_Agent.isOnNavMesh && NavMesh.SamplePosition(transform.position, out NavMeshHit hit, 6f, NavMesh.AllAreas))
                {
                    m_Agent.Warp(hit.position);
                }
            }
            else if (!enabled && m_Agent.enabled)
            {
                if (m_Agent.isOnNavMesh)
                {
                    m_Agent.ResetPath();
                }

                m_Agent.enabled = false;
            }

            m_HasDestination = false;
        }

        public float GetSpeed(BotMoveSpeed speed)
        {
            PlayerMovementSettings s = m_MovementSettings;
            switch (speed)
            {
                case BotMoveSpeed.Crouch: return s != null ? s.crouchSpeed : 2.2f;
                case BotMoveSpeed.Walk: return s != null ? s.walkSpeed * 0.7f : 3.2f;
                case BotMoveSpeed.Run: return s != null ? s.walkSpeed : 4.6f;
                default: return s != null ? s.sprintSpeed : 7f;
            }
        }

        public void SetSpeed(BotMoveSpeed speed)
        {
            m_Speed = speed;
            if (m_Agent != null && m_Agent.enabled)
            {
                m_Agent.speed = GetSpeed(speed);
            }
        }

        /// <summary>Requests a path. Returns false if the destination is not reachable on the NavMesh.</summary>
        public bool MoveTo(Vector3 destination, BotMoveSpeed speed, float stoppingDistance = 0.4f)
        {
            if (!IsOnNavMesh)
            {
                return false;
            }

            SetSpeed(speed);
            m_Agent.stoppingDistance = stoppingDistance;
            if (m_HasDestination && (destination - m_Destination).sqrMagnitude < m_RepathDistance * m_RepathDistance && m_Agent.hasPath)
            {
                return true;
            }

            if (!NavMesh.SamplePosition(destination, out NavMeshHit hit, 4f, NavMesh.AllAreas))
            {
                return false;
            }

            if (!m_Agent.SetDestination(hit.position))
            {
                return false;
            }

            m_Destination = hit.position;
            m_HasDestination = true;
            m_Recovering = false;
            m_StuckTimer = 0f;
            m_StuckCheckPosition = transform.position;
            return true;
        }

        public void Stop()
        {
            m_HasDestination = false;
            m_Recovering = false;
            if (IsOnNavMesh)
            {
                m_Agent.ResetPath();
            }
        }

        public void Warp(Vector3 position)
        {
            m_HasDestination = false;
            if (m_Agent == null)
            {
                transform.position = position;
                return;
            }

            bool wasEnabled = m_Agent.enabled;
            if (!wasEnabled)
            {
                transform.position = position;
                return;
            }

            if (NavMesh.SamplePosition(position, out NavMeshHit hit, 6f, NavMesh.AllAreas))
            {
                m_Agent.Warp(hit.position);
            }
            else
            {
                m_Agent.Warp(position);
            }
        }

        private void Update()
        {
            if (!m_HasDestination || !IsOnNavMesh || m_Agent.pathPending)
            {
                return;
            }

            if (m_Recovering && m_Agent.remainingDistance <= 0.6f)
            {
                // Recovery detour reached: resume the real destination.
                m_Recovering = false;
                m_Agent.SetDestination(m_Destination);
                return;
            }

            if (HasArrived)
            {
                m_StuckTimer = 0f;
                m_StuckRecoveries = 0;
                return;
            }

            m_StuckTimer += Time.deltaTime;
            if (m_StuckTimer < m_StuckTime)
            {
                return;
            }

            float moved = (transform.position - m_StuckCheckPosition).sqrMagnitude;
            m_StuckCheckPosition = transform.position;
            m_StuckTimer = 0f;
            if (moved > 0.25f * 0.25f)
            {
                m_StuckRecoveries = 0;
                return;
            }

            // Stuck: nudge to a random nearby point, then retry the original destination.
            m_StuckRecoveries++;
            if (m_StuckRecoveries <= 2 && RandomPointOnNavMesh(transform.position, 3f, out Vector3 nudge))
            {
                m_Recovering = true;
                m_Agent.SetDestination(nudge);
            }
            else
            {
                m_Recovering = false;
                m_Agent.ResetPath();
                m_Agent.SetDestination(m_Destination);
                m_StuckRecoveries = 0;
            }
        }

        public static bool RandomPointOnNavMesh(Vector3 centre, float radius, out Vector3 result)
        {
            for (int attempt = 0; attempt < 8; attempt++)
            {
                Vector2 offset = Random.insideUnitCircle * radius;
                Vector3 candidate = centre + new Vector3(offset.x, 0f, offset.y);
                if (NavMesh.SamplePosition(candidate, out NavMeshHit hit, 2.5f, NavMesh.AllAreas))
                {
                    result = hit.position;
                    return true;
                }
            }

            result = centre;
            return false;
        }

        /// <summary>Length of the NavMesh path between two points (or +inf if unreachable).</summary>
        public static float PathLength(Vector3 from, Vector3 to)
        {
            if (s_PathScratch == null)
            {
                s_PathScratch = new NavMeshPath();
            }

            if (!NavMesh.CalculatePath(from, to, NavMesh.AllAreas, s_PathScratch) || s_PathScratch.status != NavMeshPathStatus.PathComplete)
            {
                return float.PositiveInfinity;
            }

            Vector3[] corners = s_PathScratch.corners;
            float length = 0f;
            for (int i = 1; i < corners.Length; i++)
            {
                length += Vector3.Distance(corners[i - 1], corners[i]);
            }

            return length;
        }
    }
}
