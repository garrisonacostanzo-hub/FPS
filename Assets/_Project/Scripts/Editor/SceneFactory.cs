using System.Collections.Generic;
using FPS.Data;
using FPS.Networking;
using FPS.UI;
using FPS.World;
using Unity.AI.Navigation;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace FPS.EditorTools
{
    /// <summary>Creates the Bootstrap, MainMenu and Battlefield scenes and registers them in the build settings.</summary>
    public static class SceneFactory
    {
        public const string BootstrapPath = EditorUtil.SceneFolder + "/Bootstrap.unity";
        public const string MainMenuPath = EditorUtil.SceneFolder + "/MainMenu.unity";
        public const string BattlefieldPath = EditorUtil.SceneFolder + "/Battlefield.unity";

        public static void BuildAll(GameConfig config, bool bakeNavMesh, bool bakeOcclusion)
        {
            BuildBootstrap(config);
            BuildMainMenu(config);
            BuildBattlefield(config, bakeNavMesh, bakeOcclusion);
            RegisterBuildScenes();
        }

        public static void RegisterBuildScenes()
        {
            EditorBuildSettings.scenes = new[]
            {
                new EditorBuildSettingsScene(BootstrapPath, true),
                new EditorBuildSettingsScene(MainMenuPath, true),
                new EditorBuildSettingsScene(BattlefieldPath, true)
            };
        }

        // ------------------------------------------------------------------------------------------------
        // Bootstrap: persistent NetworkManager
        // ------------------------------------------------------------------------------------------------

        public static void BuildBootstrap(GameConfig config)
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var networkObject = new GameObject("NetworkManager");
            var transport = networkObject.AddComponent<UnityTransport>();
            var manager = networkObject.AddComponent<NetworkManager>();
            if (manager.NetworkConfig == null)
            {
                manager.NetworkConfig = new NetworkConfig();
            }

            NetworkConfig netConfig = manager.NetworkConfig;
            netConfig.NetworkTransport = transport;
            netConfig.PlayerPrefab = null;
            netConfig.ConnectionApproval = true;
            netConfig.EnableSceneManagement = true;
            netConfig.ForceSamePrefabs = true;
            netConfig.TickRate = (uint)(config.matchSettings != null ? config.matchSettings.networkTickRate : 60);
            netConfig.Prefabs.NetworkPrefabsLists = new List<NetworkPrefabsList> { PrefabFactory.LoadNetworkPrefabsList() };
            transport.SetConnectionData("127.0.0.1", 7777, "0.0.0.0");
            networkObject.AddComponent<NetworkManagerSetup>();
            EditorUtility.SetDirty(manager);
            EditorUtility.SetDirty(transport);

            var cameraObject = new GameObject("BootCamera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Color.black;
            camera.depth = -10f;

            EditorSceneManager.SaveScene(scene, BootstrapPath);
        }

        // ------------------------------------------------------------------------------------------------
        // Main menu
        // ------------------------------------------------------------------------------------------------

        public static void BuildMainMenu(GameConfig config)
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            ApplyEnvironment(0.62f, out Light sun);

            var backdrop = new GameObject("Backdrop").transform;
            Place("Floor_4x4", new Vector3(0f, -0.2f, 0f), 0f, backdrop, new Vector3(16f, 1f, 16f));
            Place("Container_6m", new Vector3(-6f, 0f, 4f), 20f, backdrop);
            Place("Container_6m", new Vector3(-6f, 2.6f, 4f), 26f, backdrop);
            Place("Crate_Stack", new Vector3(5f, 0f, 3f), -15f, backdrop);
            Place("Barrier_Jersey", new Vector3(1f, 0f, -4f), 80f, backdrop);
            Place("Wall_Window_4m", new Vector3(9f, 0f, -2f), 60f, backdrop);
            Place("Wall_4m", new Vector3(11f, 0f, 1.5f), 60f, backdrop);
            Place("Sandbags", new Vector3(-2f, 0f, -7f), 10f, backdrop);
            Place("Rock_Large", new Vector3(-12f, -0.6f, -6f), 0f, backdrop, Vector3.one * 3f);
            Place("LampPost", new Vector3(3f, 0f, 8f), 200f, backdrop);

            var cameraObject = new GameObject("MenuCamera") { tag = "MainCamera" };
            cameraObject.AddComponent<Camera>().fieldOfView = 55f;
            cameraObject.AddComponent<AudioListener>();
            cameraObject.AddComponent<SceneCameraDirector>().Configure(new Vector3(0f, 1.5f, 0f), 20f, 6f);

            var menu = new GameObject("MainMenu");
            EditorUtil.SetSerialized(menu.AddComponent<MainMenuUI>(), "m_Theme", config.hudTheme);
            CreateEventSystem();
            EditorSceneManager.SaveScene(scene, MainMenuPath);
        }

        // ------------------------------------------------------------------------------------------------
        // Battlefield
        // ------------------------------------------------------------------------------------------------

        public static void BuildBattlefield(GameConfig config, bool bakeNavMesh, bool bakeOcclusion)
        {
            MapBlueprint blueprint = AssetFactory.GetBlueprint();
            if (blueprint == null)
            {
                Debug.LogError("[FPS Builder] Map blueprint missing. Run 'Create Data Assets' first.");
                return;
            }

            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EditorSceneManager.SaveScene(scene, BattlefieldPath);

            ApplyEnvironment(0.42f, out Light _);
            AssignLightingSettings(scene);

            var map = new GameObject("Map").transform;
            var generator = new MapGenerator(blueprint);
            generator.Generate(map);

            var systems = new GameObject("Systems").transform;
            new GameObject("BattlefieldDirector").AddComponent<BattlefieldDirector>().transform.SetParent(systems, false);

            var hud = new GameObject("HUD");
            hud.transform.SetParent(systems, false);
            EditorUtil.SetSerialized(hud.AddComponent<HUDController>(), "m_Theme", config.hudTheme);
            var pause = new GameObject("PauseMenu");
            pause.transform.SetParent(systems, false);
            EditorUtil.SetSerialized(pause.AddComponent<PauseMenuUI>(), "m_Theme", config.hudTheme);
            CreateEventSystem().transform.SetParent(systems, false);
            new GameObject("Performance").AddComponent<PerformanceProfile>().transform.SetParent(systems, false);

            var sceneCamera = new GameObject("SceneCamera") { tag = "MainCamera" };
            sceneCamera.transform.SetParent(systems, false);
            var camera = sceneCamera.AddComponent<Camera>();
            camera.farClipPlane = 2000f;
            camera.useOcclusionCulling = true;
            sceneCamera.AddComponent<AudioListener>();
            sceneCamera.AddComponent<SceneCameraDirector>().Configure(new Vector3(0f, blueprint.baseHeight, 0f), blueprint.playableSize * 0.35f, 90f);

            var navigation = new GameObject("NavMesh");
            navigation.transform.SetParent(systems, false);
            var surface = navigation.AddComponent<NavMeshSurface>();
            surface.collectObjects = CollectObjects.Volume;
            surface.center = new Vector3(0f, blueprint.baseHeight + 40f, 0f);
            surface.size = new Vector3(blueprint.playableSize + 30f, 160f, blueprint.playableSize + 30f);
            surface.layerMask = (1 << FPS.Core.GameLayers.Default) | (1 << FPS.Core.GameLayers.Environment) | (1 << FPS.Core.GameLayers.Props);
            surface.useGeometry = UnityEngine.AI.NavMeshCollectGeometry.PhysicsColliders;
            surface.overrideVoxelSize = true;
            surface.voxelSize = 0.16f;
            surface.minRegionArea = 3f;
            navigation.AddComponent<RuntimeNavMeshGuard>();

            var occlusion = new GameObject("OcclusionArea");
            occlusion.transform.SetParent(systems, false);
            var area = occlusion.AddComponent<OcclusionArea>();
            area.center = new Vector3(0f, blueprint.baseHeight + 25f, 0f);
            area.size = new Vector3(blueprint.playableSize + 20f, 70f, blueprint.playableSize + 20f);
            ConfigureOcclusionParameters();

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, BattlefieldPath);

            if (bakeNavMesh)
            {
                BakeNavMesh(surface, generator.CoverPointsRoot);
            }

            if (bakeOcclusion)
            {
                BakeOcclusion();
            }

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, BattlefieldPath);
        }

        public static void BakeNavMesh(NavMeshSurface surface, Transform coverPoints)
        {
            EditorUtil.Progress("FPS Builder", "Baking NavMesh (this can take a minute)...", 0.85f);
            Physics.SyncTransforms();
            surface.BuildNavMesh();
            if (surface.navMeshData != null)
            {
                string folder = EditorUtil.SceneFolder + "/Battlefield";
                EditorUtil.EnsureFolder(folder);
                string path = folder + "/NavMesh-Battlefield.asset";
                AssetDatabase.DeleteAsset(path);
                AssetDatabase.CreateAsset(surface.navMeshData, path);
                EditorUtility.SetDirty(surface);
            }

            if (coverPoints != null)
            {
                int removed = MapGenerator.ValidateCoverPoints(coverPoints);
                Debug.Log($"[FPS Builder] NavMesh baked. Cover points: {coverPoints.childCount} valid, {removed} removed.");
            }

            EditorUtil.ClearProgress();
        }

        public static void ConfigureOcclusionParameters()
        {
            StaticOcclusionCulling.smallestOccluder = 4f;
            StaticOcclusionCulling.smallestHole = 0.3f;
            StaticOcclusionCulling.backfaceThreshold = 100f;
        }

        public static void BakeOcclusion()
        {
            ConfigureOcclusionParameters();
            EditorUtil.Progress("FPS Builder", "Baking occlusion culling (can take several minutes)...", 0.95f);
            bool success = StaticOcclusionCulling.Compute();
            EditorUtil.ClearProgress();
            Debug.Log("[FPS Builder] Occlusion culling bake " + (success ? "succeeded." : "failed."));
        }

        private static void AssignLightingSettings(Scene scene)
        {
            string path = EditorUtil.SceneFolder + "/Battlefield/Battlefield.lighting";
            EditorUtil.EnsureFolder(EditorUtil.SceneFolder + "/Battlefield");
            var settings = AssetDatabase.LoadAssetAtPath<LightingSettings>(path);
            if (settings == null)
            {
                settings = new LightingSettings { name = "Battlefield" };
                AssetDatabase.CreateAsset(settings, path);
            }

            // Fully dynamic lighting: no lightmaps to rebake when the map is regenerated.
            settings.bakedGI = false;
            settings.realtimeGI = false;
            EditorUtility.SetDirty(settings);
            Lightmapping.lightingSettings = settings;
        }

        private static void ApplyEnvironment(float timeOfDay, out Light sun)
        {
            var sunObject = new GameObject("Sun");
            sun = sunObject.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = 0.85f;
            sun.intensity = 1.3f;
            sunObject.transform.rotation = Quaternion.Euler(50f, -35f, 0f);

            Material skybox = AssetFactory.GetMaterial("Skybox_Procedural");
            if (skybox != null)
            {
                RenderSettings.skybox = skybox;
            }

            RenderSettings.sun = sun;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.defaultReflectionMode = DefaultReflectionMode.Skybox;
            sunObject.AddComponent<DynamicLightingController>().Configure(sun, timeOfDay, false);
        }

        private static GameObject CreateEventSystem()
        {
            return new GameObject("EventSystem", typeof(EventSystem), typeof(InputSystemUIInputModule));
        }

        private static void Place(string kit, Vector3 position, float yaw, Transform parent, Vector3? scale = null)
        {
            GameObject prefab = PrefabFactory.LoadKit(kit);
            if (prefab == null)
            {
                return;
            }

            var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, parent);
            instance.transform.SetPositionAndRotation(position, Quaternion.Euler(0f, yaw, 0f));
            if (scale.HasValue)
            {
                instance.transform.localScale = scale.Value;
            }
        }
    }
}
