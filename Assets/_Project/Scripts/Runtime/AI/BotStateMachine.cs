using System.Collections.Generic;
using UnityEngine;

namespace FPS.AI
{
    public enum BotStateId
    {
        None,
        Patrol,
        Investigate,
        Engage,
        TakeCover,
        Reload,
        Flank,
        Search,
        Dead
    }

    /// <summary>Base class for tactical states. States hold no Unity references of their own; they drive the bot API.</summary>
    public abstract class BotState
    {
        protected BotState(AdvancedBotAI bot)
        {
            Bot = bot;
        }

        protected AdvancedBotAI Bot { get; }
        protected BotBlackboard Memory => Bot.Memory;
        protected float TimeInState => Time.time - EnteredTime;

        public float EnteredTime { get; private set; }
        public abstract BotStateId Id { get; }

        /// <summary>True when the state finished its job and the decision layer should pick something else.</summary>
        public bool IsComplete { get; protected set; }

        /// <summary>When false the decision layer will not pre-empt this state for lower priority reasons.</summary>
        public virtual bool IsInterruptible => true;

        public void Enter()
        {
            EnteredTime = Time.time;
            IsComplete = false;
            OnEnter();
        }

        public void Exit()
        {
            OnExit();
        }

        public abstract void Tick(float deltaTime);

        protected virtual void OnEnter()
        {
        }

        protected virtual void OnExit()
        {
        }
    }

    /// <summary>Minimal finite state machine with typed state ids and transition history for debugging.</summary>
    public class BotStateMachine
    {
        private readonly Dictionary<BotStateId, BotState> m_States = new Dictionary<BotStateId, BotState>();
        private readonly Queue<BotStateId> m_History = new Queue<BotStateId>(8);

        public BotState Current { get; private set; }
        public BotStateId CurrentId => Current != null ? Current.Id : BotStateId.None;
        public IEnumerable<BotStateId> History => m_History;

        public void Register(BotState state)
        {
            m_States[state.Id] = state;
        }

        public bool ChangeState(BotStateId id, bool force = false)
        {
            if (!force && Current != null && Current.Id == id)
            {
                return false;
            }

            if (!m_States.TryGetValue(id, out BotState next))
            {
                Debug.LogWarning("[FPS] Bot state not registered: " + id);
                return false;
            }

            Current?.Exit();
            Current = next;
            m_History.Enqueue(id);
            while (m_History.Count > 8)
            {
                m_History.Dequeue();
            }

            Current.Enter();
            return true;
        }

        public void Tick(float deltaTime)
        {
            Current?.Tick(deltaTime);
        }

        public T Get<T>(BotStateId id) where T : BotState
        {
            return m_States.TryGetValue(id, out BotState state) ? state as T : null;
        }
    }
}
