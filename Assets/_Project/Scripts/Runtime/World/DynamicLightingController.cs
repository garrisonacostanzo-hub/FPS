using UnityEngine;
using UnityEngine.Rendering;

namespace FPS.World
{
    /// <summary>
    /// Fully real-time lighting rig for large maps: optional time-of-day cycle driving the sun direction, colour and
    /// intensity, trilight ambient and fog, with throttled environment (ambient probe) updates. Works without any
    /// baked lightmaps so the map can be regenerated and iterated instantly.
    /// </summary>
    [ExecuteAlways]
    public class DynamicLightingController : MonoBehaviour
    {
        [SerializeField] private Light m_Sun;
        [Tooltip("0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.")]
        [SerializeField, Range(0f, 1f)] private float m_TimeOfDay = 0.42f;
        [SerializeField] private bool m_CycleEnabled;
        [Tooltip("Real-time minutes for a full 24h cycle.")]
        [SerializeField, Min(0.5f)] private float m_CycleMinutes = 20f;
        [SerializeField] private float m_SunAzimuth = -35f;
        [SerializeField] private Gradient m_SunColor = DefaultSunGradient();
        [SerializeField] private AnimationCurve m_SunIntensity = new AnimationCurve(
            new Keyframe(0.2f, 0f), new Keyframe(0.27f, 0.5f), new Keyframe(0.5f, 1.35f), new Keyframe(0.73f, 0.5f), new Keyframe(0.8f, 0f));
        [SerializeField] private Color m_SkyAmbient = new Color(0.52f, 0.62f, 0.78f);
        [SerializeField] private Color m_EquatorAmbient = new Color(0.42f, 0.44f, 0.46f);
        [SerializeField] private Color m_GroundAmbient = new Color(0.22f, 0.2f, 0.18f);
        [SerializeField] private Color m_NightAmbient = new Color(0.05f, 0.06f, 0.1f);
        [SerializeField] private bool m_Fog = true;
        [SerializeField] private Color m_FogColor = new Color(0.66f, 0.72f, 0.8f);
        [SerializeField, Range(0f, 0.02f)] private float m_FogDensity = 0.0022f;
        [SerializeField, Min(0.1f)] private float m_EnvironmentUpdateInterval = 2f;

        private float m_NextEnvironmentUpdate;

        public float TimeOfDay
        {
            get => m_TimeOfDay;
            set => m_TimeOfDay = Mathf.Repeat(value, 1f);
        }

        public void Configure(Light sun, float timeOfDay, bool cycle)
        {
            m_Sun = sun;
            m_TimeOfDay = timeOfDay;
            m_CycleEnabled = cycle;
            Apply(true);
        }

        private static Gradient DefaultSunGradient()
        {
            var gradient = new Gradient();
            gradient.SetKeys(
                new[]
                {
                    new GradientColorKey(new Color(1f, 0.45f, 0.25f), 0.24f),
                    new GradientColorKey(new Color(1f, 0.85f, 0.7f), 0.32f),
                    new GradientColorKey(new Color(1f, 0.97f, 0.92f), 0.5f),
                    new GradientColorKey(new Color(1f, 0.8f, 0.6f), 0.68f),
                    new GradientColorKey(new Color(1f, 0.4f, 0.22f), 0.76f)
                },
                new[] { new GradientAlphaKey(1f, 0f), new GradientAlphaKey(1f, 1f) });
            return gradient;
        }

        private void OnEnable()
        {
            Apply(true);
        }

        private void OnValidate()
        {
            Apply(true);
        }

        private void Update()
        {
            if (!Application.isPlaying)
            {
                return; // Edit mode: applied from OnEnable/OnValidate only (avoids dirtying the scene every frame).
            }

            if (m_CycleEnabled)
            {
                m_TimeOfDay = Mathf.Repeat(m_TimeOfDay + Time.deltaTime / (m_CycleMinutes * 60f), 1f);
                Apply(false);
            }
        }

        private void Apply(bool forceEnvironment)
        {
            if (m_Sun == null)
            {
                return;
            }

            float sunAngle = (m_TimeOfDay - 0.25f) * 360f;
            m_Sun.transform.rotation = Quaternion.Euler(sunAngle, m_SunAzimuth, 0f);
            float intensity = Mathf.Max(0f, m_SunIntensity.Evaluate(m_TimeOfDay));
            m_Sun.intensity = intensity;
            m_Sun.color = m_SunColor.Evaluate(m_TimeOfDay);
            m_Sun.shadows = intensity > 0.05f ? LightShadows.Soft : LightShadows.None;

            float day = Mathf.Clamp01(intensity / 1.35f);
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Color.Lerp(m_NightAmbient, m_SkyAmbient, day);
            RenderSettings.ambientEquatorColor = Color.Lerp(m_NightAmbient, m_EquatorAmbient, day);
            RenderSettings.ambientGroundColor = Color.Lerp(m_NightAmbient * 0.5f, m_GroundAmbient, day);
            RenderSettings.sun = m_Sun;
            RenderSettings.fog = m_Fog;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = m_FogDensity;
            RenderSettings.fogColor = Color.Lerp(m_NightAmbient, m_FogColor, day);

            if (forceEnvironment || (Application.isPlaying && Time.unscaledTime >= m_NextEnvironmentUpdate && m_CycleEnabled))
            {
                m_NextEnvironmentUpdate = Time.unscaledTime + m_EnvironmentUpdateInterval;
                DynamicGI.UpdateEnvironment();
            }
        }
    }
}
