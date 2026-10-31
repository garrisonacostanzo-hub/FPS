using FPS.Controls;
using FPS.Core;
using FPS.Data;
using UnityEngine;

namespace FPS.Player
{
    /// <summary>
    /// First person camera for the local player: mouse/gamepad look with configurable smoothing, recoil
    /// (split into a recoverable "aim punch" and a permanent climb), ADS/sprint field of view, head bob,
    /// landing dip, damage shake and smooth crouch eye height.
    /// Lives on the CameraPivot transform; yaw is applied to the player body, pitch to the pivot.
    /// </summary>
    [DisallowMultipleComponent]
    public class FPSCamera : MonoBehaviour
    {
        [SerializeField] private CameraSettings m_Settings;
        [SerializeField] private Camera m_Camera;
        [Tooltip("Transform rotated around Y by the look yaw (normally the player root).")]
        [SerializeField] private Transform m_YawTransform;
        [Tooltip("Transform that receives bob/shake offsets (normally the Camera transform).")]
        [SerializeField] private Transform m_EffectsTransform;

        private PlayerController m_Motor;
        private float m_TargetYaw;
        private float m_TargetPitch;
        private float m_Yaw;
        private float m_Pitch;
        private float m_RecoilPitch;
        private float m_RecoilYaw;
        private float m_LastRecoilTime;
        private float m_RecoilRecoverySpeed = 9f;
        private float m_AimFraction;
        private float m_AimFov = 55f;
        private float m_CurrentFov;
        private float m_BobPhase;
        private float m_LandingOffset;
        private float m_LandingVelocity;
        private float m_Shake;
        private float m_EyeHeight;
        private bool m_Initialized;
        private bool m_DeathCam;
        private static readonly Vector3 s_DeathCamOffset = new Vector3(0f, 3.4f, -3.6f);

        public Camera Camera => m_Camera;
        public float Yaw => m_Yaw + m_RecoilYaw;
        public float Pitch => Mathf.Clamp(m_Pitch + m_RecoilPitch, m_Settings != null ? m_Settings.minPitch : -85f, m_Settings != null ? m_Settings.maxPitch : 85f);
        public Quaternion ViewRotation => Quaternion.Euler(-Pitch, Yaw, 0f);
        public Vector3 Forward => ViewRotation * Vector3.forward;
        public Vector3 Position => m_Camera != null ? m_Camera.transform.position : transform.position;
        public float BaseFieldOfView => GameSettings.FieldOfView;
        public bool IsActive => m_Camera != null && m_Camera.enabled;

        private void Awake()
        {
            if (m_Settings == null && GameConfig.Instance != null)
            {
                m_Settings = GameConfig.Instance.cameraSettings;
            }

            if (m_Settings == null)
            {
                m_Settings = ScriptableObject.CreateInstance<CameraSettings>();
            }

            if (m_Camera == null)
            {
                m_Camera = GetComponentInChildren<Camera>(true);
            }

            if (m_EffectsTransform == null && m_Camera != null)
            {
                m_EffectsTransform = m_Camera.transform;
            }
        }

        public void Initialize(PlayerController motor, Transform yawTransform, float yaw, float pitch)
        {
            m_Motor = motor;
            m_YawTransform = yawTransform != null ? yawTransform : m_YawTransform;
            SetViewAngles(yaw, pitch);
            m_EyeHeight = motor != null ? motor.EyeHeight : transform.localPosition.y;
            m_CurrentFov = BaseFieldOfView;
            if (m_Camera != null)
            {
                m_Camera.nearClipPlane = m_Settings.nearClipPlane;
                m_Camera.farClipPlane = m_Settings.farClipPlane;
                m_Camera.fieldOfView = m_CurrentFov;
            }

            m_Initialized = true;
        }

        public void SetCameraEnabled(bool enabled)
        {
            if (m_Camera != null)
            {
                m_Camera.enabled = enabled;
                var listener = m_Camera.GetComponent<AudioListener>();
                if (listener != null)
                {
                    listener.enabled = enabled;
                }
            }
        }

        public void SetViewAngles(float yaw, float pitch)
        {
            m_TargetYaw = m_Yaw = yaw;
            m_TargetPitch = m_Pitch = Mathf.Clamp(pitch, m_Settings.minPitch, m_Settings.maxPitch);
            m_RecoilPitch = 0f;
            m_RecoilYaw = 0f;
            ApplyRotation();
        }

        /// <summary>Consumes look input for this frame. Call once per rendered frame for the local player only.</summary>
        public void ProcessLook(PlayerInputReader input, float deltaTime)
        {
            if (!m_Initialized || input == null)
            {
                return;
            }

            float sensitivity = GameSettings.MouseSensitivity;
            if (m_AimFraction > 0.01f)
            {
                // Scale sensitivity with zoom so tracking feels identical at every FOV.
                float zoomRatio = Mathf.Tan(m_CurrentFov * 0.5f * Mathf.Deg2Rad) / Mathf.Tan(BaseFieldOfView * 0.5f * Mathf.Deg2Rad);
                sensitivity *= Mathf.Lerp(1f, zoomRatio * GameSettings.AdsSensitivityMultiplier / 0.75f, m_AimFraction);
            }

            Vector2 mouse = input.MouseDelta * (m_Settings.mouseDegreesPerCount * sensitivity);
            Vector2 stick = input.GamepadLook;
            float stickMagnitude = stick.magnitude;
            if (stickMagnitude > 0.0001f)
            {
                float curved = Mathf.Pow(Mathf.Clamp01(stickMagnitude), m_Settings.gamepadResponseCurve);
                stick = stick / stickMagnitude * curved * (m_Settings.gamepadDegreesPerSecond * sensitivity * deltaTime);
            }

            Vector2 delta = mouse + stick;
            if (GameSettings.InvertY)
            {
                delta.y = -delta.y;
            }

            m_TargetYaw += delta.x;
            m_TargetPitch = Mathf.Clamp(m_TargetPitch + delta.y, m_Settings.minPitch, m_Settings.maxPitch);

            float smoothing = GameSettings.LookSmoothing;
            if (smoothing <= 0.0001f)
            {
                m_Yaw = m_TargetYaw;
                m_Pitch = m_TargetPitch;
            }
            else
            {
                float t = 1f - Mathf.Exp(-deltaTime / smoothing);
                m_Yaw = Mathf.Lerp(m_Yaw, m_TargetYaw, t);
                m_Pitch = Mathf.Lerp(m_Pitch, m_TargetPitch, t);
            }

            // Keep values bounded without visible snapping.
            if (Mathf.Abs(m_TargetYaw) > 3600f)
            {
                float wrap = Mathf.Floor(m_TargetYaw / 360f) * 360f;
                m_TargetYaw -= wrap;
                m_Yaw -= wrap;
            }

            RecoverRecoil(deltaTime);
            ApplyRotation();
        }

        /// <summary>Adds recoil. A fraction recovers automatically, the rest becomes permanent climb the player must pull down.</summary>
        public void AddRecoil(float pitchUp, float yaw, float recoverableFraction, float recoverySpeed)
        {
            recoverableFraction = Mathf.Clamp01(recoverableFraction);
            m_RecoilPitch += pitchUp * recoverableFraction;
            m_RecoilYaw += yaw * recoverableFraction;
            m_TargetPitch = Mathf.Clamp(m_TargetPitch + pitchUp * (1f - recoverableFraction), m_Settings.minPitch, m_Settings.maxPitch);
            m_Pitch = Mathf.Clamp(m_Pitch + pitchUp * (1f - recoverableFraction), m_Settings.minPitch, m_Settings.maxPitch);
            m_TargetYaw += yaw * (1f - recoverableFraction);
            m_Yaw += yaw * (1f - recoverableFraction);
            m_RecoilRecoverySpeed = Mathf.Max(0.1f, recoverySpeed);
            m_LastRecoilTime = Time.time;
        }

        private void RecoverRecoil(float deltaTime)
        {
            if (Time.time - m_LastRecoilTime < 0.08f)
            {
                return;
            }

            float step = m_RecoilRecoverySpeed * deltaTime;
            m_RecoilPitch = Mathf.MoveTowards(m_RecoilPitch, 0f, step);
            m_RecoilYaw = Mathf.MoveTowards(m_RecoilYaw, 0f, step);
        }

        public void SetAimState(float aimFraction, float aimFieldOfView)
        {
            m_AimFraction = Mathf.Clamp01(aimFraction);
            m_AimFov = aimFieldOfView;
        }

        public void OnLanded(float impactSpeed)
        {
            float dip = Mathf.Min(m_Settings.maxLandingDip, impactSpeed * m_Settings.landingDipPerMeterPerSecond);
            m_LandingVelocity -= dip * 12f;
        }

        /// <summary>Third-person spectator view of the own body while dead.</summary>
        public void SetDeathCam(bool active)
        {
            m_DeathCam = active;
            if (active)
            {
                SetViewAngles(Yaw, -40f);
            }
            else
            {
                transform.localPosition = new Vector3(0f, m_Motor != null ? m_Motor.EyeHeight : transform.localPosition.y, 0f);
                m_EyeHeight = transform.localPosition.y;
            }
        }

        public void Shake(float amount)
        {
            m_Shake = Mathf.Min(2f, m_Shake + amount * m_Settings.damageShakeAmount);
        }

        private void ApplyRotation()
        {
            if (m_YawTransform != null)
            {
                m_YawTransform.rotation = Quaternion.Euler(0f, Yaw, 0f);
            }

            transform.localRotation = Quaternion.Euler(-Pitch, 0f, 0f);
        }

        private void LateUpdate()
        {
            if (!m_Initialized || m_Camera == null || !m_Camera.enabled)
            {
                return;
            }

            float deltaTime = Time.deltaTime;

            if (m_DeathCam)
            {
                transform.localPosition = Vector3.Lerp(transform.localPosition, s_DeathCamOffset, 1f - Mathf.Exp(-4f * deltaTime));
            }
            else if (m_Motor != null)
            {
                // Eye height follows crouch smoothly.
                m_EyeHeight = Mathf.Lerp(m_EyeHeight, m_Motor.EyeHeight, 1f - Mathf.Exp(-m_Settings.eyeHeightSmoothing * deltaTime));
                Vector3 local = transform.localPosition;
                local.y = m_EyeHeight;
                transform.localPosition = local;
            }

            // Field of view: base -> sprint boost -> ADS zoom.
            float targetFov = BaseFieldOfView;
            if (m_Motor != null && m_Motor.IsSprinting && m_Motor.HorizontalSpeed > 1f)
            {
                targetFov += m_Settings.sprintFovBoost;
            }

            targetFov = Mathf.Lerp(targetFov, m_AimFov, m_AimFraction);
            m_CurrentFov = Mathf.Lerp(m_CurrentFov, targetFov, 1f - Mathf.Exp(-m_Settings.fovLerpSpeed * deltaTime));
            m_Camera.fieldOfView = m_CurrentFov;

            // Head bob.
            Vector3 bob = Vector3.zero;
            if (m_Motor != null && m_Motor.IsGrounded)
            {
                float speed = m_Motor.HorizontalSpeed;
                float speed01 = Mathf.Clamp01(speed / Mathf.Max(0.1f, m_Motor.Settings.sprintSpeed));
                float multiplier = (m_Motor.IsSprinting ? m_Settings.sprintBobMultiplier : 1f) * Mathf.Lerp(1f, m_Settings.aimBobMultiplier, m_AimFraction);
                m_BobPhase += deltaTime * m_Settings.bobFrequency * Mathf.Lerp(0.6f, 1.6f, speed01) * Mathf.PI * 2f;
                float amplitude = m_Settings.bobAmplitude * speed01 * multiplier;
                bob = new Vector3(Mathf.Cos(m_BobPhase * 0.5f) * amplitude * 0.6f, Mathf.Abs(Mathf.Sin(m_BobPhase * 0.5f)) * amplitude, 0f);
            }

            // Landing dip spring.
            const float stiffness = 120f;
            const float damping = 14f;
            m_LandingVelocity += (-m_LandingOffset * stiffness - m_LandingVelocity * damping) * deltaTime;
            m_LandingOffset += m_LandingVelocity * deltaTime;

            // Damage shake.
            Quaternion shakeRotation = Quaternion.identity;
            if (m_Shake > 0.001f)
            {
                float time = Time.time * 35f;
                shakeRotation = Quaternion.Euler(
                    (Mathf.PerlinNoise(time, 0.1f) - 0.5f) * m_Shake * 4f,
                    (Mathf.PerlinNoise(0.3f, time) - 0.5f) * m_Shake * 4f,
                    (Mathf.PerlinNoise(time, time) - 0.5f) * m_Shake * 2f);
                m_Shake = Mathf.MoveTowards(m_Shake, 0f, m_Settings.shakeDecay * deltaTime);
            }

            if (m_EffectsTransform != null && m_EffectsTransform != transform)
            {
                m_EffectsTransform.localPosition = bob + new Vector3(0f, m_LandingOffset, 0f);
                m_EffectsTransform.localRotation = shakeRotation;
            }
        }
    }
}
