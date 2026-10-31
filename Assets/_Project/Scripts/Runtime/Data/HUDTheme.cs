using UnityEngine;

namespace FPS.Data
{
    /// <summary>
    /// Fully data-driven HUD look. Duplicate the asset to create alternative HUD themes and assign it in GameConfig.
    /// Crosshair colour can additionally be overridden by the player in the pause menu.
    /// </summary>
    [CreateAssetMenu(menuName = "FPS/HUD Theme", fileName = "HUDTheme", order = 40)]
    public class HUDTheme : ScriptableObject
    {
        [Header("Palette")]
        public Color primary = new Color(0.94f, 0.96f, 1f, 1f);
        public Color secondary = new Color(0.62f, 0.68f, 0.76f, 1f);
        public Color panel = new Color(0.04f, 0.06f, 0.09f, 0.55f);
        public Color accent = new Color(1f, 0.67f, 0.18f, 1f);
        public Color danger = new Color(1f, 0.25f, 0.22f, 1f);
        public Color healthHigh = new Color(0.35f, 0.95f, 0.55f, 1f);
        public Color healthLow = new Color(1f, 0.25f, 0.22f, 1f);

        [Header("Layout")]
        [Range(0.5f, 2f)] public float scale = 1f;
        [Min(8)] public int fontSize = 22;
        [Min(8)] public int largeFontSize = 46;
        public Vector2 screenPadding = new Vector2(36f, 30f);

        [Header("Crosshair")]
        public bool useWeaponCrosshairStyle = true;
        public CrosshairStyle defaultStyle = CrosshairStyle.Cross;
        [Min(1f)] public float lineLength = 9f;
        [Min(1f)] public float lineThickness = 2f;
        [Min(0f)] public float baseGap = 5f;
        [Tooltip("Pixels of gap per degree of weapon spread.")]
        [Min(0f)] public float pixelsPerSpreadDegree = 9f;
        [Min(0f)] public float dotSize = 3f;
        public bool outline = true;
        public Color outlineColor = new Color(0f, 0f, 0f, 0.6f);
        public bool hideWhenAiming = true;

        [Header("Hit feedback")]
        public Color hitmarkerColor = Color.white;
        public Color headshotHitmarkerColor = new Color(1f, 0.85f, 0.2f, 1f);
        public Color killHitmarkerColor = new Color(1f, 0.25f, 0.22f, 1f);
        [Min(0.05f)] public float hitmarkerDuration = 0.22f;
        [Min(0.1f)] public float damageIndicatorDuration = 1.2f;

        [Header("Feeds")]
        [Range(1, 10)] public int killFeedEntries = 5;
        [Min(1f)] public float killFeedEntryLifetime = 6f;
        public bool showKillFeed = true;
        public bool showMatchStatus = true;
    }
}
