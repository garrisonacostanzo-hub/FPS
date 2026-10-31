using System.Collections.Generic;
using FPS.Combat;
using FPS.Core;
using UnityEngine;

namespace FPS.Weapons
{
    public struct BallisticHit
    {
        public bool Hit;
        public Vector3 Point;
        public Vector3 Normal;
        public float Distance;
        public Hitbox Hitbox;
        public Collider Collider;
    }

    /// <summary>Deterministic spread generation and hitscan resolution shared by client prediction and server.</summary>
    public static class Ballistics
    {
        private static readonly RaycastHit[] s_Hits = new RaycastHit[32];
        private static readonly Comparer<RaycastHit> s_DistanceComparer = Comparer<RaycastHit>.Create((a, b) => a.distance.CompareTo(b.distance));

        /// <summary>Returns a direction inside a cone of <paramref name="spreadDegrees"/> (full angle) around <paramref name="direction"/>.</summary>
        public static Vector3 ApplySpread(Vector3 direction, float spreadDegrees, int seed, int pelletIndex)
        {
            if (spreadDegrees <= 0.0001f)
            {
                return direction.normalized;
            }

            uint hash = Hash((uint)seed, (uint)pelletIndex);
            float u = (hash & 0xFFFF) / 65535f;
            float v = ((hash >> 16) & 0xFFFF) / 65535f;
            float coneAngle = Mathf.Sqrt(u) * spreadDegrees * 0.5f * Mathf.Deg2Rad;
            float theta = v * Mathf.PI * 2f;
            Vector3 local = new Vector3(Mathf.Cos(theta) * Mathf.Sin(coneAngle), Mathf.Sin(theta) * Mathf.Sin(coneAngle), Mathf.Cos(coneAngle));
            return (Quaternion.LookRotation(direction.normalized) * local).normalized;
        }

        private static uint Hash(uint a, uint b)
        {
            uint h = a * 0x9E3779B1u ^ (b + 0x7F4A7C15u) * 0x85EBCA77u;
            h ^= h >> 15;
            h *= 0x2C1B3C6Du;
            h ^= h >> 12;
            h *= 0x297A2D39u;
            h ^= h >> 15;
            return h;
        }

        /// <summary>
        /// Resolves a hitscan ray, ignoring every collider that belongs to <paramref name="shooterRoot"/>.
        /// Stops at the first world surface or hitbox.
        /// </summary>
        public static BallisticHit Raycast(Vector3 origin, Vector3 direction, float maxDistance, Transform shooterRoot)
        {
            int count = Physics.RaycastNonAlloc(origin, direction, s_Hits, maxDistance, GameLayers.ShootableMask, QueryTriggerInteraction.Ignore);
            if (count > 1)
            {
                System.Array.Sort(s_Hits, 0, count, s_DistanceComparer);
            }

            for (int i = 0; i < count; i++)
            {
                RaycastHit hit = s_Hits[i];
                if (hit.collider == null)
                {
                    continue;
                }

                if (shooterRoot != null && hit.collider.transform.IsChildOf(shooterRoot))
                {
                    continue;
                }

                Hitbox hitbox = hit.collider.GetComponent<Hitbox>();
                if (hitbox != null && (hitbox.Owner == null || !hitbox.CanTakeDamage))
                {
                    // Dead bodies do not stop bullets.
                    continue;
                }

                return new BallisticHit
                {
                    Hit = true,
                    Point = hit.point,
                    Normal = hit.normal,
                    Distance = hit.distance,
                    Hitbox = hitbox,
                    Collider = hit.collider
                };
            }

            return new BallisticHit
            {
                Hit = false,
                Point = origin + direction * maxDistance,
                Normal = -direction,
                Distance = maxDistance
            };
        }

        /// <summary>Shortest distance from a point to the segment [a, b].</summary>
        public static float DistanceToSegment(Vector3 point, Vector3 a, Vector3 b)
        {
            Vector3 ab = b - a;
            float lengthSq = ab.sqrMagnitude;
            if (lengthSq < 1e-6f)
            {
                return Vector3.Distance(point, a);
            }

            float t = Mathf.Clamp01(Vector3.Dot(point - a, ab) / lengthSq);
            return Vector3.Distance(point, a + ab * t);
        }
    }
}
