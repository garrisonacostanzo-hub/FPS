# VANGUARD — browser FPS in one HTML file

A first-person shooter that is **a single file: `web/dist/VANGUARD.html`**. Download it and double-click it. There's nothing to install and no server to run. The same file has:

* **Offline single-player against bots.**
* **Online multiplayer.** One player hosts in their browser and friends join with a 5-character room code. Humans and bots play in the same match.
* **Six game modes on three maps.** Every mode works both offline and online.

## Play offline

1. Open **`VANGUARD.html`** in Chrome, Edge, Firefox or Safari. Double-clicking it works and no web server is needed.
2. Go to **PLAY OFFLINE** and pick a mode, a map, the bot count and the bot difficulty.
3. Choose your primary weapon and click **DEPLOY**.
4. Click inside the game to capture the mouse.

## Play online

Every player needs **the same `VANGUARD.html`** and an internet connection.

**Host:**
1. Go to **PLAY ONLINE → HOST A MATCH**.
2. Pick the mode, map, bots and difficulty, then click **HOST MATCH**.
3. You get a room code like `K7QX3`. It appears in the pause menu (with a COPY button) and in the corner of the screen.
4. Send the code to your friends.

**Friends:** go to **PLAY ONLINE**, type the code under **JOIN A MATCH**, then click **JOIN**.

Some rules:
* Up to 8 players per match. Bots fill out the teams.
* **The match runs in the host's browser.** The host should keep that tab open. Their game keeps running if they switch tabs, but if the host leaves or closes the tab, the match ends for everyone.
* Players connect directly to the host's browser over WebRTC. The free public [PeerJS](https://peerjs.com) service is used only to find the host from the room code. If a strict network blocks a direct connection, PeerJS's public relay is tried automatically.
* Online play doesn't work inside sandboxed embeds that block WebRTC (such as Claude's artifact viewer). Open the file directly in a browser.
* Advanced: to use your own PeerJS signaling server, open `VANGUARD.html?signal=your-host:9000`. Everyone in a match must use the same server.

## Build from source

```bash
cd web
npm install       # three, peerjs, esbuild
npm run build     # writes dist/VANGUARD.html
npm test          # headless simulation of every mode × map with bots (pathing, combat, scoring, replication)
```

## Game modes

| Mode | Rules |
|---|---|
| **Team Deathmatch** | Two teams. The first team to the kill limit (50) wins. |
| **Domination** | Capture zones A/B/C. Each zone held gives +1 point per second and each capture gives +5. First to 250 wins. |
| **Free-for-All** | Everyone for themselves. First to 25 kills wins. |
| **Gun Game** | Every kill moves you up the weapon ladder (pistol → SMG → shotgun → rifle → LMG → DMR → sniper → pistol). A suicide demotes you. The first player to finish the ladder wins. |
| **Elimination** | Rounds with no respawns. Wipe the enemy team to win a round. First to 4 rounds wins. |
| **Horde (co-op)** | Your squad survives escalating waves of enemy bots. Fallen players return when a wave is cleared. |

## Maps

| Map | Size | Layout |
|---|---|---|
| **Outpost** | Large (180 m) | Daytime. Sniper towers, two CQB compounds and three lanes. |
| **Foundry** | Medium (124 m) | Sunset. Dense industrial blocks with rooms, alleys and courtyards. |
| **Crossfire** | Small (76 m) | Night. A compact symmetric arena for fast FFA and Elimination. |

Each map has team spawns, an FFA spawn set, three capture zones, cover points for the AI, and named areas (perches, CQB rooms, corridors, objectives). The current area name appears under the minimap.

## Controls

| Action | Key |
|---|---|
| Move | `W A S D` / arrows |
| Sprint | `Shift` |
| Jump | `Space` |
| Crouch | `Ctrl` / `C` (hold or toggle, set in Settings) |
| Fire / Aim down sights | Left mouse / Right mouse (hold or toggle) |
| Reload | `R` |
| Switch weapon | `1` `2`, `Q` `E`, mouse wheel |
| Scoreboard | `Tab` |
| Chat | `T` / `Enter` |
| Pause / menu | `Esc` |

If the browser or an embedding frame refuses mouse capture (pointer lock), the game switches to free-cursor mouse look. Clicking in-game tries to capture the mouse again.

**Settings** covers name, sensitivity, ADS sensitivity, FOV, invert Y, volume, crosshair color and size, graphics quality, and the hold/toggle choices. Settings are saved in `localStorage`.

## Weapons

Pistol, SMG, rifle, shotgun, LMG, DMR and sniper. Each weapon has its own fire rate, damage falloff, headshot multiplier, spread (hip, ADS, moving and in the air), recoil, magazine size and reload time, ADS zoom and movement speed. All of these values are in one data table: `src/shared/weapons.js`.

## Bots

Bots send the same input commands as human players, so they move, aim and shoot under the same rules. Each bot runs this loop:

1. **Perception**
   * Vision: a vision cone plus a line-of-sight raycast, with awareness that builds over time.
   * Hearing: gunshots, footsteps and reloads are heard within ranges that depend on the sound.
   * Suppression: near misses make the bot react.
   * Team intel: bots share sightings with teammates.
2. **State machine:** patrol, investigate, engage, take cover (move, hide, peek), reload behind cover, flank (one flanker per team at a time), and search the last known position.
3. **Navigation:** A* on a 2.5D nav grid with path smoothing. Stuck detection jumps or repaths.
4. **Aim:** human-like aiming with reaction time, an error cone that settles over time, tracking lag and trigger discipline. Shots come in bursts and range limits depend on the weapon.
5. **Modes:** bots play the objectives. They capture and hold zones in Domination and rush the players in Horde.

Difficulty: **Easy / Normal / Hard / Elite**. It scales reaction time, accuracy, tracking, detection speed, FOV, hearing and aggression.

## Networking

Every match runs on the same authoritative simulation (`src/shared`). For offline play it runs in your tab. For online play it runs in the host's tab, and the guests connect peer-to-peer. Offline and online therefore behave the same.

* **Host-authoritative.** The host's browser runs the 30 Hz simulation and decides every hit, kill and score. A Web Worker timer keeps the host's match running even when its tab is in the background.
* **Transport.** Each guest has one reliable WebRTC data channel (commands, events, roster) and one unreliable, unordered channel for snapshots. A lost snapshot is skipped instead of stalling the game, and stale ones are ignored. Snapshots go out at 20 Hz online (30 Hz offline), and each one carries the guest's acknowledged command sequence.
* **Disconnects.** A guest who closes their tab is removed immediately. A lost connection is detected within about 10 s. If the host disappears, the guests return to the menu with a message.
* **Client-side prediction.** The client sends 60 Hz input commands in batches. It predicts movement *and* weapon state (ammo, fire rate, reload). On each snapshot it reconciles by replaying unacknowledged commands, with smooth error correction.
* **Lag compensation.** The host keeps a 0.3 s history of every player's hitboxes. It rewinds them to the shooter's view time (`cmd.vt`) before tracing shots. Spread is seeded deterministically, so the predicted tracer matches the host's.
* **Interpolation.** Remote players and bots are interpolated about 100 ms behind host time, using an estimated clock offset.
* **Fair play.** The host sanitizes and clamps all guest inputs. Each player has a command budget (no speed hacks), and only the host can apply damage, kills and scores. The host is trusted, so play with friends.

## Source layout

```
web/
├─ dist/VANGUARD.html       # the built game: one self-contained file (offline + online)
├─ scripts/
│  ├─ build.mjs             # esbuild → one inlined HTML file
│  └─ simtest.mjs           # headless simulation test (npm test)
└─ src/
   ├─ shared/               # deterministic game simulation (offline tab or online host tab)
   │  ├─ constants.js       # tick rates, movement, difficulty tables, teams
   │  ├─ math.js            # vector/angle helpers, seeded RNG, ray tests
   │  ├─ world.js           # AABB collision world + raycasts (grid broadphase)
   │  ├─ movement.js        # player motor: walk/sprint/crouch/jump, step-up, coyote time
   │  ├─ weapons.js         # weapon data table + fire/reload/switch state machine
   │  ├─ sim.js             # per-command step (movement + weapons), hitboxes, packing
   │  ├─ map.js             # procedural map builders, zones, spawns, cover points
   │  ├─ nav.js             # 2.5D nav grid + A* + path smoothing
   │  ├─ bots.js            # bot brain: perception, FSM, steering, aim
   │  ├─ modes.js           # TDM / DOM / FFA / Gun Game / Elimination / Horde
   │  ├─ game.js            # authoritative match: entities, damage, lag comp, snapshots
   │  └─ host.js            # fixed-tick match host, client bindings, network messages
   └─ client/               # browser only
      ├─ main.js            # entry: menu ↔ session
      ├─ menu.js            # offline setup / host & join by code / settings / controls
      ├─ session.js         # prediction, reconciliation, interpolation, game loop
      ├─ net.js             # LocalTransport (offline), HostTransport & JoinTransport (WebRTC via PeerJS)
      ├─ renderer.js        # Three.js scene, characters, view model, effects
      ├─ hud.js             # HUD, killfeed, scoreboard, minimap, menus
      ├─ input.js           # pointer lock, keyboard/mouse
      ├─ audio.js           # procedural WebAudio (positional gunfire, footsteps…)
      ├─ settings.js        # persisted settings
      ├─ index.html         # page template
      └─ styles.css
```

## Notes

* Rendering uses merged geometry per material, procedural textures, shadow mapping and pooled effects. The **Quality** setting adjusts pixel ratio, antialiasing and shadows.
* Every texture and sound is generated at runtime. There are no asset files.
* After editing anything in `src/`, run `npm run build` to regenerate `dist/VANGUARD.html`.
