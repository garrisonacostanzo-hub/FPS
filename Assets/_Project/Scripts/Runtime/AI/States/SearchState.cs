using UnityEngine;

namespace FPS.AI.States
{
    /// <summary>
    /// Target lost: cautious bots first hold the angle, then everyone pushes to the predicted last known position
    /// and sweeps a few nearby points before giving up.
    /// </summary>
    public class SearchState : BotState
    {
        private readonly Vector3[] m_Points = new Vector3[3];
        private int m_PointCount;
        private int m_Index;
        private float m_HoldUntil;
        private float m_LookUntil;
        private bool m_Looking;

        public SearchState(AdvancedBotAI bot) : base(bot)
        {
        }

        public override BotStateId Id => BotStateId.Search;

        protected override void OnEnter()
        {
            Bot.SetCrouched(false);
            Bot.SetAiming(true);
            Vector3 predicted = Memory.LastKnownTargetPosition + Vector3.ClampMagnitude(Memory.LastKnownTargetVelocity * 1.5f, 6f);
            m_PointCount = 0;
            m_Points[m_PointCount++] = predicted;
            for (int i = 0; i < 2; i++)
            {
                if (BotNavigator.RandomPointOnNavMesh(predicted, 10f, out Vector3 point))
                {
                    m_Points[m_PointCount++] = point;
                }
            }

            m_Index = 0;
            m_Looking = false;
            float aggression = Bot.Difficulty.aggressiveness;
            m_HoldUntil = Time.time + (aggression < 0.35f ? Random.Range(2f, 4f) : aggression < 0.65f ? Random.Range(0.5f, 1.5f) : 0f);
        }

        public override void Tick(float deltaTime)
        {
            Bot.FireAllowed = true;
            if (TimeInState > 22f)
            {
                Finish();
                return;
            }

            if (Time.time < m_HoldUntil)
            {
                Bot.Navigator.Stop();
                Bot.SetLookPoint(Memory.LastKnownTargetPosition + Vector3.up * 1.4f);
                return;
            }

            if (m_Index >= m_PointCount)
            {
                Finish();
                return;
            }

            Vector3 point = m_Points[m_Index];
            if (!m_Looking)
            {
                Bot.SetLookPoint(point + Vector3.up * 1.4f);
                Bot.MoveTo(point, m_Index == 0 ? BotMoveSpeed.Run : BotMoveSpeed.Walk, 1f);
                if (Bot.Navigator.HasArrived)
                {
                    m_Looking = true;
                    m_LookUntil = Time.time + Random.Range(1.2f, 2.2f);
                }

                return;
            }

            float yaw = Bot.Aim.Yaw + Mathf.Sin(Time.time * 2f) * 50f * deltaTime * 4f;
            Bot.SetLookPoint(Bot.EyePosition + Quaternion.Euler(0f, yaw, 0f) * Vector3.forward * 10f);
            if (Time.time >= m_LookUntil)
            {
                m_Looking = false;
                m_Index++;
            }
        }

        private void Finish()
        {
            Memory.ForgetTarget();
            IsComplete = true;
        }

        protected override void OnExit()
        {
            Bot.SetAiming(false);
        }
    }
}
