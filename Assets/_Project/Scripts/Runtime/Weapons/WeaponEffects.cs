using System.Collections.Generic;
using FPS.Core;
using UnityEngine;
using UnityEngine.Rendering;

namespace FPS.Weapons
{
    /// <summary>
    /// Pooled, allocation-free presentation layer for gunfire: tracers, impact marks and blood puffs.
    /// Never instantiated on dedicated servers (no graphics device).
    /// </summary>
    public class WeaponEffects : MonoBehaviour
    {
        private const int k_TracerPool = 48;
        private const int k_ImpactPool = 96;
        private const float k_TracerLifetime = 0.07f;
        private const float k_ImpactLifetime = 9f;
        private const float k_BloodLifetime = 0.35f;

        private struct Tracer
        {
            public LineRenderer Line;
            public float EndTime;
        }

        private struct Impact
        {
            public Transform Transform;
            public Renderer Renderer;
            public float EndTime;
            public bool Blood;
            public Vector3 BaseScale;
        }

        private static WeaponEffects s_Instance;

        private readonly List<Tracer> m_Tracers = new List<Tracer>(k_TracerPool);
        private readonly List<Impact> m_Impacts = new List<Impact>(k_ImpactPool);
        private int m_NextTracer;
        private int m_NextImpact;
        private Material m_ImpactMaterial;
        private Material m_BloodMaterial;

        public static bool IsSupported => SystemInfo.graphicsDeviceType != GraphicsDeviceType.Null;

        public static WeaponEffects Instance
        {
            get
            {
                if (s_Instance == null && IsSupported)
                {
                    var go = new GameObject("[WeaponEffects]");
                    s_Instance = go.AddComponent<WeaponEffects>();
                }

                return s_Instance;
            }
        }

        private void Awake()
        {
            m_ImpactMaterial = RuntimeMaterials.Transparent(new Color(0.08f, 0.08f, 0.08f, 0.85f));
            m_BloodMaterial = RuntimeMaterials.Transparent(new Color(0.75f, 0.05f, 0.05f, 0.9f));
        }

        private void OnDestroy()
        {
            if (s_Instance == this)
            {
                s_Instance = null;
            }
        }

        public void SpawnTracer(Vector3 from, Vector3 to, Color color, float width = 0.025f)
        {
            Tracer tracer = GetTracer();
            tracer.Line.startColor = color;
            tracer.Line.endColor = new Color(color.r, color.g, color.b, 0f);
            tracer.Line.startWidth = width;
            tracer.Line.endWidth = width * 0.4f;
            tracer.Line.SetPosition(0, from);
            tracer.Line.SetPosition(1, to);
            tracer.Line.enabled = true;
            tracer.EndTime = Time.time + k_TracerLifetime;
            m_Tracers[m_NextTracer] = tracer;
            m_NextTracer = (m_NextTracer + 1) % k_TracerPool;
        }

        public void SpawnImpact(Vector3 point, Vector3 normal, bool hitCharacter)
        {
            Impact impact = GetImpact();
            impact.Blood = hitCharacter;
            impact.Renderer.sharedMaterial = hitCharacter ? m_BloodMaterial : m_ImpactMaterial;
            impact.BaseScale = hitCharacter ? Vector3.one * 0.35f : Vector3.one * Random.Range(0.08f, 0.13f);
            impact.Transform.localScale = impact.BaseScale;
            Vector3 safeNormal = normal.sqrMagnitude > 0.001f ? normal.normalized : Vector3.up;
            impact.Transform.SetPositionAndRotation(point + safeNormal * 0.01f, Quaternion.LookRotation(-safeNormal) * Quaternion.Euler(0f, 0f, Random.Range(0f, 360f)));
            impact.Renderer.enabled = true;
            impact.EndTime = Time.time + (hitCharacter ? k_BloodLifetime : k_ImpactLifetime);
            m_Impacts[m_NextImpact] = impact;
            m_NextImpact = (m_NextImpact + 1) % k_ImpactPool;
        }

        public void PlayShot(in ShotFxData fx, Vector3 muzzle, Color tracerColor, float tracerChance)
        {
            for (int i = 0; i < fx.Count; i++)
            {
                if (Random.value <= tracerChance || fx.Count > 1)
                {
                    SpawnTracer(muzzle, fx.Points[i], tracerColor, fx.Count > 1 ? 0.012f : 0.025f);
                }

                SpawnImpact(fx.Points[i], fx.Normals[i], fx.HitCharacter(i));
            }
        }

        private Tracer GetTracer()
        {
            if (m_Tracers.Count < k_TracerPool)
            {
                var go = new GameObject("Tracer" + m_Tracers.Count);
                go.transform.SetParent(transform, false);
                var line = go.AddComponent<LineRenderer>();
                line.positionCount = 2;
                line.useWorldSpace = true;
                line.shadowCastingMode = ShadowCastingMode.Off;
                line.receiveShadows = false;
                line.sharedMaterial = RuntimeMaterials.Transparent(Color.white);
                line.numCapVertices = 0;
                line.enabled = false;
                var tracer = new Tracer { Line = line, EndTime = 0f };
                m_Tracers.Add(tracer);
                m_NextTracer = m_Tracers.Count - 1;
                return tracer;
            }

            return m_Tracers[m_NextTracer];
        }

        private Impact GetImpact()
        {
            if (m_Impacts.Count < k_ImpactPool)
            {
                GameObject quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
                quad.name = "Impact" + m_Impacts.Count;
                Destroy(quad.GetComponent<Collider>());
                quad.layer = GameLayers.ViewModel;
                quad.transform.SetParent(transform, false);
                var renderer = quad.GetComponent<MeshRenderer>();
                renderer.shadowCastingMode = ShadowCastingMode.Off;
                renderer.receiveShadows = false;
                renderer.enabled = false;
                var impact = new Impact { Transform = quad.transform, Renderer = renderer, EndTime = 0f };
                m_Impacts.Add(impact);
                m_NextImpact = m_Impacts.Count - 1;
                return impact;
            }

            return m_Impacts[m_NextImpact];
        }

        private void Update()
        {
            float now = Time.time;
            for (int i = 0; i < m_Tracers.Count; i++)
            {
                Tracer tracer = m_Tracers[i];
                if (tracer.Line.enabled && now >= tracer.EndTime)
                {
                    tracer.Line.enabled = false;
                }
            }

            for (int i = 0; i < m_Impacts.Count; i++)
            {
                Impact impact = m_Impacts[i];
                if (!impact.Renderer.enabled)
                {
                    continue;
                }

                if (now >= impact.EndTime)
                {
                    impact.Renderer.enabled = false;
                }
                else if (impact.Blood)
                {
                    float remaining = Mathf.Clamp01((impact.EndTime - now) / k_BloodLifetime);
                    impact.Transform.localScale = impact.BaseScale * (1.6f - remaining * 0.6f);
                }
            }
        }
    }
}
