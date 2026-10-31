using FPS.Combat;
using UnityEngine;

namespace FPS.AI.States
{
    /// <summary>Moves to a suspicious position (noise, glimpse, squad intel) and scans the area on arrival.</summary>
    public class InvestigateState : BotState
    {
        private Vector3 m_Target;
        private bool m_Arrived;
        private float m_ScanUntil;
        private float m_ScanBaseYaw;

        public InvestigateState(AdvancedBotAI bot) : base(bot)
        {
        }

        public override BotStateId Id => BotStateId.Investigate;

        protected override void OnEnter()
        {
            m_Target = Memory.InvestigatePosition;
            m_Arrived = false;
            Bot.SetCrouched(false);
            Bot.SetAiming(false);
            Move();
        }

        private void Move()
        {
            BotMoveSpeed speed = Memory.InvestigateReason == NoiseType.Gunfire ? BotMoveSpeed.Run : BotMoveSpeed.Walk;
            if (!Bot.MoveTo(m_Target, speed, 1.5f))
            {
                // Unreachable (e.g. noise on a roof): give up quickly.
                Memory.HasInvestigatePosition = false;
                IsComplete = true;
            }
        }

        public override void Tick(float deltaTime)
        {
            Bot.FireAllowed = true;
            if (TimeInState > 16f)
            {
                Memory.HasInvestigatePosition = false;
                IsComplete = true;
                return;
            }

            if ((Memory.InvestigatePosition - m_Target).sqrMagnitude > 9f)
            {
                m_Target = Memory.InvestigatePosition;
                m_Arrived = false;
                Move();
            }

            float distance = Vector3.Distance(Bot.transform.position, m_Target);
            if (!m_Arrived)
            {
                Bot.SetLookPoint(m_Target + Vector3.up * 1.4f);
                bool cautious = Bot.Difficulty.aggressiveness < 0.4f;
                Bot.SetCrouched(cautious && distance < 10f);
                if (Bot.Navigator.HasArrived || distance < 2f)
                {
                    m_Arrived = true;
                    m_ScanUntil = Time.time + Random.Range(2f, 4f);
                    m_ScanBaseYaw = Bot.Aim.Yaw;
                    Bot.Navigator.Stop();
                }

                return;
            }

            float yaw = m_ScanBaseYaw + Mathf.Sin(TimeInState * 1.6f) * 75f;
            Bot.SetLookPoint(Bot.EyePosition + Quaternion.Euler(0f, yaw, 0f) * Vector3.forward * 10f);
            if (Time.time >= m_ScanUntil)
            {
                Memory.HasInvestigatePosition = false;
                IsComplete = true;
            }
        }

        protected override void OnExit()
        {
            Bot.SetCrouched(false);
        }
    }
}
