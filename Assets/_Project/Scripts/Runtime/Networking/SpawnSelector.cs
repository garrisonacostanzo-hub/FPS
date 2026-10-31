using System.Collections.Generic;
using FPS.Combat;
using FPS.Core;
using FPS.World;
using UnityEngine;

namespace FPS.Networking
{
    /// <summary>
    /// Server-side spawn point selection: prefers own-team points that are far from living enemies, not in their
    /// line of sight, not recently used and not physically occupied.
    /// </summary>
    public static class SpawnSelector
    {
        private static readonly Collider[] s_Overlap = new Collider[4];
        private static readonly List<SpawnPoint> s_Candidates = new List<SpawnPoint>(32);

        public static bool TryPick(Team team, out Vector3 position, out Quaternion rotation)
        {
            s_Candidates.Clear();
            IReadOnlyList<SpawnPoint> all = SpawnPoint.All;
            for (int i = 0; i < all.Count; i++)
            {
                if (all[i] != null && all[i].Team == team)
                {
                    s_Candidates.Add(all[i]);
                }
            }

            if (s_Candidates.Count == 0)
            {
                for (int i = 0; i < all.Count; i++)
                {
                    if (all[i] != null)
                    {
                        s_Candidates.Add(all[i]);
                    }
                }
            }

            if (s_Candidates.Count == 0)
            {
                position = Vector3.up * 2f;
                rotation = Quaternion.identity;
                return false;
            }

            SpawnPoint best = null;
            float bestScore = float.MinValue;
            IReadOnlyList<Combatant> combatants = CombatantRegistry.All;
            for (int i = 0; i < s_Candidates.Count; i++)
            {
                SpawnPoint point = s_Candidates[i];
                Vector3 spawnEye = point.transform.position + Vector3.up * 1.6f;
                float nearestEnemy = 80f;
                bool seen = false;
                for (int c = 0; c < combatants.Count; c++)
                {
                    Combatant other = combatants[c];
                    if (other == null || !other.IsAlive || other.Team == team)
                    {
                        continue;
                    }

                    float distance = Vector3.Distance(other.transform.position, point.transform.position);
                    nearestEnemy = Mathf.Min(nearestEnemy, distance);
                    if (!seen && distance < 90f && !Physics.Linecast(other.EyePosition, spawnEye, GameLayers.VisionBlockMask, QueryTriggerInteraction.Ignore))
                    {
                        seen = true;
                    }
                }

                float score = point.Priority * 5f + nearestEnemy * 0.5f + Random.Range(0f, 3f);
                if (seen) score -= 30f;
                if (Time.time - point.LastUsedTime < 3f) score -= 15f;
                if (IsOccupied(point.transform.position)) score -= 100f;

                if (score > bestScore)
                {
                    bestScore = score;
                    best = point;
                }
            }

            best.LastUsedTime = Time.time;
            position = best.transform.position;
            rotation = best.transform.rotation;
            return true;
        }

        private static bool IsOccupied(Vector3 position)
        {
            int count = Physics.OverlapCapsuleNonAlloc(position + Vector3.up * 0.4f, position + Vector3.up * 1.5f, 0.4f, s_Overlap,
                GameLayers.CombatantMask, QueryTriggerInteraction.Ignore);
            return count > 0;
        }
    }
}
