namespace FPS.AI.States
{
    /// <summary>Inert state while waiting for the server to respawn the bot.</summary>
    public class DeadState : BotState
    {
        public DeadState(AdvancedBotAI bot) : base(bot)
        {
        }

        public override BotStateId Id => BotStateId.Dead;

        public override bool IsInterruptible => false;

        protected override void OnEnter()
        {
            Bot.SetAiming(false);
            Bot.SetCrouched(false);
            Bot.ClearLookPoint();
            Memory.ForgetTarget();
        }

        public override void Tick(float deltaTime)
        {
            Bot.FireAllowed = false;
        }
    }
}
