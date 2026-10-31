using UnityEngine;

namespace FPS.Data
{
    /// <summary>Character motor tuning shared by prediction (client) and authoritative simulation (server).</summary>
    [CreateAssetMenu(menuName = "FPS/Player Movement Settings", fileName = "PlayerMovementSettings", order = 20)]
    public class PlayerMovementSettings : ScriptableObject
    {
        [Header("Speeds (m/s)")]
        [Min(0.1f)] public float walkSpeed = 4.6f;
        [Min(0.1f)] public float sprintSpeed = 7.2f;
        [Min(0.1f)] public float crouchSpeed = 2.3f;
        [Min(0.1f)] public float backwardSpeedMultiplier = 0.8f;
        [Min(0.1f)] public float strafeSpeedMultiplier = 0.9f;

        [Header("Acceleration")]
        [Min(0.1f)] public float groundAcceleration = 55f;
        [Min(0.1f)] public float groundDeceleration = 45f;
        [Min(0f)] public float airAcceleration = 12f;
        [Range(0f, 1f)] public float airControl = 0.45f;

        [Header("Jump & Gravity")]
        [Min(0f)] public float jumpHeight = 1.15f;
        [Min(0.1f)] public float gravity = 22f;
        [Min(1f)] public float terminalVelocity = 55f;
        [Min(0f)] public float coyoteTime = 0.12f;
        [Min(0f)] public float jumpBufferTime = 0.12f;
        [Tooltip("Downward velocity applied while grounded to keep the controller glued to slopes and steps.")]
        [Min(0f)] public float groundStickVelocity = 3f;

        [Header("Capsule")]
        [Min(0.5f)] public float standingHeight = 1.8f;
        [Min(0.5f)] public float crouchHeight = 1.15f;
        [Min(0.1f)] public float radius = 0.35f;
        [Min(0.1f)] public float crouchTransitionSpeed = 9f;
        [Min(0.1f)] public float standingEyeHeight = 1.62f;
        [Min(0.1f)] public float crouchEyeHeight = 1.0f;
        [Min(0f)] public float stepOffset = 0.4f;
        [Range(10f, 80f)] public float slopeLimit = 48f;

        [Header("Footsteps & Noise")]
        [Min(0.1f)] public float walkStrideLength = 2.1f;
        [Min(0.1f)] public float sprintStrideLength = 2.7f;
        [Min(0.1f)] public float crouchStrideLength = 1.6f;
        [Min(0f)] public float walkNoiseRadius = 14f;
        [Min(0f)] public float sprintNoiseRadius = 26f;
        [Min(0f)] public float crouchNoiseRadius = 3f;
        [Min(0f)] public float landingNoiseRadius = 18f;

        [Header("Fall damage")]
        [Min(0f)] public float fallDamageMinSpeed = 15f;
        [Min(0f)] public float fallDamagePerMeterPerSecond = 9f;
    }
}
