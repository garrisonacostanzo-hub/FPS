using System.Collections.Generic;
using FPS.Combat;
using FPS.Core;
using FPS.World;
using UnityEngine;

namespace FPS.AI
{
    public struct EnemyIntel
    {
        public Combatant Enemy;
        public Vector3 Position;
        public float Time;
    }

    /// <summary>
    /// Small fire team (2-4 bots). Shares enemy sightings, holds a common objective, staggers reloads so the whole
    /// squad never reloads at once, assigns at most one flanker at a time and provides formation slots while moving.
    /// </summary>
    public class BotSquad
    {
        private const float k_IntelLifetime = 8f;
        private const float k_FlankCooldown = 9f;

        private readonly List<AdvancedBotAI> m_Members = new List<AdvancedBotAI>(4);
        private readonly Dictionary<ulong, EnemyIntel> m_Intel = new Dictionary<ulong, EnemyIntel>(8);
        private readonly List<ulong> m_Expired = new List<ulong>(8);
        private AdvancedBotAI m_Reloader;
        private float m_ReloadTokenExpiry;
        private AdvancedBotAI m_Flanker;
        private float m_LastFlankTime = -999f;

        public BotSquad(int id, Team team)
        {
            Id = id;
            Team = team;
        }

        public int Id { get; }
        public Team Team { get; }
        public IReadOnlyList<AdvancedBotAI> Members => m_Members;
        public IObjective Objective { get; set; }
        public int Count => m_Members.Count;

        public AdvancedBotAI Leader
        {
            get
            {
                for (int i = 0; i < m_Members.Count; i++)
                {
                    if (m_Members[i] != null && m_Members[i].IsAlive)
                    {
                        return m_Members[i];
                    }
                }

                return null;
            }
        }

        public Vector3 Centroid
        {
            get
            {
                Vector3 sum = Vector3.zero;
                int count = 0;
                for (int i = 0; i < m_Members.Count; i++)
                {
                    if (m_Members[i] != null && m_Members[i].IsAlive)
                    {
                        sum += m_Members[i].transform.position;
                        count++;
                    }
                }

                return count > 0 ? sum / count : Vector3.zero;
            }
        }

        public void Add(AdvancedBotAI bot)
        {
            if (!m_Members.Contains(bot))
            {
                m_Members.Add(bot);
            }
        }

        public void Remove(AdvancedBotAI bot)
        {
            m_Members.Remove(bot);
            ReleaseTokens(bot);
        }

        public void ReportEnemy(Combatant enemy, Vector3 position)
        {
            if (enemy == null)
            {
                return;
            }

            m_Intel[enemy.CombatantId] = new EnemyIntel { Enemy = enemy, Position = position, Time = Time.time };
        }

        /// <summary>Most recent enemy sighting by any squad member (excluding stale or dead enemies).</summary>
        public bool TryGetFreshIntel(Vector3 from, out EnemyIntel intel)
        {
            intel = default;
            float bestScore = float.MaxValue;
            bool found = false;
            m_Expired.Clear();
            foreach (KeyValuePair<ulong, EnemyIntel> pair in m_Intel)
            {
                EnemyIntel entry = pair.Value;
                float age = Time.time - entry.Time;
                if (age > k_IntelLifetime || entry.Enemy == null || !entry.Enemy.IsAlive)
                {
                    m_Expired.Add(pair.Key);
                    continue;
                }

                float score = age * 10f + Vector3.Distance(from, entry.Position);
                if (score < bestScore)
                {
                    bestScore = score;
                    intel = entry;
                    found = true;
                }
            }

            for (int i = 0; i < m_Expired.Count; i++)
            {
                m_Intel.Remove(m_Expired[i]);
            }

            return found;
        }

        /// <summary>Only one member reloads at a time during combat, unless a magazine is completely empty.</summary>
        public bool RequestReloadToken(AdvancedBotAI bot, bool emergency)
        {
            if (emergency || m_Reloader == null || m_Reloader == bot || !m_Reloader.IsAlive || Time.time > m_ReloadTokenExpiry)
            {
                m_Reloader = bot;
                m_ReloadTokenExpiry = Time.time + 4f;
                return true;
            }

            return false;
        }

        public bool TryAssignFlanker(AdvancedBotAI bot)
        {
            if (m_Members.Count < 2)
            {
                return false;
            }

            if (m_Flanker != null && m_Flanker != bot && m_Flanker.IsAlive && m_Flanker.IsFlanking)
            {
                return false;
            }

            if (Time.time - m_LastFlankTime < k_FlankCooldown)
            {
                return false;
            }

            m_Flanker = bot;
            m_LastFlankTime = Time.time;
            return true;
        }

        public void ReleaseTokens(AdvancedBotAI bot)
        {
            if (m_Reloader == bot)
            {
                m_Reloader = null;
            }

            if (m_Flanker == bot)
            {
                m_Flanker = null;
            }
        }

        /// <summary>Wedge formation slot behind the leader.</summary>
        public Vector3 GetFormationPosition(AdvancedBotAI bot)
        {
            AdvancedBotAI leader = Leader;
            if (leader == null || leader == bot)
            {
                return bot.transform.position;
            }

            int index = Mathf.Max(1, m_Members.IndexOf(bot));
            float side = index % 2 == 0 ? 1f : -1f;
            float row = Mathf.Ceil(index / 2f);
            Transform lt = leader.transform;
            return lt.position - lt.forward * (3.5f * row) + lt.right * (3f * side * row);
        }

        /// <summary>Picks a side to flank the target from, opposite to where most of the squad is.</summary>
        public Vector3 ComputeFlankPosition(Vector3 targetPosition, Vector3 flankerPosition, float distance)
        {
            Vector3 centroid = Centroid;
            Vector3 axis = targetPosition - centroid;
            axis.y = 0f;
            if (axis.sqrMagnitude < 1f)
            {
                axis = targetPosition - flankerPosition;
                axis.y = 0f;
            }

            axis.Normalize();
            Vector3 perpendicular = Vector3.Cross(Vector3.up, axis);
            float side = Vector3.Dot(flankerPosition - centroid, perpendicular) >= 0f ? 1f : -1f;
            return targetPosition + perpendicular * (side * distance) - axis * (distance * 0.35f);
        }
    }
}
