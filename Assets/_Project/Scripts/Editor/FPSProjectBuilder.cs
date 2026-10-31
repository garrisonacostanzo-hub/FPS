using System;
using System.Linq;
using FPS.Data;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace FPS.EditorTools
{
    /// <summary>
    /// One-click project generation ("FPS > Build Everything") and individual build steps.
    /// Headless: Unity -batchmode -quit -projectPath . -executeMethod FPS.EditorTools.FPSProjectBuilder.BuildAllBatch
    ///           (append -fpsBakeOcclusion to also bake occlusion culling, -fpsSkipNavMesh to skip the NavMesh bake).
    /// </summary>
    public static class FPSProjectBuilder
    {
        [MenuItem("FPS/Build Everything", priority = 0)]
        public static void BuildEverythingMenu()
        {
            if (!Application.isBatchMode && !EditorUtility.DisplayDialog("FPS Builder",
                    "Generate project settings, data assets, prefabs and all scenes (Bootstrap, MainMenu, Battlefield) and bake the NavMesh?\n\nExisting generated scenes will be overwritten.",
                    "Build", "Cancel"))
            {
                return;
            }

            BuildEverything(true, false);
        }

        public static bool BuildEverything(bool bakeNavMesh, bool bakeOcclusion)
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                return false;
            }

            DateTime start = DateTime.Now;
            try
            {
                EditorUtil.Progress("FPS Builder", "Configuring project settings", 0.02f);
                bool restartRequired = ProjectConfigurator.ConfigureAll();

                EditorUtil.Progress("FPS Builder", "Creating data assets", 0.05f);
                GameConfig config = AssetFactory.CreateAll();

                EditorUtil.Progress("FPS Builder", "Building prefabs", 0.1f);
                PrefabFactory.CreateAll(config);

                SceneFactory.BuildAll(config, bakeNavMesh, bakeOcclusion);
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh();

                EditorSceneManager.OpenScene(SceneFactory.BootstrapPath);
                double seconds = (DateTime.Now - start).TotalSeconds;
                string message = $"FPS project generated in {seconds:F0}s.\n\nOpen the Bootstrap scene and press Play (or press Play in Battlefield for an instant local host).";
                if (restartRequired)
                {
                    message += "\n\nIMPORTANT: the Input System backend was enabled - restart the editor before pressing Play.";
                }

                Debug.Log("[FPS Builder] " + message.Replace("\n\n", " "));
                if (!Application.isBatchMode)
                {
                    EditorUtility.DisplayDialog("FPS Builder", message, "OK");
                }

                return true;
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                return false;
            }
            finally
            {
                EditorUtil.ClearProgress();
            }
        }

        /// <summary>Entry point for -executeMethod (CI / command line).</summary>
        public static void BuildAllBatch()
        {
            string[] args = Environment.GetCommandLineArgs();
            bool bakeOcclusion = args.Contains("-fpsBakeOcclusion");
            bool bakeNavMesh = !args.Contains("-fpsSkipNavMesh");
            bool ok = BuildEverything(bakeNavMesh, bakeOcclusion);
            EditorApplication.Exit(ok ? 0 : 1);
        }

        [MenuItem("FPS/Steps/1. Configure Project Settings", priority = 20)]
        public static void ConfigureSettingsMenu()
        {
            bool restart = ProjectConfigurator.ConfigureAll();
            Debug.Log("[FPS Builder] Project settings configured." + (restart ? " Restart the editor to activate the Input System backend." : string.Empty));
        }

        [MenuItem("FPS/Steps/2. Create Data Assets", priority = 21)]
        public static void CreateAssetsMenu()
        {
            AssetFactory.CreateAll();
            Debug.Log("[FPS Builder] Data assets created.");
        }

        [MenuItem("FPS/Steps/3. Build Prefabs", priority = 22)]
        public static void BuildPrefabsMenu()
        {
            GameConfig config = AssetFactory.CreateAll();
            PrefabFactory.CreateAll(config);
            Debug.Log("[FPS Builder] Prefabs built.");
        }

        [MenuItem("FPS/Steps/4. Build Scenes (Bootstrap, MainMenu, Battlefield)", priority = 23)]
        public static void BuildScenesMenu()
        {
            GameConfig config = GameConfig.Instance != null ? GameConfig.Instance : AssetFactory.CreateAll();
            SceneFactory.BuildAll(config, true, false);
            EditorUtil.ClearProgress();
        }

        [MenuItem("FPS/Steps/5. Rebuild Battlefield Only", priority = 24)]
        public static void RebuildBattlefieldMenu()
        {
            GameConfig config = GameConfig.Instance != null ? GameConfig.Instance : AssetFactory.CreateAll();
            SceneFactory.BuildBattlefield(config, true, false);
            SceneFactory.RegisterBuildScenes();
            EditorUtil.ClearProgress();
        }

        [MenuItem("FPS/Bake NavMesh (open scene)", priority = 40)]
        public static void BakeNavMeshMenu()
        {
            NavMeshSurface surface = UnityEngine.Object.FindAnyObjectByType<NavMeshSurface>();
            if (surface == null)
            {
                Debug.LogError("[FPS Builder] No NavMeshSurface in the open scene.");
                return;
            }

            GameObject coverRoot = GameObject.Find("Map/Gameplay/CoverPoints");
            SceneFactory.BakeNavMesh(surface, coverRoot != null ? coverRoot.transform : null);
            EditorSceneManager.MarkSceneDirty(surface.gameObject.scene);
            EditorSceneManager.SaveOpenScenes();
        }

        [MenuItem("FPS/Bake Occlusion Culling (open scene)", priority = 41)]
        public static void BakeOcclusionMenu()
        {
            SceneFactory.BakeOcclusion();
            EditorSceneManager.SaveOpenScenes();
        }

        [MenuItem("FPS/Regenerate Cover Points (open scene)", priority = 42)]
        public static void RegenerateCoverPointsMenu()
        {
            GameObject coverRoot = GameObject.Find("Map/Gameplay/CoverPoints");
            if (coverRoot == null)
            {
                Debug.LogError("[FPS Builder] 'Map/Gameplay/CoverPoints' not found in the open scene.");
                return;
            }

            int created = MapGenerator.GenerateCoverPoints(coverRoot.transform);
            int removed = MapGenerator.ValidateCoverPoints(coverRoot.transform);
            Debug.Log($"[FPS Builder] Cover points regenerated: {created - removed} (removed {removed} invalid).");
            EditorSceneManager.MarkSceneDirty(coverRoot.scene);
        }

        [MenuItem("FPS/Open Scene/Bootstrap", priority = 60)]
        public static void OpenBootstrap() => OpenScene(SceneFactory.BootstrapPath);

        [MenuItem("FPS/Open Scene/Main Menu", priority = 61)]
        public static void OpenMainMenu() => OpenScene(SceneFactory.MainMenuPath);

        [MenuItem("FPS/Open Scene/Battlefield", priority = 62)]
        public static void OpenBattlefield() => OpenScene(SceneFactory.BattlefieldPath);

        private static void OpenScene(string path)
        {
            if (EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                EditorSceneManager.OpenScene(path);
            }
        }
    }
}
