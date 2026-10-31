using FPS.Core;
using UnityEngine;

namespace FPS.World
{
    /// <summary>
    /// Scene overview / spectator camera. Slowly orbits the battlefield while no local player is alive in the scene
    /// (loading, dedicated spectators) and hands over to the player camera once the local player spawns.
    /// </summary>
    [RequireComponent(typeof(Camera))]
    public class SceneCameraDirector : MonoBehaviour
    {
        [SerializeField] private Vector3 m_OrbitCentre = Vector3.zero;
        [SerializeField, Min(10f)] private float m_OrbitRadius = 160f;
        [SerializeField, Min(5f)] private float m_OrbitHeight = 90f;
        [SerializeField] private float m_OrbitSpeed = 3f;

        private Camera m_Camera;
        private AudioListener m_Listener;
        private float m_Angle;

        public void Configure(Vector3 centre, float radius, float height)
        {
            m_OrbitCentre = centre;
            m_OrbitRadius = radius;
            m_OrbitHeight = height;
        }

        private void Awake()
        {
            m_Camera = GetComponent<Camera>();
            m_Listener = GetComponent<AudioListener>();
        }

        private void OnEnable()
        {
            EventBus<LocalPlayerSpawnedEvent>.Subscribe(OnLocalPlayerSpawned);
            EventBus<LocalPlayerDespawnedEvent>.Subscribe(OnLocalPlayerDespawned);
        }

        private void OnDisable()
        {
            EventBus<LocalPlayerSpawnedEvent>.Unsubscribe(OnLocalPlayerSpawned);
            EventBus<LocalPlayerDespawnedEvent>.Unsubscribe(OnLocalPlayerDespawned);
        }

        private void OnLocalPlayerSpawned(LocalPlayerSpawnedEvent evt)
        {
            SetActive(false);
        }

        private void OnLocalPlayerDespawned(LocalPlayerDespawnedEvent evt)
        {
            SetActive(true);
        }

        private void SetActive(bool active)
        {
            if (m_Camera != null)
            {
                m_Camera.enabled = active;
            }

            if (m_Listener != null)
            {
                m_Listener.enabled = active;
            }
        }

        private void LateUpdate()
        {
            if (m_Camera == null || !m_Camera.enabled)
            {
                return;
            }

            m_Angle += m_OrbitSpeed * Time.deltaTime;
            Vector3 offset = Quaternion.Euler(0f, m_Angle, 0f) * new Vector3(0f, m_OrbitHeight, -m_OrbitRadius);
            transform.position = m_OrbitCentre + offset;
            transform.LookAt(m_OrbitCentre);
        }
    }
}
