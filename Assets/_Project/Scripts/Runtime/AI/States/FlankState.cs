using UnityEngine;
using UnityEngine.AI;

namespace FPS.AI.States
{
    /// <summary>
    /// Squad-assigned flanking manoeuvre: while teammates keep the enemy busy, sprint to a position on the
    /// target's side (opposite the squad), validated for reachability, then re-engage from the new angle.
    /// </summary>
    public class FlankState : BotState
    {
        private Vector3 m_Destination;

        public FlankState(AdvancedBotAI bot) : base(bot)
        {
        }

        public override BotStateId Id => BotStateId.Flank;

        public override bool IsInterruptible => IsComplete || Memory.Suppression > 0.7f || Bot.HealthFraction < 0.3f;

        protected override void OnEnter()
        {
            Bot.SetCrouched(false);
            Bot.SetAiming(false);
            Memory.FlankAssigned = true;

            Vector3 target = Memory.HasTarget && Memory.TargetVisible ? Memory.Target.FeetPosition : Memory.LastKnownTargetPosition;
            Vector2 range = Bot.PreferredRange;
            float flankDistance = Mathf.Clamp((range.x + range.y) * 0.5f, 12f, 30f);

            if (!TryPick(target, flankDistance, 1f) && !TryPick(target, flankDistance, -1f))
            {
                IsComplete = true;
                return;
            }

            Memory.FlankPosition = m_Destination;
            Bot.MoveTo(m_Destination, BotMoveSpeed.Sprint, 1.5f);
        }

        private bool TryPick(Vector3 target, float distance, float sideSign)
        {
            BotSquad squad = Bot.Squad;
            Vector3 candidate = squad != null
                ? squad.ComputeFlankPosition(target, Bot.transform.position, distance * sideSign)
                : target + Vector3.Cross(Vector3.up, (target - Bot.transform.position).normalized) * distance * sideSign;

            if (!NavMesh.SamplePosition(candidate, out NavMeshHit hit, 6f, NavMesh.AllAreas))
            {
                return false;
            }

            float straight = Vector3.Distance(Bot.transform.position, hit.position);
            float path = BotNavigator.PathLength(Bot.transform.position, hit.position);
            if (float.IsInfinity(path) || path > straight * 3f + 20f)
            {
                return false;
            }

            m_Destination = hit.position;
            return true;
        }

        public override void Tick(float deltaTime)
        {
            Bot.FireAllowed = Memory.TargetVisible;
            if (Bot.Navigator.HasArrived)
            {
                Bot.SetLookPoint(Memory.LastKnownTargetPosition + Vector3.up * 1.4f);
                IsComplete = true;
                return;
            }

            if (Memory.TargetVisible && Vector3.Distance(Bot.transform.position, m_Destination) < 6f)
            {
                IsComplete = true;
                return;
            }

            Bot.ClearLookPoint();
            if (TimeInState > 16f)
            {
                IsComplete = true;
            }
        }

        protected override void OnExit()
        {
            Memory.FlankAssigned = false;
            Bot.Squad?.ReleaseTokens(Bot);
        }
    }
}
