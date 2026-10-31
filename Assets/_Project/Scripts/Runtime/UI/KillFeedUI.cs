using System.Collections.Generic;
using FPS.Core;
using FPS.Data;
using UnityEngine;
using UnityEngine.UI;

namespace FPS.UI
{
    /// <summary>Top-right kill feed with team-coloured names, weapon and headshot marker.</summary>
    public class KillFeedUI : MonoBehaviour
    {
        private struct Row
        {
            public Text Text;
            public float Time;
        }

        private readonly List<Row> m_Rows = new List<Row>(8);
        private HUDTheme m_Theme;
        private RectTransform m_Root;

        public void Build(HUDTheme theme, RectTransform parent)
        {
            m_Theme = theme;
            m_Root = UIFactory.CreateRect("KillFeed", parent, new Vector2(1f, 1f), new Vector2(1f, 1f), new Vector2(-theme.screenPadding.x, -theme.screenPadding.y), new Vector2(560f, 260f));
            for (int i = 0; i < theme.killFeedEntries; i++)
            {
                Text text = UIFactory.CreateText("Row" + i, m_Root, string.Empty, Mathf.RoundToInt(theme.fontSize * 0.85f), TextAnchor.MiddleRight, theme.primary,
                    new Vector2(1f, 1f), new Vector2(1f, 1f), new Vector2(0f, -i * 30f), new Vector2(560f, 28f));
                m_Rows.Add(new Row { Text = text, Time = -100f });
            }
        }

        private void OnEnable()
        {
            EventBus<KillFeedEvent>.Subscribe(OnKill);
        }

        private void OnDisable()
        {
            EventBus<KillFeedEvent>.Unsubscribe(OnKill);
        }

        private void OnKill(KillFeedEvent evt)
        {
            if (m_Theme == null || !m_Theme.showKillFeed || m_Rows.Count == 0)
            {
                return;
            }

            // Shift rows down and insert at the top.
            for (int i = m_Rows.Count - 1; i > 0; i--)
            {
                Row row = m_Rows[i];
                row.Text.text = m_Rows[i - 1].Text.text;
                row.Time = m_Rows[i - 1].Time;
                m_Rows[i] = row;
            }

            string victim = $"<color=#{UIFactory.ToHex(TeamUtility.GetColor(evt.VictimTeam))}>{evt.VictimName}</color>";
            string line;
            if (string.IsNullOrEmpty(evt.KillerName))
            {
                line = $"{victim} <color=#AAAAAA>[{evt.WeaponName}]</color>";
            }
            else
            {
                string killer = $"<color=#{UIFactory.ToHex(TeamUtility.GetColor(evt.KillerTeam))}>{evt.KillerName}</color>";
                string headshot = evt.Headshot ? " <color=#FFD640>[HS]</color>" : string.Empty;
                line = $"{killer} <color=#DDDDDD>[{evt.WeaponName}]</color>{headshot} {victim}";
            }

            Row top = m_Rows[0];
            top.Text.text = line;
            top.Time = Time.unscaledTime;
            m_Rows[0] = top;
        }

        private void Update()
        {
            if (m_Theme == null)
            {
                return;
            }

            for (int i = 0; i < m_Rows.Count; i++)
            {
                float age = Time.unscaledTime - m_Rows[i].Time;
                float alpha = Mathf.Clamp01((m_Theme.killFeedEntryLifetime - age) / 0.75f);
                Color color = m_Rows[i].Text.color;
                color.a = alpha;
                m_Rows[i].Text.color = color;
            }
        }
    }
}
