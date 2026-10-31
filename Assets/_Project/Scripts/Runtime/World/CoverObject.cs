using UnityEngine;

namespace FPS.World
{
    /// <summary>
    /// Marks an environment piece as tactical cover. The editor tool "FPS > Regenerate Cover Points" (and the map
    /// builder) generates <see cref="AI.CoverPoint"/>s around every CoverObject from its collider bounds.
    /// </summary>
    public class CoverObject : MonoBehaviour
    {
        [SerializeField] private bool m_GenerateCoverPoints = true;
        [Tooltip("Spacing between generated cover points along each side (metres).")]
        [SerializeField, Min(0.8f)] private float m_PointSpacing = 1.7f;

        public bool GenerateCoverPoints => m_GenerateCoverPoints;
        public float PointSpacing => m_PointSpacing;
    }
}
