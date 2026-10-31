using System.Collections.Generic;
using FPS.AI;
using FPS.Core;
using FPS.Data;
using FPS.World;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEngine;
using UnityEngine.AI;

namespace FPS.EditorTools
{
    /// <summary>
    /// Generates the large-scale battlefield from a <see cref="MapBlueprint"/> into the currently open scene:
    /// sculpted + painted Terrain, tactical zones (spawn bases, sniper perches, CQB compounds, traversal corridors,
    /// capture objectives) built from the modular kit, scattered cover, spawn points, patrol routes, cover points,
    /// map boundaries, decorative detail sectors, NavMesh surface/links and the occlusion area.
    /// </summary>
    public class MapGenerator
    {
        private readonly MapBlueprint m_Blueprint;
        private readonly System.Random m_Random;
        private readonly List<ZoneDefinition> m_Zones;
        private Terrain m_Terrain;
        private Transform m_Environment;
        private Transform m_Structures;
        private Transform m_CoverRoot;
        private Transform m_Gameplay;
        private Transform m_Spawns;
        private Transform m_Routes;
        private Transform m_Markers;
        private Transform m_ZonesRoot;
        private Transform m_CoverPointsRoot;
        private Transform m_DecorRoot;
        private readonly List<Light> m_InteriorLights = new List<Light>();

        public Terrain Terrain => m_Terrain;
        public Transform CoverPointsRoot => m_CoverPointsRoot;
        public float PlayableHalf => m_Blueprint.playableSize * 0.5f;
        public float BaseHeight => m_Blueprint.baseHeight;

        public MapGenerator(MapBlueprint blueprint)
        {
            m_Blueprint = blueprint;
            m_Random = new System.Random(blueprint.seed);
            m_Zones = blueprint.zones;
        }

        private float Range(float min, float max)
        {
            return (float)(min + m_Random.NextDouble() * (max - min));
        }

        // ================================================================================================
        // Entry point
        // ================================================================================================

        public void Generate(Transform sceneRoot)
        {
            m_Environment = Group("Environment", sceneRoot);
            m_Structures = Group("Structures", m_Environment);
            m_CoverRoot = Group("Cover", m_Environment);
            m_DecorRoot = Group("DetailSectors", m_Environment);
            m_Gameplay = Group("Gameplay", sceneRoot);
            m_Spawns = Group("SpawnPoints", m_Gameplay);
            m_Routes = Group("PatrolRoutes", m_Gameplay);
            m_Markers = Group("CaptureZoneMarkers", m_Gameplay);
            m_ZonesRoot = Group("TacticalZones", m_Gameplay);
            m_CoverPointsRoot = Group("CoverPoints", m_Gameplay);

            EditorUtil.Progress("FPS Builder", "Sculpting terrain", 0.1f);
            CreateTerrain();

            int index = 0;
            foreach (ZoneDefinition zone in m_Zones)
            {
                EditorUtil.Progress("FPS Builder", "Building zone: " + zone.name, 0.2f + 0.4f * index++ / Mathf.Max(1, m_Zones.Count));
                switch (zone.type)
                {
                    case TacticalZoneType.SpawnBase: BuildSpawnBase(zone); break;
                    case TacticalZoneType.CaptureObjective: BuildObjective(zone); break;
                    case TacticalZoneType.CloseQuartersArena: BuildCompound(zone); break;
                    case TacticalZoneType.SniperPerch: BuildPerch(zone); break;
                    case TacticalZoneType.TraversalCorridor: BuildCorridor(zone); break;
                }
            }

            EditorUtil.Progress("FPS Builder", "Scattering rocks and detail", 0.65f);
            ScatterRocks();
            ScatterDetail();
            BuildBoundaries();
            BuildObjectiveLoopRoute();
            EditorUtil.Progress("FPS Builder", "Generating cover points", 0.7f);
            GenerateCoverPoints(m_CoverPointsRoot);
        }

        private static Transform Group(string name, Transform parent)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            return go.transform;
        }

        // ================================================================================================
        // Terrain
        // ================================================================================================

        private void CreateTerrain()
        {
            MapBlueprint b = m_Blueprint;
            int resolution = Mathf.ClosestPowerOfTwo(b.heightmapResolution - 1) + 1;
            var data = new TerrainData
            {
                heightmapResolution = resolution,
                alphamapResolution = 512,
                baseMapResolution = 512
            };
            data.SetDetailResolution(256, 16);
            data.size = new Vector3(b.terrainSize, b.terrainHeight, b.terrainSize);

            var heights = new float[resolution, resolution];
            float origin = -b.terrainSize * 0.5f;
            for (int zi = 0; zi < resolution; zi++)
            {
                for (int xi = 0; xi < resolution; xi++)
                {
                    float x = origin + xi / (float)(resolution - 1) * b.terrainSize;
                    float z = origin + zi / (float)(resolution - 1) * b.terrainSize;
                    heights[zi, xi] = Mathf.Clamp01(SampleHeight(x, z) / b.terrainHeight);
                }
            }

            data.SetHeights(0, 0, heights);
            data.terrainLayers = CreateTerrainLayers();
            PaintSplatmap(data, origin);

            string folder = EditorUtil.SceneFolder + "/Battlefield";
            EditorUtil.EnsureFolder(folder);
            string path = folder + "/Battlefield_TerrainData.asset";
            AssetDatabase.DeleteAsset(path);
            AssetDatabase.CreateAsset(data, path);

            GameObject terrainObject = Terrain.CreateTerrainGameObject(data);
            terrainObject.name = "Terrain";
            terrainObject.transform.SetParent(m_Environment, false);
            terrainObject.transform.position = new Vector3(origin, 0f, origin);
            terrainObject.layer = GameLayers.Environment;
            m_Terrain = terrainObject.GetComponent<Terrain>();
            m_Terrain.heightmapPixelError = 6f;
            m_Terrain.basemapDistance = 350f;
            m_Terrain.drawInstanced = true;
            m_Terrain.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.TwoSided;
            m_Terrain.materialTemplate = CreateTerrainMaterial();
            GameObjectUtility.SetStaticEditorFlags(terrainObject, StaticEditorFlags.OccluderStatic | StaticEditorFlags.OccludeeStatic | StaticEditorFlags.ReflectionProbeStatic);
        }

        /// <summary>Analytic height field (metres) used for the heightmap.</summary>
        private float SampleHeight(float x, float z)
        {
            MapBlueprint b = m_Blueprint;
            float half = b.playableSize * 0.5f;
            float seed = b.seed * 0.137f;
            float hills = (Mathf.PerlinNoise(x * b.hillFrequency + seed, z * b.hillFrequency - seed) - 0.5f) * 2f * b.hillAmplitude;
            float edge = Mathf.Max(Mathf.Abs(x), Mathf.Abs(z)) - half;
            float mountainMask = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(-15f, 140f, edge));
            float mountainNoise = 0.55f + 0.45f * Mathf.PerlinNoise(x * 0.008f + seed * 2f, z * 0.008f);
            float mountain = mountainMask * (b.terrainHeight * 0.8f - b.baseHeight) * mountainNoise;
            float height = b.baseHeight + hills * (1f - mountainMask) + mountain;

            // Corridors first (long features), then compact zones on top so structures always sit on flat ground.
            foreach (ZoneDefinition zone in m_Zones)
            {
                if (zone.type != TacticalZoneType.TraversalCorridor)
                {
                    continue;
                }

                float distance = DistanceToSegment(new Vector2(x, z), zone.center, zone.endPoint);
                float halfWidth = zone.size.x * 0.5f;
                float weight = 1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(halfWidth, halfWidth + 14f, distance));
                height = Mathf.Lerp(height, b.baseHeight + zone.terrainOffset, weight);
            }

            foreach (ZoneDefinition zone in m_Zones)
            {
                if (zone.type == TacticalZoneType.TraversalCorridor)
                {
                    continue;
                }

                Vector2 local = ToZoneLocal(zone, new Vector2(x, z));
                float dx = Mathf.Max(0f, Mathf.Abs(local.x) - zone.size.x * 0.5f);
                float dz = Mathf.Max(0f, Mathf.Abs(local.y) - zone.size.y * 0.5f);
                float outside = Mathf.Sqrt(dx * dx + dz * dz);
                float falloff = zone.terrainOffset > 0f ? 26f : 12f;
                float weight = 1f - Mathf.SmoothStep(0f, 1f, outside / falloff);
                height = Mathf.Lerp(height, b.baseHeight + zone.terrainOffset, weight);
            }

            return height;
        }

        private TerrainLayer[] CreateTerrainLayers()
        {
            string[] names = { "Terrain_Grass", "Terrain_Dirt", "Terrain_Rock", "Terrain_Gravel" };
            var layers = new TerrainLayer[names.Length];
            for (int i = 0; i < names.Length; i++)
            {
                string path = $"{EditorUtil.MaterialFolder}/{names[i]}.terrainlayer";
                var layer = AssetDatabase.LoadAssetAtPath<TerrainLayer>(path);
                if (layer == null)
                {
                    layer = new TerrainLayer();
                    AssetDatabase.CreateAsset(layer, path);
                }

                layer.diffuseTexture = AssetFactory.GetTexture(names[i]);
                layer.tileSize = new Vector2(6f, 6f);
                layer.smoothness = 0f;
                EditorUtility.SetDirty(layer);
                layers[i] = layer;
            }

            return layers;
        }

        private static Material CreateTerrainMaterial()
        {
            string path = EditorUtil.MaterialFolder + "/Terrain_URP.mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Terrain/Lit");
                if (shader == null)
                {
                    shader = Shader.Find("Nature/Terrain/Standard");
                }

                if (shader == null)
                {
                    return null;
                }

                material = new Material(shader);
                AssetDatabase.CreateAsset(material, path);
            }

            return material;
        }

        private void PaintSplatmap(TerrainData data, float origin)
        {
            int resolution = data.alphamapResolution;
            int layers = data.terrainLayers.Length;
            var maps = new float[resolution, resolution, layers];
            for (int zi = 0; zi < resolution; zi++)
            {
                for (int xi = 0; xi < resolution; xi++)
                {
                    float nx = xi / (float)(resolution - 1);
                    float nz = zi / (float)(resolution - 1);
                    float x = origin + nx * data.size.x;
                    float z = origin + nz * data.size.z;
                    float steepness = data.GetSteepness(nx, nz);

                    float rock = Mathf.InverseLerp(26f, 40f, steepness);
                    float dirt = 0f;
                    float gravel = 0f;
                    foreach (ZoneDefinition zone in m_Zones)
                    {
                        if (zone.type == TacticalZoneType.TraversalCorridor)
                        {
                            float distance = DistanceToSegment(new Vector2(x, z), zone.center, zone.endPoint);
                            dirt = Mathf.Max(dirt, 1f - Mathf.InverseLerp(zone.size.x * 0.45f, zone.size.x * 0.5f + 6f, distance));
                        }
                        else
                        {
                            Vector2 local = ToZoneLocal(zone, new Vector2(x, z));
                            float outside = Mathf.Max(Mathf.Abs(local.x) - zone.size.x * 0.5f, Mathf.Abs(local.y) - zone.size.y * 0.5f);
                            float weight = 1f - Mathf.InverseLerp(0f, 8f, outside);
                            if (zone.type == TacticalZoneType.SpawnBase || zone.type == TacticalZoneType.CloseQuartersArena)
                            {
                                gravel = Mathf.Max(gravel, weight);
                            }
                            else
                            {
                                dirt = Mathf.Max(dirt, weight * 0.8f);
                            }
                        }
                    }

                    float noise = Mathf.PerlinNoise(x * 0.05f, z * 0.05f);
                    dirt = Mathf.Max(dirt, Mathf.InverseLerp(0.68f, 0.85f, noise) * 0.6f);
                    float grass = Mathf.Max(0f, 1f - rock - dirt - gravel);
                    float sum = grass + dirt + rock + gravel + 0.0001f;
                    maps[zi, xi, 0] = grass / sum;
                    maps[zi, xi, 1] = dirt / sum;
                    maps[zi, xi, 2] = rock / sum;
                    maps[zi, xi, 3] = gravel / sum;
                }
            }

            data.SetAlphamaps(0, 0, maps);
        }

        public float Ground(float x, float z)
        {
            return m_Terrain.SampleHeight(new Vector3(x, 0f, z)) + m_Terrain.transform.position.y;
        }

        private Vector3 GroundPoint(Vector2 xz)
        {
            return new Vector3(xz.x, Ground(xz.x, xz.y), xz.y);
        }

        // ================================================================================================
        // Placement helpers
        // ================================================================================================

        private static Vector2 ToZoneLocal(ZoneDefinition zone, Vector2 world)
        {
            Vector2 offset = world - zone.center;
            float radians = zone.rotation * Mathf.Deg2Rad;
            float cos = Mathf.Cos(radians);
            float sin = Mathf.Sin(radians);
            return new Vector2(offset.x * cos - offset.y * sin, offset.x * sin + offset.y * cos);
        }

        private static Vector2 FromZoneLocal(ZoneDefinition zone, Vector2 local)
        {
            float radians = -zone.rotation * Mathf.Deg2Rad;
            float cos = Mathf.Cos(radians);
            float sin = Mathf.Sin(radians);
            return zone.center + new Vector2(local.x * cos - local.y * sin, local.x * sin + local.y * cos);
        }

        private static float DistanceToSegment(Vector2 p, Vector2 a, Vector2 b)
        {
            Vector2 ab = b - a;
            float t = ab.sqrMagnitude > 0.0001f ? Mathf.Clamp01(Vector2.Dot(p - a, ab) / ab.sqrMagnitude) : 0f;
            return Vector2.Distance(p, a + ab * t);
        }

        private GameObject Place(string kit, Vector3 position, float yaw, Transform parent, Vector3? scale = null)
        {
            GameObject prefab = PrefabFactory.LoadKit(kit);
            if (prefab == null)
            {
                Debug.LogWarning("[FPS Builder] Missing kit prefab " + kit);
                return null;
            }

            var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, parent);
            instance.transform.SetPositionAndRotation(position, Quaternion.Euler(0f, yaw, 0f));
            if (scale.HasValue)
            {
                instance.transform.localScale = scale.Value;
            }

            return instance;
        }

        /// <summary>Places a kit piece using zone-local coordinates (x right, z forward), snapped to the ground.</summary>
        private GameObject PlaceLocal(ZoneDefinition zone, string kit, Vector2 local, float localYaw, Transform parent, float heightOffset = 0f, Vector3? scale = null)
        {
            Vector2 world = FromZoneLocal(zone, local);
            Vector3 position = new Vector3(world.x, Ground(world.x, world.y) + heightOffset, world.y);
            return Place(kit, position, zone.rotation + localYaw, parent, scale);
        }

        private Transform ZoneRoot(ZoneDefinition zone, Vector3 size)
        {
            Transform root = Group(zone.name, m_Structures);
            var zoneObject = new GameObject(zone.name);
            zoneObject.transform.SetParent(m_ZonesRoot, false);
            zoneObject.transform.SetPositionAndRotation(GroundPoint(zone.center), Quaternion.Euler(0f, zone.rotation, 0f));
            zoneObject.AddComponent<TacticalZone>().Configure(zone.name, zone.type, size, zone.team);
            return root;
        }

        private PatrolRoute CreateRoute(string name, Team team, IEnumerable<Vector3> points, bool loop = true)
        {
            var go = new GameObject("Route_" + name);
            go.transform.SetParent(m_Routes, false);
            var route = go.AddComponent<PatrolRoute>();
            route.Configure(team, loop);
            int i = 0;
            foreach (Vector3 point in points)
            {
                var waypoint = new GameObject("Waypoint" + i++);
                waypoint.transform.SetParent(go.transform, false);
                waypoint.transform.position = point;
            }

            return route;
        }

        private void Tint(GameObject instance, Material material)
        {
            if (instance == null || material == null)
            {
                return;
            }

            foreach (MeshRenderer renderer in instance.GetComponentsInChildren<MeshRenderer>())
            {
                if (renderer.gameObject.name == "Body" || renderer.gameObject.name == "Part")
                {
                    renderer.sharedMaterial = material;
                }
            }
        }

        // ================================================================================================
        // Zones
        // ================================================================================================

        private void BuildSpawnBase(ZoneDefinition zone)
        {
            Transform root = ZoneRoot(zone, new Vector3(zone.size.x, 12f, zone.size.y));
            float hx = zone.size.x * 0.5f;
            float hz = zone.size.y * 0.5f;
            Material teamMaterial = AssetFactory.GetMaterial(zone.team == Team.Alpha ? "Proto_Alpha" : "Proto_Bravo");

            GameObject floor = PlaceLocal(zone, "Floor_4x4", Vector2.zero, 0f, root, -0.05f, new Vector3(zone.size.x / 4f, 1f, zone.size.y / 4f));
            Tint(floor, teamMaterial);

            // Back wall (high) and side walls, front line of sandbags with two exits.
            for (float x = -hx + 2f; x <= hx - 2f + 0.01f; x += 4f)
            {
                PlaceLocal(zone, "Wall_4m", new Vector2(x, -hz), 0f, root);
            }

            for (float z = -hz + 2f; z <= hz - 2f + 0.01f; z += 4f)
            {
                bool gap = Mathf.Abs(z) < 3f;
                PlaceLocal(zone, gap ? "Wall_Door_4m" : "Wall_4m", new Vector2(-hx, z), 90f, root);
                PlaceLocal(zone, gap ? "Wall_Door_4m" : "Wall_4m", new Vector2(hx, z), 90f, root);
            }

            for (float x = -hx + 3f; x <= hx - 3f; x += 6f)
            {
                if (Mathf.Abs(x) < 6f || Mathf.Abs(Mathf.Abs(x) - hx * 0.6f) < 4f)
                {
                    continue; // exits
                }

                PlaceLocal(zone, "Sandbags", new Vector2(x, hz), 0f, m_CoverRoot);
            }

            PlaceLocal(zone, "Container_6m", new Vector2(-hx * 0.55f, hz * 0.2f), 90f, m_CoverRoot);
            PlaceLocal(zone, "Container_6m", new Vector2(hx * 0.55f, hz * 0.2f), 90f, m_CoverRoot);
            PlaceLocal(zone, "Crate_Stack", new Vector2(0f, hz * 0.45f), 0f, m_CoverRoot);

            // Spawn points: two rows near the back wall facing the battlefield.
            int count = 0;
            for (int row = 0; row < 2; row++)
            {
                for (int column = 0; column < 6; column++)
                {
                    float x = Mathf.Lerp(-hx + 6f, hx - 6f, column / 5f);
                    float z = -hz + 5f + row * 4f;
                    Vector2 world = FromZoneLocal(zone, new Vector2(x, z));
                    var spawn = new GameObject($"Spawn_{zone.team}_{count++}");
                    spawn.transform.SetParent(m_Spawns, false);
                    spawn.transform.SetPositionAndRotation(GroundPoint(world) + Vector3.up * 0.1f, Quaternion.Euler(0f, zone.rotation, 0f));
                    spawn.AddComponent<SpawnPoint>().Configure(zone.team, 0.8f);
                }
            }

            // Forward spawns near the midline of each team's half (lower priority).
            for (int i = 0; i < 4; i++)
            {
                float x = (i - 1.5f) * 70f;
                Vector2 world = FromZoneLocal(zone, new Vector2(x, hz + 70f));
                var spawn = new GameObject($"ForwardSpawn_{zone.team}_{i}");
                spawn.transform.SetParent(m_Spawns, false);
                spawn.transform.SetPositionAndRotation(GroundPoint(world) + Vector3.up * 0.1f, Quaternion.Euler(0f, zone.rotation, 0f));
                spawn.AddComponent<SpawnPoint>().Configure(zone.team, 0.3f);
            }

            CreateRoute(zone.name, zone.team, new[]
            {
                GroundPoint(FromZoneLocal(zone, new Vector2(-hx + 6f, 0f))),
                GroundPoint(FromZoneLocal(zone, new Vector2(hx - 6f, 0f))),
                GroundPoint(FromZoneLocal(zone, new Vector2(hx - 6f, hz + 10f))),
                GroundPoint(FromZoneLocal(zone, new Vector2(-hx + 6f, hz + 10f)))
            });
        }

        private void BuildObjective(ZoneDefinition zone)
        {
            Transform root = ZoneRoot(zone, new Vector3(zone.size.x, 10f, zone.size.y));
            float radius = Mathf.Min(zone.size.x, zone.size.y) * 0.5f * 0.6f;

            var marker = new GameObject("Marker_" + zone.label);
            marker.transform.SetParent(m_Markers, false);
            marker.transform.position = GroundPoint(zone.center);
            marker.AddComponent<CaptureZoneMarker>().Configure(zone.label, zone.name, radius);

            PlaceLocal(zone, "Floor_4x4", Vector2.zero, 45f, root, -0.08f, new Vector3(2f, 1f, 2f));

            // Inner ring of low cover, outer ring of high cover.
            for (int i = 0; i < 4; i++)
            {
                float angle = i * 90f + 45f;
                Vector2 direction = new Vector2(Mathf.Sin(angle * Mathf.Deg2Rad), Mathf.Cos(angle * Mathf.Deg2Rad));
                PlaceLocal(zone, "Barrier_Jersey", direction * (radius * 0.45f), angle + 90f, m_CoverRoot);
                PlaceLocal(zone, "Crate_Stack", direction * (radius * 1.25f), angle, m_CoverRoot);
                Vector2 side = new Vector2(Mathf.Sin((angle + 45f) * Mathf.Deg2Rad), Mathf.Cos((angle + 45f) * Mathf.Deg2Rad));
                PlaceLocal(zone, i % 2 == 0 ? "Sandbags" : "Wall_Low_4m", side * (radius * 0.95f), angle + 135f, m_CoverRoot);
            }

            switch (zone.label)
            {
                case "A":
                    for (int i = 0; i < 6; i++)
                    {
                        float angle = i * 60f + 15f;
                        Vector2 direction = new Vector2(Mathf.Sin(angle * Mathf.Deg2Rad), Mathf.Cos(angle * Mathf.Deg2Rad));
                        GameObject rock = PlaceLocal(zone, "Rock_Large", direction * (radius * 1.6f), Range(0f, 360f), m_CoverRoot, -0.6f, Vector3.one * Range(2.6f, 3.6f));
                        if (rock != null) rock.AddComponent<CoverObject>();
                    }

                    break;
                case "B":
                    for (int i = 0; i < 4; i++)
                    {
                        float angle = i * 90f;
                        Vector2 direction = new Vector2(Mathf.Sin(angle * Mathf.Deg2Rad), Mathf.Cos(angle * Mathf.Deg2Rad));
                        PlaceLocal(zone, "LampPost", direction * (radius * 1.7f), angle + 180f, root);
                    }

                    PlaceLocal(zone, "Container_6m", new Vector2(radius * 1.6f, radius * 0.4f), 90f, m_CoverRoot);
                    break;
                default:
                    PlaceLocal(zone, "Container_6m", new Vector2(-radius * 1.5f, 0f), 0f, m_CoverRoot);
                    PlaceLocal(zone, "Container_6m", new Vector2(radius * 1.5f, 2f), 0f, m_CoverRoot);
                    PlaceLocal(zone, "Container_6m", new Vector2(radius * 1.5f, 2f), 0f, m_CoverRoot, 2.6f);
                    PlaceLocal(zone, "Barrel", new Vector2(-2f, radius * 1.3f), 0f, root);
                    PlaceLocal(zone, "Barrel", new Vector2(-1.2f, radius * 1.4f), 0f, root);
                    break;
            }

            var points = new List<Vector3>();
            for (int i = 0; i < 6; i++)
            {
                float angle = i * 60f * Mathf.Deg2Rad;
                points.Add(GroundPoint(zone.center + new Vector2(Mathf.Sin(angle), Mathf.Cos(angle)) * (radius * 1.1f)));
            }

            CreateRoute(zone.name, Team.Neutral, points);
        }

        private void BuildCompound(ZoneDefinition zone)
        {
            Transform root = ZoneRoot(zone, new Vector3(zone.size.x, 8f, zone.size.y));
            int modulesX = Mathf.Max(4, Mathf.RoundToInt(zone.size.x / 4f));
            int modulesZ = Mathf.Max(4, Mathf.RoundToInt(zone.size.y / 4f));
            float hx = modulesX * 2f;
            float hz = modulesZ * 2f;

            PlaceLocal(zone, "Floor_4x4", Vector2.zero, 0f, root, -0.05f, new Vector3(modulesX, 1f, modulesZ));

            // Outer walls with doors and windows.
            for (int i = 0; i < modulesX; i++)
            {
                float x = -hx + 2f + i * 4f;
                PlaceLocal(zone, OuterModule(i, modulesX), new Vector2(x, -hz), 0f, root);
                PlaceLocal(zone, OuterModule(i + 1, modulesX), new Vector2(x, hz), 0f, root);
            }

            for (int i = 0; i < modulesZ; i++)
            {
                float z = -hz + 2f + i * 4f;
                PlaceLocal(zone, OuterModule(i, modulesZ), new Vector2(-hx, z), 90f, root);
                PlaceLocal(zone, OuterModule(i + 2, modulesZ), new Vector2(hx, z), 90f, root);
            }

            foreach (Vector2 corner in new[] { new Vector2(-hx, -hz), new Vector2(hx, -hz), new Vector2(-hx, hz), new Vector2(hx, hz) })
            {
                PlaceLocal(zone, "Pillar", corner, 0f, root);
            }

            // Interior partitions: one wall line along X and one along Z, each with doorways -> 4 rooms + corridors.
            int splitX = modulesX / 3;
            float wallX = -hx + splitX * 4f;
            for (int i = 0; i < modulesZ; i++)
            {
                float z = -hz + 2f + i * 4f;
                bool door = i == modulesZ / 4 || i == modulesZ * 3 / 4;
                PlaceLocal(zone, door ? "Wall_Door_4m" : "Wall_4m", new Vector2(wallX, z), 90f, root);
            }

            for (int i = splitX; i < modulesX; i++)
            {
                float x = -hx + 2f + i * 4f;
                bool door = i == splitX + 1 || i == modulesX - 2;
                PlaceLocal(zone, door ? "Wall_Door_4m" : (i % 3 == 0 ? "Wall_Window_4m" : "Wall_4m"), new Vector2(x, 0f), 0f, root);
            }

            PlaceLocal(zone, "Pillar", new Vector2(wallX, 0f), 0f, root);

            // Roof over the west hall (adds interior darkness and strong occluders).
            float hallWidth = splitX * 4f;
            PlaceLocal(zone, "Floor_4x4", new Vector2(-hx + hallWidth * 0.5f, 0f), 0f, root, 3f, new Vector3(splitX, 1f, modulesZ));

            // Interior cover and props.
            Vector2[] crateSpots =
            {
                new Vector2(-hx + hallWidth * 0.5f, -hz * 0.5f), new Vector2(-hx + hallWidth * 0.5f, hz * 0.45f),
                new Vector2(wallX + (hx - wallX) * 0.35f, -hz * 0.5f), new Vector2(wallX + (hx - wallX) * 0.7f, -hz * 0.35f),
                new Vector2(wallX + (hx - wallX) * 0.4f, hz * 0.5f), new Vector2(wallX + (hx - wallX) * 0.75f, hz * 0.6f)
            };
            for (int i = 0; i < crateSpots.Length; i++)
            {
                PlaceLocal(zone, i % 2 == 0 ? "Crate_Stack" : "Crate_1m", crateSpots[i], Range(-20f, 20f), m_CoverRoot);
            }

            PlaceLocal(zone, "Barrel", new Vector2(hx - 2f, -hz + 2f), 0f, root);
            PlaceLocal(zone, "Barrel", new Vector2(hx - 2.8f, -hz + 2.2f), 0f, root);

            // Interior lights (real-time, no shadows - cheap).
            Vector2[] lightSpots = { new Vector2(-hx + hallWidth * 0.5f, -hz * 0.5f), new Vector2(-hx + hallWidth * 0.5f, hz * 0.5f), new Vector2((wallX + hx) * 0.5f, -hz * 0.5f), new Vector2((wallX + hx) * 0.5f, hz * 0.5f) };
            foreach (Vector2 spot in lightSpots)
            {
                Vector2 world = FromZoneLocal(zone, spot);
                var lightObject = new GameObject("InteriorLight");
                lightObject.transform.SetParent(root, false);
                lightObject.transform.position = new Vector3(world.x, Ground(world.x, world.y) + 2.7f, world.y);
                var light = lightObject.AddComponent<Light>();
                light.type = LightType.Point;
                light.range = 11f;
                light.intensity = 2.2f;
                light.color = new Color(1f, 0.82f, 0.6f);
                light.shadows = LightShadows.None;
                m_InteriorLights.Add(light);
            }

            var route = new List<Vector3>();
            foreach (Vector2 spot in lightSpots)
            {
                route.Add(GroundPoint(FromZoneLocal(zone, spot)));
            }

            route.Add(GroundPoint(FromZoneLocal(zone, new Vector2(0f, hz + 8f))));
            CreateRoute(zone.name, Team.Neutral, route);
        }

        private static string OuterModule(int index, int count)
        {
            if (index % count == count / 2)
            {
                return "Wall_Door_4m";
            }

            return index % 3 == 1 ? "Wall_Window_4m" : "Wall_4m";
        }

        private void BuildPerch(ZoneDefinition zone)
        {
            Transform root = ZoneRoot(zone, new Vector3(zone.size.x, 20f, zone.size.y));
            bool tall = zone.terrainOffset <= 0.01f;
            float height = tall ? 9f : 5f;
            float platform = tall ? 6f : 8f;
            Vector2 centreLocal = Vector2.zero;
            float ground = Ground(zone.center.x, zone.center.y);
            float half = platform * 0.5f;

            // Legs + platform.
            foreach (Vector2 corner in new[] { new Vector2(-half, -half), new Vector2(half, -half), new Vector2(-half, half), new Vector2(half, half) })
            {
                PlaceLocal(zone, "Pillar", centreLocal + corner * 0.9f, 0f, root, 0f, new Vector3(1f, height / 3f, 1f));
            }

            PlaceLocal(zone, "Floor_4x4", centreLocal, 0f, root, height, new Vector3(platform / 4f, 1.5f, platform / 4f));

            // Railings (low cover) on three sides; ramp side (south / -z) left open.
            Vector3 railScale = new Vector3(platform / 4f, 1f, 1f);
            PlaceLocal(zone, "Wall_Low_4m", centreLocal + new Vector2(0f, half - 0.2f), 0f, m_CoverRoot, height + 0.3f, railScale);
            PlaceLocal(zone, "Wall_Low_4m", centreLocal + new Vector2(-half + 0.2f, 0f), 90f, m_CoverRoot, height + 0.3f, railScale);
            PlaceLocal(zone, "Wall_Low_4m", centreLocal + new Vector2(half - 0.2f, 0f), 90f, m_CoverRoot, height + 0.3f, railScale);
            PlaceLocal(zone, "Sandbags", centreLocal + new Vector2(-half * 0.4f, -half + 0.6f), 0f, m_CoverRoot, height + 0.3f, new Vector3(0.6f, 1f, 1f));

            // Ramp up to the platform.
            const float rampAngle = 27f;
            float rampLength = (height + 0.3f) / Mathf.Sin(rampAngle * Mathf.Deg2Rad);
            float horizontal = rampLength * Mathf.Cos(rampAngle * Mathf.Deg2Rad);
            Vector2 rampMidLocal = centreLocal + new Vector2(half * 0.4f, -half - horizontal * 0.5f + 0.2f);
            Vector2 rampMidWorld = FromZoneLocal(zone, rampMidLocal);
            var ramp = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ramp.name = "Ramp";
            ramp.layer = GameLayers.Environment;
            ramp.transform.SetParent(root, false);
            ramp.transform.position = new Vector3(rampMidWorld.x, ground + (height + 0.3f) * 0.5f, rampMidWorld.y);
            ramp.transform.rotation = Quaternion.Euler(0f, zone.rotation, 0f) * Quaternion.Euler(-rampAngle, 0f, 0f);
            ramp.transform.localScale = new Vector3(2.4f, 0.3f, rampLength + 0.6f);
            ramp.GetComponent<MeshRenderer>().sharedMaterial = AssetFactory.GetMaterial("Proto_Floor");
            GameObjectUtility.SetStaticEditorFlags(ramp, StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccludeeStatic);

            // One-way drop link from the platform's north edge back to the ground (bots can leave quickly).
            var linkObject = new GameObject("DropLink");
            linkObject.transform.SetParent(root, false);
            Vector2 linkStart = FromZoneLocal(zone, centreLocal + new Vector2(-half * 0.5f, half - 1.2f));
            Vector2 linkEnd = FromZoneLocal(zone, centreLocal + new Vector2(-half * 0.5f, half + 3.5f));
            linkObject.transform.position = Vector3.zero;
            var link = linkObject.AddComponent<NavMeshLink>();
            link.startPoint = new Vector3(linkStart.x, ground + height + 0.3f, linkStart.y);
            link.endPoint = new Vector3(linkEnd.x, Ground(linkEnd.x, linkEnd.y), linkEnd.y);
            link.width = 1.5f;
            link.bidirectional = false;

            // Ground cover around the base.
            for (int i = 0; i < 5; i++)
            {
                float angle = i * 72f + 20f;
                Vector2 direction = new Vector2(Mathf.Sin(angle * Mathf.Deg2Rad), Mathf.Cos(angle * Mathf.Deg2Rad));
                GameObject rock = PlaceLocal(zone, "Rock_Large", direction * (zone.size.x * 0.4f), Range(0f, 360f), m_CoverRoot, -0.5f, Vector3.one * Range(2f, 3f));
                if (rock != null) rock.AddComponent<CoverObject>();
            }

            Vector3 top = GroundPoint(zone.center);
            top.y = ground + height + 0.35f;
            CreateRoute(zone.name, Team.Neutral, new[]
            {
                GroundPoint(FromZoneLocal(zone, new Vector2(half * 0.4f, -half - horizontal - 2f))),
                top,
                GroundPoint(FromZoneLocal(zone, new Vector2(-half * 0.5f, half + 5f))),
                GroundPoint(FromZoneLocal(zone, new Vector2(half + 6f, 0f)))
            });
        }

        private void BuildCorridor(ZoneDefinition zone)
        {
            Vector2 start = zone.center;
            Vector2 end = zone.endPoint;
            Vector2 axis = end - start;
            float length = axis.magnitude;
            if (length < 1f)
            {
                return;
            }

            Vector2 direction = axis / length;
            Vector2 right = new Vector2(direction.y, -direction.x);
            float yaw = Mathf.Atan2(direction.x, direction.y) * Mathf.Rad2Deg;
            float halfWidth = zone.size.x * 0.5f;

            Transform root = Group(zone.name, m_Structures);
            var zoneObject = new GameObject(zone.name);
            zoneObject.transform.SetParent(m_ZonesRoot, false);
            Vector2 middle = (start + end) * 0.5f;
            zoneObject.transform.SetPositionAndRotation(GroundPoint(middle) + Vector3.down * 4f, Quaternion.Euler(0f, yaw, 0f));
            zoneObject.AddComponent<TacticalZone>().Configure(zone.name, zone.type, new Vector3(zone.size.x + 12f, 18f, length), zone.team);

            string[] coverKits = { "Barrier_Jersey", "Sandbags", "Crate_Stack", "Wall_Low_4m", "Crate_1m", "Barrier_Jersey", "Container_6m" };
            int side = 1;
            for (float distance = 18f; distance < length - 18f; distance += Range(16f, 26f))
            {
                Vector2 point = start + direction * distance;
                if (InsideCompactZone(point, 6f))
                {
                    continue;
                }

                side = -side;
                float lateral = side * Range(halfWidth * 0.25f, halfWidth * 0.8f);
                Vector2 position = point + right * lateral;
                string kit = coverKits[m_Random.Next(coverKits.Length)];
                float pieceYaw = yaw + (m_Random.NextDouble() < 0.6 ? 90f : 0f) + Range(-12f, 12f);
                Place(kit, GroundPoint(position), pieceYaw, m_CoverRoot);

                if (m_Random.NextDouble() < 0.35)
                {
                    Vector2 partner = point - right * lateral * 0.7f + direction * Range(-4f, 4f);
                    Place(coverKits[m_Random.Next(5)], GroundPoint(partner), yaw + Range(-30f, 30f), m_CoverRoot);
                }
            }

            for (float distance = 10f; distance < length; distance += 40f)
            {
                foreach (int s in new[] { -1, 1 })
                {
                    Vector2 point = start + direction * distance + right * (s * (halfWidth + 1.2f));
                    if (!InsideCompactZone(point, 2f))
                    {
                        Place("LampPost", GroundPoint(point), yaw + (s > 0 ? -90f : 90f), root);
                    }
                }
            }

            var route = new List<Vector3>();
            for (float distance = 0f; distance <= length; distance += 40f)
            {
                route.Add(GroundPoint(start + direction * distance));
            }

            CreateRoute(zone.name, Team.Neutral, route, false);
        }

        private bool InsideCompactZone(Vector2 point, float margin)
        {
            foreach (ZoneDefinition zone in m_Zones)
            {
                if (zone.type == TacticalZoneType.TraversalCorridor)
                {
                    continue;
                }

                Vector2 local = ToZoneLocal(zone, point);
                if (Mathf.Abs(local.x) <= zone.size.x * 0.5f + margin && Mathf.Abs(local.y) <= zone.size.y * 0.5f + margin)
                {
                    return true;
                }
            }

            return false;
        }

        private bool OnCorridor(Vector2 point, float margin)
        {
            foreach (ZoneDefinition zone in m_Zones)
            {
                if (zone.type == TacticalZoneType.TraversalCorridor && DistanceToSegment(point, zone.center, zone.endPoint) < zone.size.x * 0.5f + margin)
                {
                    return true;
                }
            }

            return false;
        }

        // ================================================================================================
        // Scatter, detail, boundaries, routes
        // ================================================================================================

        private void ScatterRocks()
        {
            Transform rocks = Group("Rocks", m_Environment);
            float half = PlayableHalf - 8f;
            int placed = 0;
            int attempts = 0;
            while (placed < m_Blueprint.scatterRockCount && attempts++ < m_Blueprint.scatterRockCount * 10)
            {
                var point = new Vector2(Range(-half, half), Range(-half, half));
                if (InsideCompactZone(point, 8f) || OnCorridor(point, 1.5f))
                {
                    continue;
                }

                float scale = Range(1.2f, 4.6f);
                Vector3 position = GroundPoint(point) + Vector3.down * scale * 0.22f;
                GameObject rock = Place("Rock_Large", position, Range(0f, 360f), rocks, new Vector3(scale * Range(0.8f, 1.3f), scale * Range(0.6f, 1.1f), scale * Range(0.8f, 1.3f)));
                if (rock != null && scale > 2.2f && m_Random.NextDouble() < m_Blueprint.scatterCoverDensity + 0.3f)
                {
                    rock.AddComponent<CoverObject>();
                }

                placed++;
            }
        }

        /// <summary>Purely cosmetic detail (no colliders) grouped in 120 m sectors for distance streaming.</summary>
        private void ScatterDetail()
        {
            Mesh mesh = AssetFactory.GetRockMesh(2);
            Material material = AssetFactory.GetMaterial("Proto_Rock");
            if (mesh == null || material == null)
            {
                return;
            }

            const float sectorSize = 120f;
            float half = PlayableHalf;
            int sectorsPerSide = Mathf.CeilToInt(half * 2f / sectorSize);
            var sectors = new List<Transform>();
            for (int sx = 0; sx < sectorsPerSide; sx++)
            {
                for (int sz = 0; sz < sectorsPerSide; sz++)
                {
                    var sector = new GameObject($"Sector_{sx}_{sz}");
                    sector.transform.SetParent(m_DecorRoot, false);
                    float cx = -half + (sx + 0.5f) * sectorSize;
                    float cz = -half + (sz + 0.5f) * sectorSize;
                    sector.transform.position = GroundPoint(new Vector2(cx, cz));
                    for (int i = 0; i < 70; i++)
                    {
                        var point = new Vector2(cx + Range(-sectorSize * 0.5f, sectorSize * 0.5f), cz + Range(-sectorSize * 0.5f, sectorSize * 0.5f));
                        if (Mathf.Abs(point.x) > half || Mathf.Abs(point.y) > half || InsideCompactZone(point, 0f))
                        {
                            continue;
                        }

                        var pebble = new GameObject("Detail");
                        pebble.layer = GameLayers.Props;
                        pebble.transform.SetParent(sector.transform, false);
                        float scale = Range(0.2f, 0.65f);
                        pebble.transform.position = GroundPoint(point) - Vector3.up * scale * 0.2f;
                        pebble.transform.rotation = Quaternion.Euler(Range(-10f, 10f), Range(0f, 360f), Range(-10f, 10f));
                        pebble.transform.localScale = new Vector3(scale, scale * 0.6f, scale);
                        pebble.AddComponent<MeshFilter>().sharedMesh = mesh;
                        var renderer = pebble.AddComponent<MeshRenderer>();
                        renderer.sharedMaterial = material;
                        renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                        GameObjectUtility.SetStaticEditorFlags(pebble, StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccludeeStatic);
                    }

                    sectors.Add(sector.transform);
                }
            }

            var streamer = m_DecorRoot.gameObject.AddComponent<WorldSectorStreamer>();
            streamer.Configure(sectors, sectorSize * 0.75f);
        }

        private void BuildBoundaries()
        {
            Transform root = Group("Boundaries", m_Environment);
            float half = PlayableHalf + 4f;
            float centreY = BaseHeight + 30f;
            (Vector3 position, Vector3 size)[] walls =
            {
                (new Vector3(0f, centreY, half), new Vector3(half * 2f + 8f, 100f, 4f)),
                (new Vector3(0f, centreY, -half), new Vector3(half * 2f + 8f, 100f, 4f)),
                (new Vector3(half, centreY, 0f), new Vector3(4f, 100f, half * 2f + 8f)),
                (new Vector3(-half, centreY, 0f), new Vector3(4f, 100f, half * 2f + 8f))
            };
            foreach ((Vector3 position, Vector3 size) in walls)
            {
                var wall = new GameObject("InvisibleWall") { layer = GameLayers.Environment };
                wall.transform.SetParent(root, false);
                wall.transform.position = position;
                var collider = wall.AddComponent<BoxCollider>();
                collider.size = size;
                var modifier = wall.AddComponent<NavMeshModifier>();
                modifier.ignoreFromBuild = true;
            }
        }

        private void BuildObjectiveLoopRoute()
        {
            var points = new List<Vector3>();
            foreach (ZoneDefinition zone in m_Zones)
            {
                if (zone.type == TacticalZoneType.CaptureObjective)
                {
                    points.Add(GroundPoint(zone.center));
                }
            }

            if (points.Count > 1)
            {
                CreateRoute("ObjectiveLoop", Team.Neutral, points);
            }
        }

        // ================================================================================================
        // Cover points
        // ================================================================================================

        /// <summary>Creates cover points around every <see cref="CoverObject"/> in the open scene.</summary>
        public static int GenerateCoverPoints(Transform parent)
        {
            for (int i = parent.childCount - 1; i >= 0; i--)
            {
                Object.DestroyImmediate(parent.GetChild(i).gameObject);
            }

            Physics.SyncTransforms();
            int created = 0;
            foreach (CoverObject cover in FindInScene<CoverObject>())
            {
                if (!cover.GenerateCoverPoints)
                {
                    continue;
                }

                Transform t = cover.transform;
                Vector3 right;
                Vector3 forward;
                Vector3 extents;
                Vector3 centre;
                float groundY;
                float height;
                BoxCollider[] boxes = cover.GetComponents<BoxCollider>();
                if (boxes.Length > 0)
                {
                    // Oriented extents from the local box colliders (exact for rotated/scaled kit pieces).
                    Vector3 min = boxes[0].center - boxes[0].size * 0.5f;
                    Vector3 max = boxes[0].center + boxes[0].size * 0.5f;
                    for (int i = 1; i < boxes.Length; i++)
                    {
                        min = Vector3.Min(min, boxes[i].center - boxes[i].size * 0.5f);
                        max = Vector3.Max(max, boxes[i].center + boxes[i].size * 0.5f);
                    }

                    Vector3 scale = t.lossyScale;
                    right = t.right;
                    forward = t.forward;
                    extents = new Vector3((max.x - min.x) * 0.5f * Mathf.Abs(scale.x), 0f, (max.z - min.z) * 0.5f * Mathf.Abs(scale.z));
                    centre = t.TransformPoint((min + max) * 0.5f);
                    groundY = t.TransformPoint(new Vector3((min.x + max.x) * 0.5f, min.y, (min.z + max.z) * 0.5f)).y;
                    height = (max.y - min.y) * Mathf.Abs(scale.y);
                }
                else
                {
                    Collider[] colliders = cover.GetComponents<Collider>();
                    if (colliders.Length == 0)
                    {
                        continue;
                    }

                    Bounds bounds = colliders[0].bounds;
                    for (int i = 1; i < colliders.Length; i++)
                    {
                        bounds.Encapsulate(colliders[i].bounds);
                    }

                    right = Vector3.right;
                    forward = Vector3.forward;
                    extents = new Vector3(bounds.extents.x, 0f, bounds.extents.z);
                    centre = bounds.center;
                    groundY = cover.transform.position.y;
                    height = bounds.max.y - groundY;
                }

                if (height < 0.8f)
                {
                    continue;
                }

                CoverHeight coverHeight = height >= 1.65f ? CoverHeight.High : CoverHeight.Low;
                float topY = groundY + height;

                (Vector3 normal, Vector3 along, float halfLength, float offset)[] sides =
                {
                    (forward, right, extents.x, extents.z),
                    (-forward, right, extents.x, extents.z),
                    (right, forward, extents.z, extents.x),
                    (-right, forward, extents.z, extents.x)
                };

                foreach ((Vector3 normal, Vector3 along, float halfLength, float offset) in sides)
                {
                    int count = Mathf.Max(1, Mathf.FloorToInt(halfLength * 2f / cover.PointSpacing));
                    for (int i = 0; i < count; i++)
                    {
                        float t01 = count == 1 ? 0.5f : i / (float)(count - 1);
                        Vector3 position = centre + normal * (offset + 0.6f) + along * Mathf.Lerp(-halfLength + 0.4f, halfLength - 0.4f, t01);
                        if (!Physics.Raycast(new Vector3(position.x, topY + 2f, position.z), Vector3.down, out RaycastHit hit, height + 6f, GameLayers.WorldMask, QueryTriggerInteraction.Ignore))
                        {
                            continue;
                        }

                        if (hit.collider.transform.IsChildOf(t) || Mathf.Abs(hit.point.y - groundY) > 1.2f)
                        {
                            continue; // landed on top of the cover itself or on a different level
                        }

                        var go = new GameObject("CoverPoint");
                        go.transform.SetParent(parent, false);
                        go.transform.SetPositionAndRotation(hit.point, Quaternion.LookRotation(-new Vector3(normal.x, 0f, normal.z).normalized));
                        go.AddComponent<CoverPoint>().Configure(coverHeight);
                        created++;
                    }
                }
            }

            return created;
        }

        private static List<T> FindInScene<T>() where T : Component
        {
            var results = new List<T>();
            UnityEngine.SceneManagement.Scene scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            foreach (GameObject root in scene.GetRootGameObjects())
            {
                results.AddRange(root.GetComponentsInChildren<T>(false));
            }

            return results;
        }

        /// <summary>After the NavMesh bake: snap cover points onto the NavMesh and delete invalid ones.</summary>
        public static int ValidateCoverPoints(Transform parent)
        {
            int removed = 0;
            for (int i = parent.childCount - 1; i >= 0; i--)
            {
                Transform point = parent.GetChild(i);
                bool valid = NavMesh.SamplePosition(point.position, out NavMeshHit hit, 0.8f, NavMesh.AllAreas);
                if (valid)
                {
                    Vector3 bottom = hit.position + Vector3.up * 0.45f;
                    Vector3 top = hit.position + Vector3.up * 1.4f;
                    valid = !Physics.CheckCapsule(bottom, top, 0.3f, GameLayers.WorldMask, QueryTriggerInteraction.Ignore);
                }

                if (!valid)
                {
                    Object.DestroyImmediate(point.gameObject);
                    removed++;
                }
                else
                {
                    point.position = hit.position;
                }
            }

            return removed;
        }
    }
}
