using System;
using Unity.Netcode;
using UnityEngine;

namespace FPS.Player
{
    [Flags]
    public enum InputButtons : byte
    {
        None = 0,
        Jump = 1 << 0,
        Sprint = 1 << 1,
        Crouch = 1 << 2,
        Aim = 1 << 3,
        Fire = 1 << 4
    }

    /// <summary>One tick of player intent. Produced by the owning client, simulated by both client (prediction) and server.</summary>
    public struct PlayerInputCommand : INetworkSerializable, IEquatable<PlayerInputCommand>
    {
        public int Tick;
        public Vector2 Move;
        public float Yaw;
        public float Pitch;
        public InputButtons Buttons;

        public bool Has(InputButtons button)
        {
            return (Buttons & button) != 0;
        }

        public void NetworkSerialize<T>(BufferSerializer<T> serializer) where T : IReaderWriter
        {
            serializer.SerializeValue(ref Tick);
            serializer.SerializeValue(ref Move);
            serializer.SerializeValue(ref Yaw);
            serializer.SerializeValue(ref Pitch);
            byte buttons = (byte)Buttons;
            serializer.SerializeValue(ref buttons);
            if (serializer.IsReader)
            {
                Buttons = (InputButtons)buttons;
            }
        }

        public bool Equals(PlayerInputCommand other)
        {
            return Tick == other.Tick && Move == other.Move && Yaw.Equals(other.Yaw) && Pitch.Equals(other.Pitch) && Buttons == other.Buttons;
        }

        public override bool Equals(object obj)
        {
            return obj is PlayerInputCommand other && Equals(other);
        }

        public override int GetHashCode()
        {
            return Tick;
        }
    }

    /// <summary>
    /// Redundant batch of the most recent commands. Sent unreliably every tick; resending the previous two commands
    /// hides single packet losses without needing a reliable (head-of-line blocking) channel.
    /// </summary>
    public struct InputBatch : INetworkSerializable
    {
        public const int Capacity = 3;

        public byte Count;
        public PlayerInputCommand Command0;
        public PlayerInputCommand Command1;
        public PlayerInputCommand Command2;

        public PlayerInputCommand Get(int index)
        {
            switch (index)
            {
                case 0: return Command0;
                case 1: return Command1;
                default: return Command2;
            }
        }

        public void Set(int index, PlayerInputCommand command)
        {
            switch (index)
            {
                case 0: Command0 = command; break;
                case 1: Command1 = command; break;
                default: Command2 = command; break;
            }
        }

        public void NetworkSerialize<T>(BufferSerializer<T> serializer) where T : IReaderWriter
        {
            serializer.SerializeValue(ref Count);
            if (Count > 0) serializer.SerializeValue(ref Command0);
            if (Count > 1) serializer.SerializeValue(ref Command1);
            if (Count > 2) serializer.SerializeValue(ref Command2);
        }
    }

    /// <summary>Complete motor state required to rewind and replay prediction (reconciliation).</summary>
    public struct MotorState : INetworkSerializable, IEquatable<MotorState>
    {
        public Vector3 Position;
        public Vector3 Velocity;
        public float CrouchAmount;
        public float CoyoteTimer;
        public float JumpBufferTimer;
        public bool Grounded;
        public bool Crouching;
        public bool Sprinting;

        public void NetworkSerialize<T>(BufferSerializer<T> serializer) where T : IReaderWriter
        {
            serializer.SerializeValue(ref Position);
            serializer.SerializeValue(ref Velocity);
            serializer.SerializeValue(ref CrouchAmount);
            serializer.SerializeValue(ref CoyoteTimer);
            serializer.SerializeValue(ref JumpBufferTimer);
            byte flags = (byte)((Grounded ? 1 : 0) | (Crouching ? 2 : 0) | (Sprinting ? 4 : 0));
            serializer.SerializeValue(ref flags);
            if (serializer.IsReader)
            {
                Grounded = (flags & 1) != 0;
                Crouching = (flags & 2) != 0;
                Sprinting = (flags & 4) != 0;
            }
        }

        public bool Equals(MotorState other)
        {
            return Position == other.Position && Velocity == other.Velocity && CrouchAmount.Equals(other.CrouchAmount) &&
                   Grounded == other.Grounded && Crouching == other.Crouching && Sprinting == other.Sprinting;
        }

        public override bool Equals(object obj)
        {
            return obj is MotorState other && Equals(other);
        }

        public override int GetHashCode()
        {
            return Position.GetHashCode();
        }
    }

    [Flags]
    public enum PlayerStateFlags : byte
    {
        None = 0,
        Crouching = 1 << 0,
        Grounded = 1 << 1,
        Aiming = 1 << 2,
        Sprinting = 1 << 3,
        Alive = 1 << 4
    }

    /// <summary>Compact snapshot broadcast by the server to non-owning peers for interpolation.</summary>
    public struct PlayerSnapshot : INetworkSerializable
    {
        public int Tick;
        public Vector3 Position;
        public float Yaw;
        public float Pitch;
        public float CrouchAmount;
        public float Speed;
        public PlayerStateFlags Flags;
        public byte TeleportId;

        public bool Has(PlayerStateFlags flag)
        {
            return (Flags & flag) != 0;
        }

        public void NetworkSerialize<T>(BufferSerializer<T> serializer) where T : IReaderWriter
        {
            serializer.SerializeValue(ref Tick);
            serializer.SerializeValue(ref Position);
            serializer.SerializeValue(ref Yaw);
            serializer.SerializeValue(ref Pitch);
            serializer.SerializeValue(ref CrouchAmount);
            serializer.SerializeValue(ref Speed);
            byte flags = (byte)Flags;
            serializer.SerializeValue(ref flags);
            serializer.SerializeValue(ref TeleportId);
            if (serializer.IsReader)
            {
                Flags = (PlayerStateFlags)flags;
            }
        }
    }

    public struct FootstepInfo
    {
        public Vector3 Position;
        public float NoiseRadius;
        public bool Sprinting;
        public bool Crouching;
    }
}
