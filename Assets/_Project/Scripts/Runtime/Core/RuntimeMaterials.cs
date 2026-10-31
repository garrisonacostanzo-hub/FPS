using System.Collections.Generic;
using FPS.Data;
using UnityEngine;

namespace FPS.Core
{
    /// <summary>
    /// Creates and caches colour-tinted materials at runtime for procedural meshes (view models, characters, FX).
    /// Uses the template materials stored in <see cref="GameConfig"/> (so the shaders are guaranteed to be part
    /// of player builds) and falls back to Shader.Find in the editor.
    /// </summary>
    public static class RuntimeMaterials
    {
        private static readonly Dictionary<int, Material> s_Lit = new Dictionary<int, Material>();
        private static readonly Dictionary<int, Material> s_Unlit = new Dictionary<int, Material>();
        private static readonly Dictionary<int, Material> s_Transparent = new Dictionary<int, Material>();

        private static readonly int s_BaseColor = Shader.PropertyToID("_BaseColor");
        private static readonly int s_Color = Shader.PropertyToID("_Color");
        private static readonly int s_EmissionColor = Shader.PropertyToID("_EmissionColor");

        public static Material Lit(Color color, float emission = 0f)
        {
            int key = Key(color, emission);
            if (s_Lit.TryGetValue(key, out Material material) && material != null)
            {
                return material;
            }

            GameConfig config = GameConfig.Instance;
            material = CreateFrom(config != null ? config.litMaterialTemplate : null, "Universal Render Pipeline/Lit", "Standard");
            SetColor(material, color);
            if (emission > 0f)
            {
                material.EnableKeyword("_EMISSION");
                material.SetColor(s_EmissionColor, color * emission);
            }

            material.enableInstancing = true;
            s_Lit[key] = material;
            return material;
        }

        public static Material Unlit(Color color)
        {
            int key = Key(color, 0f);
            if (s_Unlit.TryGetValue(key, out Material material) && material != null)
            {
                return material;
            }

            GameConfig config = GameConfig.Instance;
            material = CreateFrom(config != null ? config.unlitMaterialTemplate : null, "Universal Render Pipeline/Unlit", "Unlit/Color");
            SetColor(material, color);
            s_Unlit[key] = material;
            return material;
        }

        /// <summary>Alpha-blended unlit material (tracers, capture rings, decals).</summary>
        public static Material Transparent(Color color)
        {
            int key = Key(color, 0f);
            if (s_Transparent.TryGetValue(key, out Material material) && material != null)
            {
                return material;
            }

            GameConfig config = GameConfig.Instance;
            material = CreateFrom(config != null ? config.transparentMaterialTemplate : null, "Sprites/Default", "Unlit/Transparent");
            SetColor(material, color);
            s_Transparent[key] = material;
            return material;
        }

        /// <summary>Creates an un-cached instance (for materials whose colour animates every frame).</summary>
        public static Material CreateTransparentInstance(Color color)
        {
            var material = new Material(Transparent(Color.white));
            SetColor(material, color);
            return material;
        }

        public static Material CreateLitInstance(Color color)
        {
            var material = new Material(Lit(Color.white));
            SetColor(material, color);
            return material;
        }

        private static Material CreateFrom(Material template, string shaderName, string fallbackShader)
        {
            if (template != null)
            {
                return new Material(template);
            }

            Shader shader = Shader.Find(shaderName);
            if (shader == null)
            {
                shader = Shader.Find(fallbackShader);
            }

            if (shader == null)
            {
                shader = Shader.Find("Sprites/Default");
            }

            return new Material(shader);
        }

        public static void SetColor(Material material, Color color)
        {
            if (material.HasProperty(s_BaseColor))
            {
                material.SetColor(s_BaseColor, color);
            }

            if (material.HasProperty(s_Color))
            {
                material.SetColor(s_Color, color);
            }

            material.color = color;
        }

        private static int Key(Color color, float emission)
        {
            Color32 c = color;
            return (c.r << 24) ^ (c.g << 16) ^ (c.b << 8) ^ c.a ^ (Mathf.RoundToInt(emission * 10f) << 4);
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            s_Lit.Clear();
            s_Unlit.Clear();
            s_Transparent.Clear();
        }
    }
}
