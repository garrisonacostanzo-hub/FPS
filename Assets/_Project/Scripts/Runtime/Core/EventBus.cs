using System;
using System.Collections.Generic;
using UnityEngine;

namespace FPS.Core
{
    /// <summary>
    /// Type-safe, allocation-free (after warm-up) publish/subscribe bus for decoupled gameplay events.
    /// Producers never know who is listening (HUD, audio, AI, analytics...), which keeps systems independent.
    /// Usage: EventBus&lt;LocalAmmoChangedEvent&gt;.Subscribe(OnAmmo); EventBus&lt;LocalAmmoChangedEvent&gt;.Raise(evt);
    /// </summary>
    public static class EventBus<T> where T : struct
    {
        private static readonly List<Action<T>> s_Handlers = new List<Action<T>>(8);
        private static readonly List<Action<T>> s_Snapshot = new List<Action<T>>(8);
        private static bool s_Registered;

        public static int HandlerCount => s_Handlers.Count;

        public static void Subscribe(Action<T> handler)
        {
            if (handler == null || s_Handlers.Contains(handler))
            {
                return;
            }

            if (!s_Registered)
            {
                s_Registered = true;
                EventBusRegistry.Register(Clear);
            }

            s_Handlers.Add(handler);
        }

        public static void Unsubscribe(Action<T> handler)
        {
            if (handler != null)
            {
                s_Handlers.Remove(handler);
            }
        }

        public static void Raise(T evt)
        {
            if (s_Handlers.Count == 0)
            {
                return;
            }

            // Iterate a snapshot so handlers may unsubscribe while the event is dispatched.
            s_Snapshot.Clear();
            s_Snapshot.AddRange(s_Handlers);
            for (int i = 0; i < s_Snapshot.Count; i++)
            {
                try
                {
                    s_Snapshot[i]?.Invoke(evt);
                }
                catch (Exception exception)
                {
                    Debug.LogException(exception);
                }
            }

            s_Snapshot.Clear();
        }

        public static void Clear()
        {
            s_Handlers.Clear();
            s_Snapshot.Clear();
        }
    }

    /// <summary>
    /// Clears every bus when entering play mode, so the project works with "Enter Play Mode Options"
    /// (domain reload disabled) without leaking handlers from a previous session.
    /// </summary>
    public static class EventBusRegistry
    {
        private static readonly List<Action> s_ClearActions = new List<Action>();

        internal static void Register(Action clearAction)
        {
            s_ClearActions.Add(clearAction);
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ClearAll()
        {
            for (int i = 0; i < s_ClearActions.Count; i++)
            {
                s_ClearActions[i]?.Invoke();
            }
        }
    }
}
