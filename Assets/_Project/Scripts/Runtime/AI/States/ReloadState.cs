using UnityEngine;

namespace FPS.AI.States
{
    /// <summary>
    /// Reloads during a safe interval (squad-staggered). If an enemy was seen recently the bot backs into nearby
    /// cover while reloading instead of standing in the open.
    /// </summary>
    public class ReloadState : BotState
    {
        private CoverPoint m_Cover;

        public ReloadState(AdvancedBotAI bot) : base(bot)
        {
        }

        public override BotStateId Id => BotStateId.Reload;

        public override bool IsInterruptible => !Bot.Weapons.IsReloading;

        protected override void OnEnter()
        {
            Bot.SetAiming(false);
            if (!Bot.Weapons.RequestReload())
            {
                IsComplete = true;
                return;
            }

            if (Memory.TimeSinceSeen < 4f || Memory.TimeSinceThreat < 4f)
            {
                m_Cover = CoverSystem.FindBestCover(Bot.Combatant, Bot.transform.position, Memory.BestThreatPosition, 12f, 5f, Bot.Difficulty.aggressiveness);
                if (m_Cover != null && m_Cover.TryReserve(Bot.Combatant, 8f))
                {
                    Memory.CurrentCover = m_Cover;
                    Bot.MoveTo(m_Cover.Position, BotMoveSpeed.Run, 0.3f);
                    return;
                }

                m_Cover = null;
            }

            Bot.Navigator.Stop();
            Bot.SetCrouched(true);
        }

        public override void Tick(float deltaTime)
        {
            Bot.FireAllowed = false;
            if (m_Cover != null && Bot.Navigator.HasArrived)
            {
                Bot.SetCrouched(m_Cover.Height == CoverHeight.Low);
            }

            if (Memory.HasTarget)
            {
                Bot.SetLookPoint(Memory.LastKnownTargetPosition + Vector3.up * 1.4f);
            }

            if (!Bot.Weapons.IsReloading || TimeInState > 6f)
            {
                IsComplete = true;
            }
        }

        protected override void OnExit()
        {
            if (m_Cover != null)
            {
                m_Cover.Release(Bot.Combatant);
                m_Cover = null;
            }

            Memory.CurrentCover = null;
            Bot.SetCrouched(false);
        }
    }
}
