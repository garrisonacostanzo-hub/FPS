using FPS.Core;
using FPS.Data;
using UnityEngine;
using UnityEngine.UI;

namespace FPS.UI
{
    /// <summary>
    /// Dynamic crosshair driven by the real weapon spread (converted from degrees to pixels with the current FOV),
    /// supporting several styles (cross, cross + dot, dot, circle, chevron), player colour, outline, ADS fade
    /// and hit markers (normal / headshot / kill).
    /// </summary>
    public class CrosshairUI : MonoBehaviour
    {
        private HUDTheme m_Theme;
        private RectTransform m_Root;
        private readonly Image[] m_Lines = new Image[4];
        private readonly Image[] m_Outlines = new Image[4];
        private readonly Image[] m_HitLines = new Image[4];
        private Image m_Dot;
        private Image m_Circle;
        private CanvasGroup m_Group;
        private CanvasGroup m_HitGroup;
        private CrosshairStyle m_Style;
        private float m_TargetSpread;
        private float m_Spread;
        private float m_AimFraction;
        private bool m_Visible = true;
        private float m_HitTime = -10f;
        private Camera m_Camera;

        public void Build(HUDTheme theme, RectTransform parent)
        {
            m_Theme = theme;
            m_Root = UIFactory.CreateRect("Crosshair", parent, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(200f, 200f));
            m_Group = m_Root.gameObject.AddComponent<CanvasGroup>();
            m_Group.interactable = false;
            m_Group.blocksRaycasts = false;

            for (int i = 0; i < 4; i++)
            {
                m_Outlines[i] = UIFactory.CreateImage("Outline" + i, m_Root, theme.outlineColor, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.one);
                m_Outlines[i].enabled = theme.outline;
            }

            for (int i = 0; i < 4; i++)
            {
                m_Lines[i] = UIFactory.CreateImage("Line" + i, m_Root, Color.white, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.one);
            }

            m_Dot = UIFactory.CreateImage("Dot", m_Root, Color.white, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.one * theme.dotSize);
            m_Circle = UIFactory.CreateImage("Circle", m_Root, Color.white, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.one * 40f);
            m_Circle.sprite = UIFactory.RingSprite;

            RectTransform hitRoot = UIFactory.CreateRect("Hitmarker", m_Root, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(60f, 60f));
            m_HitGroup = hitRoot.gameObject.AddComponent<CanvasGroup>();
            m_HitGroup.alpha = 0f;
            for (int i = 0; i < 4; i++)
            {
                float angle = 45f + 90f * i;
                Vector2 direction = Quaternion.Euler(0f, 0f, angle) * Vector2.up;
                m_HitLines[i] = UIFactory.CreateImage("Hit" + i, hitRoot, theme.hitmarkerColor, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), direction * 13f, new Vector2(2.5f, 10f));
                m_HitLines[i].rectTransform.localRotation = Quaternion.Euler(0f, 0f, angle);
            }

            m_Style = theme.defaultStyle;
            ApplyStyle();
        }

        private void OnEnable()
        {
            EventBus<CrosshairSpreadEvent>.Subscribe(OnSpread);
            EventBus<HitConfirmedEvent>.Subscribe(OnHit);
            EventBus<LocalWeaponSwitchedEvent>.Subscribe(OnWeaponSwitched);
            GameSettings.Changed += ApplyStyle;
        }

        private void OnDisable()
        {
            EventBus<CrosshairSpreadEvent>.Unsubscribe(OnSpread);
            EventBus<HitConfirmedEvent>.Unsubscribe(OnHit);
            EventBus<LocalWeaponSwitchedEvent>.Unsubscribe(OnWeaponSwitched);
            GameSettings.Changed -= ApplyStyle;
        }

        public void SetCamera(Camera camera)
        {
            m_Camera = camera;
        }

        private void OnSpread(CrosshairSpreadEvent evt)
        {
            m_TargetSpread = evt.SpreadDegrees;
            m_AimFraction = evt.AimFraction;
            m_Visible = evt.Visible;
        }

        private void OnHit(HitConfirmedEvent evt)
        {
            m_HitTime = Time.unscaledTime;
            Color color = evt.Kill ? m_Theme.killHitmarkerColor : evt.Headshot ? m_Theme.headshotHitmarkerColor : m_Theme.hitmarkerColor;
            float scale = evt.Kill ? 1.4f : 1f;
            foreach (Image line in m_HitLines)
            {
                line.color = color;
                line.rectTransform.localScale = Vector3.one * scale;
            }
        }

        private void OnWeaponSwitched(LocalWeaponSwitchedEvent evt)
        {
            if (m_Theme != null && m_Theme.useWeaponCrosshairStyle && evt.Weapon != null)
            {
                m_Style = evt.Weapon.crosshairStyle;
                ApplyStyle();
            }
        }

        private void ApplyStyle()
        {
            if (m_Theme == null || m_Dot == null)
            {
                return;
            }

            Color color = GameSettings.CrosshairColor;
            bool lines = m_Style == CrosshairStyle.Cross || m_Style == CrosshairStyle.CrossWithDot || m_Style == CrosshairStyle.Chevron;
            for (int i = 0; i < 4; i++)
            {
                bool visible = lines && !(m_Style == CrosshairStyle.Chevron && i == 0);
                m_Lines[i].enabled = visible;
                m_Lines[i].color = color;
                m_Outlines[i].enabled = visible && m_Theme.outline;
            }

            m_Dot.enabled = m_Style == CrosshairStyle.CrossWithDot || m_Style == CrosshairStyle.Dot || m_Style == CrosshairStyle.Circle;
            m_Dot.color = color;
            m_Circle.enabled = m_Style == CrosshairStyle.Circle;
            m_Circle.color = color;
        }

        private void Update()
        {
            if (m_Theme == null)
            {
                return;
            }

            m_Spread = Mathf.Lerp(m_Spread, m_TargetSpread, 1f - Mathf.Exp(-18f * Time.unscaledDeltaTime));
            float gap = m_Theme.baseGap + SpreadToPixels(m_Spread);
            float length = m_Theme.lineLength;
            float thickness = m_Theme.lineThickness;

            // 0 = top, 1 = right, 2 = bottom, 3 = left
            for (int i = 0; i < 4; i++)
            {
                Vector2 direction = i == 0 ? Vector2.up : i == 1 ? Vector2.right : i == 2 ? Vector2.down : Vector2.left;
                bool vertical = i == 0 || i == 2;
                Vector2 size = vertical ? new Vector2(thickness, length) : new Vector2(length, thickness);
                Vector2 position = direction * (gap + length * 0.5f);
                RectTransform line = m_Lines[i].rectTransform;
                line.anchoredPosition = position;
                line.sizeDelta = size;
                line.localRotation = Quaternion.identity;
                if (m_Style == CrosshairStyle.Chevron && i != 0)
                {
                    line.localRotation = Quaternion.Euler(0f, 0f, i == 1 ? 45f : i == 3 ? -45f : 0f);
                }

                RectTransform outline = m_Outlines[i].rectTransform;
                outline.anchoredPosition = position;
                outline.sizeDelta = size + Vector2.one * 2f;
                outline.localRotation = line.localRotation;
            }

            m_Circle.rectTransform.sizeDelta = Vector2.one * Mathf.Max(18f, gap * 2f + 6f);

            float aimFade = m_Theme.hideWhenAiming ? 1f - Mathf.Clamp01(m_AimFraction * 1.4f) : 1f;
            float targetAlpha = m_Visible ? aimFade : 0f;
            m_Group.alpha = Mathf.MoveTowards(m_Group.alpha, targetAlpha, Time.unscaledDeltaTime * 8f);

            float hitAge = Time.unscaledTime - m_HitTime;
            m_HitGroup.alpha = hitAge < m_Theme.hitmarkerDuration ? 1f - hitAge / m_Theme.hitmarkerDuration : 0f;
            // Hit markers stay visible even while aiming down sights.
            m_HitGroup.transform.localScale = Vector3.one * (1f + Mathf.Max(0f, 0.12f - hitAge) * 2f);
        }

        private float SpreadToPixels(float spreadDegrees)
        {
            if (m_Camera == null)
            {
                return spreadDegrees * m_Theme.pixelsPerSpreadDegree;
            }

            // Half-angle of the spread cone projected onto a 1080p reference canvas.
            float halfSpread = spreadDegrees * 0.5f * Mathf.Deg2Rad;
            float halfFov = m_Camera.fieldOfView * 0.5f * Mathf.Deg2Rad;
            return Mathf.Tan(halfSpread) / Mathf.Tan(halfFov) * 540f;
        }
    }
}
