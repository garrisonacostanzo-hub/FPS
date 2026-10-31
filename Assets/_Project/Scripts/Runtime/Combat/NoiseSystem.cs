using FPS.Core;
using UnityEngine;

namespace FPS.Combat
{
    public enum NoiseType : byte
    {
        Footstep,
        Landing,
        Gunfire,
        BulletImpact,
        Explosion
    }

    /// <summary>Server-side sound stimulus consumed by AI hearing.</summary>
    public struct NoiseEvent
    {
        public Vector3 Position;
        public float Radius;
        public NoiseType Type;
        public Combatant Source;
        public Team SourceTeam;
        public float Time;
    }

    /// <summary>
    /// Publishes noise stimuli on the server through the <see cref="EventBus{T}"/>. Bots subscribe and decide
    /// (distance, occlusion, hearing skill) whether they perceived the sound.
    /// </summary>
    public static class NoiseSystem
    {
        public static bool Enabled { get; set; } = true;

        public static void Emit(Vector3 position, float radius, NoiseType type, Combatant source)
        {
            if (!Enabled || radius <= 0f)
            {
                return;
            }

            EventBus<NoiseEvent>.Raise(new NoiseEvent
            {
                Position = position,
                Radius = radius,
                Type = type,
                Source = source,
                SourceTeam = source != null ? source.Team : Team.Neutral,
                Time = UnityEngine.Time.time
            });
        }
    }
}
