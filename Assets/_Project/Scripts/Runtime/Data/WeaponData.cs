using FPS.Core;
using UnityEngine;

namespace FPS.Data
{
    public enum FireMode : byte
    {
        SemiAuto = 0,
        FullAuto = 1,
        Burst = 2
    }

    public enum WeaponCategory : byte
    {
        AssaultRifle,
        SubmachineGun,
        Shotgun,
        SniperRifle,
        Pistol
    }

    public enum CrosshairStyle : byte
    {
        Cross,
        CrossWithDot,
        Dot,
        Circle,
        Chevron
    }

    /// <summary>
    /// Data-only definition of a weapon. Gameplay (WeaponSystem), presentation (view model, HUD) and AI
    /// (bot engagement ranges) all read from this asset, so balancing never requires code changes.
    /// Create via Assets > Create > FPS > Weapon Data.
    /// </summary>
    [CreateAssetMenu(menuName = "FPS/Weapon Data", fileName = "WeaponData", order = 0)]
    public class WeaponData : ScriptableObject
    {
        [Header("Identity")]
        [Tooltip("Stable network id. Must be unique across all weapons in the GameConfig weapon list.")]
        public int weaponId = 1;
        public string displayName = "Rifle";
        public WeaponCategory category = WeaponCategory.AssaultRifle;
        public FireMode fireMode = FireMode.FullAuto;

        [Header("Fire")]
        [Min(30f)] public float roundsPerMinute = 650f;
        [Min(1)] public int burstCount = 3;
        [Min(1)] public int pelletsPerShot = 1;
        [Min(0f)] public float damage = 24f;
        [Min(1f)] public float headshotMultiplier = 1.8f;
        [Min(0.5f)] public float limbMultiplier = 0.85f;
        [Tooltip("Damage multiplier over normalized distance (0 = muzzle, 1 = maxRange).")]
        public AnimationCurve damageFalloff = new AnimationCurve(new Keyframe(0f, 1f), new Keyframe(0.45f, 1f), new Keyframe(1f, 0.55f));
        [Min(5f)] public float maxRange = 250f;

        [Header("Ammunition")]
        [Min(1)] public int magazineSize = 30;
        [Min(0)] public int startingReserve = 120;
        [Min(0)] public int maxReserve = 240;
        [Min(0.1f)] public float reloadTime = 2.1f;
        [Min(0.1f)] public float emptyReloadTime = 2.6f;

        [Header("Handling")]
        [Min(0.05f)] public float equipTime = 0.45f;
        [Min(0.05f)] public float aimDownSightTime = 0.22f;
        [Range(10f, 90f)] public float aimFieldOfView = 55f;
        [Range(0.1f, 1f)] public float aimMoveSpeedMultiplier = 0.65f;
        [Min(0f)] public float sprintToFireTime = 0.18f;

        [Header("Spread (degrees)")]
        [Min(0f)] public float hipSpread = 2.4f;
        [Min(0f)] public float aimSpread = 0.25f;
        [Min(0f)] public float moveSpreadAdd = 2.0f;
        [Min(0f)] public float airborneSpreadAdd = 4.0f;
        [Min(0f)] public float spreadPerShot = 0.35f;
        [Min(0f)] public float maxBloom = 3.5f;
        [Min(0f)] public float bloomRecoveryPerSecond = 6f;
        [Range(0.2f, 1f)] public float crouchSpreadMultiplier = 0.75f;

        [Header("Recoil (degrees)")]
        public Vector2 verticalRecoil = new Vector2(0.55f, 0.85f);
        [Min(0f)] public float horizontalRecoil = 0.35f;
        [Range(0f, 1f)] public float aimRecoilMultiplier = 0.65f;
        [Min(0f)] public float recoilRecoverySpeed = 9f;
        [Range(0f, 1f)] public float recoilRecoveryFraction = 0.7f;

        [Header("AI usage")]
        [Tooltip("Distance band at which bots prefer to engage with this weapon.")]
        public Vector2 preferredEngagementRange = new Vector2(8f, 45f);

        [Header("Audio / Noise")]
        [Min(1f)] public float noiseRadius = 70f;
        public ProceduralSound proceduralShotSound = ProceduralSound.RifleShot;
        [Tooltip("Optional authored clip. When empty the procedural sound is used.")]
        public AudioClip fireClip;
        public AudioClip reloadClip;
        [Range(0f, 1f)] public float fireVolume = 0.8f;

        [Header("Presentation")]
        public CrosshairStyle crosshairStyle = CrosshairStyle.Cross;
        public Color bodyColor = new Color(0.16f, 0.17f, 0.19f);
        public Color accentColor = new Color(0.85f, 0.45f, 0.12f);
        public Vector3 bodySize = new Vector3(0.07f, 0.11f, 0.48f);
        [Min(0.05f)] public float barrelLength = 0.28f;
        public Vector3 hipOffset = new Vector3(0.18f, -0.17f, 0.36f);
        public Vector3 aimOffset = new Vector3(0f, -0.085f, 0.26f);
        public Color muzzleFlashColor = new Color(1f, 0.78f, 0.38f);
        public Color tracerColor = new Color(1f, 0.85f, 0.5f, 0.85f);
        [Range(0f, 1f)] public float tracerChance = 0.5f;
        [Tooltip("Optional authored view model. When empty a procedural model is built from the values above.")]
        public GameObject viewModelPrefab;

        public float SecondsBetweenShots => 60f / Mathf.Max(30f, roundsPerMinute);

        public float GetDamageAtDistance(float distance)
        {
            float normalized = Mathf.Clamp01(distance / Mathf.Max(1f, maxRange));
            float multiplier = damageFalloff != null && damageFalloff.length > 0 ? damageFalloff.Evaluate(normalized) : 1f;
            return damage * Mathf.Max(0f, multiplier);
        }

        public float GetReloadTime(bool magazineEmpty)
        {
            return magazineEmpty ? emptyReloadTime : reloadTime;
        }

        public AudioClip GetFireClip()
        {
            return fireClip != null ? fireClip : ProceduralAudio.Get(proceduralShotSound);
        }

        private void OnValidate()
        {
            maxReserve = Mathf.Max(maxReserve, startingReserve);
            emptyReloadTime = Mathf.Max(emptyReloadTime, reloadTime);
            if (verticalRecoil.y < verticalRecoil.x)
            {
                verticalRecoil.y = verticalRecoil.x;
            }

            if (preferredEngagementRange.y < preferredEngagementRange.x)
            {
                preferredEngagementRange.y = preferredEngagementRange.x;
            }
        }
    }
}
