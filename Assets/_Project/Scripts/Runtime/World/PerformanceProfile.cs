using FPS.Core;
using UnityEngine;
using UnityEngine.Rendering;

namespace FPS.World
{
    /// <summary>
    /// Runtime performance settings for the large battlefield: per-layer camera cull distances (small props and
    /// cosmetic geometry disappear early), occlusion culling on, LOD bias, shadow distance, frame pacing and
    /// physics/transform sync settings. Applied to whichever camera becomes active.
    /// </summary>
    public class PerformanceProfile : MonoBehaviour
    {
        [SerializeField, Min(10f)] private float m_PropCullDistance = 160f;
        [SerializeField, Min(10f)] private float m_CosmeticCullDistance = 250f;
        [SerializeField, Min(10f)] private float m_EnvironmentCullDistance = 1400f;
        [SerializeField, Range(0.3f, 3f)] private float m_LodBias = 1.2f;
        [SerializeField, Min(10f)] private float m_ShadowDistance = 140f;
        [SerializeField] private int m_TargetFrameRate = 144;
        [SerializeField] private bool m_VSync;

        private Camera m_LastCamera;

        private void Awake()
        {
            QualitySettings.lodBias = m_LodBias;
            QualitySettings.shadowDistance = m_ShadowDistance;
            QualitySettings.vSyncCount = m_VSync ? 1 : 0;
            Application.targetFrameRate = SystemInfo.graphicsDeviceType == GraphicsDeviceType.Null ? 60 : m_TargetFrameRate;
            Physics.autoSyncTransforms = false;
            Physics.reuseCollisionCallbacks = true;
        }

        private void LateUpdate()
        {
            Camera current = Camera.main;
            if (current == null || current == m_LastCamera)
            {
                return;
            }

            m_LastCamera = current;
            Apply(current);
        }

        public void Apply(Camera targetCamera)
        {
            float[] distances = new float[32];
            distances[GameLayers.Props] = m_PropCullDistance;
            distances[GameLayers.ViewModel] = m_CosmeticCullDistance;
            distances[GameLayers.Environment] = m_EnvironmentCullDistance;
            targetCamera.layerCullDistances = distances;
            targetCamera.layerCullSpherical = true;
            targetCamera.useOcclusionCulling = true;
        }
    }
}
