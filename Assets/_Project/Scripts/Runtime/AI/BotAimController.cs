using FPS.Combat;
using FPS.Data;
using UnityEngine;

namespace FPS.AI
{
    /// <summary>
    /// Human-like aiming: limited turn speed, a per-target error offset that shrinks while the bot keeps tracking
    /// ("settling"), situational penalties (target speed, own movement, suppression) and head/chest selection.
    /// </summary>
    public class BotAimController
    {
        private readonly Transform m_Body;
        private float m_Yaw;
        private float m_Pitch;
        private Vector3 m_ErrorOffset;
        private float m_NextErrorRoll;
        private Combatant m_TrackedTarget;
        private float m_TrackingStart;
        private bool m_AimAtHead;

        public BotAimController(Transform body)
        {
            m_Body = body;
            m_Yaw = body.eulerAngles.y;
        }

        public float Yaw => m_Yaw;
        public float Pitch => m_Pitch;
        public Vector3 Forward => Quaternion.Euler(-m_Pitch, m_Yaw, 0f) * Vector3.forward;
        public Combatant TrackedTarget => m_TrackedTarget;
        public float TrackingTime => m_TrackedTarget != null ? Time.time - m_TrackingStart : 0f;

        public void Reset(float yaw)
        {
            m_Yaw = yaw;
            m_Pitch = 0f;
            m_TrackedTarget = null;
            m_ErrorOffset = Vector3.zero;
        }

        /// <summary>Returns the world point the bot wants to hit on <paramref name="target"/> (including aim error).</summary>
        public Vector3 GetAimPoint(Combatant target, BotDifficultyProfile difficulty, float situationalMultiplier, Vector3 eye)
        {
            if (target != m_TrackedTarget)
            {
                m_TrackedTarget = target;
                m_TrackingStart = Time.time;
                m_NextErrorRoll = 0f;
            }

            if (Time.time >= m_NextErrorRoll)
            {
                m_NextErrorRoll = Time.time + Random.Range(0.25f, 0.6f);
                m_AimAtHead = Random.value < difficulty.headshotPreference;
                float settle = Mathf.Clamp01(TrackingTime / Mathf.Max(0.05f, difficulty.aimSettleTime));
                float errorDegrees = difficulty.GetAimError(settle, situationalMultiplier);
                float distance = Vector3.Distance(eye, target.ChestPosition);
                float errorMeters = Mathf.Tan(errorDegrees * Mathf.Deg2Rad) * distance;
                m_ErrorOffset = Random.insideUnitSphere * errorMeters;
            }

            Vector3 basePoint = m_AimAtHead ? target.HeadPosition - Vector3.up * 0.05f : target.ChestPosition;
            return basePoint + m_ErrorOffset;
        }

        /// <summary>Rotates the aim towards <paramref name="point"/> limited by the tracking speed.</summary>
        public void RotateTowards(Vector3 eye, Vector3 point, float degreesPerSecond, float deltaTime)
        {
            Vector3 direction = point - eye;
            if (direction.sqrMagnitude < 0.0001f)
            {
                return;
            }

            Quaternion look = Quaternion.LookRotation(direction);
            Vector3 euler = look.eulerAngles;
            float targetYaw = euler.y;
            float targetPitch = -Mathf.DeltaAngle(0f, euler.x);
            float step = degreesPerSecond * deltaTime;
            m_Yaw = Mathf.MoveTowardsAngle(m_Yaw, targetYaw, step);
            m_Pitch = Mathf.MoveTowards(m_Pitch, Mathf.Clamp(targetPitch, -80f, 80f), step);
            m_Body.rotation = Quaternion.Euler(0f, m_Yaw, 0f);
        }

        /// <summary>Angle in degrees between the current aim and the direction to <paramref name="point"/>.</summary>
        public float AngleTo(Vector3 eye, Vector3 point)
        {
            return Vector3.Angle(Forward, point - eye);
        }

        public void ClearTarget()
        {
            m_TrackedTarget = null;
        }
    }
}
