using System.Collections.Generic;
using System.Text;
using FPS.Core;
using FPS.Data;
using FPS.Networking;
using UnityEngine;
using UnityEngine.UI;

namespace FPS.UI
{
    /// <summary>Hold-to-show (Tab) scoreboard listing humans and bots of both teams, sorted by score.</summary>
    public class ScoreboardUI : MonoBehaviour
    {
        private const int k_Columns = 5;
        private static readonly string[] s_Headers = { "NAME", "K", "D", "CAP", "SCORE" };
        private static readonly float[] s_ColumnX = { 0f, 330f, 390f, 455f, 545f };

        private readonly List<ScoreEntry> m_Entries = new List<ScoreEntry>(64);
        private readonly StringBuilder[] m_Builders = new StringBuilder[k_Columns];
        private readonly Text[] m_AlphaColumns = new Text[k_Columns];
        private readonly Text[] m_BravoColumns = new Text[k_Columns];
        private HUDTheme m_Theme;
        private GameObject m_Panel;
        private Text m_Header;
        private float m_NextRefresh;

        public bool IsVisible => m_Panel != null && m_Panel.activeSelf;

        public void Build(HUDTheme theme, RectTransform parent)
        {
            m_Theme = theme;
            for (int i = 0; i < k_Columns; i++)
            {
                m_Builders[i] = new StringBuilder(512);
            }

            Image panel = UIFactory.CreateImage("Scoreboard", parent, new Color(0.02f, 0.03f, 0.05f, 0.85f), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(1280f, 720f));
            m_Panel = panel.gameObject;
            m_Header = UIFactory.CreateText("Header", panel.transform, "SCOREBOARD", theme.fontSize + 6, TextAnchor.UpperCenter, theme.primary,
                new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0f, -18f), new Vector2(1240f, 40f));

            BuildTeam(panel.transform, Team.Alpha, new Vector2(30f, -80f), m_AlphaColumns);
            BuildTeam(panel.transform, Team.Bravo, new Vector2(660f, -80f), m_BravoColumns);
            m_Panel.SetActive(false);
        }

        private void BuildTeam(Transform parent, Team team, Vector2 origin, Text[] columns)
        {
            UIFactory.CreateText(team + "Title", parent, TeamUtility.GetName(team), m_Theme.fontSize + 2, TextAnchor.UpperLeft, TeamUtility.GetColor(team),
                new Vector2(0f, 1f), new Vector2(0f, 1f), origin, new Vector2(590f, 34f));
            for (int c = 0; c < k_Columns; c++)
            {
                TextAnchor alignment = c == 0 ? TextAnchor.UpperLeft : TextAnchor.UpperRight;
                float width = c == 0 ? 320f : 60f;
                Vector2 pivot = c == 0 ? new Vector2(0f, 1f) : new Vector2(1f, 1f);
                float x = c == 0 ? s_ColumnX[c] : s_ColumnX[c] + width * 0.5f;
                UIFactory.CreateText(team + "H" + c, parent, s_Headers[c], m_Theme.fontSize - 6, alignment, m_Theme.secondary,
                    new Vector2(0f, 1f), pivot, origin + new Vector2(x, -38f), new Vector2(width, 26f), false);
                columns[c] = UIFactory.CreateText(team + "C" + c, parent, string.Empty, m_Theme.fontSize - 3, alignment, m_Theme.primary,
                    new Vector2(0f, 1f), pivot, origin + new Vector2(x, -66f), new Vector2(width, 580f), false);
                columns[c].lineSpacing = 1.15f;
            }
        }

        public void SetVisible(bool visible)
        {
            if (m_Panel != null && m_Panel.activeSelf != visible)
            {
                m_Panel.SetActive(visible);
                m_NextRefresh = 0f;
            }
        }

        private void Update()
        {
            if (!IsVisible || Time.unscaledTime < m_NextRefresh)
            {
                return;
            }

            m_NextRefresh = Time.unscaledTime + 0.25f;
            MatchManager match = MatchManager.Instance;
            if (match == null)
            {
                m_Header.text = "Waiting for match...";
                return;
            }

            match.CopyScoreboard(m_Entries);
            m_Entries.Sort((a, b) => b.Score != a.Score ? b.Score.CompareTo(a.Score) : b.Kills.CompareTo(a.Kills));
            m_Header.text = $"DOMINATION   <color=#{UIFactory.ToHex(TeamUtility.AlphaColor)}>{match.AlphaScore}</color>  -  " +
                            $"<color=#{UIFactory.ToHex(TeamUtility.BravoColor)}>{match.BravoScore}</color>   (first to {match.ScoreLimit})";
            FillTeam(Team.Alpha, m_AlphaColumns);
            FillTeam(Team.Bravo, m_BravoColumns);
        }

        private void FillTeam(Team team, Text[] columns)
        {
            for (int c = 0; c < k_Columns; c++)
            {
                m_Builders[c].Clear();
            }

            foreach (ScoreEntry entry in m_Entries)
            {
                if (entry.Team != team)
                {
                    continue;
                }

                string colour = entry.IsBot ? "<color=#B8C0CC>" : "<color=#FFFFFF>";
                m_Builders[0].Append(colour).Append(entry.Name.ToString()).Append("</color>\n");
                m_Builders[1].Append(entry.Kills).Append('\n');
                m_Builders[2].Append(entry.Deaths).Append('\n');
                m_Builders[3].Append(entry.Captures).Append('\n');
                m_Builders[4].Append(entry.Score).Append('\n');
            }

            for (int c = 0; c < k_Columns; c++)
            {
                columns[c].text = m_Builders[c].ToString();
            }
        }
    }
}
