# Implementation Guide

This guide takes you from an empty machine to a running multiplayer match with bots. It then documents every system, so the codebase can be extended safely.

- [1. Prerequisites](#1-prerequisites)
- [2. Create / open the project from the terminal](#2-create--open-the-project-from-the-terminal)
- [3. Packages](#3-packages)
- [4. Generate everything (automated component attachment)](#4-generate-everything-automated-component-attachment)
- [5. Run a match](#5-run-a-match)
- [6. Component reference (what the builder attaches)](#6-component-reference-what-the-builder-attaches)
- [7. Architecture](#7-architecture)
- [8. Networking model](#8-networking-model)
- [9. AI bot framework](#9-ai-bot-framework)
- [10. Map system and performance](#10-map-system-and-performance)
- [11. Customisation recipes](#11-customisation-recipes)
- [12. Builds and dedicated servers](#12-builds-and-dedicated-servers)
- [13. Troubleshooting](#13-troubleshooting)

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| Unity Hub 3.x | <https://unity.com/download> |
| Unity 6 LTS editor (`6000.0.x`; later `6000.x` LTS also works) | `ProjectSettings/ProjectVersion.txt` pins `6000.0.32f1`. Any 6000.x editor opens it. |
| Build modules | *Windows/Mac/Linux Build Support (Mono)*. For headless servers: *Linux Dedicated Server* and/or *Windows Dedicated Server Build Support*. |
| Git | To clone this repository. |

The Unity Hub CLI can install the editor and modules. Hub prints the available versions and changesets with `editors --releases`:

```bash
# Windows (PowerShell)
& "C:\Program Files\Unity Hub\Unity Hub.exe" -- --headless editors --releases
& "C:\Program Files\Unity Hub\Unity Hub.exe" -- --headless install --version 6000.0.32f1
& "C:\Program Files\Unity Hub\Unity Hub.exe" -- --headless install-modules --version 6000.0.32f1 -m windows-mono linux-mono linux-server windows-server

# macOS
"/Applications/Unity Hub.app/Contents/MacOS/Unity Hub" -- --headless install --version 6000.0.32f1
"/Applications/Unity Hub.app/Contents/MacOS/Unity Hub" -- --headless install-modules --version 6000.0.32f1 -m mac-mono linux-mono linux-server

# Linux
unityhub --headless install --version 6000.0.32f1
unityhub --headless install-modules --version 6000.0.32f1 -m linux-mono linux-server windows-mono
```

> If Hub asks for a changeset, copy it from the Unity download archive for that exact version (`--changeset <hash>`).

Editor binary locations used below (`$UNITY`):

| OS | Path |
|---|---|
| Windows | `C:\Program Files\Unity\Hub\Editor\6000.0.32f1\Editor\Unity.exe` |
| macOS | `/Applications/Unity/Hub/Editor/6000.0.32f1/Unity.app/Contents/MacOS/Unity` |
| Linux | `~/Unity/Hub/Editor/6000.0.32f1/Editor/Unity` |

## 2. Create / open the project from the terminal

This repository **is** the Unity project root (`Assets/`, `Packages/`, `ProjectSettings/`).

```bash
git clone https://github.com/<you>/FPS.git
cd FPS

# Open interactively (resolves packages, compiles scripts):
"$UNITY" -projectPath "$(pwd)"

# ...or generate the whole game headlessly (packages, compile, settings, assets, prefabs, scenes, NavMesh):
"$UNITY" -batchmode -quit -projectPath "$(pwd)" \
  -executeMethod FPS.EditorTools.FPSProjectBuilder.BuildAllBatch -logFile -
# Optional flags: -fpsBakeOcclusion (also bake occlusion culling), -fpsSkipNavMesh
```

Starting from a brand-new empty project instead? Create it, then copy `Assets/_Project`, and replace `Packages/manifest.json` with the one in this repo:

```bash
"$UNITY" -batchmode -quit -createProject ~/Projects/Vanguard
cp -r Assets/_Project ~/Projects/Vanguard/Assets/
cp Packages/manifest.json ~/Projects/Vanguard/Packages/manifest.json
```

## 3. Packages

`Packages/manifest.json` (already in the repo) declares:

| Package | Version | Why |
|---|---|---|
| `com.unity.render-pipelines.universal` | 17.0.4 | URP. This is a *core* package locked to the editor; on 6000.1+ use the version Package Manager shows. |
| `com.unity.inputsystem` | 1.20.1 | New Input System (actions are defined in code in `FPSInputActions`). |
| `com.unity.ai.navigation` | 2.0.16 | `NavMeshSurface`, `NavMeshLink`, `NavMeshModifier` components. |
| `com.unity.netcode.gameobjects` | 2.13.3 | Netcode for GameObjects (brings `com.unity.transport`, `collections`, `burst`, `mathematics`). |
| `com.unity.ugui` | 2.0.0 | uGUI (HUD, menus) – core package in Unity 6. |
| `com.unity.modules.*` | 1.0.0 | Engine modules: AI, physics, terrain, umbra (occlusion), audio, UI, etc. |

To add them to another project from the command line, merge those entries into its `Packages/manifest.json`, or use **Window > Package Manager > + > Add package by name**:
`com.unity.inputsystem`, `com.unity.ai.navigation`, `com.unity.netcode.gameobjects`.

Optional and recommended for testing several clients on one machine: **Multiplayer Play Mode** (`com.unity.multiplayer.playmode`, via *Window > Multiplayer > Multiplayer Play Mode*).

### First open

1. The Input System asks *"Do you want to enable the new input backends?"* Answer **Yes**; the editor restarts. The builder sets `Active Input Handling = Input System Package (New)` too, so headless runs work.
2. NGO may create `Assets/DefaultNetworkPrefabs.asset`. This is harmless: the project uses its own `FPS_NetworkPrefabs` list.

## 4. Generate everything (automated component attachment)

Menu **`FPS > Build Everything`** runs these idempotent steps. Each is also available under `FPS > Steps`:

| Step | Class | Output |
|---|---|---|
| 1. Project settings | `ProjectConfigurator` | Layers 8–13 (`Environment, Combatant, Hitbox, Props, Trigger, ViewModel`) and their physics matrix. Input System backend. URP asset and renderer (if none assigned) with shadows, cascades and MSAA tuning. Humanoid NavMesh agent (r 0.4 / h 1.8 / step 0.45 / slope 46). `runInBackground`, linear colour space. |
| 2. Data assets | `AssetFactory` | Procedural grid textures and URP materials, LOD rock meshes. 5 `WeaponData` (rifle, SMG, shotgun, marksman, pistol), 4 `BotDifficultyProfile`, movement, camera, match, HUD theme, map blueprint. `Resources/FPS/GameConfig.asset` wiring all of it. |
| 3. Prefabs | `PrefabFactory` | Environment kit (floor, walls, door and window walls, low wall, pillar, stairs, crates, crate stack, container, barrier, sandbags, barrel, lamp post, rock), each with colliders, `LODGroup` and static flags. `Player`, `Bot`, `MatchManager` and `CaptureZone` network prefabs plus `FPS_NetworkPrefabs.asset`. |
| 4. Scenes | `SceneFactory` + `MapGenerator` | `Bootstrap` (NetworkManager + UnityTransport + NetworkManagerSetup), `MainMenu`, and `Battlefield` (terrain, zones, cover, spawns, routes, cover points, lighting, HUD, systems, NavMesh bake, occlusion area). All are registered in Build Settings. |

Other tools:

- `FPS > Bake NavMesh (open scene)`
- `FPS > Bake Occlusion Culling (open scene)`
- `FPS > Regenerate Cover Points (open scene)`
- `FPS > Open Scene > …`
- `FPS > Build > …`

## 5. Run a match

1. Open **Bootstrap** and press Play. It loads **MainMenu**.
2. Enter a name. Choose the bot count (0–31) and difficulty, then click **HOST GAME**. The host loads **Battlefield** through `NetworkSceneManager`, spawns you, and back-fills both teams with bots.
3. Other players: **JOIN GAME** with the host IP and port (default `7777`, UDP). Allow the port through your firewall or forward it for internet play.
4. Domination rules: an 8 s warm-up, then a 10 min match to 1000 points. Points come from held zones (+2 every 2 s per zone), captures (+25) and kills (+5 team, +10/+5 headshot personal).

Shortcut: pressing **Play** directly in `Battlefield` bounces through Bootstrap and starts a local host automatically.

Testing two clients on one PC: build the client (`FPS > Build > Windows Client`), run it with `-host`, and press Play in the editor (JOIN 127.0.0.1). Alternatively, use Multiplayer Play Mode virtual players.

## 6. Component reference (what the builder attaches)

You can rebuild any prefab by hand from this table. Private serialized fields are assigned through `SerializedObject` by `PrefabFactory`.

### Player prefab (`Prefabs/Network/Player.prefab`, layer `Combatant`, tag `Player`)

| GameObject | Components | Wired references |
|---|---|---|
| `Player` (root) | `NetworkObject`, `CharacterController` (h 1.8, r 0.35, centre 0.9), `PlayerController`, `PlayerInputReader` (disabled), `HealthSystem`, `Combatant`, `LagCompensatedTarget`, `WeaponSystem`, `NetworkPlayer` | `PlayerController.m_Settings`, `Combatant` eye → CameraPivot, chest → Hitboxes/Torso. `WeaponSystem.m_ViewModel / m_ThirdPerson`. `NetworkPlayer.m_VisualRoot / m_FpsCamera / m_Input / m_Visuals / m_HitboxRig` |
| `VisualRoot` | `CharacterVisuals` | body, aim pivot, team-coloured renderers |
| `VisualRoot/Body/*` | Mesh renderers (legs, torso, head, visor, backpack) | – |
| `VisualRoot/AimPivot/WeaponSocket` | `ThirdPersonWeapon` | – |
| `VisualRoot/CameraPivot` | `FPSCamera` | camera, yaw transform = root, effects transform = Camera |
| `…/CameraPivot/Camera` (tag `MainCamera`) | `Camera` (disabled), `AudioListener` (disabled) | enabled for the owner only |
| `…/Camera/ViewModelRoot` | `WeaponViewModel` | – |
| `Hitboxes` | `HitboxRig` | head / torso / legs |
| `Hitboxes/Head, Torso, Legs` (layer `Hitbox`) | Sphere / Box colliders, `Hitbox` (region, owner) | – |

### Bot prefab (`Prefabs/Network/Bot.prefab`)

| GameObject | Components |
|---|---|
| `Bot` (root, `Combatant`) | `NetworkObject`, `NetworkTransform` (server authority; X/Z rotation and scale not synced), `NavMeshAgent` (disabled, server enables), `CapsuleCollider`, kinematic `Rigidbody`, `BotNavigator`, `BotPerception`, `HealthSystem`, `Combatant`, `LagCompensatedTarget`, `WeaponSystem`, `AdvancedBotAI` |
| `VisualRoot/AimPivot/Eye` | perception and aim origin |
| `Hitboxes/*` | same as the player |

### Other network prefabs

- `MatchManager.prefab`: `NetworkObject` + `MatchManager`
- `CaptureZone.prefab`: `NetworkObject` + `CaptureZone`

All four network prefabs are registered in `FPS_NetworkPrefabs.asset` (assigned to the `NetworkManager`). They are also registered at runtime by `NetworkManagerSetup` if missing. The builder forces generation of each prefab's `GlobalObjectIdHash`.

### Scenes

| Scene | Contents |
|---|---|
| Bootstrap | `NetworkManager` (`NetworkManager`, `UnityTransport`, `NetworkManagerSetup`), `BootCamera` |
| MainMenu | Sun + `DynamicLightingController`, backdrop kit, `MenuCamera` (`SceneCameraDirector`), `MainMenu` (`MainMenuUI`), `EventSystem` (`InputSystemUIInputModule`) |
| Battlefield | `Map/Environment` (Terrain, Structures, Cover, Rocks, DetailSectors + `WorldSectorStreamer`, Boundaries). `Map/Gameplay` (SpawnPoints, CaptureZoneMarkers, PatrolRoutes, TacticalZones, CoverPoints). `Systems` (BattlefieldDirector, HUD, PauseMenu, EventSystem, Performance, SceneCamera, NavMesh + `RuntimeNavMeshGuard`, OcclusionArea). Sun + `DynamicLightingController`. |

> Networked objects are never placed in scenes. The server spawns `MatchManager` and one `CaptureZone` per `CaptureZoneMarker` from `BattlefieldDirector`. This avoids in-scene `NetworkObject` hash pitfalls entirely.

## 7. Architecture

```
               ┌──────────────── ScriptableObject data (Data/) ────────────────┐
               │ WeaponData · BotDifficultyProfile · MatchSettings · HUDTheme … │
               └───────────────▲───────────────────────────────▲───────────────┘
                               │ read                          │ read
 Input System ─► PlayerInputReader ─► NetworkPlayer ──commands──► PlayerController (motor)
                                       │   ▲ reconcile/snapshots      ▲
                                       │   └──── NGO RPC / ticks ─────┘
                                       ├─► FPSCamera (look, recoil, FOV)
                                       └─► WeaponSystem ──ShotRequest──► server: LagCompensation + Ballistics
                                                                            └─► Hitbox ─► HealthSystem (IDamageable)
 AdvancedBotAI ─► BotPerception / BotSquad / CoverSystem / BotNavigator ─► WeaponSystem.BotTryFire (same pipeline)

 Decoupling: EventBus<T> (Core/GameEvents.cs) ─► HUDController, CrosshairUI, KillFeedUI, audio, cameras …
 Registries: CombatantRegistry, ObjectiveRegistry, CoverSystem, SpawnPoint.All, PatrolRoute.All, TacticalZone.All
```

Principles:

- **Data-driven**: every tunable value lives in a ScriptableObject. `GameConfig` (in `Resources`) is the single root, so runtime code needs no scene references.
- **Event-driven presentation**: gameplay raises typed structs through `EventBus<T>`. The HUD, crosshair and kill feed subscribe without referencing players or weapons.
- **One code path for humans and bots**: both are `Combatant` + `HealthSystem` + `WeaponSystem` + `IRespawnable`. Bots call `WeaponSystem.BotTryFire`, players call `OwnerTick`. Validation, lag compensation, damage and FX are shared.
- **Server authority**: health, ammo, hits, movement, score and objectives are decided by the server. Clients predict only what needs to feel instant (movement, fire feedback, ammo display).

## 8. Networking model

| Concern | Implementation |
|---|---|
| Topology | Client-server with optional host (`StartHost`, `StartClient`, `StartServer`). Unity Transport over UDP. |
| Connection approval | `NetworkManagerSetup.ApproveConnection` validates the JSON payload (name, game version) and capacity. `CreatePlayerObject = false`; `MatchManager` spawns players with team balancing and safe spawn selection. |
| Scene flow | `Bootstrap` → `MainMenu` → `NetworkSceneManager.LoadScene("Battlefield")`. Late joiners are synchronised automatically and spawned on `OnSynchronizeComplete`. |
| Tick rate | 60 Hz (`MatchSettings.networkTickRate`). Movement simulates on `NetworkTickSystem.Tick`. |
| Movement | Owner: `BuildCommand` → `PlayerController.Simulate` (prediction) → `SubmitInputsRpc` (unreliable, last 3 commands for loss resilience). Server: queue → simulate (bounded catch-up against speed hacks). It replies with `OwnerStateRpc(lastProcessedTick, MotorState)`. Owner: compares with the predicted state at that tick; on error > 6 cm, rewinds and replays newer commands, and smooths the visual offset. |
| Remote players | Server broadcasts a `PlayerSnapshot` at 30 Hz (`SnapshotRpc`, unreliable, `SendTo.NotOwner`). Clients render 100 ms in the past with interpolation (`InterpolateRemote`). A teleport id prevents smearing across respawns. |
| Bots | Server-simulated NavMeshAgent. `NetworkTransform` (server authority, interpolated). `NetworkVariable`s for aim pitch and crouch. |
| Shooting | Owner predicts: fire timing, ammo, recoil, view model, local tracer and impact raycast. Sends `FireRpc(ShotRequest{origin, dir, spread, seed, viewTime, slot})`. Server validates rate, ammo, origin and minimum spread. `LagCompensation.Rewind(viewTime)` restores the hitbox poses the shooter saw (≤ 300 ms). It regenerates the identical seeded pellet pattern, applies damage, then sends `ShotFxRpc` to observers and `HitConfirmRpc` to the shooter. |
| Ammo / reload / switch | Predicted locally. `ReloadRpc` / `SwitchRpc` to the server, which keeps authoritative ammo. `AmmoSyncRpc` corrections account for shots still in flight. Active slot is a `NetworkVariable` for remote third-person models. |
| Health | `NetworkVariable<float>` health, `NetworkVariable<bool>` dead. `DamagedRpc` / `DiedRpc` drive hit indicators, death cams and kill feed. Static server events feed scoring and AI. |
| Match state | `NetworkVariable` phase, end time, team scores, winner. `NetworkList<ScoreEntry>` scoreboard (humans and bots). `KillFeedRpc`, `AnnounceRpc`. |
| Objectives | `CaptureZone`: `NetworkVariable` owner, progress, contested, radius, label, name. |
| Security notes | Every client→server RPC checks `SenderClientId == OwnerClientId`. Shots are validated on the server; clients can never apply damage directly. |

## 9. AI bot framework

**Perception** (`BotPerception`, server only, 10 Hz with LOD):

- Vision: FOV cone plus detection distance, from the difficulty profile. Line of sight is raycast to the head, chest and legs. Each enemy has an awareness meter that fills faster when the enemy is close, centred, moving or shooting (muzzle flashes extend range by 1.8×).
- Hearing: `NoiseSystem` events (footsteps by stance, landings, gunfire). The radius is scaled by the profile's `hearingMultiplier` and reduced by 40 % through walls. Localisation error grows with distance. Allied gunfire draws bots to support their team.
- Threat: near misses (≤ 3.5 m from a bullet path) and damage raise suppression and reveal the shooter.

**Decision layer** (`AdvancedBotAI.Decide`, every `decisionInterval`), checked in this order:

1. Dead.
2. A non-interruptible state (dash to cover, reload, flank en route) continues.
3. Threatened (suppression or low health and recently hit): TakeCover.
4. Empty magazine: TakeCover with reload, or Reload.
5. Visible target: Engage, or Flank when assigned by the squad.
6. Safe and the magazine is low: Reload, using a squad token so the whole squad never reloads at once.
7. Remembered target: Engage (hold the angle) for 1.2 s, then Search.
8. A noise or sighting to check: Investigate.
9. Fresh squad intel: Investigate, moving to support.
10. Otherwise: Patrol (squad objective or patrol route).

**States**:

| State | Behaviour |
|---|---|
| Patrol | Squad leader heads to the objective; followers take wedge formation slots. Inside the objective: hold points, crouch, sweep outward. Without an objective: patrol routes or wander. |
| Investigate | Run (gunfire) or walk (footstep) to the stimulus; cautious bots crouch-walk near it; scan on arrival. |
| Engage | Keep the weapon's preferred range (advance or back off), strafe (`strafeChance`) or crouch-fire. Pre-aim and suppress the last known position. |
| TakeCover | `CoverSystem.FindBestCover`: protection raycasts at hidden eye height, distance and threat-distance scoring, no running towards the enemy, path validation, squad reservation. Sprint there, hide (crouch for low cover), reload, then peek and re-engage. With no cover, retreat. |
| Reload | Reload in place, or back into nearby cover if threatened. |
| Flank | Squad-assigned (one flanker at a time, with cooldown). Picks the side opposite the squad's centroid, validates it is on the NavMesh with a sane path length, sprints there, then re-engages. |
| Search | Predict the target's movement from its last known velocity, sweep 3 points, then give up. Cautious bots hold the angle first. |

**Aim and trigger** (`BotAimController`): turn speed is limited by `aimTrackingSpeed`. A per-target error offset is re-rolled every 0.25–0.6 s; its cone shrinks while the bot keeps tracking (`aimSettleTime`) and grows with target speed, own movement and suppression. Head shots follow `headshotPreference`. The first shot waits `reactionTime` after full detection. Bursts follow `burstShots` / `burstPause`; marksman rifles wait for the aim to settle.

**Squads** (`BotSquad`, `BotSquadManager`): up to 3 bots per squad. Squads share enemy sightings and are given objectives by priority: defend contested zones > attack enemy zones > take neutral zones. They also coordinate reload tokens and flanker assignment.

**Difficulty profiles** (`Data/Bots/*.asset`):

| Profile | Reaction (s) | Accuracy | Detection (m) | FOV | Aggressiveness | Flank |
|---|---|---|---|---|---|---|
| Recruit | 0.90 | 0.25 | 55 | 95° | 0.35 | 0.10 |
| Regular | 0.50 | 0.55 | 85 | 110° | 0.50 | 0.30 |
| Veteran | 0.30 | 0.75 | 120 | 120° | 0.65 | 0.45 |
| Elite | 0.18 | 0.90 | 160 | 130° | 0.80 | 0.60 |

Set the difficulty from the main menu, with `-difficulty <0-3>`, per prefab (`AdvancedBotAI.m_Difficulty`), or at runtime with `AdvancedBotAI.ServerConfigure(profile)`.

Debugging: select a bot in play mode to see its vision cone, target line and investigate point (gizmos). Enable `m_LogStateChanges` to log transitions.

## 10. Map system and performance

`MapBlueprint_Valley.asset` is a list of `ZoneDefinition`s (type, centre, size, rotation, team, terrain offset, label). Edit it and run `FPS > Steps > 5. Rebuild Battlefield Only`.

| Zone type | What gets built |
|---|---|
| SpawnBase | Team-tinted slab, high back wall, side walls with doors, sandbag front with exits, containers. 12 base spawn points plus 4 forward spawns. |
| CaptureObjective | Capture marker (networked zone at runtime), inner barrier ring, outer crate stacks and low walls. Flavour per label: A quarry rocks, B lamp-lit crossroads, C container depot. Ring patrol route. |
| CloseQuartersArena | 4 m modular compound: outer walls with doors and windows, interior partitions with doorways, a roofed hall, crates, interior real-time lights, a route through the rooms. |
| SniperPerch | Raised ridge (terrain offset), tower on pillars, railings, 27° access ramp, one-way `NavMeshLink` drop-down, rock cover around the base. |
| TraversalCorridor | Terrain cut along a segment (canal or rail cut) or a flat road, alternating cover clusters, lamp posts, a linear patrol route. |

Performance features:

- **LOD**: every kit piece has an `LODGroup` (detailed → simple → culled). Rocks use procedural icosphere LODs (1280 / 320 / 80 triangles).
- **Static batching and occlusion**: kit pieces are flagged Batching, Occludee and ReflectionProbe static. Walls, containers, rocks and terrain are also Occluder static. An `OcclusionArea` covers the playable volume. Bake with `FPS > Bake Occlusion Culling`, which takes a few minutes.
- **Culling distances**: `PerformanceProfile` sets per-layer cull distances (Props 160 m, cosmetic 250 m) and spherical culling, and turns occlusion culling on for the active camera.
- **Sector streaming**: decorative detail (no colliders) is grouped into 120 m sectors. `WorldSectorStreamer` (a `CullingGroup` with distance bands) disables far sectors on clients.
- **Lighting**: fully real-time (no lightmaps, so instant regeneration). `DynamicLightingController` provides an optional day/night cycle with throttled `DynamicGI.UpdateEnvironment`. The URP asset uses 4 cascades and a 140 m shadow distance. Interior lights don't cast shadows.
- **NavMesh**: baked from physics colliders inside a bounded volume (voxel 0.16 m) and saved as an asset. `RuntimeNavMeshGuard` builds it at runtime if the bake is missing.
- **AI LOD**: bots more than 70 m / 150 m from every human run perception at 6.7 Hz / 4 Hz instead of 10 Hz.
- **Allocation-free hot paths**: `NonAlloc` physics queries, pooled tracers, impacts and audio, cached procedural materials and clips.

## 11. Customisation recipes

- **New weapon**:
  1. *Assets > Create > FPS > Weapon Data* (give it a unique `weaponId`).
  2. Add it to `GameConfig.weapons`, then to `playerLoadout` (max 3 slots) or `botLoadoutPool`.
  3. To use your own model, assign `viewModelPrefab` (name a child `Muzzle`, optionally `Magazine`).
- **Weapon feel**: tune `roundsPerMinute`, `damageFalloff`, spread (hip/ADS/move/bloom), recoil (vertical range, horizontal, recovery fraction), `aimFieldOfView` and `preferredEngagementRange` (AI).
- **HUD theme**: duplicate `HUDTheme_Default`, change the palette, crosshair geometry or hit-marker colours, and assign it in `GameConfig.hudTheme`. Players can change crosshair colour, HUD scale, FOV, sensitivity, smoothing and toggles in the ESC menu.
- **Match rules**: `MatchSettings` sets durations, score limit, kill and capture scores, respawn delay, spawn protection, friendly fire, regeneration and lag compensation window.
- **New bot state**:
  1. Derive from `BotState`.
  2. Add a `BotStateId` value.
  3. Register it in `AdvancedBotAI.InitializeServer`.
  4. Return it from `Decide()`.
- **New objective type**: implement `IObjective` on a `NetworkBehaviour` and register it with `ObjectiveRegistry`. Squads, the HUD and scoring pick it up automatically.
- **Rebinding**: `InputService.Actions.Asset` is a normal `InputActionAsset`. Use `PerformInteractiveRebinding()`, then `InputService.SaveBindings()` to persist the overrides.

## 12. Builds and dedicated servers

```bash
# Client builds (menu: FPS > Build > ...)
"$UNITY" -batchmode -quit -projectPath . -executeMethod FPS.EditorTools.BuildTools.BuildWindowsClientBatch -logFile -

# Linux dedicated server (Dedicated Server build target, headless)
"$UNITY" -batchmode -quit -projectPath . -executeMethod FPS.EditorTools.BuildTools.BuildLinuxServerBatch -logFile -

# Run the server: 10 bots on Veteran
./Builds/LinuxServer/ProjectVanguardServer.x86_64 -batchmode -nographics -server -port 7777 -bots 10 -difficulty 2 -logFile -

# Run clients
ProjectVanguard.exe -client 203.0.113.10 -port 7777 -name Alice
ProjectVanguard.exe -host -bots 7 -difficulty 1          # listen server with bots
```

Command-line options parsed by `NetworkManagerSetup`: `-server` (or `-dedicated`), `-host`, `-client <ip>`, `-port <n>`, `-bots <0-31>`, `-difficulty <0-3>`, `-name <player>`. Any `-batchmode` player without a mode starts as a dedicated server.

## 13. Troubleshooting

| Symptom | Fix |
|---|---|
| Pink materials | No URP asset assigned. Run `FPS > Steps > 1. Configure Project Settings`, or assign `Settings/Rendering/FPS_URP.asset` in *Project Settings > Graphics*. |
| No input in play mode / console says the Input System backend is disabled | *Project Settings > Player > Active Input Handling* = *Input System Package (New)*, then restart the editor. |
| Package resolution error for URP/uGUI on Unity 6000.1+ | Change the version in `Packages/manifest.json` to the one Package Manager lists for your editor (core packages are tied to the editor version). |
| `GameConfig not found` | Run `FPS > Build Everything` (creates `Resources/FPS/GameConfig.asset`). |
| Bots stand still | The NavMesh is missing: `FPS > Bake NavMesh (open scene)` in Battlefield (or let `RuntimeNavMeshGuard` build it at load). |
| Clients cannot connect | Open UDP 7777 on the host firewall or router. Check that both builds have the same `MatchSettings.gameVersion`. Use the host's LAN or public IP. |
| "NetworkPrefab hash" warnings after editing prefabs | Re-run `FPS > Steps > 3. Build Prefabs` (regenerates hashes and the prefab list). |
| Editor freezes during occlusion bake | Expected for large maps (minutes). Bake once before shipping; it is optional during development. |

> **Version control:** after the first `Build Everything`, commit the generated `Assets/_Project/*` assets **and all `.meta` files**, so teammates share the same GUIDs.
