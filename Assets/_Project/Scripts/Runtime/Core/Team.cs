using UnityEngine;

namespace FPS.Core
{
    public enum Team : byte
    {
        Alpha = 0,
        Bravo = 1,
        Neutral = 2
    }

    public static class TeamUtility
    {
        public static readonly Color AlphaColor = new Color(0.20f, 0.55f, 1.00f);
        public static readonly Color BravoColor = new Color(1.00f, 0.38f, 0.22f);
        public static readonly Color NeutralColor = new Color(0.85f, 0.85f, 0.85f);

        public static Color GetColor(Team team)
        {
            switch (team)
            {
                case Team.Alpha: return AlphaColor;
                case Team.Bravo: return BravoColor;
                default: return NeutralColor;
            }
        }

        public static string GetName(Team team)
        {
            switch (team)
            {
                case Team.Alpha: return "ALPHA";
                case Team.Bravo: return "BRAVO";
                default: return "NEUTRAL";
            }
        }

        public static Team Opposing(Team team)
        {
            switch (team)
            {
                case Team.Alpha: return Team.Bravo;
                case Team.Bravo: return Team.Alpha;
                default: return Team.Neutral;
            }
        }

        public static bool AreHostile(Team a, Team b)
        {
            return a != b || a == Team.Neutral;
        }
    }
}
