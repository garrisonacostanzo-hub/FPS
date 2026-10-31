using System;
using System.Reflection;
using FPS.Core;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace FPS.EditorTools
{
    /// <summary>
    /// Project-wide settings required by the FPS framework: physics layers + collision matrix, Input System backend,
    /// URP pipeline asset, NavMesh agent dimensions, player settings for multiplayer and colour space.
    /// Everything is idempotent: running it again only fixes what is missing.
    /// </summary>
    public static class ProjectConfigurator
    {
        /// <summary>Returns true if an editor restart is required (input backend switch).</summary>
        public static bool ConfigureAll()
        {
            ConfigureLayers();
            ConfigurePhysics();
            ConfigurePlayerSettings();
            ConfigureRenderPipeline();
            ConfigureNavMeshAgent();
            bool restart = ConfigureInputBackend();
            AssetDatabase.SaveAssets();
            return restart;
        }

        public static void ConfigureLayers()
        {
            UnityEngine.Object[] assets = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TagManager.asset");
            if (assets == null || assets.Length == 0)
            {
                Debug.LogError("[FPS Builder] Could not load TagManager.asset");
                return;
            }

            var tagManager = new SerializedObject(assets[0]);
            SerializedProperty layers = tagManager.FindProperty("layers");
            for (int i = 0; i < GameLayers.LayerNames.Length; i++)
            {
                string name = GameLayers.LayerNames[i];
                if (string.IsNullOrEmpty(name) || layers == null || i >= layers.arraySize)
                {
                    continue;
                }

                SerializedProperty element = layers.GetArrayElementAtIndex(i);
                if (element.stringValue != name)
                {
                    if (!string.IsNullOrEmpty(element.stringValue))
                    {
                        Debug.LogWarning($"[FPS Builder] Layer {i} '{element.stringValue}' renamed to '{name}'.");
                    }

                    element.stringValue = name;
                }
            }

            tagManager.ApplyModifiedPropertiesWithoutUndo();
        }

        public static void ConfigurePhysics()
        {
            for (int layer = 0; layer < 32; layer++)
            {
                Physics.IgnoreLayerCollision(GameLayers.Hitbox, layer, true);
                Physics.IgnoreLayerCollision(GameLayers.ViewModel, layer, true);
                if (layer != GameLayers.Combatant)
                {
                    Physics.IgnoreLayerCollision(GameLayers.Trigger, layer, true);
                }
            }

            Physics.autoSyncTransforms = false;
        }

        public static void ConfigurePlayerSettings()
        {
            PlayerSettings.companyName = string.IsNullOrEmpty(PlayerSettings.companyName) || PlayerSettings.companyName == "DefaultCompany" ? "FPSFramework" : PlayerSettings.companyName;
            PlayerSettings.productName = "Project Vanguard";
            PlayerSettings.runInBackground = true; // Required so hosts/servers keep simulating when unfocused.
            PlayerSettings.visibleInBackground = true;
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.bundleVersion = "0.1.0";
        }

        /// <summary>
        /// Switches "Active Input Handling" to the Input System package (same mechanism the Input System package uses).
        /// </summary>
        public static bool ConfigureInputBackend()
        {
            UnityEngine.Object playerSettings = Unsupported.GetSerializedAssetInterfaceSingleton("PlayerSettings");
            if (playerSettings == null)
            {
                return false;
            }

            var serialized = new SerializedObject(playerSettings);
            SerializedProperty handler = serialized.FindProperty("activeInputHandler");
            if (handler == null)
            {
                Debug.LogWarning("[FPS Builder] 'activeInputHandler' not found. Set Project Settings > Player > Active Input Handling to 'Input System Package (New)' manually.");
                return false;
            }

            // 0 = Input Manager (old), 1 = Input System package (new), 2 = Both.
            if (handler.intValue == 1 || handler.intValue == 2)
            {
                return false;
            }

            handler.intValue = 1;
            serialized.ApplyModifiedPropertiesWithoutUndo();
            Debug.LogWarning("[FPS Builder] Active Input Handling switched to the Input System package. RESTART THE EDITOR for it to take effect.");
            return true;
        }

        /// <summary>Creates a URP asset + renderer if the project has no render pipeline assigned yet.</summary>
        public static void ConfigureRenderPipeline()
        {
            EditorUtil.EnsureFolder(EditorUtil.RenderingFolder);
            if (GraphicsSettings.defaultRenderPipeline is UniversalRenderPipelineAsset existing)
            {
                TuneUrpAsset(existing);
                return;
            }

            string assetPath = EditorUtil.RenderingFolder + "/FPS_URP.asset";
            string rendererPath = EditorUtil.RenderingFolder + "/FPS_URP_Renderer.asset";
            var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(assetPath);
            if (pipeline == null)
            {
                ScriptableRendererData renderer = AssetDatabase.LoadAssetAtPath<ScriptableRendererData>(rendererPath);
                if (renderer == null)
                {
                    renderer = CreateRendererData(rendererPath);
                }

                pipeline = UniversalRenderPipelineAsset.Create(renderer);
                AssetDatabase.CreateAsset(pipeline, assetPath);
            }

            TuneUrpAsset(pipeline);
            GraphicsSettings.defaultRenderPipeline = pipeline;
            int current = QualitySettings.GetQualityLevel();
            for (int i = 0; i < QualitySettings.names.Length; i++)
            {
                QualitySettings.SetQualityLevel(i, false);
                if (QualitySettings.renderPipeline == null)
                {
                    QualitySettings.renderPipeline = pipeline;
                }
            }

            QualitySettings.SetQualityLevel(current, false);
            Debug.Log("[FPS Builder] Created and assigned URP asset " + assetPath);
        }

        private static ScriptableRendererData CreateRendererData(string path)
        {
            // Prefer URP's own (internal) factory so post-processing resources are wired exactly like the editor menu does.
            MethodInfo factory = typeof(UniversalRenderPipelineAsset).GetMethod("CreateRendererAsset", BindingFlags.NonPublic | BindingFlags.Static);
            if (factory != null)
            {
                try
                {
                    ParameterInfo[] parameters = factory.GetParameters();
                    var args = new object[parameters.Length];
                    args[0] = path;
                    args[1] = Enum.ToObject(parameters[1].ParameterType, 1); // RendererType.UniversalRenderer
                    if (parameters.Length > 2) args[2] = false; // relativePath
                    if (parameters.Length > 3) args[3] = "Renderer";
                    if (factory.Invoke(null, args) is ScriptableRendererData created)
                    {
                        return created;
                    }
                }
                catch (Exception exception)
                {
                    Debug.LogWarning("[FPS Builder] URP renderer factory failed, falling back: " + exception.Message);
                }
            }

            var data = ScriptableObject.CreateInstance<UniversalRendererData>();
            AssetDatabase.CreateAsset(data, path);
            return data;
        }

        private static void TuneUrpAsset(UniversalRenderPipelineAsset asset)
        {
            // Serialized-property access keeps this robust across URP versions.
            var serialized = new SerializedObject(asset);
            SetFloat(serialized, "m_ShadowDistance", 140f);
            SetInt(serialized, "m_ShadowCascadeCount", 4);
            SetInt(serialized, "m_AdditionalLightsPerObjectLimit", 8);
            SetBool(serialized, "m_SoftShadowsSupported", true);
            SetBool(serialized, "m_SupportsHDR", true);
            SetBool(serialized, "m_UseSRPBatcher", true);
            SetBool(serialized, "m_RequireDepthTexture", false);
            SetInt(serialized, "m_MSAA", 4);
            SetBool(serialized, "m_EnableLODCrossFade", true);
            serialized.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(asset);
        }

        private static void SetFloat(SerializedObject so, string name, float value)
        {
            SerializedProperty p = so.FindProperty(name);
            if (p != null && p.propertyType == SerializedPropertyType.Float) p.floatValue = value;
        }

        private static void SetInt(SerializedObject so, string name, int value)
        {
            SerializedProperty p = so.FindProperty(name);
            if (p == null) return;
            if (p.propertyType == SerializedPropertyType.Integer) p.intValue = value;
            else if (p.propertyType == SerializedPropertyType.Enum) p.intValue = value;
        }

        private static void SetBool(SerializedObject so, string name, bool value)
        {
            SerializedProperty p = so.FindProperty(name);
            if (p != null && p.propertyType == SerializedPropertyType.Boolean) p.boolValue = value;
        }

        /// <summary>Humanoid agent sized like our characters (radius 0.4, height 1.8) for accurate doorways and cover.</summary>
        public static void ConfigureNavMeshAgent()
        {
            UnityEngine.Object settings = Unsupported.GetSerializedAssetInterfaceSingleton("NavMeshProjectSettings");
            if (settings == null)
            {
                return;
            }

            var serialized = new SerializedObject(settings);
            SerializedProperty agents = serialized.FindProperty("m_Settings");
            if (agents == null || agents.arraySize == 0)
            {
                return;
            }

            SerializedProperty humanoid = agents.GetArrayElementAtIndex(0);
            SetRelative(humanoid, "agentRadius", 0.4f);
            SetRelative(humanoid, "agentHeight", 1.8f);
            SetRelative(humanoid, "agentClimb", 0.45f);
            SetRelative(humanoid, "agentSlope", 46f);
            SetRelative(humanoid, "ledgeDropHeight", 4f);
            SetRelative(humanoid, "maxJumpAcrossDistance", 1.5f);
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void SetRelative(SerializedProperty parent, string name, float value)
        {
            SerializedProperty p = parent.FindPropertyRelative(name);
            if (p != null && p.propertyType == SerializedPropertyType.Float)
            {
                p.floatValue = value;
            }
        }
    }
}
