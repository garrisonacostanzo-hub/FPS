using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace FPS.World
{
    /// <summary>
    /// Distance-based activation of purely visual map sectors using Unity's <see cref="CullingGroup"/> API
    /// (zero per-frame cost for unchanged sectors). Each child sector root holds decorative detail (no gameplay
    /// colliders); sectors beyond the streaming distance are deactivated on clients, cutting draw calls, culling and
    /// transform cost in large open environments. Never runs on dedicated servers.
    /// </summary>
    public class WorldSectorStreamer : MonoBehaviour
    {
        [SerializeField] private List<Transform> m_Sectors = new List<Transform>();
        [SerializeField, Min(1f)] private float m_SectorRadius = 70f;
        [Tooltip("Distance bands (m). Sectors inside the first band are active, beyond the last band they are disabled.")]
        [SerializeField] private float[] m_DistanceBands = { 220f, 420f };

        private CullingGroup m_Group;
        private BoundingSphere[] m_Spheres;
        private Camera m_TrackedCamera;

        public void Configure(List<Transform> sectors, float radius)
        {
            m_Sectors = sectors;
            m_SectorRadius = radius;
        }

        private void OnEnable()
        {
            if (SystemInfo.graphicsDeviceType == GraphicsDeviceType.Null || m_Sectors.Count == 0)
            {
                return;
            }

            m_Group = new CullingGroup();
            m_Spheres = new BoundingSphere[m_Sectors.Count];
            for (int i = 0; i < m_Sectors.Count; i++)
            {
                Vector3 centre = m_Sectors[i] != null ? m_Sectors[i].position : Vector3.zero;
                m_Spheres[i] = new BoundingSphere(centre, m_SectorRadius);
            }

            m_Group.SetBoundingSpheres(m_Spheres);
            m_Group.SetBoundingSphereCount(m_Spheres.Length);
            m_Group.SetBoundingDistances(m_DistanceBands);
            m_Group.onStateChanged = OnStateChanged;
        }

        private void OnDisable()
        {
            if (m_Group != null)
            {
                m_Group.Dispose();
                m_Group = null;
            }

            foreach (Transform sector in m_Sectors)
            {
                if (sector != null)
                {
                    sector.gameObject.SetActive(true);
                }
            }
        }

        private void LateUpdate()
        {
            if (m_Group == null)
            {
                return;
            }

            Camera current = Camera.main;
            if (current != null && current != m_TrackedCamera)
            {
                m_TrackedCamera = current;
                m_Group.targetCamera = current;
                m_Group.SetDistanceReferencePoint(current.transform);
                for (int i = 0; i < m_Sectors.Count; i++)
                {
                    ApplyBand(i, m_Group.GetDistance(i));
                }
            }
        }

        private void OnStateChanged(CullingGroupEvent evt)
        {
            if (evt.hasBecomeVisible || evt.hasBecomeInvisible || evt.currentDistance != evt.previousDistance)
            {
                ApplyBand(evt.index, evt.currentDistance);
            }
        }

        private void ApplyBand(int index, int band)
        {
            if (index < 0 || index >= m_Sectors.Count || m_Sectors[index] == null)
            {
                return;
            }

            bool active = band < m_DistanceBands.Length;
            if (m_Sectors[index].gameObject.activeSelf != active)
            {
                m_Sectors[index].gameObject.SetActive(active);
            }
        }
    }
}
