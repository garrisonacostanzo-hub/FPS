using System.Collections.Generic;
using FPS.Combat;
using FPS.Controls;
using FPS.Core;
using FPS.Data;
using FPS.Weapons;
using Unity.Netcode;
using UnityEngine;

namespace FPS.Player
{
    /// <summary>
    /// Network glue of a human player (the NGO player object).
    ///
    /// Movement (server authoritative with client-side prediction):
    ///  1. Every network tick the owner samples input into a <see cref="PlayerInputCommand"/>, simulates it locally
    ///     (prediction), stores command + resulting state, and sends the last 3 commands unreliably.
    ///  2. The server queues commands and simulates them with the same motor; it acknowledges the last processed tick
    ///     together with its authoritative <see cref="MotorState"/>.
    ///  3. The owner compares the acknowledged state with its prediction for that tick. If they diverge it rewinds to
    ///     the server state and replays all newer commands (reconciliation); the visual offset is smoothed out.
    ///  4. Other peers receive compact snapshots and render them ~100 ms in the past with interpolation.
    ///
    /// The host's own player skips prediction entirely (it is the authority).
    /// </summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(PlayerController), typeof(HealthSystem), typeof(Combatant))]
    public class NetworkPlayer : NetworkBehaviour, IRespawnable
    {
        private const int k_BufferSize = 256;
        private const int k_MaxQueuedInputs = 12;
        private const float k_ReconcileThreshold = 0.06f;
        private const float k_KillPlaneY = -60f;
        private const int k_SnapshotTickInterval = 2; // remote snapshots at half the tick rate (30 Hz at 60 Hz ticks)

        [SerializeField] private Transform m_VisualRoot;
        [SerializeField] private FPSCamera m_FpsCamera;
        [SerializeField] private PlayerInputReader m_Input;
        [SerializeField] private CharacterVisuals m_Visuals;
        [SerializeField] private HitboxRig m_HitboxRig;

        private PlayerController m_Motor;
        private HealthSystem m_Health;
        private Combatant m_Combatant;
        private WeaponSystem m_Weapons;
        private LagCompensatedTarget m_LagTarget;

        private float m_TickDelta = 1f / 60f;
        private bool m_SubscribedToTicks;

        // Owner prediction buffers (indexed by tick % k_BufferSize).
        private readonly PlayerInputCommand[] m_InputBuffer = new PlayerInputCommand[k_BufferSize];
        private readonly MotorState[] m_StateBuffer = new MotorState[k_BufferSize];
        private readonly int[] m_BufferTicks = new int[k_BufferSize];
        private int m_LatestPredictedTick = -1;
        private int m_LastAcknowledgedTick = -1;
        private Vector3 m_PreviousSimPosition;
        private Vector3 m_CurrentSimPosition;
        private float m_LastSimTime;
        private Vector3 m_VisualCorrection;

        // Server state.
        private readonly Queue<PlayerInputCommand> m_ServerInputs = new Queue<PlayerInputCommand>(k_MaxQueuedInputs);
        private int m_ServerLastQueuedTick = -1;
        private int m_ServerLastProcessedTick = -1;
        private PlayerInputCommand m_ServerLastCommand;
        private byte m_TeleportId;

        // Remote interpolation.
        private readonly List<PlayerSnapshot> m_Snapshots = new List<PlayerSnapshot>(32);
        private byte m_RemoteTeleportId;

        public PlayerController Motor => m_Motor;
        public HealthSystem Health => m_Health;
        public Combatant Combatant => m_Combatant;
        public WeaponSystem Weapons => m_Weapons;
        public FPSCamera FpsCamera => m_FpsCamera;

        private void Awake()
        {
            m_Motor = GetComponent<PlayerController>();
            m_Health = GetComponent<HealthSystem>();
            m_Combatant = GetComponent<Combatant>();
            m_Weapons = GetComponent<WeaponSystem>();
            m_LagTarget = GetComponent<LagCompensatedTarget>();
            if (m_Input == null) m_Input = GetComponent<PlayerInputReader>();
            if (m_FpsCamera == null) m_FpsCamera = GetComponentInChildren<FPSCamera>(true);
            if (m_Visuals == null) m_Visuals = GetComponentInChildren<CharacterVisuals>(true);
            if (m_HitboxRig == null) m_HitboxRig = GetComponentInChildren<HitboxRig>(true);
            if (m_VisualRoot == null) m_VisualRoot = transform;

            for (int i = 0; i < k_BufferSize; i++)
            {
                m_BufferTicks[i] = -1;
            }

            if (m_Input != null)
            {
                m_Input.enabled = false;
            }

            if (m_FpsCamera != null)
            {
                m_FpsCamera.SetCameraEnabled(false);
            }
        }

        public override void OnNetworkSpawn()
        {
            m_TickDelta = 1f / Mathf.Max(1u, NetworkManager.NetworkTickSystem.TickRate);
            NetworkManager.NetworkTickSystem.Tick += OnNetworkTick;
            m_SubscribedToTicks = true;

            m_Health.Died += OnDied;
            m_Health.Revived += OnRevived;
            m_Health.Damaged += OnDamaged;
            m_Health.HealthChanged += OnHealthChanged;
            m_Motor.Footstep += OnFootstep;
            m_Motor.Landed += OnLanded;
            m_Combatant.TeamChanged += OnTeamChanged;

            m_PreviousSimPosition = m_CurrentSimPosition = transform.position;
            if (m_Visuals != null)
            {
                m_Visuals.SetTeam(m_Combatant.Team);
            }

            if (IsOwner)
            {
                SetupLocalPlayer();
            }
            else
            {
                SetupRemotePlayer();
            }
        }

        public override void OnNetworkDespawn()
        {
            if (m_SubscribedToTicks && NetworkManager != null && NetworkManager.NetworkTickSystem != null)
            {
                NetworkManager.NetworkTickSystem.Tick -= OnNetworkTick;
            }

            m_SubscribedToTicks = false;
            m_Health.Died -= OnDied;
            m_Health.Revived -= OnRevived;
            m_Health.Damaged -= OnDamaged;
            m_Health.HealthChanged -= OnHealthChanged;
            m_Motor.Footstep -= OnFootstep;
            m_Motor.Landed -= OnLanded;
            m_Combatant.TeamChanged -= OnTeamChanged;

            if (IsOwner)
            {
                if (m_FpsCamera != null)
                {
                    m_FpsCamera.SetCameraEnabled(false);
                }

                if (m_Input != null)
                {
                    m_Input.enabled = false;
                }

                EventBus<LocalPlayerDespawnedEvent>.Raise(new LocalPlayerDespawnedEvent { Player = gameObject });
                CursorController.ForceUnlocked();
            }
        }

        private void SetupLocalPlayer()
        {
            m_Input.enabled = true;
            m_Input.ResetToggles();
            m_FpsCamera.Initialize(m_Motor, transform, transform.eulerAngles.y, 0f);
            m_FpsCamera.SetCameraEnabled(true);
            m_Weapons.BindLocalCamera(m_FpsCamera);
            if (m_Visuals != null)
            {
                m_Visuals.SetFirstPerson(true);
            }

            CursorController.ResetToGameplay();
            EventBus<LocalPlayerSpawnedEvent>.Raise(new LocalPlayerSpawnedEvent
            {
                Player = gameObject,
                Camera = m_FpsCamera.Camera,
                Team = m_Combatant.Team
            });
            EventBus<LocalHealthChangedEvent>.Raise(new LocalHealthChangedEvent { Current = m_Health.Current, Max = m_Health.Max });
            m_Weapons.PublishAmmo();
        }

        private void SetupRemotePlayer()
        {
            if (m_Input != null)
            {
                m_Input.enabled = false;
            }

            if (m_FpsCamera != null)
            {
                m_FpsCamera.SetCameraEnabled(false);
            }

            if (m_Visuals != null)
            {
                m_Visuals.SetFirstPerson(false);
            }
        }

        private void OnTeamChanged(Team team)
        {
            if (m_Visuals != null)
            {
                m_Visuals.SetTeam(team);
            }

            if (IsOwner)
            {
                EventBus<LocalPlayerSpawnedEvent>.Raise(new LocalPlayerSpawnedEvent { Player = gameObject, Camera = m_FpsCamera.Camera, Team = team });
            }
        }

        // ------------------------------------------------------------------------------------------------
        // Tick: prediction, server simulation, replication
        // ------------------------------------------------------------------------------------------------

        private void OnNetworkTick()
        {
            if (!IsSpawned)
            {
                return;
            }

            if (IsOwner)
            {
                int tick = IsServer ? NetworkManager.ServerTime.Tick : NetworkManager.LocalTime.Tick;
                PlayerInputCommand command = BuildCommand(tick);
                m_PreviousSimPosition = transform.position;

                if (IsServer)
                {
                    ServerSimulate(command);
                }
                else
                {
                    PredictAndSend(command);
                }

                m_CurrentSimPosition = transform.position;
                m_LastSimTime = Time.time;
            }
            else if (IsServer)
            {
                ProcessQueuedInputs();
            }

            if (IsServer)
            {
                ServerPostSimulation();
            }
        }

        private PlayerInputCommand BuildCommand(int tick)
        {
            var command = new PlayerInputCommand
            {
                Tick = tick,
                Yaw = m_FpsCamera.Yaw,
                Pitch = m_FpsCamera.Pitch
            };

            if (m_Health.IsDead || m_Input == null)
            {
                return command;
            }

            command.Move = m_Input.Move;
            InputButtons buttons = InputButtons.None;
            if (m_Input.ConsumeJump()) buttons |= InputButtons.Jump;
            bool aiming = m_Weapons != null && m_Weapons.WantsToAim;
            if (m_Input.SprintHeld && !m_Input.FireHeld && !aiming) buttons |= InputButtons.Sprint;
            if (m_Input.CrouchHeld) buttons |= InputButtons.Crouch;
            if (aiming) buttons |= InputButtons.Aim;
            if (m_Input.FireHeld) buttons |= InputButtons.Fire;
            command.Buttons = buttons;
            return command;
        }

        private void PredictAndSend(in PlayerInputCommand command)
        {
            m_Motor.Simulate(command, m_TickDelta);

            int index = Mod(command.Tick);
            m_InputBuffer[index] = command;
            m_StateBuffer[index] = m_Motor.CaptureState();
            m_BufferTicks[index] = command.Tick;
            m_LatestPredictedTick = command.Tick;

            var batch = new InputBatch();
            int count = 0;
            for (int offset = 0; offset < InputBatch.Capacity; offset++)
            {
                int tick = command.Tick - offset;
                int bufferIndex = Mod(tick);
                if (tick < 0 || m_BufferTicks[bufferIndex] != tick)
                {
                    break;
                }

                batch.Set(count, m_InputBuffer[bufferIndex]);
                count++;
            }

            batch.Count = (byte)count;
            SubmitInputsRpc(batch);
        }

        [Rpc(SendTo.Server, Delivery = RpcDelivery.Unreliable)]
        private void SubmitInputsRpc(InputBatch batch, RpcParams rpcParams = default)
        {
            if (rpcParams.Receive.SenderClientId != OwnerClientId)
            {
                return;
            }

            // Commands arrive newest first; enqueue oldest first, skipping anything already received.
            for (int i = batch.Count - 1; i >= 0; i--)
            {
                PlayerInputCommand command = batch.Get(i);
                if (command.Tick <= m_ServerLastQueuedTick)
                {
                    continue;
                }

                m_ServerLastQueuedTick = command.Tick;
                m_ServerInputs.Enqueue(command);
                while (m_ServerInputs.Count > k_MaxQueuedInputs)
                {
                    m_ServerInputs.Dequeue();
                }
            }
        }

        private void ProcessQueuedInputs()
        {
            // Consume one command per tick; catch up gradually if a backlog formed (bounded to stop speed hacks).
            int budget = m_ServerInputs.Count > 4 ? 2 : 1;
            for (int i = 0; i < budget && m_ServerInputs.Count > 0; i++)
            {
                ServerSimulate(m_ServerInputs.Dequeue());
            }
        }

        private void ServerSimulate(in PlayerInputCommand command)
        {
            m_ServerLastCommand = command;
            m_ServerLastProcessedTick = command.Tick;
            if (m_Health.IsDead)
            {
                return;
            }

            if (!IsOwner)
            {
                transform.rotation = Quaternion.Euler(0f, command.Yaw, 0f);
            }

            m_Motor.Simulate(command, m_TickDelta);
        }

        private void ServerPostSimulation()
        {
            if (m_HitboxRig != null)
            {
                m_HitboxRig.SetCrouch(m_Motor.CrouchAmount);
            }

            if (m_LagTarget != null)
            {
                m_LagTarget.Record(NetworkManager.ServerTime.Time);
            }

            if (!m_Health.IsDead && transform.position.y < k_KillPlaneY)
            {
                m_Health.Kill(DamageType.World);
            }

            PlayerStateFlags flags = PlayerStateFlags.None;
            if (m_Motor.IsCrouching) flags |= PlayerStateFlags.Crouching;
            if (m_Motor.IsGrounded) flags |= PlayerStateFlags.Grounded;
            if (m_Motor.IsSprinting) flags |= PlayerStateFlags.Sprinting;
            if (m_ServerLastCommand.Has(InputButtons.Aim)) flags |= PlayerStateFlags.Aiming;
            if (!m_Health.IsDead) flags |= PlayerStateFlags.Alive;

            float yaw = IsOwner ? m_FpsCamera.Yaw : m_ServerLastCommand.Yaw;
            float pitch = IsOwner ? m_FpsCamera.Pitch : m_ServerLastCommand.Pitch;

            int serverTick = NetworkManager.ServerTime.Tick;
            if (serverTick % k_SnapshotTickInterval == 0 || m_Health.IsDead)
            {
                SendSnapshot(serverTick, yaw, pitch, flags);
            }

            if (!IsOwner && m_ServerLastProcessedTick >= 0)
            {
                OwnerStateRpc(m_ServerLastProcessedTick, m_TeleportId, m_Motor.CaptureState());
            }

            if (!IsOwner)
            {
                SetRemoteEyeHeight(m_Motor.CrouchAmount);
                if (m_Visuals != null)
                {
                    m_Visuals.SetStance(m_Motor.CrouchAmount);
                    m_Visuals.SetAimPitch(pitch);
                }
            }
        }

        private void SendSnapshot(int serverTick, float yaw, float pitch, PlayerStateFlags flags)
        {
            SnapshotRpc(new PlayerSnapshot
            {
                Tick = serverTick,
                Position = transform.position,
                Yaw = yaw,
                Pitch = pitch,
                CrouchAmount = m_Motor.CrouchAmount,
                Speed = m_Motor.HorizontalSpeed,
                Flags = flags,
                TeleportId = m_TeleportId
            });
        }

        private void SetRemoteEyeHeight(float crouchAmount)
        {
            if (m_FpsCamera != null)
            {
                m_FpsCamera.transform.localPosition = new Vector3(0f, m_Motor.GetEyeHeight(crouchAmount), 0f);
            }
        }

        // ------------------------------------------------------------------------------------------------
        // Reconciliation (owner)
        // ------------------------------------------------------------------------------------------------

        [Rpc(SendTo.Owner, Delivery = RpcDelivery.Unreliable)]
        private void OwnerStateRpc(int lastProcessedTick, byte teleportId, MotorState serverState)
        {
            if (IsServer || teleportId != m_TeleportId || lastProcessedTick <= m_LastAcknowledgedTick)
            {
                return;
            }

            m_LastAcknowledgedTick = lastProcessedTick;
            int index = Mod(lastProcessedTick);
            if (m_BufferTicks[index] != lastProcessedTick)
            {
                return; // Too old: prediction history no longer available.
            }

            MotorState predicted = m_StateBuffer[index];
            float error = Vector3.Distance(predicted.Position, serverState.Position);
            bool stanceMismatch = predicted.Crouching != serverState.Crouching;
            if (error < k_ReconcileThreshold && !stanceMismatch)
            {
                return;
            }

            Vector3 before = transform.position;
            m_Motor.ApplyState(serverState);
            m_StateBuffer[index] = serverState;

            m_Motor.EmitEvents = false;
            for (int tick = lastProcessedTick + 1; tick <= m_LatestPredictedTick; tick++)
            {
                int replayIndex = Mod(tick);
                if (m_BufferTicks[replayIndex] != tick)
                {
                    continue;
                }

                m_Motor.Simulate(m_InputBuffer[replayIndex], m_TickDelta);
                m_StateBuffer[replayIndex] = m_Motor.CaptureState();
            }

            m_Motor.EmitEvents = true;

            Vector3 after = transform.position;
            Vector3 shift = after - before;
            if (shift.sqrMagnitude < 4f)
            {
                // Hide small corrections by blending the visual offset out over a few frames.
                m_VisualCorrection -= shift;
            }

            m_PreviousSimPosition += shift;
            m_CurrentSimPosition = after;
        }

        // ------------------------------------------------------------------------------------------------
        // Remote interpolation
        // ------------------------------------------------------------------------------------------------

        [Rpc(SendTo.NotOwner, Delivery = RpcDelivery.Unreliable)]
        private void SnapshotRpc(PlayerSnapshot snapshot)
        {
            if (IsServer)
            {
                return;
            }

            if (snapshot.TeleportId != m_RemoteTeleportId)
            {
                m_RemoteTeleportId = snapshot.TeleportId;
                m_Snapshots.Clear();
            }

            int insertAt = m_Snapshots.Count;
            for (int i = m_Snapshots.Count - 1; i >= 0; i--)
            {
                if (m_Snapshots[i].Tick == snapshot.Tick)
                {
                    return;
                }

                if (m_Snapshots[i].Tick < snapshot.Tick)
                {
                    break;
                }

                insertAt = i;
            }

            m_Snapshots.Insert(insertAt, snapshot);
            while (m_Snapshots.Count > 30)
            {
                m_Snapshots.RemoveAt(0);
            }
        }

        private void InterpolateRemote()
        {
            if (m_Snapshots.Count == 0)
            {
                return;
            }

            MatchSettings settings = GameConfig.Instance != null ? GameConfig.Instance.matchSettings : null;
            double delay = settings != null ? settings.remoteInterpolationDelay : 0.1d;
            double renderTime = NetworkManager.ServerTime.Time - delay;
            double tickDelta = m_TickDelta;

            PlayerSnapshot from = m_Snapshots[0];
            PlayerSnapshot to = from;
            for (int i = 0; i < m_Snapshots.Count; i++)
            {
                if (m_Snapshots[i].Tick * tickDelta <= renderTime)
                {
                    from = m_Snapshots[i];
                    to = i + 1 < m_Snapshots.Count ? m_Snapshots[i + 1] : m_Snapshots[i];
                }
                else
                {
                    if (i == 0)
                    {
                        from = to = m_Snapshots[0];
                    }

                    break;
                }
            }

            double span = (to.Tick - from.Tick) * tickDelta;
            float t = span > 1e-5 ? Mathf.Clamp01((float)((renderTime - from.Tick * tickDelta) / span)) : 1f;

            Vector3 position = Vector3.Lerp(from.Position, to.Position, t);
            float yaw = Mathf.LerpAngle(from.Yaw, to.Yaw, t);
            float pitch = Mathf.Lerp(from.Pitch, to.Pitch, t);
            float crouch = Mathf.Lerp(from.CrouchAmount, to.CrouchAmount, t);

            transform.SetPositionAndRotation(position, Quaternion.Euler(0f, yaw, 0f));
            SetRemoteEyeHeight(crouch);
            if (m_HitboxRig != null)
            {
                m_HitboxRig.SetCrouch(crouch);
            }

            if (m_Visuals != null)
            {
                m_Visuals.SetStance(crouch);
                m_Visuals.SetAimPitch(pitch);
                m_Visuals.TickRemoteFootsteps(to.Has(PlayerStateFlags.Grounded) && to.Has(PlayerStateFlags.Alive));
            }

            // Drop snapshots that can no longer be used.
            while (m_Snapshots.Count > 2 && m_Snapshots[1].Tick * tickDelta < renderTime)
            {
                m_Snapshots.RemoveAt(0);
            }
        }

        // ------------------------------------------------------------------------------------------------
        // Frame update
        // ------------------------------------------------------------------------------------------------

        private void Update()
        {
            if (!IsSpawned)
            {
                return;
            }

            float deltaTime = Time.deltaTime;
            if (IsOwner)
            {
                if (!m_Health.IsDead)
                {
                    m_FpsCamera.ProcessLook(m_Input, deltaTime);
                    m_Weapons.OwnerTick(m_Input, deltaTime);
                }

                float alpha = Mathf.Clamp01((Time.time - m_LastSimTime) / m_TickDelta);
                m_VisualCorrection = Vector3.Lerp(m_VisualCorrection, Vector3.zero, 1f - Mathf.Exp(-14f * deltaTime));
                if (m_VisualRoot != transform)
                {
                    m_VisualRoot.position = Vector3.Lerp(m_PreviousSimPosition, m_CurrentSimPosition, alpha) + m_VisualCorrection;
                }

                if (m_HitboxRig != null)
                {
                    m_HitboxRig.SetCrouch(m_Motor.CrouchAmount);
                }

                if (m_Visuals != null)
                {
                    m_Visuals.SetStance(m_Motor.CrouchAmount);
                    m_Visuals.SetAimPitch(m_FpsCamera.Pitch);
                }
            }
            else if (!IsServer)
            {
                InterpolateRemote();
            }
            else if (m_Visuals != null)
            {
                m_Visuals.TickRemoteFootsteps(m_Motor.IsGrounded && !m_Health.IsDead);
            }
        }

        // ------------------------------------------------------------------------------------------------
        // Gameplay events
        // ------------------------------------------------------------------------------------------------

        private void OnFootstep(FootstepInfo footstep)
        {
            if (IsServer)
            {
                NoiseSystem.Emit(footstep.Position, footstep.NoiseRadius, NoiseType.Footstep, m_Combatant);
            }

            if (IsOwner)
            {
                float volume = footstep.Crouching ? 0.08f : footstep.Sprinting ? 0.3f : 0.18f;
                AudioPool.Play2D(ProceduralAudio.Get(ProceduralSound.Footstep), volume, Random.Range(0.9f, 1.1f));
            }
        }

        private void OnLanded(float impactSpeed)
        {
            if (IsOwner && m_FpsCamera != null)
            {
                m_FpsCamera.OnLanded(impactSpeed);
            }

            PlayerMovementSettings settings = m_Motor.Settings;
            if (IsServer && settings != null && impactSpeed > settings.fallDamageMinSpeed)
            {
                DamageInfo damage = DamageInfo.Environmental((impactSpeed - settings.fallDamageMinSpeed) * settings.fallDamagePerMeterPerSecond, transform.position, DamageType.Fall);
                damage.AttackerId = NetworkObjectId;
                m_Health.ApplyDamage(damage);
            }
        }

        private void OnDamaged(DamageInfo damage)
        {
            if (!IsOwner)
            {
                return;
            }

            EventBus<LocalDamageTakenEvent>.Raise(new LocalDamageTakenEvent
            {
                Damage = damage.Amount,
                SourcePosition = damage.SourcePosition,
                RemainingHealth = m_Health.Current
            });

            if (m_FpsCamera != null)
            {
                m_FpsCamera.Shake(Mathf.Clamp01(damage.Amount / 40f));
            }

            AudioPool.Play2D(ProceduralAudio.Get(ProceduralSound.Hurt), 0.5f, Random.Range(0.9f, 1.1f));
        }

        private void OnHealthChanged(float current, float max)
        {
            if (IsOwner)
            {
                EventBus<LocalHealthChangedEvent>.Raise(new LocalHealthChangedEvent { Current = current, Max = max });
            }
        }

        private void OnDied(DamageInfo damage)
        {
            m_Motor.SetCollisionEnabled(false);
            if (m_HitboxRig != null)
            {
                m_HitboxRig.SetEnabled(false);
            }

            if (m_Visuals != null)
            {
                m_Visuals.SetDead(true);
                m_Visuals.SetFirstPerson(false);
            }

            if (!IsOwner)
            {
                return;
            }

            Combatant killer = damage.HasAttacker ? CombatantRegistry.Find(damage.AttackerId) : null;
            WeaponData weapon = GameConfig.Instance != null ? GameConfig.Instance.FindWeapon(damage.WeaponId) : null;
            MatchSettings settings = GameConfig.Instance != null ? GameConfig.Instance.matchSettings : null;
            EventBus<LocalDeathEvent>.Raise(new LocalDeathEvent
            {
                KillerName = killer != null && killer != m_Combatant ? killer.DisplayName : string.Empty,
                WeaponName = weapon != null ? weapon.displayName : damage.Type.ToString(),
                RespawnDelay = settings != null ? settings.respawnDelay : 4f
            });

            // Death cam: pull the camera up and behind the body.
            if (m_FpsCamera != null)
            {
                m_FpsCamera.SetDeathCam(true);
            }
        }

        private void OnRevived()
        {
            m_Motor.SetCollisionEnabled(true);
            if (m_HitboxRig != null)
            {
                m_HitboxRig.SetEnabled(true);
            }

            if (m_Visuals != null)
            {
                m_Visuals.SetDead(false);
                m_Visuals.SetFirstPerson(IsOwner);
            }

            if (IsOwner)
            {
                if (m_FpsCamera != null)
                {
                    m_FpsCamera.SetDeathCam(false);
                }

                EventBus<LocalRespawnEvent>.Raise(new LocalRespawnEvent { Position = transform.position });
            }
        }

        // ------------------------------------------------------------------------------------------------
        // Respawn (server)
        // ------------------------------------------------------------------------------------------------

        public void ServerRespawn(Vector3 position, Quaternion rotation, float spawnProtectionSeconds)
        {
            if (!IsServer)
            {
                return;
            }

            m_TeleportId++;
            m_ServerInputs.Clear();
            m_Motor.SetCollisionEnabled(true);
            m_Motor.Teleport(position);
            float yaw = rotation.eulerAngles.y;
            transform.rotation = Quaternion.Euler(0f, yaw, 0f);
            if (m_LagTarget != null)
            {
                m_LagTarget.ClearHistory();
            }

            m_Health.Revive(spawnProtectionSeconds);
            m_Weapons.ServerRefillAll();

            if (IsOwner)
            {
                m_FpsCamera.SetViewAngles(yaw, 0f);
                m_PreviousSimPosition = m_CurrentSimPosition = position;
                m_VisualCorrection = Vector3.zero;
            }
            else
            {
                TeleportOwnerRpc(position, yaw, m_TeleportId);
            }
        }

        [Rpc(SendTo.Owner, Delivery = RpcDelivery.Reliable)]
        private void TeleportOwnerRpc(Vector3 position, float yaw, byte teleportId)
        {
            if (IsServer)
            {
                return;
            }

            m_TeleportId = teleportId;
            m_Motor.SetCollisionEnabled(true);
            m_Motor.Teleport(position);
            m_FpsCamera.SetViewAngles(yaw, 0f);
            m_PreviousSimPosition = m_CurrentSimPosition = position;
            m_VisualCorrection = Vector3.zero;
            m_LastAcknowledgedTick = m_LatestPredictedTick;
            for (int i = 0; i < k_BufferSize; i++)
            {
                m_BufferTicks[i] = -1;
            }
        }

        private static int Mod(int tick)
        {
            int value = tick % k_BufferSize;
            return value < 0 ? value + k_BufferSize : value;
        }
    }
}
