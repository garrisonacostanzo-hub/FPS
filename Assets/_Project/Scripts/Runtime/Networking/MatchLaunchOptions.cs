using System;
using System.Text;
using UnityEngine;

namespace FPS.Networking
{
    /// <summary>Host-selected options for the next match (set from the main menu or the command line).</summary>
    public static class MatchLaunchOptions
    {
        public static int BotCount { get; set; } = -1;
        public static int DifficultyIndex { get; set; } = -1;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            BotCount = -1;
            DifficultyIndex = -1;
        }
    }

    /// <summary>Data sent by a client with its connection request (validated in connection approval).</summary>
    [Serializable]
    public class ConnectionPayload
    {
        public string playerName;
        public string gameVersion;

        public byte[] ToBytes()
        {
            return Encoding.UTF8.GetBytes(JsonUtility.ToJson(this));
        }

        public static ConnectionPayload FromBytes(byte[] bytes)
        {
            if (bytes == null || bytes.Length == 0 || bytes.Length > 1024)
            {
                return null;
            }

            try
            {
                return JsonUtility.FromJson<ConnectionPayload>(Encoding.UTF8.GetString(bytes));
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
