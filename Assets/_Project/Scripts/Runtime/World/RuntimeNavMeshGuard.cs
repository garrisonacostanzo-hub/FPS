using Unity.AI.Navigation;
using UnityEngine;

namespace FPS.World
{
    /// <summary>
    /// Safety net for navigation data: if the NavMeshSurface has no baked data (e.g. the scene was edited and not
    /// re-baked) it builds the NavMesh at runtime before bots spawn. Baking in the editor remains the recommended path.
    /// </summary>
    [DefaultExecutionOrder(-500)]
    [RequireComponent(typeof(NavMeshSurface))]
    public class RuntimeNavMeshGuard : MonoBehaviour
    {
        [SerializeField] private bool m_BuildIfMissing = true;

        private void Awake()
        {
            var surface = GetComponent<NavMeshSurface>();
            if (m_BuildIfMissing && surface.navMeshData == null)
            {
                float start = Time.realtimeSinceStartup;
                surface.BuildNavMesh();
                Debug.LogWarning($"[FPS] NavMesh was not baked; built at runtime in {(Time.realtimeSinceStartup - start) * 1000f:F0} ms. Bake it via 'FPS > Bake NavMesh' for faster loading.");
            }
        }
    }
}
