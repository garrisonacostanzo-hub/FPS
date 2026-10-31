using System.Collections.Generic;
using FPS.Core;
using FPS.World;
using UnityEngine;

namespace FPS.AI
{
    /// <summary>
    /// Server-side squad orchestration: groups bots of the same team into squads and distributes objectives
    /// (attack un-owned zones, defend contested owned zones) so teams spread across the map.
    /// </summary>
    public static class BotSquadManager
    {
        public const int MaxSquadSize = 3;
        private const float k_ObjectiveRefreshInterval = 4f;

        private static readonly List<BotSquad> s_Squads = new List<BotSquad>(16);
        private static readonly List<IObjective> s_Scratch = new List<IObjective>(8);
        private static int s_NextId = 1;
        private static float s_NextRefresh;

        public static IReadOnlyList<BotSquad> Squads => s_Squads;

        public static BotSquad Join(AdvancedBotAI bot, Team team)
        {
            for (int i = 0; i < s_Squads.Count; i++)
            {
                BotSquad squad = s_Squads[i];
                if (squad.Team == team && squad.Count < MaxSquadSize)
                {
                    squad.Add(bot);
                    return squad;
                }
            }

            var created = new BotSquad(s_NextId++, team);
            created.Add(bot);
            s_Squads.Add(created);
            s_NextRefresh = 0f;
            return created;
        }

        public static void Leave(AdvancedBotAI bot, BotSquad squad)
        {
            if (squad == null)
            {
                return;
            }

            squad.Remove(bot);
            if (squad.Count == 0)
            {
                s_Squads.Remove(squad);
            }
        }

        /// <summary>Call regularly on the server (MatchManager does this).</summary>
        public static void Tick()
        {
            if (Time.time < s_NextRefresh)
            {
                return;
            }

            s_NextRefresh = Time.time + k_ObjectiveRefreshInterval;
            AssignObjectives(Team.Alpha);
            AssignObjectives(Team.Bravo);
        }

        private static void AssignObjectives(Team team)
        {
            IReadOnlyList<IObjective> objectives = ObjectiveRegistry.All;
            if (objectives.Count == 0)
            {
                return;
            }

            s_Scratch.Clear();
            s_Scratch.AddRange(objectives);

            // Priority: contested owned zones (defend) > enemy zones > neutral zones > safe owned zones.
            s_Scratch.Sort((a, b) => Priority(b, team).CompareTo(Priority(a, team)));

            int squadIndex = 0;
            for (int i = 0; i < s_Squads.Count; i++)
            {
                BotSquad squad = s_Squads[i];
                if (squad.Team != team)
                {
                    continue;
                }

                // Distribute squads over the top objectives, keeping the current one if it is still valuable.
                IObjective desired = s_Scratch[squadIndex % Mathf.Min(s_Scratch.Count, 2 + squadIndex / 2)];
                if (squad.Objective == null || Priority(squad.Objective, team) + 1.5f < Priority(desired, team))
                {
                    squad.Objective = desired;
                }

                squadIndex++;
            }
        }

        private static float Priority(IObjective objective, Team team)
        {
            if (objective.OwnerTeam == team)
            {
                return objective.IsContested ? 4f : 0.5f;
            }

            return objective.OwnerTeam == Team.Neutral ? 2.5f : 3f;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            s_Squads.Clear();
            s_NextId = 1;
            s_NextRefresh = 0f;
        }

        public static void Clear()
        {
            s_Squads.Clear();
        }
    }
}
