using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using FPS.AI;
using FPS.Combat;
using FPS.Controls;
using FPS.Core;
using FPS.Data;
using FPS.Networking;
using FPS.Player;
using FPS.Weapons;
using FPS.World;
using Unity.Netcode;
using Unity.Netcode.Components;
using UnityEditor;
using UnityEngine;
using UnityEngine.AI;
using Object = UnityEngine.Object;

namespace FPS.EditorTools
{
    /// <summary>
    /// Builds the modular prototype environment kit (every piece with colliders, LODGroup and static flags) and the
    /// networked prefabs (Player, Bot, MatchManager, CaptureZone) with all components attached and cross-wired.
    /// </summary>
    public static class PrefabFactory
    {
        public const string NetworkPrefabsListPath = EditorUtil.NetworkPrefabFolder + "/FPS_NetworkPrefabs.asset";

        private const StaticEditorFlags k_StaticFlags = StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccludeeStatic | StaticEditorFlags.ReflectionProbeStatic;
        private const StaticEditorFlags k_OccluderFlags = k_StaticFlags | StaticEditorFlags.OccluderStatic;

        public static void CreateAll(GameConfig config)
        {
            CreateEnvironmentKit();
            CreateNetworkPrefabs(config);
            AssetDatabase.SaveAssets();
        }

        public static GameObject LoadKit(string name)
        {
            return AssetDatabase.LoadAssetAtPath<GameObject>($"{EditorUtil.EnvironmentPrefabFolder}/{name}.prefab");
        }

        // ================================================================================================
        // Environment kit
        // ================================================================================================

        public static void CreateEnvironmentKit()
        {
            Material floor = AssetFactory.GetMaterial("Proto_Floor");
            Material wall = AssetFactory.GetMaterial("Proto_Wall");
            Material dark = AssetFactory.GetMaterial("Proto_WallDark");
            Material cover = AssetFactory.GetMaterial("Proto_Cover");
            Material crate = AssetFactory.GetMaterial("Proto_Crate");
            Material metal = AssetFactory.GetMaterial("Proto_Metal");
            Material accent = AssetFactory.GetMaterial("Proto_Accent");
            Material rock = AssetFactory.GetMaterial("Proto_Rock");
            Material glow = AssetFactory.GetMaterial("Proto_Glow");
            int env = GameLayers.Environment;
            int props = GameLayers.Props;

            SimplePiece("Floor_4x4", new Vector3(4f, 0.2f, 4f), floor, dark, env, false, false);
            SimplePiece("Wall_4m", new Vector3(4f, 3f, 0.3f), wall, dark, env, true, true);
            SimplePiece("Wall_Low_4m", new Vector3(4f, 1.1f, 0.4f), cover, dark, env, false, true);
            SimplePiece("Pillar", new Vector3(0.6f, 3f, 0.6f), dark, dark, env, false, false);
            SimplePiece("Barrier_Jersey", new Vector3(3f, 1f, 0.6f), dark, cover, env, false, true);
            SimplePiece("Sandbags", new Vector3(3f, 0.95f, 0.8f), crate, dark, env, false, true);
            SimplePiece("Crate_1m", new Vector3(1.2f, 1.2f, 1.2f), crate, dark, env, false, true);
            SimplePiece("Container_6m", new Vector3(6f, 2.6f, 2.4f), metal, accent, env, true, true);

            CompositeWall("Wall_Door_4m", wall, dark, new[]
            {
                (new Vector3(-1.35f, 1.5f, 0f), new Vector3(1.3f, 3f, 0.3f)),
                (new Vector3(1.35f, 1.5f, 0f), new Vector3(1.3f, 3f, 0.3f)),
                (new Vector3(0f, 2.65f, 0f), new Vector3(1.4f, 0.7f, 0.3f))
            });
            CompositeWall("Wall_Window_4m", wall, dark, new[]
            {
                (new Vector3(0f, 0.5f, 0f), new Vector3(4f, 1f, 0.3f)),
                (new Vector3(0f, 2.6f, 0f), new Vector3(4f, 0.8f, 0.3f)),
                (new Vector3(-1.55f, 1.6f, 0f), new Vector3(0.9f, 1.2f, 0.3f)),
                (new Vector3(1.55f, 1.6f, 0f), new Vector3(0.9f, 1.2f, 0.3f))
            });

            Stairs("Stairs_3m", dark, floor);
            CrateStack(crate, dark);
            Barrel(metal, accent, props);
            LampPost(dark, glow, props);
            Rock(rock);
            AssetDatabase.SaveAssets();
        }

        /// <summary>Box piece: LOD0 = body + trims, LOD1 = single box. One BoxCollider on the root.</summary>
        private static void SimplePiece(string name, Vector3 size, Material body, Material trim, int layer, bool occluder, bool isCover)
        {
            var root = new GameObject(name) { layer = layer };
            var collider = root.AddComponent<BoxCollider>();
            collider.center = new Vector3(0f, size.y * 0.5f, 0f);
            collider.size = size;

            GameObject lod0 = EditorUtil.CreateChild("LOD0", root.transform, Vector3.zero);
            lod0.layer = layer;
            EditorUtil.Visual(PrimitiveType.Cube, "Body", lod0.transform, new Vector3(0f, size.y * 0.5f, 0f), size, body, layer);
            float trimHeight = Mathf.Min(0.12f, size.y * 0.1f);
            EditorUtil.Visual(PrimitiveType.Cube, "TrimTop", lod0.transform, new Vector3(0f, size.y - trimHeight * 0.5f, 0f), new Vector3(size.x + 0.04f, trimHeight, size.z + 0.04f), trim, layer);
            EditorUtil.Visual(PrimitiveType.Cube, "TrimBase", lod0.transform, new Vector3(0f, trimHeight * 0.5f, 0f), new Vector3(size.x + 0.04f, trimHeight, size.z + 0.04f), trim, layer);

            GameObject lod1 = EditorUtil.CreateChild("LOD1", root.transform, Vector3.zero);
            lod1.layer = layer;
            EditorUtil.Visual(PrimitiveType.Cube, "Body", lod1.transform, new Vector3(0f, size.y * 0.5f, 0f), size, body, layer);

            if (isCover)
            {
                root.AddComponent<CoverObject>();
            }

            FinishPiece(root, lod0, lod1, occluder, 0.2f, 0.012f);
        }

        private static void CompositeWall(string name, Material body, Material trim, (Vector3 centre, Vector3 size)[] parts)
        {
            int layer = GameLayers.Environment;
            var root = new GameObject(name) { layer = layer };
            GameObject lod0 = EditorUtil.CreateChild("LOD0", root.transform, Vector3.zero);
            GameObject lod1 = EditorUtil.CreateChild("LOD1", root.transform, Vector3.zero);
            lod0.layer = lod1.layer = layer;
            foreach ((Vector3 centre, Vector3 size) in parts)
            {
                var collider = root.AddComponent<BoxCollider>();
                collider.center = centre;
                collider.size = size;
                EditorUtil.Visual(PrimitiveType.Cube, "Part", lod0.transform, centre, size, body, layer);
                EditorUtil.Visual(PrimitiveType.Cube, "Part", lod1.transform, centre, size, body, layer);
            }

            EditorUtil.Visual(PrimitiveType.Cube, "Cap", lod0.transform, new Vector3(0f, 2.95f, 0f), new Vector3(4.04f, 0.1f, 0.34f), trim, layer);
            FinishPiece(root, lod0, lod1, true, 0.2f, 0.012f);
        }

        private static void Stairs(string name, Material steps, Material side)
        {
            int layer = GameLayers.Environment;
            var root = new GameObject(name) { layer = layer };
            GameObject lod0 = EditorUtil.CreateChild("LOD0", root.transform, Vector3.zero);
            GameObject lod1 = EditorUtil.CreateChild("LOD1", root.transform, Vector3.zero);
            lod0.layer = lod1.layer = layer;
            const int count = 10;
            const float rise = 0.3f;
            const float run = 0.4f;
            const float width = 2f;
            for (int i = 0; i < count; i++)
            {
                float height = rise * (i + 1);
                var centre = new Vector3(0f, height * 0.5f, run * i + run * 0.5f);
                var size = new Vector3(width, height, run);
                var collider = root.AddComponent<BoxCollider>();
                collider.center = centre;
                collider.size = size;
                EditorUtil.Visual(PrimitiveType.Cube, "Step" + i, lod0.transform, centre, size, steps, layer);
            }

            // LOD1: a single wedge-like slab.
            GameObject slab = EditorUtil.Visual(PrimitiveType.Cube, "Slab", lod1.transform, new Vector3(0f, 1.5f, 2f), new Vector3(width, 0.3f, 5f), steps, layer);
            slab.transform.localRotation = Quaternion.Euler(-36.87f, 0f, 0f);
            EditorUtil.Visual(PrimitiveType.Cube, "SideL", lod0.transform, new Vector3(-width * 0.5f - 0.05f, 1.6f, 2f), new Vector3(0.1f, 0.2f, 4.2f), side, layer).transform.localRotation = Quaternion.Euler(-36.87f, 0f, 0f);
            EditorUtil.Visual(PrimitiveType.Cube, "SideR", lod0.transform, new Vector3(width * 0.5f + 0.05f, 1.6f, 2f), new Vector3(0.1f, 0.2f, 4.2f), side, layer).transform.localRotation = Quaternion.Euler(-36.87f, 0f, 0f);
            FinishPiece(root, lod0, lod1, false, 0.2f, 0.01f);
        }

        private static void CrateStack(Material crate, Material trim)
        {
            int layer = GameLayers.Environment;
            var root = new GameObject("Crate_Stack") { layer = layer };
            GameObject lod0 = EditorUtil.CreateChild("LOD0", root.transform, Vector3.zero);
            GameObject lod1 = EditorUtil.CreateChild("LOD1", root.transform, Vector3.zero);
            lod0.layer = lod1.layer = layer;
            (Vector3, Vector3)[] boxes =
            {
                (new Vector3(-0.65f, 0.6f, 0f), new Vector3(1.2f, 1.2f, 1.2f)),
                (new Vector3(0.65f, 0.6f, 0f), new Vector3(1.2f, 1.2f, 1.2f)),
                (new Vector3(-0.3f, 1.8f, 0f), new Vector3(1.2f, 1.2f, 1.2f))
            };
            foreach ((Vector3 centre, Vector3 size) in boxes)
            {
                var collider = root.AddComponent<BoxCollider>();
                collider.center = centre;
                collider.size = size;
                EditorUtil.Visual(PrimitiveType.Cube, "Crate", lod0.transform, centre, size, crate, layer);
                EditorUtil.Visual(PrimitiveType.Cube, "Band", lod0.transform, centre, new Vector3(size.x + 0.03f, 0.12f, size.z + 0.03f), trim, layer);
                EditorUtil.Visual(PrimitiveType.Cube, "Crate", lod1.transform, centre, size, crate, layer);
            }

            root.AddComponent<CoverObject>();
            FinishPiece(root, lod0, lod1, false, 0.2f, 0.012f);
        }

        private static void Barrel(Material metal, Material accent, int layer)
        {
            var root = new GameObject("Barrel") { layer = layer };
            var collider = root.AddComponent<CapsuleCollider>();
            collider.center = new Vector3(0f, 0.45f, 0f);
            collider.height = 0.9f;
            collider.radius = 0.3f;
            GameObject lod0 = EditorUtil.CreateChild("LOD0", root.transform, Vector3.zero);
            GameObject lod1 = EditorUtil.CreateChild("LOD1", root.transform, Vector3.zero);
            lod0.layer = lod1.layer = layer;
            EditorUtil.Visual(PrimitiveType.Cylinder, "Body", lod0.transform, new Vector3(0f, 0.45f, 0f), new Vector3(0.6f, 0.45f, 0.6f), metal, layer);
            EditorUtil.Visual(PrimitiveType.Cylinder, "Ring", lod0.transform, new Vector3(0f, 0.3f, 0f), new Vector3(0.62f, 0.03f, 0.62f), accent, layer);
            EditorUtil.Visual(PrimitiveType.Cylinder, "Ring", lod0.transform, new Vector3(0f, 0.62f, 0f), new Vector3(0.62f, 0.03f, 0.62f), accent, layer);
            EditorUtil.Visual(PrimitiveType.Cube, "Body", lod1.transform, new Vector3(0f, 0.45f, 0f), new Vector3(0.55f, 0.9f, 0.55f), metal, layer);
            FinishPiece(root, lod0, lod1, false, 0.08f, 0.02f);
        }

        private static void LampPost(Material pole, Material glow, int layer)
        {
            var root = new GameObject("LampPost") { layer = layer };
            var collider = root.AddComponent<BoxCollider>();
            collider.center = new Vector3(0f, 2.5f, 0f);
            collider.size = new Vector3(0.2f, 5f, 0.2f);
            GameObject lod0 = EditorUtil.CreateChild("LOD0", root.transform, Vector3.zero);
            GameObject lod1 = EditorUtil.CreateChild("LOD1", root.transform, Vector3.zero);
            lod0.layer = lod1.layer = layer;
            EditorUtil.Visual(PrimitiveType.Cylinder, "Pole", lod0.transform, new Vector3(0f, 2.5f, 0f), new Vector3(0.15f, 2.5f, 0.15f), pole, layer);
            EditorUtil.Visual(PrimitiveType.Cube, "Arm", lod0.transform, new Vector3(0.45f, 4.9f, 0f), new Vector3(1f, 0.1f, 0.15f), pole, layer);
            EditorUtil.Visual(PrimitiveType.Cube, "Lamp", lod0.transform, new Vector3(0.9f, 4.8f, 0f), new Vector3(0.4f, 0.12f, 0.25f), glow, layer);
            EditorUtil.Visual(PrimitiveType.Cube, "Pole", lod1.transform, new Vector3(0f, 2.5f, 0f), new Vector3(0.15f, 5f, 0.15f), pole, layer);
            FinishPiece(root, lod0, lod1, false, 0.05f, 0.01f);
        }

        private static void Rock(Material material)
        {
            int layer = GameLayers.Environment;
            var root = new GameObject("Rock_Large") { layer = layer };
            Mesh collisionMesh = AssetFactory.GetRockMesh(2);
            var collider = root.AddComponent<MeshCollider>();
            collider.sharedMesh = collisionMesh;
            collider.convex = true;
            var renderers = new List<Renderer[]>();
            for (int lod = 0; lod < 3; lod++)
            {
                GameObject child = EditorUtil.CreateChild("LOD" + lod, root.transform, Vector3.zero);
                child.layer = layer;
                child.AddComponent<MeshFilter>().sharedMesh = AssetFactory.GetRockMesh(lod);
                var renderer = child.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = material;
                renderers.Add(new Renderer[] { renderer });
            }

            var group = root.AddComponent<LODGroup>();
            group.SetLODs(new[] { new LOD(0.3f, renderers[0]), new LOD(0.08f, renderers[1]), new LOD(0.008f, renderers[2]) });
            group.RecalculateBounds();
            EditorUtil.SetStaticRecursively(root, k_OccluderFlags);
            Save(root, $"{EditorUtil.EnvironmentPrefabFolder}/Rock_Large.prefab");
        }

        private static void FinishPiece(GameObject root, GameObject lod0, GameObject lod1, bool occluder, float lod0Height, float cullHeight)
        {
            var group = root.AddComponent<LODGroup>();
            group.SetLODs(new[]
            {
                new LOD(lod0Height, lod0.GetComponentsInChildren<Renderer>()),
                new LOD(cullHeight, lod1.GetComponentsInChildren<Renderer>())
            });
            group.fadeMode = LODFadeMode.None;
            group.RecalculateBounds();
            EditorUtil.SetStaticRecursively(root, occluder ? k_OccluderFlags : k_StaticFlags);
            Save(root, $"{EditorUtil.EnvironmentPrefabFolder}/{root.name}.prefab");
        }

        private static GameObject Save(GameObject root, string path)
        {
            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(root, path);
            Object.DestroyImmediate(root);
            return prefab;
        }

        // ================================================================================================
        // Network prefabs
        // ================================================================================================

        public static void CreateNetworkPrefabs(GameConfig config)
        {
            GameObject player = BuildPlayer(config);
            GameObject bot = BuildBot(config);
            GameObject match = BuildSimpleNetworkPrefab("MatchManager", typeof(MatchManager));
            GameObject zone = BuildSimpleNetworkPrefab("CaptureZone", typeof(CaptureZone));

            config.playerPrefab = player;
            config.botPrefab = bot;
            config.matchManagerPrefab = match;
            config.captureZonePrefab = zone;
            EditorUtility.SetDirty(config);

            var list = EditorUtil.LoadOrCreate<NetworkPrefabsList>(NetworkPrefabsListPath);
            foreach (NetworkPrefab existing in list.PrefabList.ToList())
            {
                list.Remove(existing);
            }

            foreach (GameObject prefab in new[] { player, bot, match, zone })
            {
                list.Add(new NetworkPrefab { Prefab = prefab });
            }

            EditorUtility.SetDirty(list);
            AssetDatabase.SaveAssets();
        }

        public static NetworkPrefabsList LoadNetworkPrefabsList()
        {
            return AssetDatabase.LoadAssetAtPath<NetworkPrefabsList>(NetworkPrefabsListPath);
        }

        private struct CharacterRig
        {
            public Transform VisualRoot;
            public CharacterVisuals Visuals;
            public Transform AimPivot;
            public ThirdPersonWeapon ThirdPerson;
            public HitboxRig HitboxRig;
            public Transform Torso;
        }

        /// <summary>Procedural body + hitboxes shared by players and bots.</summary>
        private static CharacterRig BuildCharacterRig(GameObject root, HealthSystem health)
        {
            var rig = new CharacterRig();
            Material character = AssetFactory.GetMaterial("Proto_Character");
            Material accent = AssetFactory.GetMaterial("Proto_Accent");
            Material team = AssetFactory.GetMaterial("Proto_Alpha");
            int bodyLayer = GameLayers.Default;

            GameObject visualRoot = EditorUtil.CreateChild("VisualRoot", root.transform, Vector3.zero);
            rig.VisualRoot = visualRoot.transform;
            GameObject body = EditorUtil.CreateChild("Body", visualRoot.transform, Vector3.zero);
            GameObject legs = EditorUtil.Visual(PrimitiveType.Cube, "Legs", body.transform, new Vector3(0f, 0.45f, 0f), new Vector3(0.4f, 0.88f, 0.26f), character, bodyLayer);
            GameObject torso = EditorUtil.Visual(PrimitiveType.Cube, "Torso", body.transform, new Vector3(0f, 1.15f, 0f), new Vector3(0.54f, 0.68f, 0.32f), team, bodyLayer);
            GameObject head = EditorUtil.Visual(PrimitiveType.Sphere, "Head", body.transform, new Vector3(0f, 1.63f, 0f), new Vector3(0.3f, 0.32f, 0.3f), character, bodyLayer);
            GameObject visor = EditorUtil.Visual(PrimitiveType.Cube, "Visor", body.transform, new Vector3(0f, 1.66f, 0.13f), new Vector3(0.22f, 0.07f, 0.06f), accent, bodyLayer);
            GameObject pack = EditorUtil.Visual(PrimitiveType.Cube, "Backpack", body.transform, new Vector3(0f, 1.2f, -0.22f), new Vector3(0.4f, 0.45f, 0.16f), team, bodyLayer);

            GameObject aimPivot = EditorUtil.CreateChild("AimPivot", visualRoot.transform, new Vector3(0f, 1.42f, 0f));
            rig.AimPivot = aimPivot.transform;
            GameObject socket = EditorUtil.CreateChild("WeaponSocket", aimPivot.transform, new Vector3(0.2f, -0.08f, 0.3f));
            rig.ThirdPerson = socket.AddComponent<ThirdPersonWeapon>();

            rig.Visuals = visualRoot.AddComponent<CharacterVisuals>();
            rig.Visuals.Configure(body.transform, aimPivot.transform,
                new[] { torso.GetComponent<Renderer>(), pack.GetComponent<Renderer>() },
                new[] { legs, torso, head, visor, pack }.Select(g => g.GetComponent<Renderer>()).ToArray());

            // Hitboxes (children of the root so they follow the simulated position, not the smoothed visual).
            GameObject hitboxes = EditorUtil.CreateChild("Hitboxes", root.transform, Vector3.zero);
            hitboxes.layer = GameLayers.Hitbox;
            Transform headBox = CreateHitbox(hitboxes.transform, "Head", HitboxRegion.Head, health, new Vector3(0f, 1.63f, 0f), Vector3.one, h => h.AddComponent<SphereCollider>().radius = 0.17f);
            Transform torsoBox = CreateHitbox(hitboxes.transform, "Torso", HitboxRegion.Torso, health, new Vector3(0f, 1.15f, 0f), new Vector3(0.52f, 0.72f, 0.34f), h => h.AddComponent<BoxCollider>());
            Transform legsBox = CreateHitbox(hitboxes.transform, "Legs", HitboxRegion.Limb, health, new Vector3(0f, 0.42f, 0f), new Vector3(0.44f, 0.82f, 0.28f), h => h.AddComponent<BoxCollider>());
            rig.HitboxRig = hitboxes.AddComponent<HitboxRig>();
            rig.HitboxRig.Configure(headBox, torsoBox, legsBox, 0.64f);
            rig.Torso = torsoBox;
            return rig;
        }

        private static Transform CreateHitbox(Transform parent, string name, HitboxRegion region, HealthSystem health, Vector3 position, Vector3 scale, Action<GameObject> addCollider)
        {
            GameObject go = EditorUtil.CreateChild(name, parent, position);
            go.transform.localScale = scale;
            go.layer = GameLayers.Hitbox;
            addCollider(go);
            go.AddComponent<Hitbox>().Configure(region, health);
            return go.transform;
        }

        private static GameObject BuildPlayer(GameConfig config)
        {
            var root = new GameObject("Player") { layer = GameLayers.Combatant, tag = "Player" };
            root.AddComponent<NetworkObject>();
            var controller = root.AddComponent<CharacterController>();
            controller.center = new Vector3(0f, 0.9f, 0f);
            controller.height = 1.8f;
            controller.radius = 0.35f;
            controller.stepOffset = 0.4f;
            controller.skinWidth = 0.04f;
            var motor = root.AddComponent<PlayerController>();
            EditorUtil.SetSerialized(motor, "m_Settings", config.movementSettings);
            var input = root.AddComponent<PlayerInputReader>();
            input.enabled = false; // Enabled at runtime for the owning client only.
            var health = root.AddComponent<HealthSystem>();
            var combatant = root.AddComponent<Combatant>();
            var lagTarget = root.AddComponent<LagCompensatedTarget>();
            var weapons = root.AddComponent<WeaponSystem>();
            var networkPlayer = root.AddComponent<NetworkPlayer>();

            CharacterRig rig = BuildCharacterRig(root, health);

            GameObject cameraPivot = EditorUtil.CreateChild("CameraPivot", rig.VisualRoot, new Vector3(0f, 1.62f, 0f));
            var fpsCamera = cameraPivot.AddComponent<FPSCamera>();
            GameObject cameraObject = EditorUtil.CreateChild("Camera", cameraPivot.transform, Vector3.zero);
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            camera.nearClipPlane = config.cameraSettings != null ? config.cameraSettings.nearClipPlane : 0.03f;
            camera.farClipPlane = config.cameraSettings != null ? config.cameraSettings.farClipPlane : 1500f;
            camera.fieldOfView = 78f;
            camera.useOcclusionCulling = true;
            camera.enabled = false;
            var listener = cameraObject.AddComponent<AudioListener>();
            listener.enabled = false;
            GameObject viewModelRoot = EditorUtil.CreateChild("ViewModelRoot", cameraObject.transform, Vector3.zero);
            viewModelRoot.layer = GameLayers.ViewModel;
            var viewModel = viewModelRoot.AddComponent<WeaponViewModel>();

            EditorUtil.SetSerialized(fpsCamera, "m_Settings", config.cameraSettings);
            EditorUtil.SetSerialized(fpsCamera, "m_Camera", camera);
            EditorUtil.SetSerialized(fpsCamera, "m_YawTransform", root.transform);
            EditorUtil.SetSerialized(fpsCamera, "m_EffectsTransform", cameraObject.transform);
            combatant.SetAimPoints(cameraPivot.transform, rig.Torso);
            EditorUtil.SetSerialized(lagTarget, "m_Rig", rig.HitboxRig);
            EditorUtil.SetSerialized(weapons, "m_ViewModel", viewModel);
            EditorUtil.SetSerialized(weapons, "m_ThirdPerson", rig.ThirdPerson);
            EditorUtil.SetSerialized(networkPlayer, "m_VisualRoot", rig.VisualRoot);
            EditorUtil.SetSerialized(networkPlayer, "m_FpsCamera", fpsCamera);
            EditorUtil.SetSerialized(networkPlayer, "m_Input", input);
            EditorUtil.SetSerialized(networkPlayer, "m_Visuals", rig.Visuals);
            EditorUtil.SetSerialized(networkPlayer, "m_HitboxRig", rig.HitboxRig);

            return SaveNetworkPrefab(root, $"{EditorUtil.NetworkPrefabFolder}/Player.prefab");
        }

        private static GameObject BuildBot(GameConfig config)
        {
            var root = new GameObject("Bot") { layer = GameLayers.Combatant };
            root.AddComponent<NetworkObject>();
            var networkTransform = root.AddComponent<NetworkTransform>();
            networkTransform.SyncRotAngleX = false;
            networkTransform.SyncRotAngleZ = false;
            networkTransform.SyncScaleX = false;
            networkTransform.SyncScaleY = false;
            networkTransform.SyncScaleZ = false;
            networkTransform.Interpolate = true;
            networkTransform.PositionThreshold = 0.01f;
            networkTransform.RotAngleThreshold = 0.5f;

            var agent = root.AddComponent<NavMeshAgent>();
            agent.radius = 0.35f;
            agent.height = 1.8f;
            agent.baseOffset = 0f;
            agent.speed = 4.6f;
            agent.acceleration = 28f;
            agent.angularSpeed = 720f;
            agent.stoppingDistance = 0.4f;
            agent.autoTraverseOffMeshLink = true;
            agent.enabled = false;

            var capsule = root.AddComponent<CapsuleCollider>();
            capsule.center = new Vector3(0f, 0.9f, 0f);
            capsule.height = 1.8f;
            capsule.radius = 0.35f;
            var body = root.AddComponent<Rigidbody>();
            body.isKinematic = true;
            body.useGravity = false;

            var navigator = root.AddComponent<BotNavigator>();
            EditorUtil.SetSerialized(navigator, "m_MovementSettings", config.movementSettings);
            var perception = root.AddComponent<BotPerception>();
            var health = root.AddComponent<HealthSystem>();
            var combatant = root.AddComponent<Combatant>();
            var lagTarget = root.AddComponent<LagCompensatedTarget>();
            var weapons = root.AddComponent<WeaponSystem>();
            var brain = root.AddComponent<AdvancedBotAI>();

            CharacterRig rig = BuildCharacterRig(root, health);
            GameObject eye = EditorUtil.CreateChild("Eye", rig.AimPivot, new Vector3(0f, 0.2f, 0.08f));

            combatant.SetAimPoints(eye.transform, rig.Torso);
            EditorUtil.SetSerialized(perception, "m_Eye", eye.transform);
            EditorUtil.SetSerialized(lagTarget, "m_Rig", rig.HitboxRig);
            EditorUtil.SetSerialized(weapons, "m_ThirdPerson", rig.ThirdPerson);
            EditorUtil.SetSerialized(brain, "m_Difficulty", config.GetDifficulty(config.defaultDifficultyIndex));
            EditorUtil.SetSerialized(brain, "m_Eye", eye.transform);
            EditorUtil.SetSerialized(brain, "m_Visuals", rig.Visuals);
            EditorUtil.SetSerialized(brain, "m_HitboxRig", rig.HitboxRig);
            EditorUtil.SetSerialized(brain, "m_BodyCollider", capsule);

            return SaveNetworkPrefab(root, $"{EditorUtil.NetworkPrefabFolder}/Bot.prefab");
        }

        private static GameObject BuildSimpleNetworkPrefab(string name, Type component)
        {
            var root = new GameObject(name);
            root.AddComponent<NetworkObject>();
            root.AddComponent(component);
            return SaveNetworkPrefab(root, $"{EditorUtil.NetworkPrefabFolder}/{name}.prefab");
        }

        /// <summary>Saves a prefab and forces NGO to generate its GlobalObjectIdHash immediately.</summary>
        private static GameObject SaveNetworkPrefab(GameObject root, string path)
        {
            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(root, path);
            Object.DestroyImmediate(root);
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate);
            prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);

            var networkObject = prefab.GetComponent<NetworkObject>();
            MethodInfo onValidate = typeof(NetworkObject).GetMethod("OnValidate", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);
            onValidate?.Invoke(networkObject, null);
            EditorUtility.SetDirty(prefab);
            AssetDatabase.SaveAssets();

            var serialized = new SerializedObject(networkObject);
            SerializedProperty hash = serialized.FindProperty("GlobalObjectIdHash");
            if (hash != null && hash.longValue == 0)
            {
                Debug.LogWarning($"[FPS Builder] {path} has no GlobalObjectIdHash yet; select the prefab once in the Project window to let Netcode generate it.");
            }

            return prefab;
        }
    }
}
