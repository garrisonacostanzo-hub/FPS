using System.Collections.Generic;
using UnityEngine;

namespace FPS.Data
{
    /// <summary>
    /// Root configuration asset. Lives at Resources/FPS/GameConfig so any system can locate it without scene wiring.
    /// The editor builder creates and fills it automatically.
    /// </summary>
    [CreateAssetMenu(menuName = "FPS/Game Config", fileName = "GameConfig", order = 100)]
    public class GameConfig : ScriptableObject
    {
        public const string ResourcesPath = "FPS/GameConfig";

        [Header("Scenes (must be in Build Settings)")]
        public string bootstrapScene = "Bootstrap";
        public string mainMenuScene = "MainMenu";
        public string battlefieldScene = "Battlefield";

        [Header("Rules & tuning")]
        public MatchSettings matchSettings;
        public PlayerMovementSettings movementSettings;
        public CameraSettings cameraSettings;
        public HUDTheme hudTheme;

        [Header("Weapons")]
        [Tooltip("Every weapon that can exist in a match. WeaponData.weaponId must be unique.")]
        public List<WeaponData> weapons = new List<WeaponData>();
        public List<WeaponData> playerLoadout = new List<WeaponData>();
        public List<WeaponData> botLoadoutPool = new List<WeaponData>();

        [Header("Bots")]
        public List<BotDifficultyProfile> difficulties = new List<BotDifficultyProfile>();
        [Tooltip("Index into the difficulties list used when the host does not override it.")]
        public int defaultDifficultyIndex = 1;
        public string[] botNames =
        {
            "Viper", "Ghost", "Raven", "Hawk", "Nomad", "Sable", "Onyx", "Talon", "Jinx", "Atlas", "Bishop", "Cobalt",
            "Drift", "Ember", "Flint", "Gunner", "Havoc", "Ion", "Jackal", "Kodiak", "Lynx", "Mako", "Nova", "Orbit",
            "Pike", "Quill", "Rogue", "Saber", "Torque", "Umbra", "Vandal", "Wraith"
        };

        [Header("Runtime material templates (guarantee shader inclusion in player builds)")]
        public Material litMaterialTemplate;
        public Material unlitMaterialTemplate;
        public Material transparentMaterialTemplate;

        [Header("Network prefabs")]
        public GameObject playerPrefab;
        public GameObject botPrefab;
        public GameObject matchManagerPrefab;
        public GameObject captureZonePrefab;

        private static GameConfig s_Instance;

        public static GameConfig Instance
        {
            get
            {
                if (s_Instance == null)
                {
                    s_Instance = Resources.Load<GameConfig>(ResourcesPath);
                    if (s_Instance == null)
                    {
                        Debug.LogError("[FPS] GameConfig not found at Resources/" + ResourcesPath + ". Run 'FPS > Build Everything' in the editor.");
                    }
                }

                return s_Instance;
            }
        }

        public WeaponData FindWeapon(int weaponId)
        {
            for (int i = 0; i < weapons.Count; i++)
            {
                if (weapons[i] != null && weapons[i].weaponId == weaponId)
                {
                    return weapons[i];
                }
            }

            return null;
        }

        public BotDifficultyProfile GetDifficulty(int index)
        {
            if (difficulties == null || difficulties.Count == 0)
            {
                return null;
            }

            return difficulties[Mathf.Clamp(index, 0, difficulties.Count - 1)];
        }

        public IEnumerable<GameObject> EnumerateNetworkPrefabs()
        {
            if (playerPrefab != null) yield return playerPrefab;
            if (botPrefab != null) yield return botPrefab;
            if (matchManagerPrefab != null) yield return matchManagerPrefab;
            if (captureZonePrefab != null) yield return captureZonePrefab;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            s_Instance = null;
        }
    }
}
