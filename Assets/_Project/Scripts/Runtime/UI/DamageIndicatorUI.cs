using FPS.Core;
using FPS.Data;
using UnityEngine;
using UnityEngine.UI;

namespace FPS.UI
{
    /// <summary>Directional damage arcs around the screen centre pointing at where the damage came from.</summary>
    public class DamageIndicatorUI : MonoBehaviour
    {
        private const int k_Count = 6;

        private struct Indicator
        {
            public RectTransform Pivot;
            public Image Image;
            public Vector3 Source;
            public float Time;
        }

        private readonly Indicator[] m_Indicators = new Indicator[k_Count];
        private HUDTheme m_Theme;
        private Transform m_View;
        private int m_Next;

        public void Build(HUDTheme theme, RectTransform parent)
        {
            m_Theme = theme;
            RectTransform root = UIFactory.CreateRect("DamageIndicators", parent, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(10f, 10f));
            for (int i = 0; i < k_Count; i++)
            {
                RectTransform pivot = UIFactory.CreateRect("Pivot" + i, root, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.one);
                Image image = UIFactory.CreateImage("Arc", pivot, theme.danger, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0f), new Vector2(0f, 150f), new Vector2(90f, 9f));
                image.enabled = false;
                m_Indicators[i] = new Indicator { Pivot = pivot, Image = image, Time = -10f };
            }
        }

        public void SetView(Transform view)
        {
            m_View = view;
        }

        private void OnEnable()
        {
            EventBus<LocalDamageTakenEvent>.Subscribe(OnDamage);
        }

        private void OnDisable()
        {
            EventBus<LocalDamageTakenEvent>.Unsubscribe(OnDamage);
        }

        private void OnDamage(LocalDamageTakenEvent evt)
        {
            if (m_Theme == null)
            {
                return;
            }

            m_Indicators[m_Next].Source = evt.SourcePosition;
            m_Indicators[m_Next].Time = Time.unscaledTime;
            m_Indicators[m_Next].Image.enabled = true;
            m_Next = (m_Next + 1) % k_Count;
        }

        private void Update()
        {
            if (m_Theme == null)
            {
                return;
            }

            for (int i = 0; i < k_Count; i++)
            {
                Indicator indicator = m_Indicators[i];
                float age = Time.unscaledTime - indicator.Time;
                if (age > m_Theme.damageIndicatorDuration || m_View == null)
                {
                    indicator.Image.enabled = false;
                    continue;
                }

                Vector3 toSource = indicator.Source - m_View.position;
                toSource.y = 0f;
                Vector3 forward = m_View.forward;
                forward.y = 0f;
                float angle = Vector3.SignedAngle(forward, toSource, Vector3.up);
                indicator.Pivot.localRotation = Quaternion.Euler(0f, 0f, -angle);
                Color color = m_Theme.danger;
                color.a = Mathf.Clamp01(1f - age / m_Theme.damageIndicatorDuration) * 0.9f;
                indicator.Image.color = color;
            }
        }
    }
}
