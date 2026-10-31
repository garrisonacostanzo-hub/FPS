using System.Collections.Generic;
using UnityEngine;

namespace FPS.World
{
    /// <summary>
    /// Scene marker for an objective capture area. Markers are plain scene objects; when a match starts the
    /// server spawns a networked CaptureZone at each marker (avoids in-scene NetworkObject hash issues).
    /// </summary>
    public class CaptureZoneMarker : MonoBehaviour
    {
        [SerializeField] private string m_Label = "A";
        [SerializeField] private string m_DisplayName = "Objective A";
        [SerializeField, Min(2f)] private float m_Radius = 9f;

        private static readonly List<CaptureZoneMarker> s_All = new List<CaptureZoneMarker>(8);

        public static IReadOnlyList<CaptureZoneMarker> All => s_All;

        private void OnEnable()
        {
            if (!s_All.Contains(this))
            {
                s_All.Add(this);
            }
        }

        private void OnDisable()
        {
            s_All.Remove(this);
        }

        public string Label => m_Label;
        public string DisplayName => m_DisplayName;
        public float Radius => m_Radius;

        public void Configure(string label, string displayName, float radius)
        {
            m_Label = label;
            m_DisplayName = displayName;
            m_Radius = radius;
        }

        private void OnDrawGizmos()
        {
            Gizmos.color = new Color(1f, 0.85f, 0.2f, 0.9f);
            const int segments = 40;
            Vector3 previous = transform.position + new Vector3(m_Radius, 0.1f, 0f);
            for (int i = 1; i <= segments; i++)
            {
                float angle = i / (float)segments * Mathf.PI * 2f;
                Vector3 next = transform.position + new Vector3(Mathf.Cos(angle) * m_Radius, 0.1f, Mathf.Sin(angle) * m_Radius);
                Gizmos.DrawLine(previous, next);
                previous = next;
            }
        }
    }
}
