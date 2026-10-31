using System.Collections.Generic;
using FPS.Core;
using UnityEngine;

namespace FPS.World
{
    /// <summary>Anything bots and the HUD can treat as a tactical objective (capture zones, bombs, flags...).</summary>
    public interface IObjective
    {
        string DisplayName { get; }
        Vector3 Position { get; }
        float Radius { get; }
        Team OwnerTeam { get; }
        bool IsContested { get; }

        /// <summary>-1..1 progress towards Alpha (negative) or Bravo (positive) ownership.</summary>
        float CaptureProgress { get; }
    }

    public static class ObjectiveRegistry
    {
        private static readonly List<IObjective> s_Objectives = new List<IObjective>(8);

        public static IReadOnlyList<IObjective> All => s_Objectives;

        public static void Register(IObjective objective)
        {
            if (objective != null && !s_Objectives.Contains(objective))
            {
                s_Objectives.Add(objective);
            }
        }

        public static void Unregister(IObjective objective)
        {
            s_Objectives.Remove(objective);
        }

        public static IObjective Closest(Vector3 position)
        {
            IObjective best = null;
            float bestDistance = float.MaxValue;
            for (int i = 0; i < s_Objectives.Count; i++)
            {
                float distance = (s_Objectives[i].Position - position).sqrMagnitude;
                if (distance < bestDistance)
                {
                    bestDistance = distance;
                    best = s_Objectives[i];
                }
            }

            return best;
        }

        public static int CountOwnedBy(Team team)
        {
            int count = 0;
            for (int i = 0; i < s_Objectives.Count; i++)
            {
                if (s_Objectives[i].OwnerTeam == team)
                {
                    count++;
                }
            }

            return count;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            s_Objectives.Clear();
        }
    }
}
