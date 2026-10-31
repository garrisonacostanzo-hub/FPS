using System;
using Unity.Netcode;
using UnityEngine;

namespace FPS.Weapons
{
    /// <summary>Client -> server shot request. The seed lets the server regenerate the exact spread pattern.</summary>
    public struct ShotRequest : INetworkSerializable
    {
        public Vector3 Origin;
        public Vector3 Direction;
        public float Spread;
        public int Seed;
        public double ViewTime;
        public byte Slot;

        public void NetworkSerialize<T>(BufferSerializer<T> serializer) where T : IReaderWriter
        {
            serializer.SerializeValue(ref Origin);
            serializer.SerializeValue(ref Direction);
            serializer.SerializeValue(ref Spread);
            serializer.SerializeValue(ref Seed);
            serializer.SerializeValue(ref ViewTime);
            serializer.SerializeValue(ref Slot);
        }
    }

    /// <summary>Server -> clients visual result of a validated shot (tracers, impacts, blood).</summary>
    public struct ShotFxData : INetworkSerializable
    {
        public const int MaxImpacts = 12;

        public Vector3 Origin;
        public byte Slot;
        public byte Count;
        public ushort CharacterHitMask;
        public Vector3[] Points;
        public Vector3[] Normals;

        public static ShotFxData Create(Vector3 origin, byte slot)
        {
            return new ShotFxData
            {
                Origin = origin,
                Slot = slot,
                Count = 0,
                CharacterHitMask = 0,
                Points = new Vector3[MaxImpacts],
                Normals = new Vector3[MaxImpacts]
            };
        }

        public void Add(Vector3 point, Vector3 normal, bool hitCharacter)
        {
            if (Points == null || Count >= MaxImpacts)
            {
                return;
            }

            Points[Count] = point;
            Normals[Count] = normal;
            if (hitCharacter)
            {
                CharacterHitMask |= (ushort)(1 << Count);
            }

            Count++;
        }

        public bool HitCharacter(int index)
        {
            return (CharacterHitMask & (1 << index)) != 0;
        }

        public void NetworkSerialize<T>(BufferSerializer<T> serializer) where T : IReaderWriter
        {
            serializer.SerializeValue(ref Origin);
            serializer.SerializeValue(ref Slot);
            serializer.SerializeValue(ref Count);
            serializer.SerializeValue(ref CharacterHitMask);
            if (serializer.IsReader)
            {
                Count = (byte)Mathf.Min(Count, MaxImpacts);
                Points = new Vector3[MaxImpacts];
                Normals = new Vector3[MaxImpacts];
            }

            for (int i = 0; i < Count; i++)
            {
                Vector3 point = Points[i];
                Vector3 normal = Normals[i];
                serializer.SerializeValue(ref point);
                serializer.SerializeValue(ref normal);
                if (serializer.IsReader)
                {
                    Points[i] = point;
                    Normals[i] = normal;
                }
            }
        }
    }

    /// <summary>Replicated weapon loadout (weapon ids from GameConfig.weapons). -1 marks an empty slot.</summary>
    public struct LoadoutIds : INetworkSerializable, IEquatable<LoadoutIds>
    {
        public const int MaxSlots = 3;

        public int Slot0;
        public int Slot1;
        public int Slot2;

        public static LoadoutIds Empty => new LoadoutIds { Slot0 = -1, Slot1 = -1, Slot2 = -1 };

        public int Get(int index)
        {
            switch (index)
            {
                case 0: return Slot0;
                case 1: return Slot1;
                case 2: return Slot2;
                default: return -1;
            }
        }

        public void Set(int index, int weaponId)
        {
            switch (index)
            {
                case 0: Slot0 = weaponId; break;
                case 1: Slot1 = weaponId; break;
                case 2: Slot2 = weaponId; break;
            }
        }

        public void NetworkSerialize<T>(BufferSerializer<T> serializer) where T : IReaderWriter
        {
            serializer.SerializeValue(ref Slot0);
            serializer.SerializeValue(ref Slot1);
            serializer.SerializeValue(ref Slot2);
        }

        public bool Equals(LoadoutIds other)
        {
            return Slot0 == other.Slot0 && Slot1 == other.Slot1 && Slot2 == other.Slot2;
        }

        public override bool Equals(object obj)
        {
            return obj is LoadoutIds other && Equals(other);
        }

        public override int GetHashCode()
        {
            return (Slot0 * 397) ^ (Slot1 * 31) ^ Slot2;
        }
    }
}
