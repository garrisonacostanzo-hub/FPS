using System;
using FPS.Core;
using Unity.Collections;
using Unity.Netcode;

namespace FPS.Networking
{
    public enum MatchPhase : byte
    {
        Warmup,
        InProgress,
        PostMatch
    }

    /// <summary>One scoreboard row (human or bot), replicated in a NetworkList.</summary>
    public struct ScoreEntry : INetworkSerializable, IEquatable<ScoreEntry>
    {
        public ulong CombatantId;
        public ulong ClientId;
        public FixedString32Bytes Name;
        public Team Team;
        public bool IsBot;
        public int Kills;
        public int Deaths;
        public int Score;
        public int Captures;

        public void NetworkSerialize<T>(BufferSerializer<T> serializer) where T : IReaderWriter
        {
            serializer.SerializeValue(ref CombatantId);
            serializer.SerializeValue(ref ClientId);
            serializer.SerializeValue(ref Name);
            byte team = (byte)Team;
            serializer.SerializeValue(ref team);
            serializer.SerializeValue(ref IsBot);
            serializer.SerializeValue(ref Kills);
            serializer.SerializeValue(ref Deaths);
            serializer.SerializeValue(ref Score);
            serializer.SerializeValue(ref Captures);
            if (serializer.IsReader)
            {
                Team = (Team)team;
            }
        }

        public bool Equals(ScoreEntry other)
        {
            return CombatantId == other.CombatantId && ClientId == other.ClientId && Name.Equals(other.Name) && Team == other.Team &&
                   IsBot == other.IsBot && Kills == other.Kills && Deaths == other.Deaths && Score == other.Score && Captures == other.Captures;
        }

        public override bool Equals(object obj)
        {
            return obj is ScoreEntry other && Equals(other);
        }

        public override int GetHashCode()
        {
            return CombatantId.GetHashCode();
        }
    }
}
