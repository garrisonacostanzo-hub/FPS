using UnityEngine;

namespace FPS.Data
{
    [CreateAssetMenu(menuName = "FPS/Camera Settings", fileName = "CameraSettings", order = 21)]
    public class CameraSettings : ScriptableObject
    {
        [Header("Look")]
        [Tooltip("Degrees per mouse count, multiplied by the user's sensitivity setting.")]
        [Min(0.001f)] public float mouseDegreesPerCount = 0.085f;
        [Tooltip("Degrees per second at full stick deflection.")]
        [Min(1f)] public float gamepadDegreesPerSecond = 220f;
        [Range(0.5f, 3f)] public float gamepadResponseCurve = 1.6f;
        [Range(-89f, 0f)] public float minPitch = -85f;
        [Range(0f, 89f)] public float maxPitch = 85f;

        [Header("Field of view")]
        [Min(0f)] public float sprintFovBoost = 6f;
        [Min(0.1f)] public float fovLerpSpeed = 10f;
        [Min(0.01f)] public float nearClipPlane = 0.03f;
        [Min(10f)] public float farClipPlane = 1500f;

        [Header("Head bob")]
        [Min(0f)] public float bobAmplitude = 0.035f;
        [Min(0f)] public float bobFrequency = 1.8f;
        [Min(0f)] public float sprintBobMultiplier = 1.5f;
        [Range(0f, 1f)] public float aimBobMultiplier = 0.15f;

        [Header("Impacts")]
        [Min(0f)] public float landingDipPerMeterPerSecond = 0.012f;
        [Min(0f)] public float maxLandingDip = 0.22f;
        [Min(0f)] public float damageShakeAmount = 0.6f;
        [Min(0.1f)] public float shakeDecay = 6f;

        [Header("Eye height smoothing")]
        [Min(0.1f)] public float eyeHeightSmoothing = 14f;
    }
}
