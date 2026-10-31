using System.Collections.Generic;
using FPS.Core;
using FPS.Data;
using UnityEngine;

namespace FPS.World
{
    /// <summary>
    /// Volume describing a tactical area of the map (sniper perch, CQB arena, corridor, objective, base).
    /// Used by AI (e.g. long-range weapons prefer perches), by the HUD (location name) and by designers as a
    /// visual layout aid.
    /// </summary>
    public class TacticalZone : MonoBehaviour
    {
        [SerializeField] private string m_DisplayName = "Zone";
        [SerializeField] private TacticalZoneType m_Type = TacticalZoneType.CaptureObjective;
        [SerializeField] private Vector3 m_Size = new Vector3(30f, 20f, 30f);
        [SerializeField] private Team m_Team = Team.Neutral;

        private static readonly List<TacticalZone> s_All = new List<TacticalZone>(16);

        public static IReadOnlyList<TacticalZone> All => s_All;
        public string DisplayName => m_DisplayName;
        public TacticalZoneType Type => m_Type;
        public Team Team => m_Team;
        public Vector3 Size => m_Size;

        public void Configure(string displayName, TacticalZoneType type, Vector3 size, Team team)
        {
            m_DisplayName = displayName;
            m_Type = type;
            m_Size = size;
            m_Team = team;
        }

        private void OnEnable()
        {
            if (!s_All.Contains(this))
            {
                s_All.Add(this);
            }
        }

        private void OnDisable()
        {
            s_All.Remove(this);
        }

        public bool Contains(Vector3 worldPosition)
        {
            Vector3 local = transform.InverseTransformPoint(worldPosition);
            return Mathf.Abs(local.x) <= m_Size.x * 0.5f && Mathf.Abs(local.z) <= m_Size.z * 0.5f && local.y >= -5f && local.y <= m_Size.y;
        }

        public Vector3 RandomPoint()
        {
            Vector3 local = new Vector3(Random.Range(-0.5f, 0.5f) * m_Size.x, 0f, Random.Range(-0.5f, 0.5f) * m_Size.z);
            return transform.TransformPoint(local);
        }

        public static TacticalZone Find(Vector3 position)
        {
            for (int i = 0; i < s_All.Count; i++)
            {
                if (s_All[i].Contains(position))
                {
                    return s_All[i];
                }
            }

            return null;
        }

        public static TacticalZone FindClosest(Vector3 position, TacticalZoneType type)
        {
            TacticalZone best = null;
            float bestDistance = float.MaxValue;
            for (int i = 0; i < s_All.Count; i++)
            {
                if (s_All[i].m_Type != type)
                {
                    continue;
                }

                float distance = (s_All[i].transform.position - position).sqrMagnitude;
                if (distance < bestDistance)
                {
                    bestDistance = distance;
                    best = s_All[i];
                }
            }

            return best;
        }

        private void OnDrawGizmos()
        {
            Color color;
            switch (m_Type)
            {
                case TacticalZoneType.SniperPerch: color = new Color(0.8f, 0.3f, 1f, 0.35f); break;
                case TacticalZoneType.CloseQuartersArena: color = new Color(1f, 0.4f, 0.2f, 0.35f); break;
                case TacticalZoneType.TraversalCorridor: color = new Color(0.3f, 0.9f, 0.4f, 0.35f); break;
                case TacticalZoneType.CaptureObjective: color = new Color(1f, 0.85f, 0.2f, 0.35f); break;
                default: color = new Color(TeamUtility.GetColor(m_Team).r, TeamUtility.GetColor(m_Team).g, TeamUtility.GetColor(m_Team).b, 0.35f); break;
            }

            Gizmos.color = color;
            Gizmos.matrix = transform.localToWorldMatrix;
            Gizmos.DrawWireCube(new Vector3(0f, m_Size.y * 0.5f, 0f), m_Size);
            Gizmos.matrix = Matrix4x4.identity;
        }
    }
}
