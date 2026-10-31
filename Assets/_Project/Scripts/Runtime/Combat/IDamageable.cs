using Unity.Netcode;
using UnityEngine;

namespace FPS.Combat
{
    public enum DamageType : byte
    {
        Bullet,
        Explosion,
        Fall,
        World,
        Suicide
    }

    public enum HitboxRegion : byte
    {
        Torso,
        Head,
        Limb
    }

    /// <summary>Immutable description of a damage event. Serializable so it can be replicated for hit feedback.</summary>
    public struct DamageInfo : INetworkSerializable
    {
        public const ulong NoAttacker = ulong.MaxValue;

        public float Amount;
        public Vector3 Point;
        public Vector3 Direction;
        public Vector3 SourcePosition;
        public ulong AttackerId;
        public int WeaponId;
        public DamageType Type;
        public HitboxRegion Region;

        public bool IsHeadshot => Region == HitboxRegion.Head;
        public bool HasAttacker => AttackerId != NoAttacker;

        public static DamageInfo Environmental(float amount, Vector3 point, DamageType type)
        {
            return new DamageInfo
            {
                Amount = amount,
                Point = point,
                Direction = Vector3.down,
                SourcePosition = point,
                AttackerId = NoAttacker,
                WeaponId = 0,
                Type = type,
                Region = HitboxRegion.Torso
            };
        }

        public void NetworkSerialize<T>(BufferSerializer<T> serializer) where T : IReaderWriter
        {
            serializer.SerializeValue(ref Amount);
            serializer.SerializeValue(ref Point);
            serializer.SerializeValue(ref Direction);
            serializer.SerializeValue(ref SourcePosition);
            serializer.SerializeValue(ref AttackerId);
            serializer.SerializeValue(ref WeaponId);
            byte type = (byte)Type;
            byte region = (byte)Region;
            serializer.SerializeValue(ref type);
            serializer.SerializeValue(ref region);
            if (serializer.IsReader)
            {
                Type = (DamageType)type;
                Region = (HitboxRegion)region;
            }
        }
    }

    /// <summary>
    /// Anything that can receive damage. Implemented by <see cref="HealthSystem"/> (whole entity) and
    /// <see cref="Hitbox"/> (body region forwarding to its owner). Damage is only ever applied on the server.
    /// </summary>
    public interface IDamageable
    {
        bool CanTakeDamage { get; }

        void ApplyDamage(in DamageInfo damage);
    }
}
