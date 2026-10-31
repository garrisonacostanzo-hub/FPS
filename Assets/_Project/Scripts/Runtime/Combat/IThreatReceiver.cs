using UnityEngine;

namespace FPS.Combat
{
    /// <summary>
    /// Implemented by AI brains that want to know about incoming fire (near misses and hits), which drives
    /// suppression, cover seeking and threat awareness even when the shooter is not visible.
    /// </summary>
    public interface IThreatReceiver
    {
        void ReceiveIncomingFire(Combatant shooter, Vector3 shotOrigin, float intensity);
    }
}
