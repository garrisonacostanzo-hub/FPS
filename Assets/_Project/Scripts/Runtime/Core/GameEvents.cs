using FPS.Data;
using UnityEngine;

namespace FPS.Core
{
    // -----------------------------------------------------------------------------------------
    // Local-player presentation events (raised only on the machine that owns the player).
    // The HUD, audio and camera effects listen to these without referencing gameplay classes.
    // -----------------------------------------------------------------------------------------

    public struct LocalPlayerSpawnedEvent
    {
        public GameObject Player;
        public Camera Camera;
        public Team Team;
    }

    public struct LocalPlayerDespawnedEvent
    {
        public GameObject Player;
    }

    public struct LocalHealthChangedEvent
    {
        public float Current;
        public float Max;
    }

    public struct LocalAmmoChangedEvent
    {
        public int Magazine;
        public int MagazineSize;
        public int Reserve;
        public string WeaponName;
        public FireMode FireMode;
    }

    public struct LocalWeaponSwitchedEvent
    {
        public WeaponData Weapon;
        public int Slot;
        public int SlotCount;
    }

    public struct LocalReloadEvent
    {
        public bool Started;
        public bool Cancelled;
        public float Duration;
    }

    public struct CrosshairSpreadEvent
    {
        public float SpreadDegrees;
        public float AimFraction;
        public bool Visible;
    }

    public struct HitConfirmedEvent
    {
        public float Damage;
        public bool Headshot;
        public bool Kill;
    }

    public struct LocalDamageTakenEvent
    {
        public float Damage;
        public Vector3 SourcePosition;
        public float RemainingHealth;
    }

    public struct LocalDeathEvent
    {
        public string KillerName;
        public string WeaponName;
        public float RespawnDelay;
    }

    public struct LocalRespawnEvent
    {
        public Vector3 Position;
    }

    // -----------------------------------------------------------------------------------------
    // Match-wide events (raised on every peer).
    // -----------------------------------------------------------------------------------------

    public struct KillFeedEvent
    {
        public string KillerName;
        public string VictimName;
        public string WeaponName;
        public Team KillerTeam;
        public Team VictimTeam;
        public bool Headshot;
    }

    public struct MatchAnnouncementEvent
    {
        public string Message;
        public Color Color;
        public float Duration;
    }

    public struct ZoneCapturedEvent
    {
        public string ZoneName;
        public Team NewOwner;
    }

    public struct PauseMenuToggledEvent
    {
        public bool IsOpen;
    }
}
