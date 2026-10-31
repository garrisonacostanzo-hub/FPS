using FPS.Core;
using FPS.Data;
using UnityEngine;
using UnityEngine.Rendering;

namespace FPS.Weapons
{
    /// <summary>Result of building a weapon model: root, muzzle socket and the magazine (animated on reload).</summary>
    public struct WeaponModelParts
    {
        public GameObject Root;
        public Transform Muzzle;
        public Transform Magazine;
        public Light MuzzleLight;
        public Renderer MuzzleFlash;
    }

    /// <summary>
    /// Builds placeholder weapon geometry from <see cref="WeaponData"/> dimensions and colours, so every weapon is
    /// visually distinct without imported art. If WeaponData.viewModelPrefab is assigned it is used instead.
    /// </summary>
    public static class ProceduralWeaponModel
    {
        public static WeaponModelParts Build(WeaponData data, Transform parent, int layer, bool castShadows, float scale = 1f)
        {
            var parts = new WeaponModelParts();
            var root = new GameObject(data != null ? data.displayName : "Weapon");
            root.transform.SetParent(parent, false);
            root.layer = layer;
            parts.Root = root;

            if (data != null && data.viewModelPrefab != null)
            {
                GameObject instance = Object.Instantiate(data.viewModelPrefab, root.transform, false);
                GameLayers.SetLayerRecursively(instance, layer);
                Transform muzzle = FindDeep(instance.transform, "Muzzle");
                parts.Muzzle = muzzle != null ? muzzle : instance.transform;
                parts.Magazine = FindDeep(instance.transform, "Magazine");
                AddMuzzleFlash(ref parts, data, layer);
                return parts;
            }

            Vector3 size = (data != null ? data.bodySize : new Vector3(0.07f, 0.11f, 0.48f)) * scale;
            float barrelLength = (data != null ? data.barrelLength : 0.28f) * scale;
            Color body = data != null ? data.bodyColor : Color.gray;
            Color accent = data != null ? data.accentColor : Color.yellow;
            ShadowCastingMode shadows = castShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;

            CreatePart(root.transform, "Receiver", PrimitiveType.Cube, Vector3.zero, size, body, layer, shadows);
            CreatePart(root.transform, "Stock", PrimitiveType.Cube, new Vector3(0f, -size.y * 0.1f, -size.z * 0.62f), new Vector3(size.x * 0.8f, size.y * 0.8f, size.z * 0.35f), body * 0.85f, layer, shadows);
            CreatePart(root.transform, "Grip", PrimitiveType.Cube, new Vector3(0f, -size.y * 0.75f, -size.z * 0.22f), new Vector3(size.x * 0.75f, size.y * 0.9f, size.x * 1.1f), body * 0.7f, layer, shadows);
            CreatePart(root.transform, "Sight", PrimitiveType.Cube, new Vector3(0f, size.y * 0.62f, -size.z * 0.05f), new Vector3(size.x * 0.45f, size.y * 0.25f, size.z * 0.3f), accent, layer, shadows);
            CreatePart(root.transform, "Rail", PrimitiveType.Cube, new Vector3(0f, size.y * 0.52f, size.z * 0.15f), new Vector3(size.x * 0.3f, size.y * 0.06f, size.z * 0.6f), body * 0.6f, layer, shadows);

            GameObject barrel = CreatePart(root.transform, "Barrel", PrimitiveType.Cylinder,
                new Vector3(0f, size.y * 0.15f, size.z * 0.5f + barrelLength * 0.5f),
                new Vector3(size.x * 0.38f, barrelLength * 0.5f, size.x * 0.38f), body * 0.5f, layer, shadows);
            barrel.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);

            GameObject magazine = CreatePart(root.transform, "Magazine", PrimitiveType.Cube,
                new Vector3(0f, -size.y * 0.85f, size.z * 0.12f), new Vector3(size.x * 0.6f, size.y * 1.1f, size.x * 1.3f), accent, layer, shadows);
            parts.Magazine = magazine.transform;

            var muzzleGo = new GameObject("Muzzle");
            muzzleGo.layer = layer;
            muzzleGo.transform.SetParent(root.transform, false);
            muzzleGo.transform.localPosition = new Vector3(0f, size.y * 0.15f, size.z * 0.5f + barrelLength + 0.01f);
            parts.Muzzle = muzzleGo.transform;

            AddMuzzleFlash(ref parts, data, layer);
            return parts;
        }

        private static void AddMuzzleFlash(ref WeaponModelParts parts, WeaponData data, int layer)
        {
            Color flashColor = data != null ? data.muzzleFlashColor : new Color(1f, 0.8f, 0.4f);
            GameObject flash = GameObject.CreatePrimitive(PrimitiveType.Quad);
            flash.name = "MuzzleFlash";
            Object.Destroy(flash.GetComponent<Collider>());
            flash.layer = layer;
            flash.transform.SetParent(parts.Muzzle, false);
            flash.transform.localPosition = new Vector3(0f, 0f, 0.04f);
            flash.transform.localScale = Vector3.one * 0.16f;
            var renderer = flash.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = RuntimeMaterials.Transparent(new Color(flashColor.r, flashColor.g, flashColor.b, 0.9f));
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.enabled = false;
            parts.MuzzleFlash = renderer;

            var lightGo = new GameObject("MuzzleLight");
            lightGo.transform.SetParent(parts.Muzzle, false);
            lightGo.transform.localPosition = new Vector3(0f, 0f, 0.08f);
            Light light = lightGo.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = flashColor;
            light.range = 7f;
            light.intensity = 0f;
            light.shadows = LightShadows.None;
            light.enabled = false;
            parts.MuzzleLight = light;
        }

        private static GameObject CreatePart(Transform parent, string name, PrimitiveType type, Vector3 localPosition, Vector3 localScale, Color color, int layer, ShadowCastingMode shadows)
        {
            GameObject part = GameObject.CreatePrimitive(type);
            part.name = name;
            Collider collider = part.GetComponent<Collider>();
            if (collider != null)
            {
                Object.Destroy(collider);
            }

            part.layer = layer;
            part.transform.SetParent(parent, false);
            part.transform.localPosition = localPosition;
            part.transform.localScale = localScale;
            var renderer = part.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = RuntimeMaterials.Lit(color);
            renderer.shadowCastingMode = shadows;
            renderer.receiveShadows = shadows == ShadowCastingMode.On;
            return part;
        }

        private static Transform FindDeep(Transform root, string name)
        {
            if (root.name == name)
            {
                return root;
            }

            foreach (Transform child in root)
            {
                Transform found = FindDeep(child, name);
                if (found != null)
                {
                    return found;
                }
            }

            return null;
        }
    }
}
