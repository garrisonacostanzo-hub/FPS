using FPS.Data;
using UnityEngine;
using UnityEngine.AI;

namespace FPS.AI.States
{
    /// <summary>
    /// Active firefight: keeps the weapon's preferred range (advance / back off), strafes or crouch-fires,
    /// holds the angle on the last known position for a moment after losing sight, and lays down suppressive fire.
    /// </summary>
    public class EngageState : BotState
    {
        private float m_NextManeuver;

        public EngageState(AdvancedBotAI bot) : base(bot)
        {
        }

        public override BotStateId Id => BotStateId.Engage;

        protected override void OnEnter()
        {
            m_NextManeuver = 0f;
            Bot.SetAiming(true);
        }

        public override void Tick(float deltaTime)
        {
            Bot.FireAllowed = true;
            Bot.SetAiming(true);

            if (!Memory.HasTarget)
            {
                IsComplete = true;
                return;
            }

            Vector3 position = Bot.transform.position;
            if (!Memory.TargetVisible)
            {
                // Hold the angle and pre-aim where the enemy disappeared.
                Bot.Navigator.Stop();
                Bot.SetCrouched(false);
                Vector3 lastKnown = Memory.LastKnownTargetPosition + Vector3.up * 1.3f;
                Bot.SetLookPoint(lastKnown);
                if (Memory.TimeSinceSeen < 0.7f && Bot.Difficulty.aggressiveness > 0.55f)
                {
                    Bot.TrySuppressiveFire(lastKnown);
                }

                return;
            }

            Vector3 targetPosition = Memory.Target.FeetPosition;
            Vector3 toTarget = targetPosition - position;
            toTarget.y = 0f;
            float distance = toTarget.magnitude;
            Vector2 range = Bot.PreferredRange;
            BotDifficultyProfile difficulty = Bot.Difficulty;

            if (distance > range.y)
            {
                Bot.SetCrouched(false);
                Bot.MoveTo(targetPosition, BotMoveSpeed.Run, range.y * 0.8f);
                return;
            }

            if (Time.time < m_NextManeuver)
            {
                return;
            }

            m_NextManeuver = Time.time + Random.Range(0.8f, 2.1f);
            Vector3 forward = distance > 0.01f ? toTarget / distance : Bot.transform.forward;

            if (distance < range.x && difficulty.aggressiveness < 0.6f)
            {
                // Too close for comfort: back off while shooting.
                Bot.SetCrouched(false);
                TryMoveTo(position - forward * Random.Range(4f, 7f), BotMoveSpeed.Walk);
                return;
            }

            bool shotgun = Bot.Weapons.ActiveWeapon != null && Bot.Weapons.ActiveWeapon.category == WeaponCategory.Shotgun;
            if (Random.value < difficulty.strafeChance || shotgun)
            {
                Bot.SetCrouched(false);
                Vector3 right = Vector3.Cross(Vector3.up, forward);
                float side = Random.value < 0.5f ? -1f : 1f;
                Vector3 strafe = position + right * (side * Random.Range(2.5f, 5f));
                if (shotgun || difficulty.aggressiveness > 0.7f)
                {
                    strafe += forward * Random.Range(1f, 3f);
                }

                TryMoveTo(strafe, difficulty.aggressiveness > 0.5f ? BotMoveSpeed.Run : BotMoveSpeed.Walk);
            }
            else
            {
                Bot.Navigator.Stop();
                Bot.SetCrouched(Random.value < Mathf.Lerp(0.65f, 0.2f, difficulty.aggressiveness));
            }
        }

        private void TryMoveTo(Vector3 point, BotMoveSpeed speed)
        {
            if (NavMesh.SamplePosition(point, out NavMeshHit hit, 2f, NavMesh.AllAreas))
            {
                Bot.MoveTo(hit.position, speed, 0.3f);
            }
        }

        protected override void OnExit()
        {
            Bot.SetAiming(false);
            Bot.SetCrouched(false);
        }
    }
}
