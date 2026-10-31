using FPS.AI.States;
using FPS.Combat;
using FPS.Core;
using FPS.Data;
using FPS.Player;
using FPS.Weapons;
using Unity.Netcode;
using Unity.Netcode.Components;
using UnityEngine;
using UnityEngine.AI;

namespace FPS.AI
{
    /// <summary>
    /// Server-authoritative tactical bot brain.
    ///
    /// Architecture (all of it runs on the server only; clients just render replicated state):
    ///  * <see cref="BotPerception"/> - vision cone raycasts, hearing (footsteps/gunfire), suppression.
    ///  * <see cref="BotBlackboard"/> - working memory (target, last known position, threats, cover).
    ///  * Decision layer (<see cref="Decide"/>) - priority/utility rules evaluated every difficulty.decisionInterval.
    ///  * <see cref="BotStateMachine"/> - Patrol, Investigate, Engage, TakeCover, Reload, Flank, Search, Dead.
    ///  * <see cref="BotNavigator"/> (NavMeshAgent), <see cref="BotAimController"/> (human-like aim), and the same
    ///    <see cref="WeaponSystem"/> used by players, so bots obey identical weapon rules.
    ///  * <see cref="BotSquad"/> - shared intel, objective, reload staggering, flanker assignment, formation.
    /// Difficulty (<see cref="BotDifficultyProfile"/>) scales reaction time, aim accuracy, detection range and aggressiveness.
    /// </summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(NavMeshAgent), typeof(BotNavigator), typeof(BotPerception))]
    [RequireComponent(typeof(WeaponSystem), typeof(HealthSystem), typeof(Combatant))]
    public class AdvancedBotAI : NetworkBehaviour, IThreatReceiver, IRespawnable
    {
        [SerializeField] private BotDifficultyProfile m_Difficulty;
        [SerializeField] private Transform m_Eye;
        [SerializeField] private CharacterVisuals m_Visuals;
        [SerializeField] private HitboxRig m_HitboxRig;
        [SerializeField] private Collider m_BodyCollider;
        [SerializeField] private bool m_LogStateChanges;

        private readonly NetworkVariable<short> m_NetPitch = new NetworkVariable<short>(0);
        private readonly NetworkVariable<bool> m_NetCrouch = new NetworkVariable<bool>(false);

        private BotNavigator m_Navigator;
        private BotPerception m_Perception;
        private WeaponSystem m_Weapons;
        private HealthSystem m_Health;
        private Combatant m_Combatant;
        private LagCompensatedTarget m_LagTarget;
        private NetworkTransform m_NetworkTransform;
        private BotStateMachine m_Fsm;
        private BotAimController m_Aim;
        private BotSquad m_Squad;

        private float m_PerceptionTimer;
        private float m_PerceptionInterval = 0.1f;
        private float m_DecisionTimer;
        private float m_LodTimer;
        private bool m_WantsCrouch;
        private float m_CrouchAmount;
        private bool m_WantsAim;
        private bool m_HasLookPoint;
        private Vector3 m_LookPoint;
        private int m_BurstShotsRemaining;
        private float m_NextBurstTime;
        private bool m_ServerInitialized;
        private bool m_SubscribedToTicks;

        public BotBlackboard Memory { get; } = new BotBlackboard();
        public BotDifficultyProfile Difficulty => m_Difficulty;
        public BotNavigator Navigator => m_Navigator;
        public BotPerception Perception => m_Perception;
        public WeaponSystem Weapons => m_Weapons;
        public Combatant Combatant => m_Combatant;
        public BotSquad Squad => m_Squad;
        public BotAimController Aim => m_Aim;
        public BotStateId CurrentState => m_Fsm != null ? m_Fsm.CurrentId : BotStateId.None;
        public bool IsAlive => m_Combatant != null && m_Combatant.IsAlive;
        public bool IsFlanking => CurrentState == BotStateId.Flank;
        public float HealthFraction => m_Health != null ? m_Health.Normalized : 0f;
        public bool FireAllowed { get; set; }
        public Vector3 EyePosition => m_Eye != null ? m_Eye.position : transform.position + Vector3.up * (1.6f - 0.6f * m_CrouchAmount);
        public bool IsCrouched => m_WantsCrouch;

        /// <summary>Preferred engagement distances for the current weapon, adjusted for aggressiveness.</summary>
        public Vector2 PreferredRange
        {
            get
            {
                WeaponData weapon = m_Weapons != null ? m_Weapons.ActiveWeapon : null;
                Vector2 range = weapon != null ? weapon.preferredEngagementRange : new Vector2(8f, 40f);
                float aggression = m_Difficulty != null ? m_Difficulty.aggressiveness : 0.5f;
                return new Vector2(range.x * Mathf.Lerp(1.25f, 0.6f, aggression), range.y * Mathf.Lerp(1.1f, 0.75f, aggression));
            }
        }

        private void Awake()
        {
            m_Navigator = GetComponent<BotNavigator>();
            m_Perception = GetComponent<BotPerception>();
            m_Weapons = GetComponent<WeaponSystem>();
            m_Health = GetComponent<HealthSystem>();
            m_Combatant = GetComponent<Combatant>();
            m_LagTarget = GetComponent<LagCompensatedTarget>();
            m_NetworkTransform = GetComponent<NetworkTransform>();
            if (m_Visuals == null) m_Visuals = GetComponentInChildren<CharacterVisuals>(true);
            if (m_HitboxRig == null) m_HitboxRig = GetComponentInChildren<HitboxRig>(true);
            if (m_BodyCollider == null) m_BodyCollider = GetComponent<CapsuleCollider>();

            // The agent only ever runs on the server; it is enabled in OnNetworkSpawn.
            GetComponent<NavMeshAgent>().enabled = false;
        }

        public override void OnNetworkSpawn()
        {
            m_Health.Died += OnDied;
            m_Health.Revived += OnRevived;
            m_Combatant.TeamChanged += OnTeamChanged;
            if (m_Visuals != null)
            {
                m_Visuals.SetTeam(m_Combatant.Team);
                m_Visuals.SetFirstPerson(false);
            }

            if (!IsServer)
            {
                m_Navigator.enabled = false;
                return;
            }

            m_Health.Damaged += OnServerDamaged;
            m_Weapons.SetBotControlled(true);
            m_Navigator.SetAgentEnabled(true);
            NetworkManager.NetworkTickSystem.Tick += OnServerTick;
            m_SubscribedToTicks = true;
            InitializeServer();
        }

        public override void OnNetworkDespawn()
        {
            m_Health.Died -= OnDied;
            m_Health.Revived -= OnRevived;
            m_Combatant.TeamChanged -= OnTeamChanged;
            if (!IsServer)
            {
                return;
            }

            m_Health.Damaged -= OnServerDamaged;
            if (m_SubscribedToTicks && NetworkManager != null && NetworkManager.NetworkTickSystem != null)
            {
                NetworkManager.NetworkTickSystem.Tick -= OnServerTick;
            }

            m_SubscribedToTicks = false;
            m_Perception.StopListening();
            ReleaseCover();
            BotSquadManager.Leave(this, m_Squad);
            m_Squad = null;
        }

        private void InitializeServer()
        {
            if (m_Difficulty == null && GameConfig.Instance != null)
            {
                m_Difficulty = GameConfig.Instance.GetDifficulty(GameConfig.Instance.defaultDifficultyIndex);
            }

            if (m_Difficulty == null)
            {
                m_Difficulty = ScriptableObject.CreateInstance<BotDifficultyProfile>();
            }

            m_Aim = new BotAimController(transform);
            m_Perception.Initialize(m_Combatant, Memory, m_Difficulty, m_Eye);
            m_Perception.StartListening();

            m_Fsm = new BotStateMachine();
            m_Fsm.Register(new PatrolState(this));
            m_Fsm.Register(new InvestigateState(this));
            m_Fsm.Register(new EngageState(this));
            m_Fsm.Register(new TakeCoverState(this));
            m_Fsm.Register(new ReloadState(this));
            m_Fsm.Register(new FlankState(this));
            m_Fsm.Register(new SearchState(this));
            m_Fsm.Register(new DeadState(this));
            m_Fsm.ChangeState(BotStateId.Patrol);

            m_PerceptionTimer = Random.Range(0f, 0.1f);
            m_DecisionTimer = Random.Range(0f, m_Difficulty.decisionInterval);
            m_ServerInitialized = true;
        }

        /// <summary>Server: applies difficulty and joins a squad of the bot's team. Call after Combatant.ServerInitialize.</summary>
        public void ServerConfigure(BotDifficultyProfile difficulty)
        {
            if (!IsServer)
            {
                return;
            }

            if (difficulty != null)
            {
                m_Difficulty = difficulty;
                m_Perception.SetDifficulty(difficulty);
            }

            if (m_Squad != null)
            {
                BotSquadManager.Leave(this, m_Squad);
            }

            m_Squad = BotSquadManager.Join(this, m_Combatant.Team);
            m_Perception.SetSquad(m_Squad);
        }

        private void OnTeamChanged(Team team)
        {
            if (m_Visuals != null)
            {
                m_Visuals.SetTeam(team);
            }

            if (IsServer && m_ServerInitialized && (m_Squad == null || m_Squad.Team != team))
            {
                ServerConfigure(m_Difficulty);
            }
        }

        // ------------------------------------------------------------------------------------------------
        // Server update
        // ------------------------------------------------------------------------------------------------

        private void Update()
        {
            if (!IsSpawned)
            {
                return;
            }

            if (!IsServer)
            {
                UpdateClientPresentation();
                return;
            }

            if (!m_ServerInitialized || !IsAlive)
            {
                return;
            }

            float deltaTime = Time.deltaTime;
            UpdateLevelOfDetail(deltaTime);

            m_PerceptionTimer -= deltaTime;
            if (m_PerceptionTimer <= 0f)
            {
                m_Perception.Tick(m_PerceptionInterval);
                m_PerceptionTimer += m_PerceptionInterval;
            }

            m_DecisionTimer -= deltaTime;
            if (m_DecisionTimer <= 0f)
            {
                m_DecisionTimer = m_Difficulty.decisionInterval;
                Think();
            }

            FireAllowed = false;
            m_Fsm.Tick(deltaTime);
            UpdateAimAndFire(deltaTime);
            UpdateStance(deltaTime);

            m_Weapons.SetExternalMovement(m_Navigator.SpeedFraction * 1.4f, true, m_WantsCrouch);
            m_Weapons.SetAimInput(m_WantsAim && Memory.TargetVisible);
        }

        private void UpdateLevelOfDetail(float deltaTime)
        {
            m_LodTimer -= deltaTime;
            if (m_LodTimer > 0f)
            {
                return;
            }

            m_LodTimer = 2f;
            float nearestHuman = float.MaxValue;
            var all = CombatantRegistry.All;
            for (int i = 0; i < all.Count; i++)
            {
                if (all[i] != null && !all[i].IsBot && all[i].IsAlive)
                {
                    nearestHuman = Mathf.Min(nearestHuman, (all[i].transform.position - transform.position).sqrMagnitude);
                }
            }

            // Bots far from every human think less often (they still fight each other, just cheaper).
            nearestHuman = Mathf.Sqrt(nearestHuman);
            m_PerceptionInterval = nearestHuman > 150f ? 0.25f : nearestHuman > 70f ? 0.15f : 0.1f;
        }

        private void OnServerTick()
        {
            if (!IsSpawned)
            {
                return;
            }

            if (m_HitboxRig != null)
            {
                m_HitboxRig.SetCrouch(m_CrouchAmount);
            }

            if (m_LagTarget != null)
            {
                m_LagTarget.Record(NetworkManager.ServerTime.Time);
            }

            if (IsAlive && transform.position.y < -60f)
            {
                m_Health.Kill(DamageType.World);
            }
        }

        private void Think()
        {
            BotStateId desired = Decide();
            if (desired != m_Fsm.CurrentId)
            {
                if (m_LogStateChanges)
                {
                    Debug.Log($"[Bot {m_Combatant.DisplayName}] {m_Fsm.CurrentId} -> {desired}");
                }

                m_Fsm.ChangeState(desired);
            }
        }

        /// <summary>Priority-ordered tactical decision. Returns the state the bot should be in right now.</summary>
        private BotStateId Decide()
        {
            BotState current = m_Fsm.Current;
            BotDifficultyProfile d = m_Difficulty;

            if (!IsAlive)
            {
                return BotStateId.Dead;
            }

            bool hasVisibleTarget = Memory.TargetVisible && Memory.HasTarget;
            bool rememberedTarget = Memory.HasTarget && !Memory.TargetVisible;
            bool threatened = Memory.Suppression >= d.suppressionTolerance ||
                              (HealthFraction < d.retreatHealthFraction && Memory.TimeSinceDamaged < 3f);
            bool magazineEmpty = m_Weapons.Magazine <= 0;
            bool canReload = m_Weapons.CanReload();

            if (current != null && !current.IsComplete && !current.IsInterruptible)
            {
                return current.Id;
            }

            if (threatened && CanUseCover())
            {
                return BotStateId.TakeCover;
            }

            if (magazineEmpty && canReload)
            {
                if (hasVisibleTarget && CanUseCover())
                {
                    Memory.ReloadInCover = true;
                    return BotStateId.TakeCover;
                }

                if (m_Squad == null || m_Squad.RequestReloadToken(this, true))
                {
                    return BotStateId.Reload;
                }
            }

            if (hasVisibleTarget)
            {
                if (current != null && current.Id == BotStateId.Flank && !current.IsComplete)
                {
                    return BotStateId.Flank;
                }

                if (ShouldFlank())
                {
                    return BotStateId.Flank;
                }

                return BotStateId.Engage;
            }

            if (canReload && m_Weapons.MagazineFraction < d.tacticalReloadFraction && Memory.TimeSinceSeen > 1.5f &&
                (m_Squad == null || m_Squad.RequestReloadToken(this, false)))
            {
                return BotStateId.Reload;
            }

            if (rememberedTarget)
            {
                if (current != null && current.Id == BotStateId.Flank && !current.IsComplete)
                {
                    return BotStateId.Flank;
                }

                if (Memory.TimeSinceSeen < 1.2f)
                {
                    return BotStateId.Engage;
                }

                if (current != null && current.Id == BotStateId.Search && current.IsComplete)
                {
                    Memory.ForgetTarget();
                }
                else
                {
                    return BotStateId.Search;
                }
            }

            if (Memory.HasInvestigatePosition && Time.time - Memory.InvestigateTime < 14f &&
                !(current != null && current.Id == BotStateId.Investigate && current.IsComplete))
            {
                return BotStateId.Investigate;
            }

            if (m_Squad != null && m_Squad.TryGetFreshIntel(transform.position, out EnemyIntel intel) &&
                Time.time - intel.Time < 6f && Vector3.Distance(intel.Position, transform.position) < 90f)
            {
                Memory.SetInvestigate(intel.Position, NoiseType.Gunfire);
                return BotStateId.Investigate;
            }

            return BotStateId.Patrol;
        }

        private bool CanUseCover()
        {
            float cooldown = Mathf.Lerp(2.5f, 7f, m_Difficulty.aggressiveness);
            return CoverSystem.Count > 0 && Time.time - Memory.LastCoverTime > cooldown;
        }

        private bool ShouldFlank()
        {
            if (m_Squad == null || Memory.Target == null)
            {
                return false;
            }

            float distance = Vector3.Distance(transform.position, Memory.Target.FeetPosition);
            if (distance < 14f)
            {
                return false;
            }

            float chancePerDecision = m_Difficulty.flankChance * Mathf.Lerp(0.5f, 1.3f, m_Difficulty.aggressiveness) * m_Difficulty.decisionInterval * 0.5f;
            return Random.value < chancePerDecision && m_Squad.TryAssignFlanker(this);
        }

        // ------------------------------------------------------------------------------------------------
        // Aim & trigger discipline
        // ------------------------------------------------------------------------------------------------

        private void UpdateAimAndFire(float deltaTime)
        {
            Vector3 eye = EyePosition;
            float trackingSpeed = m_Difficulty.aimTrackingSpeed;

            if (Memory.TargetVisible && Memory.HasTarget)
            {
                Combatant target = Memory.Target;
                float situational = 1f + target.Velocity.magnitude / 6f + m_Navigator.SpeedFraction * 0.8f + Memory.Suppression * 1.2f - (m_WantsCrouch ? 0.15f : 0f);
                Vector3 aimPoint = m_Aim.GetAimPoint(target, m_Difficulty, situational, eye);
                m_Aim.RotateTowards(eye, aimPoint, trackingSpeed, deltaTime);
                if (FireAllowed)
                {
                    TryFireAt(target, aimPoint, eye);
                }

                return;
            }

            m_Aim.ClearTarget();
            if (m_HasLookPoint)
            {
                m_Aim.RotateTowards(eye, m_LookPoint, trackingSpeed * 0.6f, deltaTime);
            }
            else
            {
                Vector3 velocity = m_Navigator.Velocity;
                velocity.y = 0f;
                if (velocity.sqrMagnitude > 0.25f)
                {
                    m_Aim.RotateTowards(eye, eye + velocity.normalized * 10f, trackingSpeed * 0.5f, deltaTime);
                }
            }
        }

        private void TryFireAt(Combatant target, Vector3 aimPoint, Vector3 eye)
        {
            if (Time.time - Memory.TargetAcquiredTime < m_Difficulty.reactionTime)
            {
                return;
            }

            if (m_Weapons.IsReloading || m_Weapons.Magazine <= 0 || Time.time < m_NextBurstTime)
            {
                return;
            }

            WeaponData weapon = m_Weapons.ActiveWeapon;
            if (weapon == null)
            {
                return;
            }

            float distance = Vector3.Distance(eye, aimPoint);
            float tolerance = Mathf.Max(1.2f, Mathf.Atan2(0.45f, distance) * Mathf.Rad2Deg) * 2.5f;
            if (m_Aim.AngleTo(eye, aimPoint) > tolerance)
            {
                return;
            }

            // Precision weapons wait until the aim has settled.
            if (weapon.category == WeaponCategory.SniperRifle && m_Aim.TrackingTime < m_Difficulty.aimSettleTime * 0.8f)
            {
                return;
            }

            if (m_BurstShotsRemaining <= 0)
            {
                bool semi = weapon.fireMode == FireMode.SemiAuto;
                m_BurstShotsRemaining = semi ? Random.Range(1, 4) : Mathf.RoundToInt(Random.Range(m_Difficulty.burstShots.x, m_Difficulty.burstShots.y));
            }

            if (!m_Weapons.BotTryFire(eye, m_Aim.Forward))
            {
                return;
            }

            m_BurstShotsRemaining--;
            if (weapon.fireMode == FireMode.SemiAuto)
            {
                m_NextBurstTime = Time.time + Random.Range(0.08f, 0.3f) * Mathf.Lerp(1.4f, 0.6f, m_Difficulty.aggressiveness);
            }

            if (m_BurstShotsRemaining <= 0)
            {
                m_NextBurstTime = Time.time + Random.Range(m_Difficulty.burstPause.x, m_Difficulty.burstPause.y) * Mathf.Lerp(1.3f, 0.7f, m_Difficulty.aggressiveness);
            }
        }

        /// <summary>Fires at a point without a visible target (suppressive fire at the last known position).</summary>
        public bool TrySuppressiveFire(Vector3 point)
        {
            if (m_Weapons.IsReloading || m_Weapons.Magazine <= 1 || Time.time < m_NextBurstTime)
            {
                return false;
            }

            Vector3 eye = EyePosition;
            if (m_Aim.AngleTo(eye, point) > 6f)
            {
                return false;
            }

            if (m_Weapons.BotTryFire(eye, m_Aim.Forward))
            {
                m_NextBurstTime = Time.time + Random.Range(0.12f, 0.35f);
                return true;
            }

            return false;
        }

        // ------------------------------------------------------------------------------------------------
        // State-facing API
        // ------------------------------------------------------------------------------------------------

        public void SetCrouched(bool crouched)
        {
            m_WantsCrouch = crouched;
            m_Navigator.SetSpeed(crouched ? BotMoveSpeed.Crouch : BotMoveSpeed.Run);
        }

        public void SetAiming(bool aiming)
        {
            m_WantsAim = aiming;
        }

        public void SetLookPoint(Vector3 point)
        {
            m_HasLookPoint = true;
            m_LookPoint = point;
        }

        public void ClearLookPoint()
        {
            m_HasLookPoint = false;
        }

        /// <summary>Moves (with crouch-aware speed). Crouched bots always crouch-walk.</summary>
        public bool MoveTo(Vector3 destination, BotMoveSpeed speed, float stoppingDistance = 0.5f)
        {
            return m_Navigator.MoveTo(destination, m_WantsCrouch ? BotMoveSpeed.Crouch : speed, stoppingDistance);
        }

        public void ReleaseCover()
        {
            if (Memory.CurrentCover != null)
            {
                Memory.CurrentCover.Release(m_Combatant);
                Memory.CurrentCover = null;
            }
        }

        private void UpdateStance(float deltaTime)
        {
            m_CrouchAmount = Mathf.MoveTowards(m_CrouchAmount, m_WantsCrouch ? 1f : 0f, deltaTime * 6f);
            if (m_HitboxRig != null)
            {
                m_HitboxRig.SetCrouch(m_CrouchAmount);
            }

            if (m_Visuals != null)
            {
                m_Visuals.SetStance(m_CrouchAmount);
                m_Visuals.SetAimPitch(m_Aim.Pitch);
                m_Visuals.TickRemoteFootsteps(true);
            }

            short pitch = (short)Mathf.RoundToInt(m_Aim.Pitch);
            if (m_NetPitch.Value != pitch)
            {
                m_NetPitch.Value = pitch;
            }

            if (m_NetCrouch.Value != m_WantsCrouch)
            {
                m_NetCrouch.Value = m_WantsCrouch;
            }
        }

        private void UpdateClientPresentation()
        {
            float deltaTime = Time.deltaTime;
            m_CrouchAmount = Mathf.MoveTowards(m_CrouchAmount, m_NetCrouch.Value ? 1f : 0f, deltaTime * 6f);
            if (m_HitboxRig != null)
            {
                m_HitboxRig.SetCrouch(m_CrouchAmount);
            }

            if (m_Visuals != null)
            {
                m_Visuals.SetStance(m_CrouchAmount);
                m_Visuals.SetAimPitch(m_NetPitch.Value);
                m_Visuals.TickRemoteFootsteps(IsAlive);
            }
        }

        // ------------------------------------------------------------------------------------------------
        // Damage, death and respawn
        // ------------------------------------------------------------------------------------------------

        public void ReceiveIncomingFire(Combatant shooter, Vector3 shotOrigin, float intensity)
        {
            if (IsServer && IsAlive)
            {
                m_Perception.OnIncomingFire(shooter, shotOrigin, intensity);
            }
        }

        private void OnServerDamaged(DamageInfo damage)
        {
            if (IsAlive)
            {
                m_Perception.OnDamaged(damage);
            }
        }

        private void OnDied(DamageInfo damage)
        {
            if (m_BodyCollider != null)
            {
                m_BodyCollider.enabled = false;
            }

            if (m_HitboxRig != null)
            {
                m_HitboxRig.SetEnabled(false);
            }

            if (m_Visuals != null)
            {
                m_Visuals.SetDead(true);
            }

            if (!IsServer || m_Fsm == null)
            {
                return;
            }

            m_Fsm.ChangeState(BotStateId.Dead);
            ReleaseCover();
            m_Squad?.ReleaseTokens(this);
            m_Navigator.Stop();
            m_Navigator.SetAgentEnabled(false);
        }

        private void OnRevived()
        {
            if (m_BodyCollider != null)
            {
                m_BodyCollider.enabled = true;
            }

            if (m_HitboxRig != null)
            {
                m_HitboxRig.SetEnabled(true);
            }

            if (m_Visuals != null)
            {
                m_Visuals.SetDead(false);
            }
        }

        public void ServerRespawn(Vector3 position, Quaternion rotation, float spawnProtectionSeconds)
        {
            if (!IsServer)
            {
                return;
            }

            float yaw = rotation.eulerAngles.y;
            transform.SetPositionAndRotation(position, Quaternion.Euler(0f, yaw, 0f));
            m_Navigator.SetAgentEnabled(true);
            m_Navigator.Warp(position);
            if (m_NetworkTransform != null)
            {
                m_NetworkTransform.Teleport(transform.position, transform.rotation, transform.localScale);
            }

            if (m_LagTarget != null)
            {
                m_LagTarget.ClearHistory();
            }

            Memory.Reset();
            m_Perception.ResetAwareness();
            m_Aim?.Reset(yaw);
            m_WantsCrouch = false;
            m_CrouchAmount = 0f;
            m_BurstShotsRemaining = 0;
            m_Health.Revive(spawnProtectionSeconds);
            m_Weapons.ServerRefillAll();
            m_Fsm?.ChangeState(BotStateId.Patrol, true);
        }
    }
}
