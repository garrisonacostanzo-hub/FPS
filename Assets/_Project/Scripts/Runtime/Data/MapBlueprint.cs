using System;
using System.Collections.Generic;
using FPS.Core;
using UnityEngine;

namespace FPS.Data
{
    public enum TacticalZoneType : byte
    {
        SpawnBase,
        SniperPerch,
        CloseQuartersArena,
        TraversalCorridor,
        CaptureObjective
    }

    [Serializable]
    public class ZoneDefinition
    {
        public string name = "Zone";
        public TacticalZoneType type = TacticalZoneType.CaptureObjective;
        [Tooltip("Centre of the zone in world metres (X, Z). Height is sampled from the terrain.")]
        public Vector2 center;
        [Tooltip("Footprint size in metres (X = width, Y = depth).")]
        public Vector2 size = new Vector2(30f, 30f);
        [Range(-180f, 180f)] public float rotation;
        public Team team = Team.Neutral;
        [Tooltip("For corridors: the end point (X, Z). The centre is used as the start point.")]
        public Vector2 endPoint;
        [Tooltip("Raise (positive) or lower (negative) the terrain under the zone, in metres.")]
        public float terrainOffset;
        [Tooltip("Capture zone letter / display label.")]
        public string label = "A";
    }

    /// <summary>
    /// Declarative description of the battlefield. The editor MapGenerator turns this into terrain, modular
    /// structures, cover, spawn points, capture areas, patrol routes and navigation data.
    /// Edit the zones and re-run "FPS > Build Battlefield Scene" to iterate on the layout.
    /// </summary>
    [CreateAssetMenu(menuName = "FPS/Map Blueprint", fileName = "MapBlueprint", order = 50)]
    public class MapBlueprint : ScriptableObject
    {
        [Header("Terrain")]
        [Min(128f)] public float terrainSize = 1000f;
        [Min(10f)] public float terrainHeight = 120f;
        [Tooltip("Height (m) of the flattened playable plateau.")]
        [Min(0f)] public float baseHeight = 20f;
        [Tooltip("Playable area side length (m), centred on the terrain. Outside it the terrain rises into mountains.")]
        [Min(64f)] public float playableSize = 560f;
        [Range(129, 2049)] public int heightmapResolution = 513;
        public int seed = 1337;
        [Range(0f, 30f)] public float hillAmplitude = 6f;
        [Range(0.001f, 0.05f)] public float hillFrequency = 0.012f;

        [Header("Population")]
        [Range(0f, 1f)] public float scatterCoverDensity = 0.6f;
        [Range(0, 600)] public int scatterRockCount = 220;

        [Header("Zones")]
        public List<ZoneDefinition> zones = new List<ZoneDefinition>();

        public void ResetToDefaultLayout()
        {
            zones.Clear();
            float h = playableSize * 0.5f;

            zones.Add(new ZoneDefinition { name = "Alpha Base", type = TacticalZoneType.SpawnBase, center = new Vector2(0f, -h + 45f), size = new Vector2(70f, 40f), team = Team.Alpha });
            zones.Add(new ZoneDefinition { name = "Bravo Base", type = TacticalZoneType.SpawnBase, center = new Vector2(0f, h - 45f), size = new Vector2(70f, 40f), rotation = 180f, team = Team.Bravo });

            zones.Add(new ZoneDefinition { name = "Objective A - Quarry", type = TacticalZoneType.CaptureObjective, center = new Vector2(-150f, 0f), size = new Vector2(34f, 34f), label = "A" });
            zones.Add(new ZoneDefinition { name = "Objective B - Crossroads", type = TacticalZoneType.CaptureObjective, center = new Vector2(0f, 0f), size = new Vector2(30f, 30f), label = "B" });
            zones.Add(new ZoneDefinition { name = "Objective C - Depot", type = TacticalZoneType.CaptureObjective, center = new Vector2(150f, 0f), size = new Vector2(34f, 34f), label = "C" });

            zones.Add(new ZoneDefinition { name = "The Compound", type = TacticalZoneType.CloseQuartersArena, center = new Vector2(70f, -85f), size = new Vector2(44f, 36f) });
            zones.Add(new ZoneDefinition { name = "The Warehouse", type = TacticalZoneType.CloseQuartersArena, center = new Vector2(-70f, 85f), size = new Vector2(44f, 36f), rotation = 180f });

            zones.Add(new ZoneDefinition { name = "West Ridge Perch", type = TacticalZoneType.SniperPerch, center = new Vector2(-215f, -110f), size = new Vector2(40f, 40f), terrainOffset = 9f });
            zones.Add(new ZoneDefinition { name = "East Ridge Perch", type = TacticalZoneType.SniperPerch, center = new Vector2(215f, 110f), size = new Vector2(40f, 40f), terrainOffset = 9f, rotation = 180f });
            zones.Add(new ZoneDefinition { name = "Water Tower", type = TacticalZoneType.SniperPerch, center = new Vector2(10f, 60f), size = new Vector2(30f, 30f) });

            zones.Add(new ZoneDefinition { name = "West Canal", type = TacticalZoneType.TraversalCorridor, center = new Vector2(-150f, -h + 60f), endPoint = new Vector2(-150f, h - 60f), size = new Vector2(16f, 0f), terrainOffset = -2.5f });
            zones.Add(new ZoneDefinition { name = "Main Street", type = TacticalZoneType.TraversalCorridor, center = new Vector2(0f, -h + 70f), endPoint = new Vector2(0f, h - 70f), size = new Vector2(14f, 0f) });
            zones.Add(new ZoneDefinition { name = "East Rail Cut", type = TacticalZoneType.TraversalCorridor, center = new Vector2(150f, -h + 60f), endPoint = new Vector2(150f, h - 60f), size = new Vector2(16f, 0f), terrainOffset = -2.5f });
            zones.Add(new ZoneDefinition { name = "Midline Road", type = TacticalZoneType.TraversalCorridor, center = new Vector2(-h + 50f, -30f), endPoint = new Vector2(h - 50f, 30f), size = new Vector2(12f, 0f) });
        }

        private void Reset()
        {
            ResetToDefaultLayout();
        }
    }
}
