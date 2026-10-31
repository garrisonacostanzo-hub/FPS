using System;
using FPS.Core;
using FPS.Data;
using UnityEngine;

namespace FPS.Player
{
    /// <summary>
    /// Deterministic-style first person motor built on <see cref="CharacterController"/>.
    /// Movement is advanced exclusively through <see cref="Simulate"/> with explicit commands and fixed delta time,
    /// which lets the owning client predict, the server re-simulate authoritatively, and the client replay
    /// unacknowledged commands after a correction (see NetworkPlayer). Supports walk, sprint, jump (coyote time +
    /// jump buffering), crouch with ceiling detection, air control, slope/step handling and ground snapping.
    /// </summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(CharacterController))]
    public class PlayerController : MonoBehaviour
    {
        [SerializeField] private PlayerMovementSettings m_Settings;
        [Tooltip("Movement speed multiplier while aiming down sights. Driven by the active weapon.")]
        [SerializeField, Range(0.1f, 1f)] private float m_AimSpeedMultiplier = 0.65f;

        private static readonly Collider[] s_OverlapBuffer = new Collider[8];

        private CharacterController m_Controller;
        private MotorState m_State;
        private float m_StrideAccumulator;
        private bool m_Initialized;

        /// <summary>Raised (during simulation) when a footstep should be heard. Used for audio and AI hearing.</summary>
        public event Action<FootstepInfo> Footstep;

        /// <summary>Raised when landing; the argument is the downward impact speed in m/s.</summary>
        public event Action<float> Landed;

        public event Action Jumped;

        public PlayerMovementSettings Settings => m_Settings;
        public CharacterController Controller => m_Controller;
        public MotorState State => m_State;
        public bool IsGrounded => m_State.Grounded;
        public bool IsCrouching => m_State.Crouching;
        public bool IsSprinting => m_State.Sprinting;
        public float CrouchAmount => m_State.CrouchAmount;
        public Vector3 Velocity => m_State.Velocity;
        public float HorizontalSpeed => new Vector2(m_State.Velocity.x, m_State.Velocity.z).magnitude;

        public float AimSpeedMultiplier
        {
            get => m_AimSpeedMultiplier;
            set => m_AimSpeedMultiplier = Mathf.Clamp(value, 0.1f, 1f);
        }

        public float EyeHeight
        {
            get
            {
                EnsureInitialized();
                return Mathf.Lerp(m_Settings.standingEyeHeight, m_Settings.crouchEyeHeight, m_State.CrouchAmount);
            }
        }

        public float GetEyeHeight(float crouchAmount)
        {
            EnsureInitialized();
            return Mathf.Lerp(m_Settings.standingEyeHeight, m_Settings.crouchEyeHeight, Mathf.Clamp01(crouchAmount));
        }

        public float CurrentHeight => Mathf.Lerp(m_Settings.standingHeight, m_Settings.crouchHeight, m_State.CrouchAmount);

        /// <summary>When true, footstep/land/jump events fire during Simulate. Disabled while replaying predictions.</summary>
        public bool EmitEvents { get; set; } = true;

        private void Awake()
        {
            EnsureInitialized();
        }

        private void EnsureInitialized()
        {
            if (m_Initialized)
            {
                return;
            }

            m_Initialized = true;
            m_Controller = GetComponent<CharacterController>();
            if (m_Settings == null)
            {
                m_Settings = GameConfig.Instance != null ? GameConfig.Instance.movementSettings : null;
            }

            if (m_Settings == null)
            {
                m_Settings = ScriptableObject.CreateInstance<PlayerMovementSettings>();
            }

            m_Controller.radius = m_Settings.radius;
            m_Controller.stepOffset = m_Settings.stepOffset;
            m_Controller.slopeLimit = m_Settings.slopeLimit;
            m_Controller.skinWidth = 0.04f;
            m_Controller.minMoveDistance = 0f;
            m_State.Position = transform.position;
            m_State.Grounded = true;
            ApplyCapsuleHeight();
        }

        public void Configure(PlayerMovementSettings settings)
        {
            if (settings != null)
            {
                m_Settings = settings;
                m_Initialized = false;
                EnsureInitialized();
            }
        }

        /// <summary>Advances the motor by one command.</summary>
        public void Simulate(in PlayerInputCommand command, float deltaTime)
        {
            EnsureInitialized();
            if (deltaTime <= 0f || !m_Controller.enabled)
            {
                return;
            }

            PlayerMovementSettings s = m_Settings;
            Vector2 move = Vector2.ClampMagnitude(command.Move, 1f);
            bool aiming = command.Has(InputButtons.Aim);

            // --- Crouch -------------------------------------------------------------------------
            bool wantsCrouch = command.Has(InputButtons.Crouch);
            if (!wantsCrouch && m_State.Crouching && !CanStandUp())
            {
                wantsCrouch = true;
            }

            m_State.Crouching = wantsCrouch;
            m_State.CrouchAmount = Mathf.MoveTowards(m_State.CrouchAmount, wantsCrouch ? 1f : 0f, s.crouchTransitionSpeed * deltaTime);
            ApplyCapsuleHeight();

            // --- Target speed -------------------------------------------------------------------
            bool sprinting = command.Has(InputButtons.Sprint) && move.y > 0.5f && !wantsCrouch && !aiming;
            if (!m_State.Grounded)
            {
                // Keep sprint momentum in the air but never start sprinting mid-air.
                sprinting &= m_State.Sprinting;
            }

            m_State.Sprinting = sprinting;

            float speed = wantsCrouch ? s.crouchSpeed : sprinting ? s.sprintSpeed : s.walkSpeed;
            if (aiming)
            {
                speed *= m_AimSpeedMultiplier;
            }

            if (move.y < -0.1f)
            {
                speed *= s.backwardSpeedMultiplier;
            }
            else if (Mathf.Abs(move.x) > Mathf.Abs(move.y))
            {
                speed *= s.strafeSpeedMultiplier;
            }

            Quaternion yaw = Quaternion.Euler(0f, command.Yaw, 0f);
            Vector3 wishVelocity = yaw * new Vector3(move.x, 0f, move.y) * speed;

            Vector3 velocity = m_State.Velocity;
            Vector3 horizontal = new Vector3(velocity.x, 0f, velocity.z);

            if (m_State.Grounded)
            {
                float rate = wishVelocity.sqrMagnitude > 0.01f ? s.groundAcceleration : s.groundDeceleration;
                horizontal = Vector3.MoveTowards(horizontal, wishVelocity, rate * deltaTime);
            }
            else if (wishVelocity.sqrMagnitude > 0.01f)
            {
                Vector3 target = Vector3.Lerp(horizontal, wishVelocity, s.airControl);
                horizontal = Vector3.MoveTowards(horizontal, target, s.airAcceleration * deltaTime);
            }

            // --- Jump (buffer + coyote time) ------------------------------------------------------
            m_State.JumpBufferTimer = command.Has(InputButtons.Jump) ? s.jumpBufferTime : Mathf.Max(0f, m_State.JumpBufferTimer - deltaTime);
            m_State.CoyoteTimer = m_State.Grounded ? s.coyoteTime : Mathf.Max(0f, m_State.CoyoteTimer - deltaTime);

            bool jumped = false;
            if (m_State.JumpBufferTimer > 0f && m_State.CoyoteTimer > 0f)
            {
                if (m_State.Crouching && CanStandUp())
                {
                    m_State.Crouching = false;
                }

                if (!m_State.Crouching)
                {
                    velocity.y = Mathf.Sqrt(2f * s.gravity * s.jumpHeight);
                    m_State.JumpBufferTimer = 0f;
                    m_State.CoyoteTimer = 0f;
                    m_State.Grounded = false;
                    jumped = true;
                }
            }

            // --- Gravity ---------------------------------------------------------------------------
            float verticalBeforeMove = velocity.y;
            if (m_State.Grounded && velocity.y <= 0f)
            {
                velocity.y = -s.groundStickVelocity;
            }
            else
            {
                velocity.y = Mathf.Max(velocity.y - s.gravity * deltaTime, -s.terminalVelocity);
            }

            // --- Move ------------------------------------------------------------------------------
            Vector3 startPosition = transform.position;
            Vector3 displacement = new Vector3(horizontal.x, velocity.y, horizontal.z) * deltaTime;
            CollisionFlags flags = m_Controller.Move(displacement);

            bool wasGrounded = m_State.Grounded;
            bool grounded = (flags & CollisionFlags.Below) != 0 || m_Controller.isGrounded;

            if (!grounded && wasGrounded && !jumped && velocity.y <= 0f)
            {
                grounded = TrySnapToGround();
            }

            if ((flags & CollisionFlags.Above) != 0 && velocity.y > 0f)
            {
                velocity.y = 0f;
            }

            Vector3 actualDelta = transform.position - startPosition;
            if ((flags & CollisionFlags.Sides) != 0)
            {
                // Remove velocity that was absorbed by walls so speed does not build up against obstacles.
                Vector3 actualHorizontal = new Vector3(actualDelta.x, 0f, actualDelta.z) / deltaTime;
                if (actualHorizontal.sqrMagnitude < horizontal.sqrMagnitude)
                {
                    horizontal = actualHorizontal;
                }
            }

            if (grounded && velocity.y < 0f)
            {
                velocity.y = -s.groundStickVelocity;
            }

            m_State.Velocity = new Vector3(horizontal.x, velocity.y, horizontal.z);
            m_State.Grounded = grounded;
            m_State.Position = transform.position;

            // --- Events ----------------------------------------------------------------------------
            if (!EmitEvents)
            {
                return;
            }

            if (jumped)
            {
                Jumped?.Invoke();
            }

            if (grounded && !wasGrounded)
            {
                float impactSpeed = Mathf.Max(0f, -verticalBeforeMove);
                Landed?.Invoke(impactSpeed);
                if (impactSpeed > 4f)
                {
                    RaiseFootstep(s.landingNoiseRadius);
                }
            }

            if (grounded)
            {
                float travelled = new Vector2(actualDelta.x, actualDelta.z).magnitude;
                m_StrideAccumulator += travelled;
                float stride = m_State.Crouching ? s.crouchStrideLength : m_State.Sprinting ? s.sprintStrideLength : s.walkStrideLength;
                if (m_StrideAccumulator >= stride * 0.5f)
                {
                    m_StrideAccumulator = 0f;
                    float radius = m_State.Crouching ? s.crouchNoiseRadius : m_State.Sprinting ? s.sprintNoiseRadius : s.walkNoiseRadius;
                    if (aiming)
                    {
                        radius *= 0.6f;
                    }

                    RaiseFootstep(radius);
                }
            }
        }

        private void RaiseFootstep(float radius)
        {
            Footstep?.Invoke(new FootstepInfo
            {
                Position = transform.position,
                NoiseRadius = radius,
                Sprinting = m_State.Sprinting,
                Crouching = m_State.Crouching
            });
        }

        private bool TrySnapToGround()
        {
            float radius = m_Controller.radius * 0.9f;
            Vector3 origin = transform.position + Vector3.up * (radius + 0.05f);
            float maxDistance = m_Settings.stepOffset + 0.1f;
            if (Physics.SphereCast(origin, radius, Vector3.down, out RaycastHit hit, maxDistance, GameLayers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                if (Vector3.Angle(hit.normal, Vector3.up) <= m_Controller.slopeLimit)
                {
                    float drop = Mathf.Max(0f, hit.distance - 0.05f);
                    m_Controller.Move(Vector3.down * (drop + m_Controller.skinWidth));
                    return true;
                }
            }

            return false;
        }

        public bool CanStandUp()
        {
            float radius = m_Controller.radius * 0.95f;
            Vector3 bottom = transform.position + Vector3.up * (radius + 0.05f);
            Vector3 top = transform.position + Vector3.up * (m_Settings.standingHeight - radius);
            int count = Physics.OverlapCapsuleNonAlloc(bottom, top, radius, s_OverlapBuffer, GameLayers.WorldMask | GameLayers.CombatantMask, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < count; i++)
            {
                Collider other = s_OverlapBuffer[i];
                if (other != null && other != m_Controller && !other.transform.IsChildOf(transform))
                {
                    return false;
                }
            }

            return true;
        }

        private void ApplyCapsuleHeight()
        {
            float height = CurrentHeight;
            m_Controller.height = height;
            m_Controller.center = new Vector3(0f, height * 0.5f, 0f);
        }

        public MotorState CaptureState()
        {
            EnsureInitialized();
            m_State.Position = transform.position;
            return m_State;
        }

        /// <summary>Hard-sets the motor (used for reconciliation and teleports).</summary>
        public void ApplyState(in MotorState state)
        {
            EnsureInitialized();
            m_State = state;
            SetPositionImmediate(state.Position);
            ApplyCapsuleHeight();
        }

        public void Teleport(Vector3 position)
        {
            EnsureInitialized();
            m_State = new MotorState
            {
                Position = position,
                Velocity = Vector3.zero,
                Grounded = true,
                CrouchAmount = 0f
            };
            m_StrideAccumulator = 0f;
            SetPositionImmediate(position);
            ApplyCapsuleHeight();
        }

        private void SetPositionImmediate(Vector3 position)
        {
            bool wasEnabled = m_Controller.enabled;
            m_Controller.enabled = false;
            transform.position = position;
            m_Controller.enabled = wasEnabled;
        }

        public void SetCollisionEnabled(bool enabled)
        {
            EnsureInitialized();
            m_Controller.enabled = enabled;
        }
    }
}
