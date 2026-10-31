using FPS.World;
using UnityEngine;

namespace FPS.AI.States
{
    /// <summary>
    /// Default behaviour: move with the squad to its objective (formation for followers) and hold/rotate inside it;
    /// without an objective, walk the closest patrol route and pause at waypoints.
    /// </summary>
    public class PatrolState : BotState
    {
        private PatrolRoute m_Route;
        private int m_Index;
        private float m_WaitUntil;
        private Vector3 m_HoldPoint;
        private float m_NextReposition;
        private Vector2 m_ObjectiveOffset;

        public PatrolState(AdvancedBotAI bot) : base(bot)
        {
        }

        public override BotStateId Id => BotStateId.Patrol;

        protected override void OnEnter()
        {
            Bot.SetCrouched(false);
            Bot.SetAiming(false);
            Bot.ClearLookPoint();
            m_Route = null;
            m_WaitUntil = 0f;
            m_NextReposition = 0f;
            m_ObjectiveOffset = Random.insideUnitCircle;
        }

        public override void Tick(float deltaTime)
        {
            Bot.FireAllowed = true;
            BotSquad squad = Bot.Squad;
            IObjective objective = squad != null ? squad.Objective : null;
            if (objective != null)
            {
                TickObjective(squad, objective);
            }
            else
            {
                TickRoute();
            }
        }

        private void TickObjective(BotSquad squad, IObjective objective)
        {
            Vector3 position = Bot.transform.position;
            Vector3 objectivePosition = objective.Position;
            Vector3 flat = objectivePosition - position;
            flat.y = 0f;
            float distance = flat.magnitude;

            if (distance > objective.Radius * 0.9f)
            {
                bool isLeader = squad.Leader == Bot;
                Vector3 destination;
                if (isLeader || distance > 70f)
                {
                    destination = objectivePosition + new Vector3(m_ObjectiveOffset.x, 0f, m_ObjectiveOffset.y) * (objective.Radius * 0.5f);
                }
                else
                {
                    destination = squad.GetFormationPosition(Bot);
                }

                Bot.ClearLookPoint();
                Bot.SetCrouched(false);
                Bot.MoveTo(destination, distance > 35f ? BotMoveSpeed.Run : BotMoveSpeed.Walk, 1f);
                return;
            }

            // Inside the objective: hold positions, rotate between them, watch outwards.
            if (Time.time >= m_NextReposition)
            {
                m_NextReposition = Time.time + Random.Range(4f, 9f);
                if (BotNavigator.RandomPointOnNavMesh(objectivePosition, objective.Radius * 0.8f, out Vector3 point))
                {
                    m_HoldPoint = point;
                }
                else
                {
                    m_HoldPoint = objectivePosition;
                }

                Bot.SetCrouched(Random.value < 0.35f);
            }

            Bot.MoveTo(m_HoldPoint, BotMoveSpeed.Walk, 0.6f);
            Vector3 outward = m_HoldPoint - objectivePosition;
            outward.y = 0f;
            if (outward.sqrMagnitude < 0.25f)
            {
                outward = Bot.transform.forward;
            }

            float sweep = Mathf.Sin(Time.time * 0.4f + m_ObjectiveOffset.x * 10f) * 60f;
            Vector3 look = Quaternion.Euler(0f, sweep, 0f) * outward.normalized;
            Bot.SetLookPoint(Bot.EyePosition + look * 15f);
        }

        private void TickRoute()
        {
            if (m_Route == null)
            {
                m_Route = PatrolRoute.FindClosest(Bot.transform.position, Bot.Combatant.Team);
                if (m_Route != null)
                {
                    m_Index = m_Route.ClosestIndex(Bot.transform.position);
                }
            }

            if (m_Route == null)
            {
                // Wander.
                if (!Bot.Navigator.HasDestination || Bot.Navigator.HasArrived)
                {
                    if (BotNavigator.RandomPointOnNavMesh(Bot.transform.position, 25f, out Vector3 wander))
                    {
                        Bot.MoveTo(wander, BotMoveSpeed.Walk);
                    }
                }

                return;
            }

            if (Bot.Navigator.HasArrived && Bot.Navigator.HasDestination)
            {
                if (m_WaitUntil <= 0f)
                {
                    m_WaitUntil = Time.time + Random.Range(1f, 3f);
                }
                else if (Time.time >= m_WaitUntil)
                {
                    m_Index++;
                    m_WaitUntil = 0f;
                }
            }

            Bot.ClearLookPoint();
            Bot.MoveTo(m_Route.GetWaypoint(m_Index), BotMoveSpeed.Walk, 0.8f);
        }
    }
}
