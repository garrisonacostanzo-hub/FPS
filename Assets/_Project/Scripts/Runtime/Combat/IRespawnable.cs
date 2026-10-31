using UnityEngine;

namespace FPS.Combat
{
    /// <summary>Server-side respawn hook implemented by both NetworkPlayer and AdvancedBotAI.</summary>
    public interface IRespawnable
    {
        void ServerRespawn(Vector3 position, Quaternion rotation, float spawnProtectionSeconds);
    }
}
