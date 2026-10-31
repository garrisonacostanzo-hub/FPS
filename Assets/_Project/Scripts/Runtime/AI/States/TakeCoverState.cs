using UnityEngine;
using UnityEngine.AI;

namespace FPS.AI.States
{
    /// <summary>
    /// Under fire or hurt: sprint to the best protected cover point (or retreat if none), hide (crouch behind low
    /// cover), reload if needed, then peek out to re-engage once suppression has dropped.
    /// </summary>
    public class TakeCoverState : BotState
    {
        private enum Phase
        {
            Moving,
            Retreating,
            Hiding,
            Peeking
        }

        private Phase m_Phase;
        private CoverPoint m_Cover;
        private Vector3 m_Threat;
        private float m_HideUntil;
        private float m_PeekUntil;

        public TakeCoverState(AdvancedBotAI bot) : base(bot)
        {
        }

        public override BotStateId Id => BotStateId.TakeCover;

        /// <summary>Do not abandon the dash to cover halfway; hiding/peeking can be interrupted.</summary>
        public override bool IsInterruptible => m_Phase == Phase.Peeking || (m_Phase == Phase.Hiding && TimeInState > 1.5f);

        protected override void OnEnter()
        {
            m_Threat = Memory.BestThreatPosition;
            Memory.LastCoverTime = Time.time;
            Bot.SetAiming(false);
            Bot.SetCrouched(false);

            m_Cover = CoverSystem.FindBestCover(Bot.Combatant, Bot.transform.position, m_Threat, 28f, 6f, Bot.Difficulty.aggressiveness);
            if (m_Cover != null && m_Cover.TryReserve(Bot.Combatant, 20f))
            {
                Memory.CurrentCover = m_Cover;
                m_Phase = Phase.Moving;
                if (!Bot.MoveTo(m_Cover.Position, BotMoveSpeed.Sprint, 0.25f))
                {
                    m_Cover.Release(Bot.Combatant);
                    m_Cover = null;
                    Memory.CurrentCover = null;
                    BeginRetreat();
                }

                return;
            }

            m_Cover = null;
            BeginRetreat();
        }

        private void BeginRetreat()
        {
            m_Phase = Phase.Retreating;
            Vector3 away = Bot.transform.position - m_Threat;
            away.y = 0f;
            if (away.sqrMagnitude < 0.01f)
            {
                away = -Bot.transform.forward;
            }

            Vector3 point = Bot.transform.position + away.normalized * 12f;
            if (NavMesh.SamplePosition(point, out NavMeshHit hit, 5f, NavMesh.AllAreas))
            {
                Bot.MoveTo(hit.position, BotMoveSpeed.Sprint, 0.5f);
            }
            else
            {
                IsComplete = true;
            }
        }

        public override void Tick(float deltaTime)
        {
            if (Memory.HasTarget && Memory.TargetVisible)
            {
                m_Threat = Memory.Target.FeetPosition;
            }

            switch (m_Phase)
            {
                case Phase.Moving:
                    // Aggressive bots shoot on the move; others concentrate on getting to safety.
                    Bot.FireAllowed = Memory.TargetVisible && Bot.Difficulty.aggressiveness > 0.6f;
                    Bot.ClearLookPoint();
                    if (Bot.Navigator.HasArrived)
                    {
                        EnterHiding();
                    }
                    else if (TimeInState > 8f)
                    {
                        IsComplete = true;
                    }

                    break;

                case Phase.Retreating:
                    Bot.FireAllowed = Memory.TargetVisible;
                    if (Bot.Navigator.HasArrived || TimeInState > 5f)
                    {
                        IsComplete = true;
                    }

                    break;

                case Phase.Hiding:
                    Bot.FireAllowed = false;
                    Bot.Navigator.Stop();
                    Bot.SetCrouched(m_Cover == null || m_Cover.Height == CoverHeight.Low || Memory.Suppression > 0.6f);
                    Bot.SetLookPoint(m_Threat + Vector3.up * 1.4f);

                    if (Bot.Weapons.CanReload() && (Bot.Weapons.MagazineFraction < 0.6f || Memory.ReloadInCover))
                    {
                        Bot.Weapons.RequestReload();
                        Memory.ReloadInCover = false;
                    }

                    if (Time.time >= m_HideUntil && Memory.Suppression < Bot.Difficulty.suppressionTolerance * 0.7f && !Bot.Weapons.IsReloading)
                    {
                        m_Phase = Phase.Peeking;
                        m_PeekUntil = Time.time + Random.Range(1.2f, 2.6f);
                        Bot.SetCrouched(false);
                    }

                    break;

                case Phase.Peeking:
                    Bot.FireAllowed = true;
                    Bot.SetAiming(true);
                    Bot.SetCrouched(false);
                    Bot.SetLookPoint(m_Threat + Vector3.up * 1.4f);
                    if (Memory.Suppression >= Bot.Difficulty.suppressionTolerance)
                    {
                        EnterHiding();
                    }
                    else if (Memory.TargetVisible || Time.time >= m_PeekUntil)
                    {
                        IsComplete = true;
                    }

                    break;
            }
        }

        private void EnterHiding()
        {
            m_Phase = Phase.Hiding;
            float aggression = Bot.Difficulty.aggressiveness;
            m_HideUntil = Time.time + Mathf.Lerp(5f, 1.8f, aggression) + Memory.Suppression * 2f;
        }

        protected override void OnExit()
        {
            if (m_Cover != null)
            {
                m_Cover.Release(Bot.Combatant);
            }

            m_Cover = null;
            Memory.CurrentCover = null;
            Memory.ReloadInCover = false;
            Memory.LastCoverTime = Time.time;
            Bot.SetCrouched(false);
            Bot.SetAiming(false);
        }
    }
}
