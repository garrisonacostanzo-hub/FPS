using System.Collections.Generic;
using FPS.Core;
using UnityEngine;

namespace FPS.World
{
    /// <summary>Team spawn location. The server's SpawnSelector scores these by enemy proximity and visibility.</summary>
    public class SpawnPoint : MonoBehaviour
    {
        [SerializeField] private Team m_Team = Team.Alpha;
        [Tooltip("Higher priority spawns are preferred when equally safe (e.g. base spawns over forward spawns).")]
        [SerializeField, Range(0f, 1f)] private float m_Priority = 0.5f;

        private static readonly List<SpawnPoint> s_All = new List<SpawnPoint>(64);

        public static IReadOnlyList<SpawnPoint> All => s_All;
        public Team Team => m_Team;
        public float Priority => m_Priority;
        public float LastUsedTime { get; set; } = -999f;

        public void Configure(Team team, float priority)
        {
            m_Team = team;
            m_Priority = priority;
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

        private void OnDrawGizmos()
        {
            Gizmos.color = TeamUtility.GetColor(m_Team);
            Gizmos.DrawWireCube(transform.position + Vector3.up * 0.9f, new Vector3(0.7f, 1.8f, 0.7f));
            Gizmos.DrawLine(transform.position + Vector3.up * 1.5f, transform.position + Vector3.up * 1.5f + transform.forward);
        }
    }
}
