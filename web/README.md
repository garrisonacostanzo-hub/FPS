# VANGUARD — browser FPS (HTML5 / Three.js)

A playable first-person shooter that runs in the browser. It has three ways to play:

* **Offline single-player against bots.** Open one HTML file. No server and no install.
* **Online multiplayer.** A small Node.js server runs authoritative rooms. Humans and bots play in the same match.
* **Six game modes on three maps.** Every mode works both offline and online.

## Play offline (no install)

Open **`web/dist/index.html`** in Chrome, Edge or Firefox (double-clicking it works, `file://` is fine). Then:

1. Choose **Offline**.
2. Pick a mode, a map, the bot count and the bot difficulty.
3. Choose your primary weapon and click **DEPLOY**.
4. Click inside the game to capture the mouse.

The page is self-contained (≈700 KB, Three.js bundled in), so you can copy it anywhere.

## Play online

```bash
cd web
npm install          # three, ws, esbuild
npm run serve        # builds dist/index.html and starts the server on :8080
```

* On the machine running the server, open **http://localhost:8080**.
* Other players on your LAN open **http://YOUR-IP:8080**. Find the IP with `ipconfig` on Windows or `ip addr` / `ifconfig` on macOS and Linux. Allow port 8080 through the firewall.
* In the menu, go to **Online → Connect**. Then **create a room** (mode, map, bots, difficulty) or **join** one from the list.
* The WebSocket URL defaults to the page's own host. You can change it under **Online** to connect to a different server.

For internet play, run the server on any VPS or Node host, or put it behind a reverse proxy with TLS. The client switches to `wss://` automatically when the page is served over HTTPS.

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket port (`/ws`) |
| `MAX_ROOMS` | `20` | Concurrent rooms |
| `MAX_PLAYERS` | `12` | Humans per room (bots fill the rest) |

Other scripts: `npm run build` (bundle only), `npm start` (server only), and `npm test`. The test runs a headless simulation of every mode × map with bots and checks pathing, combat, scoring and replication.

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

Everything runs on one simulation (`src/shared`). The Node server runs it for each room, and the browser runs the same code for offline play through an in-memory transport. Offline and online therefore behave the same.

* **Server-authoritative.** The tick runs at 30 Hz. Snapshots go out at 20 Hz online (30 Hz offline), and each one carries the receiving player's acknowledged command sequence.
* **Client-side prediction.** The client sends 60 Hz input commands in batches. It predicts movement *and* weapon state (ammo, fire rate, reload). On each snapshot it reconciles by replaying unacknowledged commands, with smooth error correction.
* **Lag compensation.** The server keeps a 0.3 s history of every player's hitboxes. It rewinds them to the shooter's view time (`cmd.vt`) before tracing shots. Spread is seeded deterministically, so the predicted tracer matches the server's.
* **Interpolation.** Remote players and bots are interpolated about 100 ms behind server time, using an estimated clock offset.
* **Anti-cheat basics.** Inputs are sanitized and clamped. Each player has a command budget (no speed hacks). Damage, kills and scoring are server-only.

## Source layout

```
web/
├─ dist/index.html          # built single-file game (commit-ready, works offline)
├─ server/server.mjs        # HTTP + WebSocket server, lobby & rooms
├─ scripts/
│  ├─ build.mjs             # esbuild → one inlined HTML file
│  └─ simtest.mjs           # headless simulation test (npm test)
└─ src/
   ├─ shared/               # deterministic game simulation (runs on server AND in browser)
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
   │  └─ host.js            # fixed-tick host, client bindings, network messages
   └─ client/               # browser only
      ├─ main.js            # entry: menu ↔ session
      ├─ menu.js            # offline / online lobby / settings / controls
      ├─ session.js         # prediction, reconciliation, interpolation, game loop
      ├─ net.js             # LocalTransport (offline) & WsTransport (online)
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
* After editing anything in `src/`, run `npm run build` to regenerate `dist/index.html`.
