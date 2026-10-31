using System.IO;
using UnityEditor;
using UnityEngine;

namespace FPS.EditorTools
{
    /// <summary>Shared helpers for the project builder (folders, serialized field assignment, primitives, static flags).</summary>
    public static class EditorUtil
    {
        public const string Root = "Assets/_Project";
        public const string DataFolder = Root + "/Data";
        public const string WeaponFolder = DataFolder + "/Weapons";
        public const string BotFolder = DataFolder + "/Bots";
        public const string SettingsFolder = DataFolder + "/Settings";
        public const string MaterialFolder = Root + "/Art/Materials";
        public const string TextureFolder = Root + "/Art/Textures";
        public const string MeshFolder = Root + "/Art/Meshes";
        public const string EnvironmentPrefabFolder = Root + "/Prefabs/Environment";
        public const string NetworkPrefabFolder = Root + "/Prefabs/Network";
        public const string SceneFolder = Root + "/Scenes";
        public const string RenderingFolder = Root + "/Settings/Rendering";
        public const string ResourcesFolder = Root + "/Resources/FPS";

        public static void EnsureFolder(string path)
        {
            path = path.Replace('\\', '/').TrimEnd('/');
            if (AssetDatabase.IsValidFolder(path))
            {
                return;
            }

            string parent = Path.GetDirectoryName(path)?.Replace('\\', '/');
            string name = Path.GetFileName(path);
            if (!string.IsNullOrEmpty(parent) && !AssetDatabase.IsValidFolder(parent))
            {
                EnsureFolder(parent);
            }

            AssetDatabase.CreateFolder(parent, name);
        }

        public static void EnsureAllFolders()
        {
            foreach (string folder in new[]
                     {
                         WeaponFolder, BotFolder, SettingsFolder, MaterialFolder, TextureFolder, MeshFolder,
                         EnvironmentPrefabFolder, NetworkPrefabFolder, SceneFolder, RenderingFolder, ResourcesFolder
                     })
            {
                EnsureFolder(folder);
            }
        }

        /// <summary>Loads an asset or creates (and saves) a new ScriptableObject at the path.</summary>
        public static T LoadOrCreate<T>(string path) where T : ScriptableObject
        {
            var asset = AssetDatabase.LoadAssetAtPath<T>(path);
            if (asset != null)
            {
                return asset;
            }

            EnsureFolder(Path.GetDirectoryName(path));
            asset = ScriptableObject.CreateInstance<T>();
            AssetDatabase.CreateAsset(asset, path);
            return asset;
        }

        /// <summary>Assigns a (possibly private) serialized field through SerializedObject so it persists.</summary>
        public static void SetSerialized(Object target, string property, Object value)
        {
            var serializedObject = new SerializedObject(target);
            SerializedProperty prop = serializedObject.FindProperty(property);
            if (prop == null)
            {
                Debug.LogWarning($"[FPS Builder] Property '{property}' not found on {target.GetType().Name}");
                return;
            }

            prop.objectReferenceValue = value;
            serializedObject.ApplyModifiedPropertiesWithoutUndo();
        }

        public static void SetSerializedArray(Object target, string property, Object[] values)
        {
            var serializedObject = new SerializedObject(target);
            SerializedProperty prop = serializedObject.FindProperty(property);
            if (prop == null || !prop.isArray)
            {
                Debug.LogWarning($"[FPS Builder] Array property '{property}' not found on {target.GetType().Name}");
                return;
            }

            prop.arraySize = values.Length;
            for (int i = 0; i < values.Length; i++)
            {
                prop.GetArrayElementAtIndex(i).objectReferenceValue = values[i];
            }

            serializedObject.ApplyModifiedPropertiesWithoutUndo();
        }

        public static void SetSerializedFloat(Object target, string property, float value)
        {
            var serializedObject = new SerializedObject(target);
            SerializedProperty prop = serializedObject.FindProperty(property);
            if (prop != null)
            {
                prop.floatValue = value;
                serializedObject.ApplyModifiedPropertiesWithoutUndo();
            }
        }

        public static GameObject CreateChild(string name, Transform parent, Vector3 localPosition)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPosition;
            return go;
        }

        /// <summary>Primitive without collider (visual only).</summary>
        public static GameObject Visual(PrimitiveType type, string name, Transform parent, Vector3 localPosition, Vector3 localScale, Material material, int layer)
        {
            GameObject go = GameObject.CreatePrimitive(type);
            go.name = name;
            Object.DestroyImmediate(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPosition;
            go.transform.localScale = localScale;
            go.layer = layer;
            if (material != null)
            {
                go.GetComponent<MeshRenderer>().sharedMaterial = material;
            }

            return go;
        }

        public static void SetStaticRecursively(GameObject root, StaticEditorFlags flags)
        {
            GameObjectUtility.SetStaticEditorFlags(root, flags);
            foreach (Transform child in root.transform)
            {
                SetStaticRecursively(child.gameObject, flags);
            }
        }

        public static void SetLayerRecursively(GameObject root, int layer)
        {
            root.layer = layer;
            foreach (Transform child in root.transform)
            {
                SetLayerRecursively(child.gameObject, layer);
            }
        }

        public static void Progress(string title, string info, float progress)
        {
            if (!Application.isBatchMode)
            {
                EditorUtility.DisplayProgressBar(title, info, progress);
            }
            else
            {
                Debug.Log($"[FPS Builder] {title}: {info}");
            }
        }

        public static void ClearProgress()
        {
            if (!Application.isBatchMode)
            {
                EditorUtility.ClearProgressBar();
            }
        }
    }
}
