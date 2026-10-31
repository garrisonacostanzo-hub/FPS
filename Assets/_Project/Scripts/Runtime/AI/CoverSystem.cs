using System.Collections.Generic;
using FPS.Combat;
using FPS.Core;
using UnityEngine;

namespace FPS.AI
{
    /// <summary>
    /// Registry and evaluator of <see cref="CoverPoint"/>s. Scores candidates by protection from the threat
    /// (line-of-sight raycasts at hidden eye height), travel distance, distance to threat and squad reservations.
    /// </summary>
    public static class CoverSystem
    {
        private struct Candidate
        {
            public CoverPoint Point;
            public float Score;
        }

        private static readonly List<CoverPoint> s_Points = new List<CoverPoint>(512);
        private static readonly List<Candidate> s_Candidates = new List<Candidate>(64);

        public static int Count => s_Points.Count;
        public static IReadOnlyList<CoverPoint> All => s_Points;

        internal static void Register(CoverPoint point)
        {
            if (!s_Points.Contains(point))
            {
                s_Points.Add(point);
            }
        }

        internal static void Unregister(CoverPoint point)
        {
            s_Points.Remove(point);
        }

        /// <summary>True if <paramref name="threatEye"/> cannot see a person hiding at <paramref name="point"/>.</summary>
        public static bool IsProtected(CoverPoint point, Vector3 threatEye)
        {
            Vector3 hiddenHead = point.Position + Vector3.up * point.HiddenEyeHeight;
            return Physics.Linecast(threatEye, hiddenHead, GameLayers.VisionBlockMask, QueryTriggerInteraction.Ignore);
        }

        /// <summary>True if the cover allows shooting at the threat when peeking (standing up / leaning).</summary>
        public static bool CanPeek(CoverPoint point, Vector3 threatChest)
        {
            Vector3 peekEye = point.Position + Vector3.up * 1.6f;
            if (!Physics.Linecast(peekEye, threatChest, GameLayers.VisionBlockMask, QueryTriggerInteraction.Ignore))
            {
                return true;
            }

            // High cover: try leaning out to the sides.
            Vector3 toThreat = threatChest - peekEye;
            toThreat.y = 0f;
            Vector3 side = Vector3.Cross(Vector3.up, toThreat.normalized) * 0.8f;
            return !Physics.Linecast(peekEye + side, threatChest, GameLayers.VisionBlockMask, QueryTriggerInteraction.Ignore) ||
                   !Physics.Linecast(peekEye - side, threatChest, GameLayers.VisionBlockMask, QueryTriggerInteraction.Ignore);
        }

        /// <summary>Finds the best reachable cover against <paramref name="threatPosition"/>. Returns null if none.</summary>
        public static CoverPoint FindBestCover(Combatant seeker, Vector3 seekerPosition, Vector3 threatPosition, float searchRadius,
            float minThreatDistance, float aggressiveness)
        {
            s_Candidates.Clear();
            Vector3 threatEye = threatPosition + Vector3.up * 1.6f;
            float searchRadiusSq = searchRadius * searchRadius;
            float preferredThreatDistance = Mathf.Lerp(35f, 14f, aggressiveness);

            for (int i = 0; i < s_Points.Count; i++)
            {
                CoverPoint point = s_Points[i];
                if (point == null)
                {
                    continue;
                }

                Vector3 position = point.Position;
                float seekerDistanceSq = (position - seekerPosition).sqrMagnitude;
                if (seekerDistanceSq > searchRadiusSq)
                {
                    continue;
                }

                if (point.IsReserved && point.Occupant != seeker)
                {
                    continue;
                }

                float threatDistance = Vector3.Distance(position, threatPosition);
                if (threatDistance < minThreatDistance)
                {
                    continue;
                }

                // Cheap orientation pre-filter: the obstacle should be roughly between us and the threat.
                Vector3 toThreat = (threatPosition - position);
                toThreat.y = 0f;
                float facing = Vector3.Dot(point.ObstacleDirection, toThreat.normalized);
                if (facing < -0.2f)
                {
                    continue;
                }

                float score = 0f;
                score -= Mathf.Sqrt(seekerDistanceSq) * 1.1f;
                score -= Mathf.Abs(threatDistance - preferredThreatDistance) * 0.35f;
                score += facing * 6f;
                score += point.Height == CoverHeight.High ? 2f : 0f;

                // Prefer not to run towards the threat to reach cover.
                Vector3 seekerToCover = position - seekerPosition;
                Vector3 seekerToThreat = threatPosition - seekerPosition;
                if (Vector3.Dot(seekerToCover.normalized, seekerToThreat.normalized) > 0.6f && seekerToCover.magnitude > 6f)
                {
                    score -= 10f;
                }

                s_Candidates.Add(new Candidate { Point = point, Score = score });
            }

            if (s_Candidates.Count == 0)
            {
                return null;
            }

            s_Candidates.Sort((a, b) => b.Score.CompareTo(a.Score));

            // Expensive checks (raycasts, path) only for the best few.
            int checks = Mathf.Min(6, s_Candidates.Count);
            for (int i = 0; i < checks; i++)
            {
                CoverPoint point = s_Candidates[i].Point;
                if (!IsProtected(point, threatEye))
                {
                    continue;
                }

                float straight = Vector3.Distance(seekerPosition, point.Position);
                float path = BotNavigator.PathLength(seekerPosition, point.Position);
                if (float.IsInfinity(path) || path > straight * 2.5f + 6f)
                {
                    continue;
                }

                return point;
            }

            return null;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            s_Points.Clear();
            s_Candidates.Clear();
        }
    }
}
