using System.Collections.Generic;
using FPS.Controls;
using FPS.Core;
using FPS.Data;
using FPS.Networking;
using FPS.World;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace FPS.UI
{
    /// <summary>
    /// Customisable, event-driven HUD: health, ammunition, weapon/fire mode, reload progress, dynamic crosshair,
    /// hit markers, damage direction, kill feed, match timer and team scores, objective status + world markers,
    /// location name, death/respawn panel, announcements and the scoreboard.
    /// Built entirely in code from a <see cref="HUDTheme"/>; it only listens to <see cref="EventBus{T}"/> events and
    /// reads replicated match state, so it has no dependency on player or weapon classes.
    /// </summary>
    public class HUDController : MonoBehaviour
    {
        private const int k_MaxObjectives = 6;

        [SerializeField] private HUDTheme m_Theme;

        private RectTransform m_Root;
        private CanvasGroup m_PlayerGroup;
        private Image m_HealthFill;
        private Text m_HealthText;
        private Text m_MagazineText;
        private Text m_ReserveText;
        private Text m_WeaponText;
        private Text m_SlotsText;
        private Image m_ReloadFill;
        private GameObject m_ReloadBar;
        private Text m_TimerText;
        private Text m_AlphaScoreText;
        private Text m_BravoScoreText;
        private Image m_AlphaScoreFill;
        private Image m_BravoScoreFill;
        private Text m_PhaseText;
        private readonly Image[] m_ObjectiveIcons = new Image[k_MaxObjectives];
        private readonly Text[] m_ObjectiveLabels = new Text[k_MaxObjectives];
        private readonly RectTransform[] m_ObjectiveMarkers = new RectTransform[k_MaxObjectives];
        private readonly Text[] m_ObjectiveMarkerLabels = new Text[k_MaxObjectives];
        private Text m_AnnouncementText;
        private float m_AnnouncementUntil;
        private GameObject m_DeathPanel;
        private Text m_DeathText;
        private float m_RespawnAt;
        private Image m_Vignette;
        private Text m_LocationText;
        private float m_NextLocationUpdate;

        private CrosshairUI m_Crosshair;
        private DamageIndicatorUI m_DamageIndicators;
        private ScoreboardUI m_Scoreboard;
        private Camera m_PlayerCamera;
        private Transform m_PlayerTransform;
        private float m_Health = 100f;
        private float m_MaxHealth = 100f;
        private float m_ReloadStart;
        private float m_ReloadDuration;
        private bool m_Reloading;
        private Canvas m_Canvas;

        private void Awake()
        {
            if (SystemInfo.graphicsDeviceType == GraphicsDeviceType.Null)
            {
                enabled = false;
                return;
            }

            if (m_Theme == null && GameConfig.Instance != null)
            {
                m_Theme = GameConfig.Instance.hudTheme;
            }

            if (m_Theme == null)
            {
                m_Theme = ScriptableObject.CreateInstance<HUDTheme>();
            }

            UIFactory.EnsureEventSystem();
            Build();
        }

        private void Build()
        {
            m_Canvas = UIFactory.CreateCanvas("HUDCanvas", 10, transform);
            m_Root = UIFactory.Stretch(UIFactory.CreateRect("Root", m_Canvas.transform, Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero));
            ApplyScale();
            HUDTheme t = m_Theme;
            Vector2 pad = t.screenPadding;

            // Low health vignette (full screen, behind everything else).
            m_Vignette = UIFactory.CreateImage("Vignette", m_Root, new Color(t.danger.r, t.danger.g, t.danger.b, 0f), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            UIFactory.Stretch(m_Vignette.rectTransform);

            RectTransform playerRoot = UIFactory.Stretch(UIFactory.CreateRect("PlayerHUD", m_Root, Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero));
            m_PlayerGroup = playerRoot.gameObject.AddComponent<CanvasGroup>();
            m_PlayerGroup.alpha = 0f;

            // Health (bottom left).
            Image healthPanel = UIFactory.CreateImage("HealthPanel", playerRoot, t.panel, Vector2.zero, Vector2.zero, pad, new Vector2(380f, 74f));
            UIFactory.CreateText("HealthLabel", healthPanel.transform, "HEALTH", t.fontSize - 6, TextAnchor.UpperLeft, t.secondary, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(14f, -8f), new Vector2(200f, 22f));
            m_HealthText = UIFactory.CreateText("HealthValue", healthPanel.transform, "100", t.largeFontSize - 8, TextAnchor.MiddleRight, t.primary, new Vector2(1f, 0.5f), new Vector2(1f, 0.5f), new Vector2(-14f, 4f), new Vector2(120f, 60f));
            UIFactory.CreateFilledBar("HealthBar", healthPanel.transform, new Color(1f, 1f, 1f, 0.12f), t.healthHigh, new Vector2(0f, 0f), new Vector2(0f, 0f), new Vector2(14f, 12f), new Vector2(230f, 16f), out m_HealthFill);

            m_LocationText = UIFactory.CreateText("Location", playerRoot, string.Empty, t.fontSize - 4, TextAnchor.LowerLeft, t.secondary, Vector2.zero, Vector2.zero, pad + new Vector2(2f, 82f), new Vector2(400f, 26f));

            // Ammo (bottom right).
            Image ammoPanel = UIFactory.CreateImage("AmmoPanel", playerRoot, t.panel, new Vector2(1f, 0f), new Vector2(1f, 0f), new Vector2(-pad.x, pad.y), new Vector2(380f, 96f));
            m_WeaponText = UIFactory.CreateText("Weapon", ammoPanel.transform, string.Empty, t.fontSize - 4, TextAnchor.UpperLeft, t.secondary, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(14f, -8f), new Vector2(240f, 24f));
            m_MagazineText = UIFactory.CreateText("Magazine", ammoPanel.transform, "30", t.largeFontSize, TextAnchor.LowerRight, t.primary, new Vector2(1f, 0f), new Vector2(1f, 0f), new Vector2(-110f, 8f), new Vector2(140f, 60f));
            m_ReserveText = UIFactory.CreateText("Reserve", ammoPanel.transform, "/ 120", t.fontSize, TextAnchor.LowerLeft, t.secondary, new Vector2(1f, 0f), new Vector2(0f, 0f), new Vector2(-104f, 14f), new Vector2(100f, 34f));
            m_SlotsText = UIFactory.CreateText("Slots", ammoPanel.transform, string.Empty, t.fontSize - 6, TextAnchor.LowerLeft, t.secondary, new Vector2(0f, 0f), new Vector2(0f, 0f), new Vector2(14f, 10f), new Vector2(200f, 24f));
            Image reloadBack = UIFactory.CreateFilledBar("ReloadBar", playerRoot, new Color(0f, 0f, 0f, 0.5f), t.accent, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0f, -70f), new Vector2(160f, 8f), out m_ReloadFill);
            m_ReloadBar = reloadBack.gameObject;
            m_ReloadBar.SetActive(false);

            // Crosshair, damage indicators.
            m_Crosshair = new GameObject("CrosshairController").AddComponent<CrosshairUI>();
            m_Crosshair.transform.SetParent(playerRoot, false);
            m_Crosshair.Build(t, playerRoot);
            m_DamageIndicators = new GameObject("DamageIndicatorController").AddComponent<DamageIndicatorUI>();
            m_DamageIndicators.transform.SetParent(playerRoot, false);
            m_DamageIndicators.Build(t, playerRoot);

            // Match status (top centre).
            if (t.showMatchStatus)
            {
                Image statusPanel = UIFactory.CreateImage("MatchStatus", m_Root, t.panel, new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0f, -pad.y * 0.5f), new Vector2(520f, 112f));
                m_TimerText = UIFactory.CreateText("Timer", statusPanel.transform, "00:00", t.fontSize + 6, TextAnchor.UpperCenter, t.primary, new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0f, -6f), new Vector2(160f, 34f));
                m_PhaseText = UIFactory.CreateText("Phase", statusPanel.transform, string.Empty, t.fontSize - 8, TextAnchor.UpperCenter, t.secondary, new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0f, -38f), new Vector2(200f, 20f));
                m_AlphaScoreText = UIFactory.CreateText("AlphaScore", statusPanel.transform, "0", t.fontSize + 4, TextAnchor.MiddleLeft, TeamUtility.AlphaColor, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(16f, -10f), new Vector2(120f, 34f));
                m_BravoScoreText = UIFactory.CreateText("BravoScore", statusPanel.transform, "0", t.fontSize + 4, TextAnchor.MiddleRight, TeamUtility.BravoColor, new Vector2(1f, 1f), new Vector2(1f, 1f), new Vector2(-16f, -10f), new Vector2(120f, 34f));
                UIFactory.CreateFilledBar("AlphaBar", statusPanel.transform, new Color(1f, 1f, 1f, 0.08f), TeamUtility.AlphaColor, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(16f, -48f), new Vector2(150f, 8f), out m_AlphaScoreFill);
                UIFactory.CreateFilledBar("BravoBar", statusPanel.transform, new Color(1f, 1f, 1f, 0.08f), TeamUtility.BravoColor, new Vector2(1f, 1f), new Vector2(1f, 1f), new Vector2(-16f, -48f), new Vector2(150f, 8f), out m_BravoScoreFill);
                m_BravoScoreFill.fillOrigin = (int)Image.OriginHorizontal.Right;

                for (int i = 0; i < k_MaxObjectives; i++)
                {
                    float x = (i - (k_MaxObjectives - 1) * 0.5f) * 48f;
                    m_ObjectiveIcons[i] = UIFactory.CreateImage("Objective" + i, statusPanel.transform, t.panel, new Vector2(0.5f, 0f), new Vector2(0.5f, 0f), new Vector2(x, 8f), new Vector2(40f, 40f));
                    m_ObjectiveLabels[i] = UIFactory.CreateText("Label", m_ObjectiveIcons[i].transform, string.Empty, t.fontSize, TextAnchor.MiddleCenter, Color.white, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(40f, 40f));
                    m_ObjectiveIcons[i].gameObject.SetActive(false);

                    Image marker = UIFactory.CreateImage("Marker" + i, playerRoot, Color.white, new Vector2(0f, 0f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(36f, 36f));
                    marker.sprite = UIFactory.RingSprite;
                    m_ObjectiveMarkers[i] = marker.rectTransform;
                    m_ObjectiveMarkerLabels[i] = UIFactory.CreateText("Letter", marker.transform, string.Empty, t.fontSize - 2, TextAnchor.MiddleCenter, Color.white, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(80f, 36f));
                    marker.gameObject.SetActive(false);
                }
            }

            // Kill feed.
            var killFeed = new GameObject("KillFeedController").AddComponent<KillFeedUI>();
            killFeed.transform.SetParent(m_Root, false);
            killFeed.Build(t, m_Root);

            // Announcements and death panel.
            m_AnnouncementText = UIFactory.CreateText("Announcement", m_Root, string.Empty, t.fontSize + 8, TextAnchor.MiddleCenter, t.accent, new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0f, -190f), new Vector2(1200f, 50f));
            Image deathPanel = UIFactory.CreateImage("DeathPanel", m_Root, t.panel, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0f, 120f), new Vector2(620f, 110f));
            m_DeathPanel = deathPanel.gameObject;
            m_DeathText = UIFactory.CreateText("DeathText", deathPanel.transform, string.Empty, t.fontSize + 2, TextAnchor.MiddleCenter, t.primary, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(600f, 100f));
            m_DeathPanel.SetActive(false);

            // Scoreboard.
            m_Scoreboard = new GameObject("ScoreboardController").AddComponent<ScoreboardUI>();
            m_Scoreboard.transform.SetParent(m_Root, false);
            m_Scoreboard.Build(t, m_Root);
        }

        private void ApplyScale()
        {
            if (m_Root != null)
            {
                float scale = m_Theme.scale * GameSettings.HudScale;
                m_Root.localScale = Vector3.one * scale;
                m_Root.sizeDelta = Vector2.zero;
                m_Root.anchorMin = new Vector2(0.5f - 0.5f / scale, 0.5f - 0.5f / scale);
                m_Root.anchorMax = new Vector2(0.5f + 0.5f / scale, 0.5f + 0.5f / scale);
            }
        }

        private void OnEnable()
        {
            EventBus<LocalPlayerSpawnedEvent>.Subscribe(OnLocalPlayerSpawned);
            EventBus<LocalPlayerDespawnedEvent>.Subscribe(OnLocalPlayerDespawned);
            EventBus<LocalHealthChangedEvent>.Subscribe(OnHealthChanged);
            EventBus<LocalAmmoChangedEvent>.Subscribe(OnAmmoChanged);
            EventBus<LocalWeaponSwitchedEvent>.Subscribe(OnWeaponSwitched);
            EventBus<LocalReloadEvent>.Subscribe(OnReload);
            EventBus<LocalDeathEvent>.Subscribe(OnDeath);
            EventBus<LocalRespawnEvent>.Subscribe(OnRespawn);
            EventBus<MatchAnnouncementEvent>.Subscribe(OnAnnouncement);
            GameSettings.Changed += ApplyScale;
        }

        private void OnDisable()
        {
            EventBus<LocalPlayerSpawnedEvent>.Unsubscribe(OnLocalPlayerSpawned);
            EventBus<LocalPlayerDespawnedEvent>.Unsubscribe(OnLocalPlayerDespawned);
            EventBus<LocalHealthChangedEvent>.Unsubscribe(OnHealthChanged);
            EventBus<LocalAmmoChangedEvent>.Unsubscribe(OnAmmoChanged);
            EventBus<LocalWeaponSwitchedEvent>.Unsubscribe(OnWeaponSwitched);
            EventBus<LocalReloadEvent>.Unsubscribe(OnReload);
            EventBus<LocalDeathEvent>.Unsubscribe(OnDeath);
            EventBus<LocalRespawnEvent>.Unsubscribe(OnRespawn);
            EventBus<MatchAnnouncementEvent>.Unsubscribe(OnAnnouncement);
            GameSettings.Changed -= ApplyScale;
        }

        // ------------------------------------------------------------------------------------------------
        // Event handlers
        // ------------------------------------------------------------------------------------------------

        private void OnLocalPlayerSpawned(LocalPlayerSpawnedEvent evt)
        {
            m_PlayerCamera = evt.Camera;
            m_PlayerTransform = evt.Player != null ? evt.Player.transform : null;
            m_PlayerGroup.alpha = 1f;
            m_Crosshair.SetCamera(evt.Camera);
            m_DamageIndicators.SetView(evt.Camera != null ? evt.Camera.transform : null);
        }

        private void OnLocalPlayerDespawned(LocalPlayerDespawnedEvent evt)
        {
            m_PlayerCamera = null;
            m_PlayerTransform = null;
            m_PlayerGroup.alpha = 0f;
            m_DeathPanel.SetActive(false);
        }

        private void OnHealthChanged(LocalHealthChangedEvent evt)
        {
            m_Health = evt.Current;
            m_MaxHealth = Mathf.Max(1f, evt.Max);
            float fraction = Mathf.Clamp01(m_Health / m_MaxHealth);
            m_HealthFill.fillAmount = fraction;
            m_HealthFill.color = Color.Lerp(m_Theme.healthLow, m_Theme.healthHigh, fraction);
            m_HealthText.text = Mathf.CeilToInt(m_Health).ToString();
            m_HealthText.color = fraction < 0.3f ? m_Theme.danger : m_Theme.primary;
        }

        private void OnAmmoChanged(LocalAmmoChangedEvent evt)
        {
            m_MagazineText.text = evt.Magazine.ToString();
            m_MagazineText.color = evt.Magazine <= Mathf.CeilToInt(evt.MagazineSize * 0.25f) ? m_Theme.danger : m_Theme.primary;
            m_ReserveText.text = "/ " + evt.Reserve;
            m_WeaponText.text = evt.WeaponName.ToUpperInvariant() + "  <color=#" + UIFactory.ToHex(m_Theme.accent) + ">" + FireModeLabel(evt.FireMode) + "</color>";
        }

        private static string FireModeLabel(FireMode mode)
        {
            switch (mode)
            {
                case FireMode.FullAuto: return "AUTO";
                case FireMode.Burst: return "BURST";
                default: return "SEMI";
            }
        }

        private void OnWeaponSwitched(LocalWeaponSwitchedEvent evt)
        {
            var builder = new System.Text.StringBuilder();
            for (int i = 0; i < evt.SlotCount; i++)
            {
                builder.Append(i == evt.Slot ? "<color=#" + UIFactory.ToHex(m_Theme.accent) + ">[" + (i + 1) + "]</color> " : "[" + (i + 1) + "] ");
            }

            m_SlotsText.text = builder.ToString();
            m_Reloading = false;
            m_ReloadBar.SetActive(false);
        }

        private void OnReload(LocalReloadEvent evt)
        {
            m_Reloading = evt.Started;
            m_ReloadStart = Time.time;
            m_ReloadDuration = Mathf.Max(0.01f, evt.Duration);
            m_ReloadBar.SetActive(evt.Started);
        }

        private void OnDeath(LocalDeathEvent evt)
        {
            m_RespawnAt = Time.time + evt.RespawnDelay;
            m_DeathPanel.SetActive(true);
            string killer = string.IsNullOrEmpty(evt.KillerName) ? "You died" : "Killed by <color=#" + UIFactory.ToHex(m_Theme.danger) + ">" + evt.KillerName + "</color>";
            m_DeathText.text = killer + "  [" + evt.WeaponName + "]";
            m_ReloadBar.SetActive(false);
        }

        private void OnRespawn(LocalRespawnEvent evt)
        {
            m_DeathPanel.SetActive(false);
        }

        private void OnAnnouncement(MatchAnnouncementEvent evt)
        {
            m_AnnouncementText.text = evt.Message;
            m_AnnouncementText.color = evt.Color.maxColorComponent > 0.95f && evt.Color.r > 0.8f && evt.Color.g > 0.8f ? m_Theme.accent : evt.Color;
            m_AnnouncementUntil = Time.time + evt.Duration;
        }

        // ------------------------------------------------------------------------------------------------
        // Per frame
        // ------------------------------------------------------------------------------------------------

        private void Update()
        {
            UpdateMatchStatus();
            UpdateObjectiveMarkers();

            bool scoreboard = InputService.Actions.Scoreboard.IsPressed() || (MatchManager.Instance != null && MatchManager.Instance.Phase == MatchPhase.PostMatch);
            m_Scoreboard.SetVisible(scoreboard);

            if (m_Reloading)
            {
                m_ReloadFill.fillAmount = Mathf.Clamp01((Time.time - m_ReloadStart) / m_ReloadDuration);
            }

            if (m_DeathPanel.activeSelf)
            {
                float remaining = Mathf.Max(0f, m_RespawnAt - Time.time);
                string baseText = m_DeathText.text;
                int index = baseText.IndexOf('\n');
                if (index >= 0)
                {
                    baseText = baseText.Substring(0, index);
                }

                m_DeathText.text = baseText + "\n<size=" + (m_Theme.fontSize - 4) + ">Respawning in " + remaining.ToString("0.0") + "s</size>";
            }

            float healthFraction = m_Health / m_MaxHealth;
            float vignetteAlpha = m_PlayerGroup.alpha > 0f && healthFraction < 0.45f ? (0.45f - healthFraction) * 0.6f * (0.85f + Mathf.Sin(Time.time * 6f) * 0.15f) : 0f;
            Color vignette = m_Vignette.color;
            vignette.a = Mathf.MoveTowards(vignette.a, vignetteAlpha, Time.deltaTime * 2f);
            m_Vignette.color = vignette;

            float announceAlpha = Mathf.Clamp01((m_AnnouncementUntil - Time.time) / 0.5f);
            Color announce = m_AnnouncementText.color;
            announce.a = announceAlpha;
            m_AnnouncementText.color = announce;

            if (m_PlayerTransform != null && Time.time >= m_NextLocationUpdate)
            {
                m_NextLocationUpdate = Time.time + 0.5f;
                TacticalZone zone = TacticalZone.Find(m_PlayerTransform.position);
                m_LocationText.text = zone != null ? zone.DisplayName.ToUpperInvariant() : string.Empty;
            }
        }

        private void UpdateMatchStatus()
        {
            if (m_TimerText == null)
            {
                return;
            }

            MatchManager match = MatchManager.Instance;
            if (match == null)
            {
                m_TimerText.text = "--:--";
                m_PhaseText.text = "CONNECTING";
                return;
            }

            float remaining = match.PhaseTimeRemaining;
            int minutes = Mathf.FloorToInt(remaining / 60f);
            int seconds = Mathf.FloorToInt(remaining % 60f);
            m_TimerText.text = minutes.ToString("00") + ":" + seconds.ToString("00");
            m_PhaseText.text = match.Phase == MatchPhase.Warmup ? "WARMUP" : match.Phase == MatchPhase.PostMatch ? "MATCH OVER" : "DOMINATION";
            m_AlphaScoreText.text = match.AlphaScore.ToString();
            m_BravoScoreText.text = match.BravoScore.ToString();
            m_AlphaScoreFill.fillAmount = Mathf.Clamp01(match.AlphaScore / (float)Mathf.Max(1, match.ScoreLimit));
            m_BravoScoreFill.fillAmount = Mathf.Clamp01(match.BravoScore / (float)Mathf.Max(1, match.ScoreLimit));

            IReadOnlyList<IObjective> objectives = ObjectiveRegistry.All;
            for (int i = 0; i < k_MaxObjectives; i++)
            {
                bool active = i < objectives.Count;
                m_ObjectiveIcons[i].gameObject.SetActive(active);
                if (!active)
                {
                    continue;
                }

                IObjective objective = objectives[i];
                Color color = ObjectiveColor(objective);
                m_ObjectiveIcons[i].color = new Color(color.r, color.g, color.b, 0.85f);
                m_ObjectiveLabels[i].text = ObjectiveLetter(objective);
            }
        }

        private void UpdateObjectiveMarkers()
        {
            if (m_ObjectiveMarkers[0] == null)
            {
                return;
            }

            IReadOnlyList<IObjective> objectives = ObjectiveRegistry.All;
            for (int i = 0; i < k_MaxObjectives; i++)
            {
                RectTransform marker = m_ObjectiveMarkers[i];
                bool show = m_PlayerCamera != null && m_PlayerCamera.isActiveAndEnabled && i < objectives.Count;
                if (!show)
                {
                    marker.gameObject.SetActive(false);
                    continue;
                }

                IObjective objective = objectives[i];
                Vector3 world = objective.Position + Vector3.up * 3f;
                Vector3 screen = m_PlayerCamera.WorldToScreenPoint(world);
                if (screen.z <= 0f)
                {
                    marker.gameObject.SetActive(false);
                    continue;
                }

                marker.gameObject.SetActive(true);
                float canvasScale = m_Canvas.transform.localScale.x * m_Root.localScale.x;
                marker.anchoredPosition = new Vector2(screen.x, screen.y) / Mathf.Max(0.0001f, canvasScale);
                float distance = Vector3.Distance(m_PlayerCamera.transform.position, objective.Position);
                Color color = ObjectiveColor(objective);
                marker.GetComponent<Image>().color = color;
                m_ObjectiveMarkerLabels[i].text = ObjectiveLetter(objective) + "\n<size=14>" + Mathf.RoundToInt(distance) + "m</size>";
            }
        }

        private static Color ObjectiveColor(IObjective objective)
        {
            Color color = TeamUtility.GetColor(objective.OwnerTeam);
            if (objective.IsContested)
            {
                color = Color.Lerp(color, Color.white, Mathf.PingPong(Time.time * 3f, 1f));
            }

            return color;
        }

        private static string ObjectiveLetter(IObjective objective)
        {
            if (objective is CaptureZone zone && !string.IsNullOrEmpty(zone.Label))
            {
                return zone.Label;
            }

            return string.IsNullOrEmpty(objective.DisplayName) ? "?" : objective.DisplayName.Substring(0, 1);
        }
    }
}
