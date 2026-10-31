using System.Collections.Generic;
using System.IO;
using FPS.Core;
using FPS.Data;
using UnityEditor;
using UnityEngine;

namespace FPS.EditorTools
{
    /// <summary>
    /// Creates every data asset the game needs: procedural prototype textures and URP materials, LOD meshes,
    /// weapon / bot difficulty / movement / camera / match / HUD / map ScriptableObjects and the root GameConfig.
    /// Existing assets are updated in place, so designer tweaks to other fields survive re-runs only if
    /// <see cref="OverwriteTuning"/> is false.
    /// </summary>
    public static class AssetFactory
    {
        /// <summary>When false (default) existing weapon/bot assets keep their tuned values.</summary>
        public static bool OverwriteTuning = false;

        private static readonly Dictionary<string, Material> s_Materials = new Dictionary<string, Material>();

        public static Material GetMaterial(string name)
        {
            if (s_Materials.TryGetValue(name, out Material material) && material != null)
            {
                return material;
            }

            material = AssetDatabase.LoadAssetAtPath<Material>($"{EditorUtil.MaterialFolder}/{name}.mat");
            s_Materials[name] = material;
            return material;
        }

        public static GameConfig CreateAll()
        {
            EditorUtil.EnsureAllFolders();
            CreateTexturesAndMaterials();
            CreateMeshes();
            GameConfig config = CreateData();
            AssetDatabase.SaveAssets();
            return config;
        }

        // ------------------------------------------------------------------------------------------------
        // Textures & materials
        // ------------------------------------------------------------------------------------------------

        private struct GridSpec
        {
            public string Name;
            public Color Base;
            public Color Line;
            public int Cells;
            public float Smoothness;
            public Vector2 Tiling;
        }

        private static readonly GridSpec[] s_Grids =
        {
            new GridSpec { Name = "Proto_Floor", Base = new Color(0.42f, 0.43f, 0.45f), Line = new Color(0.30f, 0.31f, 0.33f), Cells = 4, Smoothness = 0.15f, Tiling = Vector2.one },
            new GridSpec { Name = "Proto_Wall", Base = new Color(0.78f, 0.47f, 0.24f), Line = new Color(0.62f, 0.35f, 0.17f), Cells = 4, Smoothness = 0.1f, Tiling = Vector2.one },
            new GridSpec { Name = "Proto_WallDark", Base = new Color(0.30f, 0.32f, 0.36f), Line = new Color(0.22f, 0.23f, 0.26f), Cells = 4, Smoothness = 0.1f, Tiling = Vector2.one },
            new GridSpec { Name = "Proto_Cover", Base = new Color(0.33f, 0.45f, 0.55f), Line = new Color(0.24f, 0.33f, 0.42f), Cells = 2, Smoothness = 0.2f, Tiling = Vector2.one },
            new GridSpec { Name = "Proto_Crate", Base = new Color(0.55f, 0.43f, 0.28f), Line = new Color(0.42f, 0.32f, 0.2f), Cells = 2, Smoothness = 0.05f, Tiling = Vector2.one },
            new GridSpec { Name = "Proto_Metal", Base = new Color(0.5f, 0.52f, 0.55f), Line = new Color(0.4f, 0.42f, 0.45f), Cells = 8, Smoothness = 0.55f, Tiling = Vector2.one },
            new GridSpec { Name = "Proto_Accent", Base = new Color(0.95f, 0.75f, 0.2f), Line = new Color(0.2f, 0.2f, 0.2f), Cells = 4, Smoothness = 0.3f, Tiling = Vector2.one },
            new GridSpec { Name = "Proto_Rock", Base = new Color(0.45f, 0.43f, 0.4f), Line = new Color(0.4f, 0.38f, 0.36f), Cells = 2, Smoothness = 0.08f, Tiling = Vector2.one },
            new GridSpec { Name = "Proto_Alpha", Base = new Color(0.22f, 0.45f, 0.85f), Line = new Color(0.15f, 0.32f, 0.65f), Cells = 4, Smoothness = 0.2f, Tiling = Vector2.one },
            new GridSpec { Name = "Proto_Bravo", Base = new Color(0.85f, 0.35f, 0.22f), Line = new Color(0.65f, 0.25f, 0.15f), Cells = 4, Smoothness = 0.2f, Tiling = Vector2.one },
            new GridSpec { Name = "Proto_Character", Base = new Color(0.25f, 0.27f, 0.3f), Line = new Color(0.2f, 0.22f, 0.25f), Cells = 1, Smoothness = 0.25f, Tiling = Vector2.one },
            new GridSpec { Name = "Terrain_Grass", Base = new Color(0.33f, 0.42f, 0.24f), Line = new Color(0.29f, 0.37f, 0.21f), Cells = 8, Smoothness = 0f, Tiling = Vector2.one },
            new GridSpec { Name = "Terrain_Dirt", Base = new Color(0.47f, 0.39f, 0.29f), Line = new Color(0.41f, 0.34f, 0.25f), Cells = 8, Smoothness = 0f, Tiling = Vector2.one },
            new GridSpec { Name = "Terrain_Rock", Base = new Color(0.46f, 0.45f, 0.44f), Line = new Color(0.4f, 0.39f, 0.38f), Cells = 4, Smoothness = 0.05f, Tiling = Vector2.one },
            new GridSpec { Name = "Terrain_Gravel", Base = new Color(0.38f, 0.37f, 0.36f), Line = new Color(0.33f, 0.32f, 0.31f), Cells = 8, Smoothness = 0.05f, Tiling = Vector2.one }
        };

        public static void CreateTexturesAndMaterials()
        {
            Shader lit = Shader.Find("Universal Render Pipeline/Lit");
            Shader unlit = Shader.Find("Universal Render Pipeline/Unlit");
            if (lit == null)
            {
                Debug.LogWarning("[FPS Builder] URP Lit shader not found - is the Universal RP package installed? Falling back to Standard.");
                lit = Shader.Find("Standard");
            }

            foreach (GridSpec spec in s_Grids)
            {
                Texture2D texture = CreateGridTexture(spec);
                if (spec.Name.StartsWith("Terrain_"))
                {
                    continue; // Terrain layers reference the textures directly.
                }

                Material material = LoadOrCreateMaterial(spec.Name, lit);
                SetTexture(material, texture);
                SetColor(material, Color.white);
                if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", spec.Smoothness);
                if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", spec.Smoothness);
                material.enableInstancing = true;
                EditorUtility.SetDirty(material);
            }

            // Template materials for runtime-tinted procedural geometry (guarantees shader inclusion in builds).
            Material runtimeLit = LoadOrCreateMaterial("Runtime_Lit", lit);
            SetColor(runtimeLit, Color.white);
            runtimeLit.enableInstancing = true;
            Material runtimeUnlit = LoadOrCreateMaterial("Runtime_Unlit", unlit != null ? unlit : Shader.Find("Unlit/Color"));
            SetColor(runtimeUnlit, Color.white);
            LoadOrCreateMaterial("Runtime_Transparent", Shader.Find("Sprites/Default"));

            Material glass = LoadOrCreateMaterial("Proto_Glow", lit);
            SetColor(glass, new Color(1f, 0.85f, 0.55f));
            glass.EnableKeyword("_EMISSION");
            if (glass.HasProperty("_EmissionColor")) glass.SetColor("_EmissionColor", new Color(1f, 0.8f, 0.5f) * 2f);
            glass.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;

            Material skybox = LoadOrCreateMaterial("Skybox_Procedural", Shader.Find("Skybox/Procedural"));
            if (skybox.HasProperty("_SunSize")) skybox.SetFloat("_SunSize", 0.035f);
            if (skybox.HasProperty("_AtmosphereThickness")) skybox.SetFloat("_AtmosphereThickness", 0.9f);
            if (skybox.HasProperty("_Exposure")) skybox.SetFloat("_Exposure", 1.2f);
            AssetDatabase.SaveAssets();
        }

        private static Material LoadOrCreateMaterial(string name, Shader shader)
        {
            string path = $"{EditorUtil.MaterialFolder}/{name}.mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader != null ? shader : Shader.Find("Sprites/Default")) { name = name };
                AssetDatabase.CreateAsset(material, path);
            }
            else if (shader != null && material.shader != shader)
            {
                material.shader = shader;
            }

            s_Materials[name] = material;
            return material;
        }

        private static void SetTexture(Material material, Texture texture)
        {
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", texture);
            if (material.HasProperty("_MainTex")) material.SetTexture("_MainTex", texture);
        }

        private static void SetColor(Material material, Color color)
        {
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
        }

        private static Texture2D CreateGridTexture(GridSpec spec)
        {
            string path = $"{EditorUtil.TextureFolder}/{spec.Name}.png";
            if (!File.Exists(path))
            {
                const int size = 256;
                var texture = new Texture2D(size, size, TextureFormat.RGBA32, true);
                int cell = size / Mathf.Max(1, spec.Cells);
                var random = new System.Random(spec.Name.GetHashCode());
                var pixels = new Color[size * size];
                for (int y = 0; y < size; y++)
                {
                    for (int x = 0; x < size; x++)
                    {
                        bool major = x % cell < 3 || y % cell < 3;
                        bool minor = x % (cell / 2 == 0 ? 1 : cell / 2) < 1 || y % (cell / 2 == 0 ? 1 : cell / 2) < 1;
                        float noise = (float)random.NextDouble() * 0.04f - 0.02f;
                        Color c = major ? spec.Line : minor ? Color.Lerp(spec.Base, spec.Line, 0.35f) : spec.Base;
                        pixels[y * size + x] = new Color(c.r + noise, c.g + noise, c.b + noise, 1f);
                    }
                }

                texture.SetPixels(pixels);
                texture.Apply();
                File.WriteAllBytes(path, texture.EncodeToPNG());
                Object.DestroyImmediate(texture);
                AssetDatabase.ImportAsset(path);
                if (AssetImporter.GetAtPath(path) is TextureImporter importer)
                {
                    importer.wrapMode = TextureWrapMode.Repeat;
                    importer.mipmapEnabled = true;
                    importer.anisoLevel = 4;
                    importer.sRGBTexture = true;
                    importer.SaveAndReimport();
                }
            }

            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        public static Texture2D GetTexture(string name)
        {
            return AssetDatabase.LoadAssetAtPath<Texture2D>($"{EditorUtil.TextureFolder}/{name}.png");
        }

        // ------------------------------------------------------------------------------------------------
        // Meshes (LOD chain for rocks)
        // ------------------------------------------------------------------------------------------------

        public static void CreateMeshes()
        {
            for (int lod = 0; lod < 3; lod++)
            {
                string path = $"{EditorUtil.MeshFolder}/Rock_LOD{lod}.asset";
                if (AssetDatabase.LoadAssetAtPath<Mesh>(path) != null)
                {
                    continue;
                }

                Mesh mesh = MeshGenerator.CreateRock(3 - lod, 4242);
                mesh.name = "Rock_LOD" + lod;
                AssetDatabase.CreateAsset(mesh, path);
            }
        }

        public static Mesh GetRockMesh(int lod)
        {
            return AssetDatabase.LoadAssetAtPath<Mesh>($"{EditorUtil.MeshFolder}/Rock_LOD{lod}.asset");
        }

        // ------------------------------------------------------------------------------------------------
        // ScriptableObjects
        // ------------------------------------------------------------------------------------------------

        private static GameConfig CreateData()
        {
            var movement = EditorUtil.LoadOrCreate<PlayerMovementSettings>(EditorUtil.SettingsFolder + "/PlayerMovementSettings.asset");
            var camera = EditorUtil.LoadOrCreate<CameraSettings>(EditorUtil.SettingsFolder + "/CameraSettings.asset");
            var match = EditorUtil.LoadOrCreate<MatchSettings>(EditorUtil.SettingsFolder + "/MatchSettings.asset");
            var hud = EditorUtil.LoadOrCreate<HUDTheme>(EditorUtil.SettingsFolder + "/HUDTheme_Default.asset");
            var blueprint = AssetDatabase.LoadAssetAtPath<MapBlueprint>(EditorUtil.SettingsFolder + "/MapBlueprint_Valley.asset");
            if (blueprint == null)
            {
                blueprint = EditorUtil.LoadOrCreate<MapBlueprint>(EditorUtil.SettingsFolder + "/MapBlueprint_Valley.asset");
                blueprint.ResetToDefaultLayout();
                EditorUtility.SetDirty(blueprint);
            }

            WeaponData rifle = Weapon("VK-12 Assault Rifle", "Weapon_AssaultRifle", 1, w =>
            {
                w.category = WeaponCategory.AssaultRifle; w.fireMode = FireMode.FullAuto; w.roundsPerMinute = 680f; w.damage = 26f;
                w.headshotMultiplier = 1.8f; w.maxRange = 300f; w.magazineSize = 30; w.startingReserve = 150; w.maxReserve = 240;
                w.reloadTime = 2.1f; w.emptyReloadTime = 2.6f; w.equipTime = 0.5f; w.aimFieldOfView = 55f; w.aimDownSightTime = 0.22f;
                w.hipSpread = 2.6f; w.aimSpread = 0.2f; w.moveSpreadAdd = 2.2f; w.spreadPerShot = 0.32f; w.maxBloom = 3f;
                w.verticalRecoil = new Vector2(0.55f, 0.85f); w.horizontalRecoil = 0.32f; w.preferredEngagementRange = new Vector2(10f, 60f);
                w.noiseRadius = 80f; w.proceduralShotSound = ProceduralSound.RifleShot; w.crosshairStyle = CrosshairStyle.Cross;
                w.bodySize = new Vector3(0.07f, 0.11f, 0.5f); w.barrelLength = 0.3f; w.accentColor = new Color(0.9f, 0.5f, 0.15f);
            });
            WeaponData smg = Weapon("MX-9 Submachine Gun", "Weapon_SMG", 2, w =>
            {
                w.category = WeaponCategory.SubmachineGun; w.fireMode = FireMode.FullAuto; w.roundsPerMinute = 920f; w.damage = 19f;
                w.headshotMultiplier = 1.6f; w.maxRange = 130f; w.damageFalloff = new AnimationCurve(new Keyframe(0f, 1f), new Keyframe(0.25f, 1f), new Keyframe(1f, 0.45f));
                w.magazineSize = 35; w.startingReserve = 175; w.maxReserve = 280; w.reloadTime = 1.8f; w.emptyReloadTime = 2.2f;
                w.equipTime = 0.35f; w.aimFieldOfView = 62f; w.aimDownSightTime = 0.16f; w.aimMoveSpeedMultiplier = 0.8f;
                w.hipSpread = 2.1f; w.aimSpread = 0.6f; w.moveSpreadAdd = 1.2f; w.spreadPerShot = 0.25f; w.maxBloom = 3.5f;
                w.verticalRecoil = new Vector2(0.35f, 0.55f); w.horizontalRecoil = 0.45f; w.preferredEngagementRange = new Vector2(3f, 25f);
                w.noiseRadius = 60f; w.proceduralShotSound = ProceduralSound.SmgShot; w.crosshairStyle = CrosshairStyle.CrossWithDot;
                w.bodySize = new Vector3(0.065f, 0.1f, 0.36f); w.barrelLength = 0.14f; w.accentColor = new Color(0.25f, 0.75f, 0.95f);
                w.hipOffset = new Vector3(0.17f, -0.16f, 0.32f);
            });
            WeaponData shotgun = Weapon("Breacher Shotgun", "Weapon_Shotgun", 3, w =>
            {
                w.category = WeaponCategory.Shotgun; w.fireMode = FireMode.SemiAuto; w.roundsPerMinute = 85f; w.pelletsPerShot = 9; w.damage = 13f;
                w.headshotMultiplier = 1.4f; w.maxRange = 45f; w.damageFalloff = new AnimationCurve(new Keyframe(0f, 1f), new Keyframe(0.3f, 0.9f), new Keyframe(1f, 0.2f));
                w.magazineSize = 7; w.startingReserve = 35; w.maxReserve = 56; w.reloadTime = 2.6f; w.emptyReloadTime = 3.1f;
                w.equipTime = 0.55f; w.aimFieldOfView = 65f; w.hipSpread = 7.5f; w.aimSpread = 5f; w.moveSpreadAdd = 1f; w.spreadPerShot = 0f;
                w.verticalRecoil = new Vector2(3.2f, 4.2f); w.horizontalRecoil = 1.1f; w.recoilRecoveryFraction = 0.85f;
                w.preferredEngagementRange = new Vector2(2f, 12f); w.noiseRadius = 90f; w.proceduralShotSound = ProceduralSound.ShotgunShot;
                w.crosshairStyle = CrosshairStyle.Circle; w.bodySize = new Vector3(0.08f, 0.12f, 0.55f); w.barrelLength = 0.38f;
                w.accentColor = new Color(0.75f, 0.2f, 0.2f); w.tracerChance = 1f;
            });
            WeaponData sniper = Weapon("Longshot Marksman Rifle", "Weapon_Sniper", 4, w =>
            {
                w.category = WeaponCategory.SniperRifle; w.fireMode = FireMode.SemiAuto; w.roundsPerMinute = 50f; w.damage = 92f;
                w.headshotMultiplier = 2.5f; w.limbMultiplier = 0.9f; w.maxRange = 700f; w.damageFalloff = new AnimationCurve(new Keyframe(0f, 1f), new Keyframe(1f, 0.85f));
                w.magazineSize = 5; w.startingReserve = 30; w.maxReserve = 40; w.reloadTime = 2.9f; w.emptyReloadTime = 3.4f;
                w.equipTime = 0.7f; w.aimFieldOfView = 22f; w.aimDownSightTime = 0.32f; w.aimMoveSpeedMultiplier = 0.5f;
                w.hipSpread = 7f; w.aimSpread = 0.02f; w.moveSpreadAdd = 4f; w.spreadPerShot = 2f; w.maxBloom = 4f; w.sprintToFireTime = 0.3f;
                w.verticalRecoil = new Vector2(2.6f, 3.4f); w.horizontalRecoil = 0.6f; w.recoilRecoveryFraction = 0.9f;
                w.preferredEngagementRange = new Vector2(35f, 220f); w.noiseRadius = 140f; w.proceduralShotSound = ProceduralSound.SniperShot;
                w.crosshairStyle = CrosshairStyle.Dot; w.bodySize = new Vector3(0.07f, 0.12f, 0.7f); w.barrelLength = 0.45f;
                w.accentColor = new Color(0.4f, 0.75f, 0.3f); w.aimOffset = new Vector3(0f, -0.09f, 0.2f); w.tracerChance = 1f;
            });
            WeaponData pistol = Weapon("P9 Sidearm", "Weapon_Pistol", 5, w =>
            {
                w.category = WeaponCategory.Pistol; w.fireMode = FireMode.SemiAuto; w.roundsPerMinute = 420f; w.damage = 24f;
                w.headshotMultiplier = 2f; w.maxRange = 90f; w.magazineSize = 12; w.startingReserve = 60; w.maxReserve = 96;
                w.reloadTime = 1.4f; w.emptyReloadTime = 1.7f; w.equipTime = 0.25f; w.aimFieldOfView = 65f; w.aimDownSightTime = 0.14f;
                w.aimMoveSpeedMultiplier = 0.85f; w.hipSpread = 1.8f; w.aimSpread = 0.4f; w.spreadPerShot = 0.6f;
                w.verticalRecoil = new Vector2(1.1f, 1.5f); w.horizontalRecoil = 0.35f; w.preferredEngagementRange = new Vector2(3f, 25f);
                w.noiseRadius = 50f; w.proceduralShotSound = ProceduralSound.PistolShot; w.crosshairStyle = CrosshairStyle.Chevron;
                w.bodySize = new Vector3(0.045f, 0.09f, 0.2f); w.barrelLength = 0.06f; w.hipOffset = new Vector3(0.15f, -0.15f, 0.3f);
                w.aimOffset = new Vector3(0f, -0.075f, 0.28f);
            });

            BotDifficultyProfile easy = Difficulty("Recruit", "Bot_Recruit", d =>
            {
                d.reactionTime = 0.9f; d.decisionInterval = 0.45f; d.aimAccuracy = 0.25f; d.aimTrackingSpeed = 140f; d.aimSettleTime = 1.4f;
                d.headshotPreference = 0.02f; d.detectionDistance = 55f; d.fieldOfView = 95f; d.detectionTime = 1.4f; d.hearingMultiplier = 0.7f;
                d.memoryDuration = 5f; d.aggressiveness = 0.35f; d.flankChance = 0.1f; d.retreatHealthFraction = 0.5f; d.suppressionTolerance = 0.35f;
                d.strafeChance = 0.3f; d.burstShots = new Vector2(2f, 5f); d.burstPause = new Vector2(0.35f, 0.8f);
            });
            BotDifficultyProfile normal = Difficulty("Regular", "Bot_Regular", d =>
            {
                d.reactionTime = 0.5f; d.decisionInterval = 0.3f; d.aimAccuracy = 0.55f; d.aimTrackingSpeed = 240f; d.aimSettleTime = 0.9f;
                d.headshotPreference = 0.12f; d.detectionDistance = 85f; d.fieldOfView = 110f; d.detectionTime = 0.9f; d.hearingMultiplier = 1f;
                d.memoryDuration = 9f; d.aggressiveness = 0.5f; d.flankChance = 0.3f; d.retreatHealthFraction = 0.4f; d.suppressionTolerance = 0.45f;
                d.strafeChance = 0.55f; d.burstShots = new Vector2(3f, 7f); d.burstPause = new Vector2(0.2f, 0.5f);
            });
            BotDifficultyProfile hard = Difficulty("Veteran", "Bot_Veteran", d =>
            {
                d.reactionTime = 0.3f; d.decisionInterval = 0.2f; d.aimAccuracy = 0.75f; d.aimTrackingSpeed = 380f; d.aimSettleTime = 0.6f;
                d.headshotPreference = 0.25f; d.detectionDistance = 120f; d.fieldOfView = 120f; d.detectionTime = 0.6f; d.hearingMultiplier = 1.3f;
                d.memoryDuration = 12f; d.aggressiveness = 0.65f; d.flankChance = 0.45f; d.retreatHealthFraction = 0.35f; d.suppressionTolerance = 0.55f;
                d.strafeChance = 0.7f; d.burstShots = new Vector2(4f, 9f); d.burstPause = new Vector2(0.15f, 0.35f);
            });
            BotDifficultyProfile elite = Difficulty("Elite", "Bot_Elite", d =>
            {
                d.reactionTime = 0.18f; d.decisionInterval = 0.15f; d.aimAccuracy = 0.9f; d.aimTrackingSpeed = 600f; d.aimSettleTime = 0.35f;
                d.headshotPreference = 0.4f; d.detectionDistance = 160f; d.fieldOfView = 130f; d.detectionTime = 0.4f; d.hearingMultiplier = 1.6f;
                d.memoryDuration = 15f; d.aggressiveness = 0.8f; d.flankChance = 0.6f; d.retreatHealthFraction = 0.3f; d.suppressionTolerance = 0.7f;
                d.strafeChance = 0.85f; d.burstShots = new Vector2(5f, 12f); d.burstPause = new Vector2(0.1f, 0.25f);
            });

            var config = EditorUtil.LoadOrCreate<GameConfig>(EditorUtil.ResourcesFolder + "/GameConfig.asset");
            config.matchSettings = match;
            config.movementSettings = movement;
            config.cameraSettings = camera;
            config.hudTheme = hud;
            config.weapons = new List<WeaponData> { rifle, smg, shotgun, sniper, pistol };
            config.playerLoadout = new List<WeaponData> { rifle, shotgun, sniper };
            config.botLoadoutPool = new List<WeaponData> { rifle, rifle, rifle, smg, smg, shotgun, sniper };
            config.difficulties = new List<BotDifficultyProfile> { easy, normal, hard, elite };
            config.defaultDifficultyIndex = 1;
            config.litMaterialTemplate = GetMaterial("Runtime_Lit");
            config.unlitMaterialTemplate = GetMaterial("Runtime_Unlit");
            config.transparentMaterialTemplate = GetMaterial("Runtime_Transparent");
            EditorUtility.SetDirty(config);
            return config;
        }

        public static MapBlueprint GetBlueprint()
        {
            return AssetDatabase.LoadAssetAtPath<MapBlueprint>(EditorUtil.SettingsFolder + "/MapBlueprint_Valley.asset");
        }

        private static WeaponData Weapon(string displayName, string fileName, int id, System.Action<WeaponData> configure)
        {
            string path = $"{EditorUtil.WeaponFolder}/{fileName}.asset";
            bool existed = AssetDatabase.LoadAssetAtPath<WeaponData>(path) != null;
            var weapon = EditorUtil.LoadOrCreate<WeaponData>(path);
            if (!existed || OverwriteTuning)
            {
                weapon.displayName = displayName;
                weapon.weaponId = id;
                configure(weapon);
                EditorUtility.SetDirty(weapon);
            }

            weapon.weaponId = id;
            return weapon;
        }

        private static BotDifficultyProfile Difficulty(string displayName, string fileName, System.Action<BotDifficultyProfile> configure)
        {
            string path = $"{EditorUtil.BotFolder}/{fileName}.asset";
            bool existed = AssetDatabase.LoadAssetAtPath<BotDifficultyProfile>(path) != null;
            var profile = EditorUtil.LoadOrCreate<BotDifficultyProfile>(path);
            if (!existed || OverwriteTuning)
            {
                profile.displayName = displayName;
                configure(profile);
                EditorUtility.SetDirty(profile);
            }

            return profile;
        }
    }
}
