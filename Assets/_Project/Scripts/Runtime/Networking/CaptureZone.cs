using System.Collections.Generic;
using FPS.Combat;
using FPS.Core;
using FPS.Data;
using FPS.World;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.Rendering;

namespace FPS.Networking
{
    /// <summary>
    /// Networked objective capture area. The server counts living combatants of each team inside the radius;
    /// an uncontested team moves the progress bar (faster with more people) to neutralise and then capture.
    /// Ownership, progress and contest state are NetworkVariables, so the HUD and bots read them on every peer.
    /// </summary>
    public class CaptureZone : NetworkBehaviour, IObjective
    {
        private const float k_UpdateInterval = 0.2f;
        private const float k_HeightTolerance = 4f;

        private readonly NetworkVariable<Team> m_Owner = new NetworkVariable<Team>(Team.Neutral);
        private readonly NetworkVariable<float> m_Progress = new NetworkVariable<float>(0f);
        private readonly NetworkVariable<bool> m_Contested = new NetworkVariable<bool>(false);
        private readonly NetworkVariable<float> m_Radius = new NetworkVariable<float>(9f);
        private readonly NetworkVariable<FixedString32Bytes> m_Label = new NetworkVariable<FixedString32Bytes>();
        private readonly NetworkVariable<FixedString64Bytes> m_Name = new NetworkVariable<FixedString64Bytes>();

        private readonly List<Combatant> m_Inside = new List<Combatant>(16);
        private float m_NextUpdate;
        private Renderer m_Ring;
        private Renderer m_Beam;
        private Renderer m_Flag;
        private Transform m_FlagTransform;
        private Material m_RingMaterial;
        private Material m_BeamMaterial;
        private Material m_FlagMaterial;

        public string Label => m_Label.Value.ToString();
        public string DisplayName => m_Name.Value.Length > 0 ? m_Name.Value.ToString() : "Objective " + Label;
        public Vector3 Position => transform.position;
        public float Radius => m_Radius.Value;
        public Team OwnerTeam => m_Owner.Value;
        public bool IsContested => m_Contested.Value;
        public float CaptureProgress => m_Progress.Value;

        public override void OnNetworkSpawn()
        {
            ObjectiveRegistry.Register(this);
            m_Owner.OnValueChanged += OnOwnerChanged;
            m_Radius.OnValueChanged += OnRadiusChanged;
            BuildVisuals();
        }

        public override void OnDestroy()
        {
            if (m_RingMaterial != null) Destroy(m_RingMaterial);
            if (m_BeamMaterial != null) Destroy(m_BeamMaterial);
            if (m_FlagMaterial != null) Destroy(m_FlagMaterial);
            base.OnDestroy();
        }

        public override void OnNetworkDespawn()
        {
            ObjectiveRegistry.Unregister(this);
            m_Owner.OnValueChanged -= OnOwnerChanged;
            m_Radius.OnValueChanged -= OnRadiusChanged;
        }

        public void ServerConfigure(string label, string displayName, float radius)
        {
            if (!IsServer)
            {
                return;
            }

            m_Label.Value = new FixedString32Bytes(Truncate(label, 8));
            m_Name.Value = new FixedString64Bytes(Truncate(displayName, 48));
            m_Radius.Value = Mathf.Max(2f, radius);
        }

        public void ServerReset()
        {
            if (!IsServer)
            {
                return;
            }

            m_Owner.Value = Team.Neutral;
            m_Progress.Value = 0f;
            m_Contested.Value = false;
        }

        private static string Truncate(string value, int length)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            return value.Length > length ? value.Substring(0, length) : value;
        }

        private void OnOwnerChanged(Team previous, Team current)
        {
            EventBus<ZoneCapturedEvent>.Raise(new ZoneCapturedEvent { ZoneName = DisplayName, NewOwner = current });
            if (current != Team.Neutral)
            {
                AudioPool.PlayAt(ProceduralAudio.Get(ProceduralSound.CaptureTick), transform.position, 0.8f, 0.7f, 0.3f, 200f);
            }
        }

        private void OnRadiusChanged(float previous, float current)
        {
            ApplyRadius();
        }

        private void Update()
        {
            UpdateVisuals();
            if (!IsServer || !IsSpawned || Time.time < m_NextUpdate)
            {
                return;
            }

            m_NextUpdate = Time.time + k_UpdateInterval;
            ServerSimulate(k_UpdateInterval);
        }

        private void ServerSimulate(float deltaTime)
        {
            MatchSettings settings = GameConfig.Instance != null ? GameConfig.Instance.matchSettings : null;
            float captureTime = settings != null ? settings.captureTime : 9f;
            float maxMultiplier = settings != null ? settings.maxCaptureSpeedMultiplier : 2.5f;

            int alpha = 0;
            int bravo = 0;
            m_Inside.Clear();
            Vector3 centre = transform.position;
            float radiusSq = m_Radius.Value * m_Radius.Value;
            foreach (Combatant combatant in CombatantRegistry.All)
            {
                if (combatant == null || !combatant.IsAlive)
                {
                    continue;
                }

                Vector3 offset = combatant.transform.position - centre;
                if (Mathf.Abs(offset.y) > k_HeightTolerance)
                {
                    continue;
                }

                offset.y = 0f;
                if (offset.sqrMagnitude > radiusSq)
                {
                    continue;
                }

                m_Inside.Add(combatant);
                if (combatant.Team == Team.Alpha) alpha++;
                else if (combatant.Team == Team.Bravo) bravo++;
            }

            bool contested = alpha > 0 && bravo > 0;
            if (m_Contested.Value != contested)
            {
                m_Contested.Value = contested;
            }

            float progress = m_Progress.Value;
            float rate = 1f / Mathf.Max(0.5f, captureTime);
            if (!contested && (alpha > 0 || bravo > 0))
            {
                Team capturing = alpha > 0 ? Team.Alpha : Team.Bravo;
                int count = Mathf.Max(alpha, bravo);
                float speed = rate * Mathf.Min(maxMultiplier, 1f + 0.5f * (count - 1));
                float direction = capturing == Team.Alpha ? -1f : 1f;
                float previous = progress;
                progress = Mathf.Clamp(progress + direction * speed * deltaTime, -1f, 1f);

                // Crossing the centre neutralises the zone.
                if (m_Owner.Value != Team.Neutral && m_Owner.Value != capturing && Mathf.Sign(previous) != Mathf.Sign(progress) && Mathf.Abs(previous) > 0.001f)
                {
                    m_Owner.Value = Team.Neutral;
                }

                if (Mathf.Abs(progress) >= 1f && m_Owner.Value != capturing)
                {
                    m_Owner.Value = capturing;
                    if (MatchManager.Instance != null)
                    {
                        MatchManager.Instance.ServerOnZoneCaptured(this, capturing, m_Inside);
                    }
                }
            }
            else if (!contested)
            {
                // Nobody inside: drift back to the owner's resting value.
                float rest = m_Owner.Value == Team.Alpha ? -1f : m_Owner.Value == Team.Bravo ? 1f : 0f;
                progress = Mathf.MoveTowards(progress, rest, rate * 0.35f * deltaTime);
            }

            if (Mathf.Abs(progress - m_Progress.Value) > 0.0005f)
            {
                m_Progress.Value = progress;
            }
        }

        // ------------------------------------------------------------------------------------------------
        // Presentation
        // ------------------------------------------------------------------------------------------------

        private void BuildVisuals()
        {
            if (m_Ring != null || SystemInfo.graphicsDeviceType == GraphicsDeviceType.Null)
            {
                return;
            }

            m_Ring = CreatePrimitive("Ring", PrimitiveType.Cylinder, Vector3.zero, Vector3.one);
            m_Beam = CreatePrimitive("Beam", PrimitiveType.Cylinder, Vector3.zero, Vector3.one);
            CreatePrimitive("FlagPole", PrimitiveType.Cylinder, new Vector3(0f, 3f, 0f), new Vector3(0.12f, 3f, 0.12f)).sharedMaterial = RuntimeMaterials.Lit(new Color(0.75f, 0.75f, 0.78f));
            m_Flag = CreatePrimitive("Flag", PrimitiveType.Cube, new Vector3(0.75f, 5.4f, 0f), new Vector3(1.4f, 0.85f, 0.05f));
            m_FlagTransform = m_Flag.transform;
            m_RingMaterial = RuntimeMaterials.CreateTransparentInstance(Color.white);
            m_BeamMaterial = RuntimeMaterials.CreateTransparentInstance(Color.white);
            m_FlagMaterial = RuntimeMaterials.CreateLitInstance(Color.white);
            m_Ring.sharedMaterial = m_RingMaterial;
            m_Beam.sharedMaterial = m_BeamMaterial;
            m_Flag.sharedMaterial = m_FlagMaterial;
            ApplyRadius();
        }

        private Renderer CreatePrimitive(string name, PrimitiveType type, Vector3 localPosition, Vector3 localScale)
        {
            GameObject go = GameObject.CreatePrimitive(type);
            go.name = name;
            Destroy(go.GetComponent<Collider>());
            go.layer = GameLayers.ViewModel;
            go.transform.SetParent(transform, false);
            go.transform.localPosition = localPosition;
            go.transform.localScale = localScale;
            var renderer = go.GetComponent<Renderer>();
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            return renderer;
        }

        private void ApplyRadius()
        {
            if (m_Ring == null)
            {
                return;
            }

            float radius = m_Radius.Value;
            m_Ring.transform.localScale = new Vector3(radius * 2f, 0.02f, radius * 2f);
            m_Ring.transform.localPosition = new Vector3(0f, 0.05f, 0f);
            m_Beam.transform.localScale = new Vector3(radius * 2f, 6f, radius * 2f);
            m_Beam.transform.localPosition = new Vector3(0f, 6f, 0f);
        }

        private void UpdateVisuals()
        {
            if (m_Ring == null)
            {
                return;
            }

            Color owner = TeamUtility.GetColor(m_Owner.Value);
            Color capturing = m_Progress.Value < 0f ? TeamUtility.AlphaColor : TeamUtility.BravoColor;
            Color color = Color.Lerp(owner, capturing, m_Owner.Value == Team.Neutral ? Mathf.Abs(m_Progress.Value) : 0f);
            if (m_Contested.Value)
            {
                color = Color.Lerp(color, Color.white, Mathf.PingPong(Time.time * 2f, 1f) * 0.6f);
            }

            RuntimeMaterials.SetColor(m_RingMaterial, new Color(color.r, color.g, color.b, 0.35f));
            RuntimeMaterials.SetColor(m_BeamMaterial, new Color(color.r, color.g, color.b, 0.06f));
            RuntimeMaterials.SetColor(m_FlagMaterial, color);
            float flagHeight = Mathf.Lerp(1.2f, 5.4f, m_Owner.Value == Team.Neutral ? Mathf.Abs(m_Progress.Value) : 1f);
            m_FlagTransform.localPosition = new Vector3(0.75f, flagHeight, 0f);
        }
    }
}
