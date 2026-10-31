using System;
using System.Collections.Generic;
using FPS.Combat;
using FPS.Controls;
using FPS.Core;
using FPS.Data;
using FPS.Player;
using Unity.Netcode;
using UnityEngine;

namespace FPS.Weapons
{
    /// <summary>
    /// Networked weapon handling for players and bots: hitscan shooting (semi/auto/burst, multi-pellet), reloading,
    /// aim down sights, weapon switching, dynamic spread and recoil.
    ///
    /// Authority model:
    ///  * The owning client predicts fire timing, ammo, recoil and cosmetic hits for instant feedback, then sends a
    ///    <see cref="ShotRequest"/> (origin, aim, spread, random seed, view time) to the server.
    ///  * The server validates rate of fire / ammo / origin, rewinds hitboxes (lag compensation) to the time the
    ///    shooter saw, resolves the same deterministic pellet pattern, applies damage and broadcasts the FX.
    ///  * Bots run directly on the server through <see cref="BotTryFire"/> using exactly the same pipeline.
    /// </summary>
    [DisallowMultipleComponent]
    public class WeaponSystem : NetworkBehaviour
    {
        private sealed class SlotState
        {
            public WeaponData Data;
            public int Magazine;
            public int Reserve;
        }

        private struct PendingHit
        {
            public Hitbox Hitbox;
            public Vector3 Point;
            public Vector3 Direction;
            public float Distance;
        }

        [Tooltip("Loadout used when the server does not assign one (players use GameConfig.playerLoadout).")]
        [SerializeField] private List<WeaponData> m_DefaultLoadout = new List<WeaponData>();
        [SerializeField] private WeaponViewModel m_ViewModel;
        [SerializeField] private ThirdPersonWeapon m_ThirdPerson;

        private static readonly List<PendingHit> s_PendingHits = new List<PendingHit>(16);

        private readonly NetworkVariable<LoadoutIds> m_Loadout = new NetworkVariable<LoadoutIds>(LoadoutIds.Empty);
        private readonly NetworkVariable<byte> m_ActiveSlot = new NetworkVariable<byte>(0);

        private readonly List<SlotState> m_Slots = new List<SlotState>(LoadoutIds.MaxSlots);
        private Combatant m_Combatant;
        private HealthSystem m_Health;
        private PlayerController m_Motor;
        private FPSCamera m_Camera;
        private LagCompensatedTarget m_LagTarget;

        private int m_CurrentSlot = -1;
        private float m_NextFireTime;
        private float m_EquipEndTime;
        private float m_SprintRecoverTime;
        private float m_ReloadEndTime;
        private int m_ReloadSlot;
        private bool m_Reloading;
        private int m_BurstRemaining;
        private float m_Bloom;
        private float m_AimFraction;
        private bool m_WantsAim;
        private bool m_IsBotControlled;
        private bool m_UseExternalMovement;
        private float m_ExternalSpeed01;
        private bool m_ExternalGrounded = true;
        private bool m_ExternalCrouched;
        private float m_ServerLastShotTime = -999f;
        private int m_ShotsSent;
        private int m_ShotsProcessed;
        private float m_LastSpreadPublished = -1f;

        /// <summary>Raised on every peer whenever the equipped weapon changes.</summary>
        public event Action<WeaponData> WeaponEquipped;

        /// <summary>Server only: raised after a shot has been validated and resolved.</summary>
        public event Action<ShotFxData> ServerShotResolved;

        public WeaponData ActiveWeapon => Current != null ? Current.Data : null;
        public int ActiveSlot => m_CurrentSlot;
        public int SlotCount => m_Slots.Count;
        public int Magazine => Current != null ? Current.Magazine : 0;
        public int Reserve => Current != null ? Current.Reserve : 0;
        public float MagazineFraction => Current != null && Current.Data != null ? Current.Magazine / (float)Mathf.Max(1, Current.Data.magazineSize) : 0f;
        public bool IsReloading => m_Reloading;
        public bool IsEquipping => Time.time < m_EquipEndTime;
        public float AimFraction => m_AimFraction;
        public bool WantsToAim => m_WantsAim;
        public bool NeedsReload => Current != null && Current.Magazine <= 0 && Current.Reserve > 0;
        public bool HasAnyAmmo => Current != null && (Current.Magazine > 0 || Current.Reserve > 0);
        public float ReloadProgress => m_Reloading && Current != null ? 1f - Mathf.Clamp01((m_ReloadEndTime - Time.time) / Mathf.Max(0.01f, Current.Data.reloadTime)) : 0f;

        private SlotState Current => m_CurrentSlot >= 0 && m_CurrentSlot < m_Slots.Count ? m_Slots[m_CurrentSlot] : null;

        public float CurrentSpread
        {
            get
            {
                SlotState slot = Current;
                if (slot == null || slot.Data == null)
                {
                    return 0f;
                }

                WeaponData data = slot.Data;
                float speed01 = 0f;
                bool grounded = true;
                bool crouched = false;
                if (m_UseExternalMovement)
                {
                    speed01 = m_ExternalSpeed01;
                    grounded = m_ExternalGrounded;
                    crouched = m_ExternalCrouched;
                }
                else if (m_Motor != null)
                {
                    speed01 = Mathf.Clamp01(m_Motor.HorizontalSpeed / Mathf.Max(0.1f, m_Motor.Settings.walkSpeed));
                    grounded = m_Motor.IsGrounded;
                    crouched = m_Motor.IsCrouching;
                }

                float spread = Mathf.Lerp(data.hipSpread, data.aimSpread, m_AimFraction);
                spread += data.moveSpreadAdd * speed01 * Mathf.Lerp(1f, 0.35f, m_AimFraction);
                if (!grounded)
                {
                    spread += data.airborneSpreadAdd;
                }

                spread += m_Bloom * Mathf.Lerp(1f, 0.5f, m_AimFraction);
                if (crouched)
                {
                    spread *= data.crouchSpreadMultiplier;
                }

                return spread;
            }
        }

        private void Awake()
        {
            m_Combatant = GetComponent<Combatant>();
            m_Health = GetComponent<HealthSystem>();
            m_Motor = GetComponent<PlayerController>();
            m_LagTarget = GetComponent<LagCompensatedTarget>();
        }

        public override void OnNetworkSpawn()
        {
            m_Loadout.OnValueChanged += OnLoadoutChanged;
            m_ActiveSlot.OnValueChanged += OnActiveSlotChanged;

            if (IsServer && m_Loadout.Value.Equals(LoadoutIds.Empty))
            {
                ServerSetLoadout(ResolveDefaultLoadout());
            }
            else
            {
                BuildSlots(m_Loadout.Value, m_ActiveSlot.Value);
            }
        }

        public override void OnNetworkDespawn()
        {
            m_Loadout.OnValueChanged -= OnLoadoutChanged;
            m_ActiveSlot.OnValueChanged -= OnActiveSlotChanged;
        }

        // ------------------------------------------------------------------------------------------------
        // Configuration
        // ------------------------------------------------------------------------------------------------

        /// <summary>Called by NetworkPlayer for the local player so recoil and aim origin use the real camera.</summary>
        public void BindLocalCamera(FPSCamera camera)
        {
            m_Camera = camera;
            if (m_ThirdPerson != null)
            {
                m_ThirdPerson.SetShadowsOnly(true);
            }

            if (Current != null)
            {
                EquipPresentation(Current.Data, 0.01f);
            }
        }

        public void SetBotControlled(bool botControlled)
        {
            m_IsBotControlled = botControlled;
            m_UseExternalMovement = botControlled;
        }

        /// <summary>Bots report their locomotion so spread behaves like for humans.</summary>
        public void SetExternalMovement(float speed01, bool grounded, bool crouched)
        {
            m_UseExternalMovement = true;
            m_ExternalSpeed01 = Mathf.Clamp01(speed01);
            m_ExternalGrounded = grounded;
            m_ExternalCrouched = crouched;
        }

        public void SetAimInput(bool aim)
        {
            m_WantsAim = aim;
        }

        private LoadoutIds ResolveDefaultLoadout()
        {
            var ids = LoadoutIds.Empty;
            List<WeaponData> source = m_DefaultLoadout;
            GameConfig config = GameConfig.Instance;
            if ((source == null || source.Count == 0) && config != null)
            {
                source = config.playerLoadout;
            }

            if (source != null)
            {
                for (int i = 0; i < source.Count && i < LoadoutIds.MaxSlots; i++)
                {
                    ids.Set(i, source[i] != null ? source[i].weaponId : -1);
                }
            }

            return ids;
        }

        /// <summary>Server: assigns a loadout (weapon ids from GameConfig.weapons).</summary>
        public void ServerSetLoadout(LoadoutIds loadout)
        {
            if (!IsServer)
            {
                return;
            }

            m_ActiveSlot.Value = 0;
            m_Loadout.Value = loadout;
            BuildSlots(loadout, 0);
        }

        public void ServerSetLoadout(IList<WeaponData> weapons)
        {
            var ids = LoadoutIds.Empty;
            for (int i = 0; i < weapons.Count && i < LoadoutIds.MaxSlots; i++)
            {
                ids.Set(i, weapons[i] != null ? weapons[i].weaponId : -1);
            }

            ServerSetLoadout(ids);
        }

        private void OnLoadoutChanged(LoadoutIds previous, LoadoutIds current)
        {
            if (!IsServer)
            {
                BuildSlots(current, m_ActiveSlot.Value);
            }
        }

        private void BuildSlots(LoadoutIds loadout, int activeSlot)
        {
            m_Slots.Clear();
            GameConfig config = GameConfig.Instance;
            for (int i = 0; i < LoadoutIds.MaxSlots; i++)
            {
                int id = loadout.Get(i);
                WeaponData data = id >= 0 && config != null ? config.FindWeapon(id) : null;
                if (data == null && id >= 0)
                {
                    data = FindInDefaults(id);
                }

                if (data != null)
                {
                    m_Slots.Add(new SlotState { Data = data, Magazine = data.magazineSize, Reserve = data.startingReserve });
                }
            }

            m_CurrentSlot = -1;
            m_Reloading = false;
            if (m_Slots.Count > 0)
            {
                LocalSwitch(Mathf.Clamp(activeSlot, 0, m_Slots.Count - 1), true);
            }
        }

        private WeaponData FindInDefaults(int id)
        {
            foreach (WeaponData data in m_DefaultLoadout)
            {
                if (data != null && data.weaponId == id)
                {
                    return data;
                }
            }

            return null;
        }

        // ------------------------------------------------------------------------------------------------
        // Local player input
        // ------------------------------------------------------------------------------------------------

        /// <summary>Processes the local player's weapon input. Call every rendered frame for the owner only.</summary>
        public void OwnerTick(PlayerInputReader input, float deltaTime)
        {
            SlotState slot = Current;
            if (!IsSpawned || slot == null || input == null)
            {
                return;
            }

            if (m_Health != null && m_Health.IsDead)
            {
                m_WantsAim = false;
                m_BurstRemaining = 0;
                return;
            }

            int requestedSlot = input.ConsumeSlotRequest();
            int cycle = input.ConsumeCycleRequest();
            if (requestedSlot >= 0)
            {
                RequestSwitch(requestedSlot);
            }
            else if (cycle != 0 && m_Slots.Count > 1)
            {
                RequestSwitch((m_CurrentSlot + cycle + m_Slots.Count) % m_Slots.Count);
            }

            if (input.ConsumeReload())
            {
                RequestReload();
            }

            slot = Current;
            m_WantsAim = input.AimHeld && !m_Reloading;

            if (m_Motor != null && m_Motor.IsSprinting && m_Motor.HorizontalSpeed > 1f)
            {
                m_SprintRecoverTime = Time.time + slot.Data.sprintToFireTime;
            }

            HandleTrigger(slot, input.FireHeld, input.FirePressed);
        }

        private void HandleTrigger(SlotState slot, bool held, bool pressed)
        {
            if (pressed && slot.Magazine <= 0 && !m_Reloading)
            {
                if (slot.Reserve > 0)
                {
                    RequestReload();
                }
                else
                {
                    AudioPool.Play2D(ProceduralAudio.Get(ProceduralSound.DryFire), 0.6f);
                }

                return;
            }

            switch (slot.Data.fireMode)
            {
                case FireMode.SemiAuto:
                    if (pressed)
                    {
                        TryFireLocalPlayer();
                    }

                    break;
                case FireMode.FullAuto:
                    if (held)
                    {
                        TryFireLocalPlayer();
                    }

                    break;
                case FireMode.Burst:
                    if (pressed && m_BurstRemaining == 0 && CanFireNow())
                    {
                        m_BurstRemaining = Mathf.Max(1, slot.Data.burstCount);
                    }

                    break;
            }

            if (m_BurstRemaining > 0)
            {
                if (slot.Magazine <= 0 || m_Reloading)
                {
                    m_BurstRemaining = 0;
                }
                else if (TryFireLocalPlayer())
                {
                    m_BurstRemaining--;
                }
            }

            // Automatically reload when the magazine runs dry after a shot.
            if (slot.Magazine <= 0 && slot.Reserve > 0 && !m_Reloading && Time.time >= m_NextFireTime)
            {
                RequestReload();
            }
        }

        private bool TryFireLocalPlayer()
        {
            if (!CanFireNow())
            {
                return false;
            }

            Vector3 origin;
            Vector3 direction;
            if (m_Camera != null)
            {
                origin = m_Camera.Position;
                direction = m_Camera.Forward;
            }
            else
            {
                origin = m_Combatant != null ? m_Combatant.EyePosition : transform.position + Vector3.up * 1.6f;
                direction = transform.forward;
            }

            FireInternal(origin, direction, CurrentSpread, ComputeViewTime());
            return true;
        }

        private double ComputeViewTime()
        {
            if (NetworkManager == null)
            {
                return 0d;
            }

            double serverTime = NetworkManager.ServerTime.Time;
            if (IsServer)
            {
                return serverTime;
            }

            MatchSettings settings = GameConfig.Instance != null ? GameConfig.Instance.matchSettings : null;
            float interpolationDelay = settings != null ? settings.remoteInterpolationDelay : 0.1f;
            return serverTime - interpolationDelay;
        }

        public bool CanFireNow()
        {
            SlotState slot = Current;
            if (!IsSpawned || slot == null || slot.Data == null)
            {
                return false;
            }

            if (m_Health != null && m_Health.IsDead)
            {
                return false;
            }

            float now = Time.time;
            return !m_Reloading && slot.Magazine > 0 && now >= m_NextFireTime && now >= m_EquipEndTime && now >= m_SprintRecoverTime;
        }

        // ------------------------------------------------------------------------------------------------
        // Bot API (server only)
        // ------------------------------------------------------------------------------------------------

        /// <summary>Server: fires the active weapon along an explicit aim (used by AI). Returns true if a shot left the barrel.</summary>
        public bool BotTryFire(Vector3 origin, Vector3 direction)
        {
            if (!IsServer || !CanFireNow())
            {
                return false;
            }

            FireInternal(origin, direction, CurrentSpread, NetworkManager.ServerTime.Time);
            return true;
        }

        // ------------------------------------------------------------------------------------------------
        // Firing pipeline
        // ------------------------------------------------------------------------------------------------

        private void FireInternal(Vector3 origin, Vector3 direction, float spread, double viewTime)
        {
            SlotState slot = Current;
            WeaponData data = slot.Data;
            slot.Magazine--;

            float interval = data.SecondsBetweenShots;
            m_NextFireTime = Time.time - m_NextFireTime <= Time.deltaTime ? m_NextFireTime + interval : Time.time + interval;
            m_Bloom = Mathf.Min(data.maxBloom, m_Bloom + data.spreadPerShot);

            var request = new ShotRequest
            {
                Origin = origin,
                Direction = direction.normalized,
                Spread = spread,
                Seed = UnityEngine.Random.Range(1, int.MaxValue),
                ViewTime = viewTime,
                Slot = (byte)m_CurrentSlot
            };

            if (IsLocalPlayer)
            {
                PlayPredictedShot(request, data);
            }

            if (IsServer)
            {
                ServerProcessShot(request, false);
            }
            else
            {
                m_ShotsSent++;
                FireRpc(request);
            }

            if (IsLocalPlayer)
            {
                PublishAmmo();
            }
        }

        private void PlayPredictedShot(in ShotRequest request, WeaponData data)
        {
            if (m_Camera != null)
            {
                float aimMultiplier = Mathf.Lerp(1f, data.aimRecoilMultiplier, m_AimFraction);
                float vertical = UnityEngine.Random.Range(data.verticalRecoil.x, data.verticalRecoil.y) * aimMultiplier;
                float horizontal = UnityEngine.Random.Range(-data.horizontalRecoil, data.horizontalRecoil) * aimMultiplier;
                m_Camera.AddRecoil(vertical, horizontal, data.recoilRecoveryFraction, data.recoilRecoverySpeed);
            }

            if (m_ViewModel != null)
            {
                m_ViewModel.OnFire();
            }

            AudioPool.Play2D(data.GetFireClip(), data.fireVolume * 0.9f, UnityEngine.Random.Range(0.96f, 1.04f));

            if (!WeaponEffects.IsSupported)
            {
                return;
            }

            // Cosmetic client-side hit prediction against what this client currently sees.
            Vector3 muzzle = m_ViewModel != null && m_ViewModel.HasModel ? m_ViewModel.MuzzlePosition : request.Origin;
            var fx = ShotFxData.Create(request.Origin, request.Slot);
            int pellets = Mathf.Clamp(data.pelletsPerShot, 1, ShotFxData.MaxImpacts);
            for (int i = 0; i < pellets; i++)
            {
                Vector3 direction = Ballistics.ApplySpread(request.Direction, request.Spread, request.Seed, i);
                BallisticHit hit = Ballistics.Raycast(request.Origin, direction, data.maxRange, transform);
                fx.Add(hit.Point, hit.Normal, hit.Hitbox != null);
            }

            WeaponEffects.Instance.PlayShot(fx, muzzle, data.tracerColor, data.tracerChance);
        }

        [Rpc(SendTo.Server, Delivery = RpcDelivery.Reliable)]
        private void FireRpc(ShotRequest request, RpcParams rpcParams = default)
        {
            if (rpcParams.Receive.SenderClientId != OwnerClientId)
            {
                return;
            }

            m_ShotsProcessed++;
            ServerProcessShot(request, true);
        }

        private void ServerProcessShot(ShotRequest request, bool fromRemoteClient)
        {
            if (m_Health != null && m_Health.IsDead)
            {
                return;
            }

            if (request.Slot >= m_Slots.Count)
            {
                return;
            }

            SlotState slot = m_Slots[request.Slot];
            WeaponData data = slot.Data;

            if (fromRemoteClient)
            {
                if (request.Slot != m_CurrentSlot)
                {
                    LocalSwitch(request.Slot, true);
                }

                if (m_Reloading)
                {
                    // Tolerate the owner finishing its predicted reload slightly before the server does.
                    if (m_ReloadEndTime - Time.time <= 0.35f)
                    {
                        CompleteReload();
                    }
                    else
                    {
                        SendAmmoSync(request.Slot);
                        return;
                    }
                }

                if (Time.time - m_ServerLastShotTime < data.SecondsBetweenShots * 0.5f)
                {
                    return;
                }

                if (slot.Magazine <= 0)
                {
                    SendAmmoSync(request.Slot);
                    return;
                }

                slot.Magazine--;

                Vector3 eye = m_Combatant != null ? m_Combatant.EyePosition : transform.position + Vector3.up * 1.6f;
                if ((request.Origin - eye).sqrMagnitude > 2.5f * 2.5f)
                {
                    request.Origin = eye;
                }

                request.Spread = Mathf.Max(request.Spread, data.aimSpread * 0.8f);
                if (request.Direction.sqrMagnitude < 0.5f)
                {
                    request.Direction = transform.forward;
                }
            }

            m_ServerLastShotTime = Time.time;

            double now = NetworkManager.ServerTime.Time;
            MatchSettings settings = GameConfig.Instance != null ? GameConfig.Instance.matchSettings : null;
            double maxRewind = settings != null ? settings.maxRewindSeconds : 0.3f;
            double viewTime = Math.Min(now, Math.Max(now - maxRewind, request.ViewTime));
            bool rewind = fromRemoteClient && viewTime < now - 0.001d;

            var fx = ShotFxData.Create(request.Origin, request.Slot);
            int pellets = Mathf.Clamp(data.pelletsPerShot, 1, ShotFxData.MaxImpacts);
            s_PendingHits.Clear();

            if (rewind)
            {
                LagCompensation.Rewind(viewTime, m_LagTarget);
            }

            try
            {
                for (int i = 0; i < pellets; i++)
                {
                    Vector3 direction = Ballistics.ApplySpread(request.Direction, request.Spread, request.Seed, i);
                    BallisticHit hit = Ballistics.Raycast(request.Origin, direction, data.maxRange, transform);
                    fx.Add(hit.Point, hit.Normal, hit.Hitbox != null);
                    if (hit.Hitbox != null)
                    {
                        s_PendingHits.Add(new PendingHit { Hitbox = hit.Hitbox, Point = hit.Point, Direction = direction, Distance = hit.Distance });
                    }
                }
            }
            finally
            {
                if (rewind)
                {
                    LagCompensation.Restore();
                }
            }

            float totalDamage = 0f;
            bool headshot = false;
            bool kill = false;
            for (int i = 0; i < s_PendingHits.Count; i++)
            {
                PendingHit pending = s_PendingHits[i];
                HealthSystem victim = pending.Hitbox.Owner;
                if (victim == null || victim.IsDead)
                {
                    continue;
                }

                float regionMultiplier = pending.Hitbox.Region == HitboxRegion.Head ? data.headshotMultiplier
                    : pending.Hitbox.Region == HitboxRegion.Limb ? data.limbMultiplier : 1f;
                float before = victim.Current;
                var damage = new DamageInfo
                {
                    Amount = data.GetDamageAtDistance(pending.Distance) * regionMultiplier,
                    Point = pending.Point,
                    Direction = pending.Direction,
                    SourcePosition = request.Origin,
                    AttackerId = NetworkObjectId,
                    WeaponId = data.weaponId,
                    Type = DamageType.Bullet,
                    Region = pending.Hitbox.Region
                };
                pending.Hitbox.ApplyDamage(damage);
                float dealt = before - victim.Current;
                if (dealt > 0f)
                {
                    totalDamage += dealt;
                    headshot |= pending.Hitbox.Region == HitboxRegion.Head;
                    kill |= victim.IsDead;
                }
            }

            s_PendingHits.Clear();

            if (m_Combatant != null)
            {
                m_Combatant.LastFireTime = Time.time;
            }

            NoiseSystem.Emit(request.Origin, data.noiseRadius, NoiseType.Gunfire, m_Combatant);
            NotifySuppression(request.Origin, fx);

            ServerShotResolved?.Invoke(fx);
            ShotFxRpc(fx);

            if (totalDamage > 0f && !m_IsBotControlled)
            {
                HitConfirmRpc(totalDamage, headshot, kill);
            }
        }

        private void NotifySuppression(Vector3 origin, in ShotFxData fx)
        {
            IReadOnlyList<Combatant> all = CombatantRegistry.All;
            for (int c = 0; c < all.Count; c++)
            {
                Combatant other = all[c];
                if (other == null || other == m_Combatant || !other.IsAlive || other.ThreatReceiver == null)
                {
                    continue;
                }

                if (m_Combatant != null && other.Team == m_Combatant.Team)
                {
                    continue;
                }

                Vector3 chest = other.ChestPosition;
                float closest = float.MaxValue;
                for (int i = 0; i < fx.Count; i++)
                {
                    closest = Mathf.Min(closest, Ballistics.DistanceToSegment(chest, origin, fx.Points[i]));
                }

                const float suppressionRadius = 3.5f;
                if (closest < suppressionRadius)
                {
                    other.ThreatReceiver.ReceiveIncomingFire(m_Combatant, origin, 1f - closest / suppressionRadius);
                }
            }
        }

        [Rpc(SendTo.ClientsAndHost, Delivery = RpcDelivery.Unreliable)]
        private void ShotFxRpc(ShotFxData fx)
        {
            if (IsLocalPlayer || !WeaponEffects.IsSupported)
            {
                // The local player already predicted its own shot presentation.
                return;
            }

            WeaponData data = fx.Slot < m_Slots.Count ? m_Slots[fx.Slot].Data : ActiveWeapon;
            if (data == null)
            {
                return;
            }

            Vector3 muzzle = fx.Origin;
            if (m_ThirdPerson != null)
            {
                m_ThirdPerson.PlayMuzzleFlash();
                muzzle = m_ThirdPerson.MuzzlePosition;
            }

            AudioPool.PlayAt(data.GetFireClip(), fx.Origin, data.fireVolume, UnityEngine.Random.Range(0.95f, 1.05f), 1f, data.noiseRadius * 1.5f);
            WeaponEffects.Instance.PlayShot(fx, muzzle, data.tracerColor, data.tracerChance);
        }

        [Rpc(SendTo.Owner, Delivery = RpcDelivery.Reliable)]
        private void HitConfirmRpc(float damage, bool headshot, bool kill)
        {
            if (!IsLocalPlayer)
            {
                return;
            }

            EventBus<HitConfirmedEvent>.Raise(new HitConfirmedEvent { Damage = damage, Headshot = headshot, Kill = kill });
            AudioPool.Play2D(ProceduralAudio.Get(kill ? ProceduralSound.Killmarker : ProceduralSound.Hitmarker), kill ? 0.7f : 0.5f, headshot ? 1.25f : 1f);
        }

        // ------------------------------------------------------------------------------------------------
        // Reload
        // ------------------------------------------------------------------------------------------------

        public bool CanReload()
        {
            SlotState slot = Current;
            return IsSpawned && slot != null && !m_Reloading && slot.Magazine < slot.Data.magazineSize && slot.Reserve > 0 &&
                   (m_Health == null || !m_Health.IsDead);
        }

        /// <summary>Starts a reload on the owner (predicted) or the server (bots). Returns false if not possible.</summary>
        public bool RequestReload()
        {
            if (!CanReload())
            {
                return false;
            }

            BeginReload();
            if (!IsServer)
            {
                ReloadRpc((byte)m_CurrentSlot);
            }

            return true;
        }

        private void BeginReload()
        {
            SlotState slot = Current;
            float duration = slot.Data.GetReloadTime(slot.Magazine <= 0);
            m_Reloading = true;
            m_ReloadSlot = m_CurrentSlot;
            m_ReloadEndTime = Time.time + duration;
            m_BurstRemaining = 0;

            if (IsLocalPlayer)
            {
                m_WantsAim = false;
                if (m_ViewModel != null)
                {
                    m_ViewModel.OnReloadStarted(duration);
                }

                AudioPool.Play2D(slot.Data.reloadClip != null ? slot.Data.reloadClip : ProceduralAudio.Get(ProceduralSound.ReloadStart), 0.6f);
                EventBus<LocalReloadEvent>.Raise(new LocalReloadEvent { Started = true, Duration = duration });
            }
        }

        [Rpc(SendTo.Server, Delivery = RpcDelivery.Reliable)]
        private void ReloadRpc(byte slot, RpcParams rpcParams = default)
        {
            if (rpcParams.Receive.SenderClientId != OwnerClientId || slot >= m_Slots.Count)
            {
                return;
            }

            if (slot != m_CurrentSlot)
            {
                LocalSwitch(slot, true);
            }

            if (CanReload())
            {
                BeginReload();
            }
        }

        private void CompleteReload()
        {
            if (!m_Reloading)
            {
                return;
            }

            m_Reloading = false;
            if (m_ReloadSlot < 0 || m_ReloadSlot >= m_Slots.Count)
            {
                return;
            }

            SlotState slot = m_Slots[m_ReloadSlot];
            int needed = slot.Data.magazineSize - slot.Magazine;
            int taken = Mathf.Min(needed, slot.Reserve);
            slot.Magazine += taken;
            slot.Reserve -= taken;

            if (IsServer && !IsLocalPlayer && !m_IsBotControlled)
            {
                SendAmmoSync(m_ReloadSlot);
            }

            if (IsLocalPlayer)
            {
                AudioPool.Play2D(ProceduralAudio.Get(ProceduralSound.ReloadEnd), 0.6f);
                EventBus<LocalReloadEvent>.Raise(new LocalReloadEvent { Started = false });
                PublishAmmo();
            }
        }

        private void CancelReload()
        {
            if (!m_Reloading)
            {
                return;
            }

            m_Reloading = false;
            if (IsLocalPlayer)
            {
                if (m_ViewModel != null)
                {
                    m_ViewModel.OnReloadCancelled();
                }

                EventBus<LocalReloadEvent>.Raise(new LocalReloadEvent { Started = false, Cancelled = true });
            }
        }

        private void SendAmmoSync(int slotIndex)
        {
            if (slotIndex < 0 || slotIndex >= m_Slots.Count)
            {
                return;
            }

            SlotState slot = m_Slots[slotIndex];
            AmmoSyncRpc((byte)slotIndex, slot.Magazine, slot.Reserve, m_ShotsProcessed);
        }

        [Rpc(SendTo.Owner, Delivery = RpcDelivery.Reliable)]
        private void AmmoSyncRpc(byte slotIndex, int magazine, int reserve, int shotsProcessed)
        {
            if (IsServer || slotIndex >= m_Slots.Count)
            {
                return;
            }

            // Shots still in flight have been predicted locally but not yet processed by the server.
            int inFlight = Mathf.Max(0, m_ShotsSent - shotsProcessed);
            SlotState slot = m_Slots[slotIndex];
            slot.Magazine = Mathf.Max(0, magazine - (slotIndex == m_CurrentSlot ? inFlight : 0));
            slot.Reserve = reserve;
            if (m_Reloading && m_ReloadSlot == slotIndex && slot.Magazine >= slot.Data.magazineSize)
            {
                m_Reloading = false;
            }

            PublishAmmo();
        }

        /// <summary>Server: refills every weapon and equips the first slot (used on respawn).</summary>
        public void ServerRefillAll()
        {
            if (!IsServer)
            {
                return;
            }

            RefillLocal();
            if (!IsLocalPlayer && !m_IsBotControlled)
            {
                RefillRpc();
            }
        }

        private void RefillLocal()
        {
            m_Reloading = false;
            m_Bloom = 0f;
            for (int i = 0; i < m_Slots.Count; i++)
            {
                m_Slots[i].Magazine = m_Slots[i].Data.magazineSize;
                m_Slots[i].Reserve = m_Slots[i].Data.startingReserve;
            }

            if (m_Slots.Count > 0)
            {
                LocalSwitch(0, true);
            }

            if (IsLocalPlayer)
            {
                PublishAmmo();
            }
        }

        [Rpc(SendTo.Owner, Delivery = RpcDelivery.Reliable)]
        private void RefillRpc()
        {
            if (!IsServer)
            {
                RefillLocal();
            }
        }

        public void ServerAddReserveAmmo(float magazines)
        {
            if (!IsServer || Current == null)
            {
                return;
            }

            SlotState slot = Current;
            slot.Reserve = Mathf.Min(slot.Data.maxReserve, slot.Reserve + Mathf.CeilToInt(slot.Data.magazineSize * magazines));
            if (!IsLocalPlayer && !m_IsBotControlled)
            {
                SendAmmoSync(m_CurrentSlot);
            }
            else if (IsLocalPlayer)
            {
                PublishAmmo();
            }
        }

        // ------------------------------------------------------------------------------------------------
        // Switching
        // ------------------------------------------------------------------------------------------------

        public void RequestSwitch(int slot)
        {
            if (slot < 0 || slot >= m_Slots.Count || slot == m_CurrentSlot)
            {
                return;
            }

            LocalSwitch(slot, false);
            if (!IsServer)
            {
                SwitchRpc((byte)slot);
            }
        }

        [Rpc(SendTo.Server, Delivery = RpcDelivery.Reliable)]
        private void SwitchRpc(byte slot, RpcParams rpcParams = default)
        {
            if (rpcParams.Receive.SenderClientId != OwnerClientId || slot >= m_Slots.Count)
            {
                return;
            }

            LocalSwitch(slot, false);
        }

        private void LocalSwitch(int slot, bool instant)
        {
            if (slot < 0 || slot >= m_Slots.Count)
            {
                return;
            }

            CancelReload();
            m_CurrentSlot = slot;
            m_BurstRemaining = 0;
            m_Bloom = 0f;
            WeaponData data = m_Slots[slot].Data;
            float equipTime = instant ? 0f : data.equipTime;
            m_EquipEndTime = Time.time + equipTime;
            m_NextFireTime = Mathf.Max(m_NextFireTime, m_EquipEndTime);

            if (m_Motor != null)
            {
                m_Motor.AimSpeedMultiplier = data.aimMoveSpeedMultiplier;
            }

            if (IsServer && IsSpawned && m_ActiveSlot.Value != slot)
            {
                m_ActiveSlot.Value = (byte)slot;
            }

            EquipPresentation(data, Mathf.Max(0.01f, equipTime));
            WeaponEquipped?.Invoke(data);
        }

        private void OnActiveSlotChanged(byte previous, byte current)
        {
            // Owner and server already applied the switch locally; remote peers only update presentation.
            if (IsServer || IsLocalPlayer || current >= m_Slots.Count)
            {
                return;
            }

            LocalSwitch(current, true);
        }

        private void EquipPresentation(WeaponData data, float equipTime)
        {
            if (m_ThirdPerson != null)
            {
                m_ThirdPerson.Show(data);
                if (IsLocalPlayer)
                {
                    m_ThirdPerson.SetShadowsOnly(true);
                }
            }

            if (!IsLocalPlayer)
            {
                return;
            }

            if (m_ViewModel != null && WeaponEffects.IsSupported)
            {
                m_ViewModel.Equip(data, equipTime);
            }

            EventBus<LocalWeaponSwitchedEvent>.Raise(new LocalWeaponSwitchedEvent { Weapon = data, Slot = m_CurrentSlot, SlotCount = m_Slots.Count });
            PublishAmmo();
        }

        // ------------------------------------------------------------------------------------------------
        // Per-frame update
        // ------------------------------------------------------------------------------------------------

        private void Update()
        {
            if (!IsSpawned)
            {
                return;
            }

            float deltaTime = Time.deltaTime;
            if (m_Reloading && Time.time >= m_ReloadEndTime)
            {
                CompleteReload();
            }

            SlotState slot = Current;
            if (slot == null)
            {
                return;
            }

            m_Bloom = Mathf.MoveTowards(m_Bloom, 0f, slot.Data.bloomRecoveryPerSecond * deltaTime);

            if (IsLocalPlayer || m_IsBotControlled)
            {
                float aimSpeed = 1f / Mathf.Max(0.01f, slot.Data.aimDownSightTime);
                m_AimFraction = Mathf.MoveTowards(m_AimFraction, m_WantsAim ? 1f : 0f, aimSpeed * deltaTime);
            }

            if (!IsLocalPlayer)
            {
                return;
            }

            bool sprinting = m_Motor != null && m_Motor.IsSprinting && m_Motor.HorizontalSpeed > 1f;
            float speed01 = m_Motor != null ? Mathf.Clamp01(m_Motor.HorizontalSpeed / Mathf.Max(0.1f, m_Motor.Settings.sprintSpeed)) : 0f;
            if (m_Camera != null)
            {
                m_Camera.SetAimState(m_AimFraction, slot.Data.aimFieldOfView);
            }

            if (m_ViewModel != null)
            {
                m_ViewModel.SetState(m_AimFraction, sprinting, speed01);
                m_ViewModel.SetVisible(m_Health == null || !m_Health.IsDead);
            }

            float spread = CurrentSpread;
            if (Mathf.Abs(spread - m_LastSpreadPublished) > 0.01f || m_AimFraction > 0f)
            {
                m_LastSpreadPublished = spread;
                EventBus<CrosshairSpreadEvent>.Raise(new CrosshairSpreadEvent
                {
                    SpreadDegrees = spread,
                    AimFraction = m_AimFraction,
                    Visible = !sprinting && !m_Reloading && (m_Health == null || !m_Health.IsDead)
                });
            }
        }

        public void PublishAmmo()
        {
            SlotState slot = Current;
            if (!IsLocalPlayer || slot == null)
            {
                return;
            }

            EventBus<LocalAmmoChangedEvent>.Raise(new LocalAmmoChangedEvent
            {
                Magazine = slot.Magazine,
                MagazineSize = slot.Data.magazineSize,
                Reserve = slot.Reserve,
                WeaponName = slot.Data.displayName,
                FireMode = slot.Data.fireMode
            });
        }
    }
}
