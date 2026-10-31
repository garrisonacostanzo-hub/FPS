using System.Collections;
using FPS.Data;
using FPS.World;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace FPS.Networking
{
    /// <summary>
    /// Scene-level entry point of the battlefield (a plain MonoBehaviour present in the scene for every peer).
    /// On the server it spawns the networked match objects (MatchManager, one CaptureZone per marker).
    /// If the scene is opened directly in the editor without a running session it bounces through the
    /// Bootstrap scene and starts a local host automatically, so "Play" always works.
    /// </summary>
    public class BattlefieldDirector : MonoBehaviour
    {
        [SerializeField] private bool m_AutoHostWhenStartedDirectly = true;

        private void Start()
        {
            NetworkManager network = NetworkManager.Singleton;
            GameConfig config = GameConfig.Instance;

            if (network == null || !network.IsListening)
            {
                if (m_AutoHostWhenStartedDirectly && config != null)
                {
                    Debug.Log("[FPS] Battlefield started without a session - starting a local host through the Bootstrap scene.");
                    NetworkManagerSetup.QuickHostRequested = true;
                    SceneManager.LoadScene(config.bootstrapScene);
                }

                return;
            }

            if (network.IsServer)
            {
                StartCoroutine(ServerSetup(network, config));
            }
        }

        private IEnumerator ServerSetup(NetworkManager network, GameConfig config)
        {
            // Let every scene object finish Awake/OnEnable (spawn points, markers, routes) first.
            yield return null;

            if (config == null)
            {
                yield break;
            }

            if (config.captureZonePrefab != null)
            {
                foreach (CaptureZoneMarker marker in CaptureZoneMarker.All)
                {
                    GameObject zoneObject = Instantiate(config.captureZonePrefab, marker.transform.position, marker.transform.rotation);
                    zoneObject.GetComponent<NetworkObject>().Spawn(true);
                    zoneObject.GetComponent<CaptureZone>().ServerConfigure(marker.Label, marker.DisplayName, marker.Radius);
                }
            }

            if (config.matchManagerPrefab != null && MatchManager.Instance == null)
            {
                GameObject managerObject = Instantiate(config.matchManagerPrefab);
                managerObject.GetComponent<NetworkObject>().Spawn(true);
            }
            else if (config.matchManagerPrefab == null)
            {
                Debug.LogError("[FPS] GameConfig.matchManagerPrefab is not assigned. Run 'FPS > Build Everything'.");
            }
        }
    }
}
