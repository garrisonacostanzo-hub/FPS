# VANGUARD — browser FPS in one HTML file

A first-person shooter that is **a single file: `web/dist/VANGUARD.html`**. Download it and double-click it. There's nothing to install and no server to run. The same file has:

* **Offline single-player against bots.**
* **Online multiplayer.** One player hosts in their browser and friends join with a 5-character room code. Humans and bots play in the same match.
* **Six game modes on three maps.** Every mode works both offline and online.
* **Computer or phone.** Keyboard and mouse on a computer; on-screen touch controls on phones and tablets.
* **Ranked mode:** you get a rank (Bronze to Legend) and a match grade after every game.
* **Friends:** add friends with a friend code, see who's online and when they last played, and look at their rank, stats and skins.
* **Squads:** invite friends to your squad and play Ranked or any team mode together on the same team.
* **Showdown:** 1v1 a friend, either rated on its own ladder or just for fun.
* **Adaptive bots:** they get tougher the better you are and the more you play.
* **62 skins:** 50 weapon camos (most earned in Ranked) and 12 operator outfits.
* **Progression:** levels, XP and career stats, saved in cookies and browser storage.
* **Modern graphics:** physically based sky and lighting, detailed materials, bloom, ambient occlusion, foliage and combat effects.

## Play offline

1. Open **`VANGUARD.html`** in Chrome, Edge, Firefox or Safari. Double-clicking it works and no web server is needed.
2. On the **PLAY** tab, pick a mode, a map, the bot count and the bot difficulty. The default difficulty, **Adaptive**, matches your skill.
3. Choose your primary weapon and click **START MATCH**.

## Play online

Every player needs **the same `VANGUARD.html`** and an internet connection.

**Host:**
1. Go to **ONLINE → HOST A MATCH**.
2. Pick the mode, map, bots and difficulty, then click **HOST MATCH**.
3. You get a room code like `K7QX3`. It appears in the pause menu (with a COPY button) and in the corner of the screen.
4. Send the code to your friends.

**Friends:** go to **ONLINE**, type the code under **JOIN A MATCH**, then click **JOIN**.

Some rules:
* Up to 8 players per match. Bots fill out the teams.
* **The match runs in the host's browser.** The host should keep that tab open. Their game keeps running if they switch tabs, but if the host leaves or closes the tab, the match ends for everyone.
* Players connect directly to the host's browser over WebRTC. The free public [PeerJS](https://peerjs.com) service is used only to find the host from the room code. If a strict network blocks a direct connection, PeerJS's public relay is tried automatically.
* Online play doesn't work inside sandboxed embeds that block WebRTC (such as Claude's artifact viewer). Open the file directly in a browser.
* Advanced: to use your own PeerJS signaling server, open `VANGUARD.html?signal=your-host:9000`. Everyone in a match must use the same server.

## Friends, squads and Showdown 1v1

Friends, squads and 1v1s need the **downloaded** `VANGUARD.html` opened in a browser, with an internet connection. Everyone needs the same file.

**Adding friends**
1. Open the **FRIENDS** tab. Your **friend code** (8 characters, like `KD28-RK4Y`) is at the top. Click **COPY** and send it to a friend.
2. Your friend types it under **ADD A FRIEND** and clicks **SEND** (or you type theirs).
3. The other player gets a **friend request** pop-up and clicks **ACCEPT** or **DECLINE**. After accepting, you're friends.

If the other player is offline, the request waits and is delivered the next time you're both online. The friend code and friends list are saved with your progress and are included in the BARRACKS backup code.

**What you can see about a friend**
* **Online status:** online in the menu, in a match (and which one), or offline with *last seen*.
* **Last played:** when they last finished a match.
* **Profile:** level, Ranked rank and SR (and their peak), Showdown title and rating, career stats (matches, wins, K/D, kills, headshots, accuracy, time played, MVPs, best streak, ranked games), skill rating, and your head-to-head 1v1 record.
* **Skins:** their equipped camo and operator (the 3D model in the menu changes to their look), plus every camo and operator they have unlocked.

Profiles update whenever you're both online. When a friend is offline you see their profile as it was the last time you were both on, with a "last synced" time.

**Squads (play together)**
* The squad bar in the menu header shows you and your squad. Click **+** (or **INVITE** next to an online friend) to invite someone. They get a pop-up and click **JOIN**.
* A squad can be **as big as one team of the mode**:

  | Mode | Squad size |
  |---|---|
  | Ranked TDM | 5 |
  | Team Deathmatch | 6 |
  | Domination | 6 |
  | Elimination | 4 |
  | Horde | 4 |

  Free-for-All and Gun Game have no teams, so squads can't play them.
* **The squad leader picks the mode** (PLAY or RANKED tab) and clicks **START SQUAD MATCH**. The leader's browser hosts the match, and everyone else's game joins it automatically. The countdown waits until the whole squad is in.
* **Everyone in the squad is on the same team.** Bots fill the remaining slots on both teams.
* **Bots are tuned to the squad's average skill.** For Ranked, the average is each member's Ranked bot level; otherwise it's each member's adaptive level, unless the leader picks a fixed difficulty.
* In **Ranked**, everyone's own SR, grade and unlocks update from their own performance.
* After a squad match the leader can **PLAY AGAIN** (Ranked picks a new random map and re-tunes the bots), and the squad is pulled into the next match. **BACK TO LOBBY** returns you to the menu and you stay in the squad.
* The leader can remove members or **DISBAND** the squad. Members can **LEAVE**. If the leader goes offline, the squad ends.

**Showdown (1v1 against a friend)**
Select an online friend on the FRIENDS tab, choose a map (or Random), then pick:
* **SHOWDOWN 1V1:** rated. This is a separate ladder from Ranked, with its own rating and titles.
* **FRIENDLY 1V1:** no rating change.

Your friend gets a challenge pop-up. When they accept, your game hosts the duel and theirs joins. **First to 10 kills wins**, or the most kills after 6 minutes (a tie is a draw). If your opponent leaves mid-match, you win. The challenger gets a **REMATCH** button at the end.

* **Showdown rating** starts at 1000 and uses Elo: expected score = 1 / (1 + 10^((opponent − you)/400)), change = K × (result − expected), where K is 40 for your first 10 Showdowns and 24 after that.
* **Titles:** Rookie (below 900), Contender (900), Gunslinger (1100), Duelist (1300), Marksman (1500), Deadeye (1700) and Showdown Champion (1900+).
* **Both kinds of 1v1 still train your skill rating:** your friend's skill rating takes the place of the bot level in the adaptive-bot algorithm. Beating better friends makes your normal bots harder, and losing makes them easier.

**How it connects:** when the game is open, your browser registers your friend code with the same free PeerJS matchmaking service used for room codes. Friends' browsers then connect directly to each other (WebRTC) to share online status, profiles, requests, invites and challenges. There is no game server and no account. Squad matches and 1v1s are ordinary online rooms hosted by the squad leader or the challenger. If the same friend code is open in two tabs, only the first one is online.

## Play on a phone or tablet

The same file has touch controls. They turn on automatically when you touch the screen.

**Opening the file on a phone:**
* **Android:** download `VANGUARD.html`, then open it in **Chrome**: Chrome menu (⋮) → *Downloads* → tap the file. If a file manager asks which app to use, pick Chrome; a plain "HTML viewer" will not run the game. Online play works.
* **iPhone / iPad:** iOS only *previews* downloaded HTML files (the game's code does not run in a preview, so you get the "Still seeing this screen?" message). Open it from a **web link** instead:
  * A shared Claude artifact link runs the game for **offline play against bots**. Online play is blocked inside that viewer.
  * To play **online** on iPhone, put `VANGUARD.html` on any static web host and open its `https://` link in Safari. GitHub Pages and Netlify Drop (drag the file onto the page) both work.

**Tips:**
* Turn the phone sideways (landscape). On Android, tapping **START MATCH** or **RESUME** also switches to fullscreen.
* Phones start on the **medium** graphics preset. If it stutters, choose **low** under Settings → Graphics quality.

**Touch controls:**

| Action | Touch |
|---|---|
| Move | Drag anywhere on the left part of the screen (a joystick appears under your thumb) |
| Sprint | Push the joystick far forward, past its ring |
| Look | Drag anywhere on the right part of the screen |
| Fire | Big **FIRE** button (keep your thumb on it and drag to aim while shooting), or the small **FIRE** button on the left |
| Aim down sights | **Tap AIM** to scope in and tap it again to scope out. Drag your thumb after tapping to look around. It never fires. (Settings can switch it to hold-to-aim.) |
| Crouch | **CROUCH** (tap to toggle) |
| Jump / reload | **JUMP** / **RELOAD** |
| Switch weapon | Tap the weapon and ammo panel (⇄) |
| Scoreboard / pause | **☰** / **II** at the top right |

**Aiming help** (change it under Settings → Touch controls):
* **Aim assist** (on by default) slows the look speed while the crosshair is on an enemy.
* **Auto-fire** shoots while an enemy is in your crosshair, in range and in clear view. It has three settings:
  * **Not while aiming** (default): it never fires while you're aiming.
  * **Always**.
  * **Off**.

**Touch settings:**
* On-screen controls: Auto, Always on or Off.
* AIM button: Tap to toggle scope (default) or Hold.
* Auto-fire and aim assist.
* Look speed, and a separate look speed while aiming.
* Move stick: floating or fixed.
* Sprint when the stick is pushed all the way forward.
* Button size and opacity.
* Show or hide the left FIRE button.
* Vibration on hits and damage (Android).

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
| Fire / Aim down sights | Left mouse / Right mouse: click to scope in, click again to scope out (Settings can switch to hold) |
| Reload | `R` |
| Switch weapon | `1` `2`, `Q` `E`, mouse wheel |
| Scoreboard | `Tab` |
| Chat | `T` / `Enter` |
| Pause / menu | `Esc` |

If the browser or an embedding frame refuses mouse capture (pointer lock), the game switches to free-cursor mouse look. Clicking in-game tries to capture the mouse again.

**Settings** has five sections. The main menu's SETTINGS tab and the in-game pause menu show the same options:
* **Teams & visibility:** see "Telling teams apart" above.
* **Touch controls:** listed above.
* **Mouse & keyboard:**
  * Sensitivity, and a separate sensitivity while aiming.
  * Toggle (default) or hold for aim, and hold or toggle for crouch.
* **View & HUD:**
  * Field of view and invert look.
  * Camera bob and screen shake.
  * Crosshair style (per weapon, cross, cross + dot, dot, circle), size and colour.
  * Show or hide the minimap, and the FPS/ping counter.
* **Graphics & audio:** quality preset, resolution scale and volume.

Settings are saved in `localStorage`. **Reset to defaults** keeps your callsign, loadout and match setup.

## Telling teams apart

Colours are relative to you: **your team is always blue and enemies are always red**, whichever team you're on. In free-for-all everyone else is red.

* **Characters:** helmets, bodies, arms and legs are in the team colour, with a slight glow so they show in the dark and in shade.
* **Outlines:** a coloured outline makes players stand out from the scenery at any distance.
* **Enemy arrows:** a red arrow appears over enemies you can actually see. It never shows through walls.
* **Teammates:** a blue arrow and their name, visible through walls.
* **Crosshair:** turns **red** on an enemy. On a teammate it turns **blue** and shows "TEAMMATE · name".
* **Rest of the screen:** your team's colour also marks:
  * the health panel ("BRAVO · YOUR TEAM")
  * the score bar and scoreboard ("ALPHA · ENEMY" / "BRAVO · YOUR TEAM")
  * the kill feed, minimap dots, capture zones and bullet tracers

Change these under **Settings → Teams & visibility**:
* **Team colours:**
  * **Blue vs red**
  * **Blue vs yellow:** easier with red–green colour blindness.
  * **Classic:** Alpha blue, Bravo orange.
* Each visual aid can be turned on or off: outlines, enemy arrows, teammate names and arrows, and the crosshair colour change.

## Main menu

The main menu is styled like a modern military shooter. A live 3D scene shows your operator in their equipped outfit, holding your weapon with its equipped camo. The tabs are:

| Tab | What's there |
|---|---|
| **PLAY** | Offline matches against bots: mode, map, bot count, difficulty (Adaptive or a fixed level) and weapon. |
| **RANKED** | Your rank emblem, SR and progress to the next division, season stats, recent matches, the next camo rewards and **PLAY RANKED**. |
| **FRIENDS** | Your friend code, adding friends, requests, your squad, invites and challenges, your friends list, and each friend's profile with squad invite and 1v1 buttons. A red badge counts new requests and invites. |
| **ONLINE** | Host a match and get a room code, or join one with a code. |
| **ARMORY** | Weapon camos (50), operator outfits (12) and your loadout. Each item shows a live 3D preview, its rarity and how to unlock it. |
| **BARRACKS** | Career stats, your skill rating and adaptive bot level, your callsign, and save data (backup code and reset). |
| **SETTINGS** | All options and controls. |

The player card in the top right shows your level, XP and rank. Next to it, the squad bar shows you and your squad members, with **+** slots for inviting friends.

## Ranked

Ranked is **Team Deathmatch, 5 vs 5, first to 40 kills or 8 minutes**, on a random map, against adaptive bots.

**After every game** you get a match report showing:
* **VICTORY** or **DEFEAT**
* your **match grade** (S, A, B, C or D)
* your **SR change**, with **PROMOTED** or **DEMOTED** when you change division
* the XP and levels you gained
* any newly unlocked skins
* the bot level for your next game

**Ranks** run Bronze, Silver, Gold, Platinum, Diamond and Master, each with divisions I, II and III (300 SR per division), then **Legend** (5400+ SR).

**How SR changes:**
* **Result:** a win adds 35, a draw adds 5 and a loss takes away 25.
* **Performance:** up to ±60 more depending on how well you played.
* **Top of the lobby:** +10.
* **Skill pull:** a pull toward the SR your skill rating deserves (1500 SR per bot level). Because bots adapt, you win about half your games, so this pull is what lets better players climb.
* **Leaving early:** a Ranked game you abandon counts as a loss (−60).

**Match grade:** the score from 0 to 1 is made up of:
* K/D: 32%
* place in the lobby: 25%
* kills per minute: 15%
* win, draw or loss: 18%
* accuracy: 10%

Grades are S ≥ 0.80, A ≥ 0.65, B ≥ 0.50, C ≥ 0.35, and D below that.

## Adaptive bots (skill algorithm)

Bot difficulty is a continuous level: Recruit 0, Regular 1, Veteran 2, Elite 3 and **Apex 4** (new, above Elite). Fractional levels blend the presets. Bots in the same match vary slightly around the target level so they don't all play alike. After every match:

1. **Performance.** Your performance score *P* (0–1) is computed as described above.
2. **Skill rating.** Your skill rating *R* (in bot-level units) is updated Elo-style:
   * Expected performance against bots of level *L*: *E* = 0.5 + 0.3·tanh(1.2·(*R* − *L*)).
   * Update: *R* += *K*·2.5·(*P* − *E*).
   * *K* starts high, so new players are placed quickly, then shrinks with experience: *K* = max(0.06, 0.55/√(1 + matches/3)).
3. **Experience.** How much you play counts as *X* = 1 − e^(−hours/8).
4. **Bot level.** **Adaptive** bots use level *R* + 0.3·*X*, so regulars face slightly sharper bots. **Ranked** uses the higher of that and a floor that rises with your rank tier.

You can see all of these numbers in **BARRACKS**.

## Skins

**Weapon camos (50).** These are procedural patterns applied to all your guns, in the first-person view and on your character for other players.
* **Free:** 8 basics (Factory, Desert Tan, Olive Drab, Arctic, Woodland, Urban Digital, Navy Digital, Crimson).
* **Earned in Ranked:** the other 42, for:
  * games played
  * wins
  * A and S grades
  * reaching rank tiers (Bronze III up to Legend)
  * ranked kills and headshots
  * win streaks
  * finishing top of the lobby
* **Animated mastery camos:** a few are animated (for example Gilded, Diamond, Dark Plasma, Singularity, Prism and Aurora). They come from the highest ranks and achievements.

**Operator outfits (12).** These change headgear, visor, vest, pads and masks. Your team colour always stays on the torso, arms, legs and headgear, so teams remain easy to tell apart.
* **Free:** 8 outfits.
* **Earned:**
  * Ghost: reach level 10.
  * Marksman: 100 headshot kills.
  * Elite Guard: reach Diamond.
  * Warlord: 25 ranked wins.

Bots wear random skins. Online, everyone sees each other's equipped skins.

## Progress and saving

The following are saved after every match:
* level and XP
* career stats
* skill rating
* Ranked SR and history
* Showdown rating and history
* friend code, friends list and pending requests (saved separately as `vg_social`)
* unlocks
* equipped skins

Each save goes to **both cookies and browser storage** (localStorage), and the newer copy is loaded. Some browsers (Chrome, Edge) ignore cookies on pages opened directly from a file (`file://`), so browser storage keeps your progress there. **BARRACKS** shows which storage works in your browser.

To move your progress to another browser or device, use **BARRACKS → Backup code**. Copy the code, then use **Load a code** on the other device.

## Weapons

Pistol, SMG, rifle, shotgun, LMG, DMR and sniper. Each weapon has its own fire rate, damage falloff, headshot multiplier, spread (hip, ADS, moving and in the air), recoil, magazine size and reload time, ADS zoom, movement speed, muzzle velocity, drag and penetration power. All of these values are in one data table: `src/shared/weapons.js`.

## Gun physics

**Real bullets, not instant hits.** Every round is simulated on the host (`src/shared/ballistics.js`, stepped 60 times a second):
* **Muzzle velocity and travel time:**

  | Gun | Muzzle velocity | Time to 100 m |
  |---|---|---|
  | Rifle | 790 m/s | about 0.13 s |
  | Sniper | 900 m/s | about 0.11 s |
  | Pistol | 370 m/s | about 0.28 s |

  Moving targets at range need leading.
* **Drag:** slow rounds (pistol, SMG, shotgun pellets) lose speed fastest.
* **Gravity drop:** about 8 cm at 100 m for the rifle, 24 cm at 200 m for the sniper, and 40 cm at 100 m for the pistol. Long shots need holdover.
* **Damage falloff:** damage falls off with the distance the bullet actually travelled.
* **Lag compensation:** targets are checked where they were on the shooter's screen.

**Wall penetration.** Each round has a penetration power. Each material has a resistance per centimetre, and hollow objects (crates, shipping containers) are thin shells.

| Cover | Stops | Goes through |
|---|---|---|
| Wooden crate, 0.3 m plaster wall, shipping container | Pistol, SMG | Rifle, LMG, DMR, sniper |
| 0.3 m brick wall | Pistol, SMG, rifle, LMG | DMR, sniper |
| Metal railing | Everything except the sniper | Sniper |
| Concrete barrier, sandbags, rock | Everything | Nothing |

A round that goes through loses damage and speed. Exit holes appear on the far side.

**Hit zones:**
* Head: the weapon's headshot multiplier.
* Torso: full damage.
* Legs: 0.8×.

**Recoil patterns.** Each gun has a learnable pattern:
* the first shots stay tight
* then the climb grows
* the muzzle walks side to side in a gun-specific way, with a little randomness

Aiming down sights and crouching tame it, and the view recovers when you stop firing.

**Sights and scopes.** You look through the sight when you aim:
* **Rifle, SMG, shotgun and LMG** have open reflex and holographic sights: a thin frame around clear glass with a glowing reticle (red dot on the rifle, ring-and-dot holo on the SMG and shotgun, chevron on the LMG).
* **DMR** switches to a scope view (about 2× zoom) with an illuminated chevron and bullet-drop marks.
* **Sniper** switches to a high-zoom scope view with a mil-dot crosshair.
* The **pistol** uses iron sights.

**Toggle scope.** Aiming is a toggle by default: right-click (or tap AIM) to scope in, and again to scope out. You also scope out when you die, switch weapons or start sprinting. With a sniper or DMR on a computer, Shift holds your breath instead of sprinting, so it keeps the scope. To aim only while holding the button, turn off **Toggle scope** (mouse) or set **AIM button** to **Hold** (touch) in Settings.

**Weapon sway.** Aiming down sights drifts in a slow figure-eight:
* it is strongest on the sniper and DMR, and grows while moving
* crouching reduces it
* touch players get half the sway

With a sniper or DMR on a computer, hold **Shift** to **hold your breath** and steady the scope for up to 4 seconds. After that you need to recover (the scope is shakier for 3 seconds). A meter under the scope shows your breath.

**Reloads.** Reloading before the magazine is empty keeps a round in the chamber. For example, a rifle goes to 30 + 1 = 31 rounds. Empty reloads are slower. The shotgun and LMG don't chamber an extra round.

**Feedback:**
* Tracers fly at bullet speed.
* Impacts appear when the bullet arrives:
  * sparks off metal
  * dust off concrete and brick
  * splinters off wood
  * puffs off sand and dirt
* Enemy rounds passing close to your head make a supersonic **crack** (rifles, snipers) or a **whiz** (pistols, SMGs).

**Bots use the same ballistics.** They lead moving targets and aim above for drop. Better bots do it more accurately.

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

Difficulty: **Recruit / Regular / Veteran / Elite / Apex**, or **Adaptive**, which sets a continuous level from your skill (see above). It scales reaction time, accuracy, tracking, detection speed, FOV, hearing and aggression.

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
   │  ├─ modes.js           # TDM / DOM / FFA / Gun Game / Elimination / Horde / 1v1 Duel, squad sizes
   │  ├─ difficulty.js      # continuous bot levels (blends Recruit..Apex presets)
   │  ├─ ballistics.js      # bullet flight (velocity, drag, gravity), materials and penetration
   │  ├─ cosmetics.js       # 50 camos, 12 outfits, rarities, unlock rules, rank tiers, Showdown titles
   │  ├─ game.js            # authoritative match: entities, damage, lag comp, snapshots
   │  └─ host.js            # fixed-tick match host, client bindings, network messages
   └─ client/               # browser only
      ├─ main.js            # entry: menu ↔ session, Ranked and adaptive-difficulty setup
      ├─ menu.js            # CoD-style menu: Play, Ranked, Friends, Online, Armory, Barracks, Settings
      ├─ profile.js         # level/XP, stats, skill rating algorithm, Ranked SR, Showdown rating, unlocks
      ├─ social.js          # friend codes, presence, friend requests, squads, 1v1 challenges (peer-to-peer)
      ├─ ui/friendsTab.js   # FRIENDS tab, friend profiles and the squad bar
      ├─ ui/toasts.js       # pop-up notifications (requests, invites, challenges)
      ├─ ui/art.js          # small SVG operator portraits
      ├─ storage.js         # saves to cookies + localStorage, backup codes
      ├─ ui/emblems.js      # rank emblems, Showdown emblems and level badges (SVG)
      ├─ gfx/textures.js    # procedural surfaces + normal maps, the 50 camo patterns
      ├─ gfx/models.js      # detailed guns (sights, camos), operators (outfits), first-person arms
      ├─ gfx/sky.js         # physically based sky (baked to a cube map) + environment lighting, night sky
      ├─ gfx/post.js        # bloom, ambient occlusion, colour grading, anti-aliasing
      ├─ gfx/effects.js     # tracers, sparks, smoke, bullet holes, shell casings, muzzle lights
      ├─ gfx/foliage.js     # grass, forest, industrial skyline, street lamps
      ├─ gfx/showcase.js    # live 3D operator / weapon backdrop for the menu
      ├─ session.js         # prediction, reconciliation, interpolation, game loop
      ├─ net.js             # LocalTransport (offline), HostTransport & JoinTransport (WebRTC via PeerJS)
      ├─ renderer.js        # Three.js scene, characters, view model, effects
      ├─ hud.js             # HUD, killfeed, scoreboard, minimap, menus
      ├─ input.js           # pointer lock, keyboard/mouse (+ touch state)
      ├─ touch.js           # on-screen touch controls: move stick, look, fire/aim/jump/crouch/reload/swap
      ├─ audio.js           # procedural WebAudio (positional gunfire, footsteps…)
      ├─ settings.js        # persisted settings
      ├─ settingsui.js      # settings schema + controls shared by the menu and the pause screen
      ├─ teamcolors.js      # team colours relative to the player (ally blue / enemy red, colour-blind, classic)
      ├─ index.html         # page template
      └─ styles.css
```

## Notes

* **Graphics quality presets:**
  * **Low:** no post effects, shadows, reflections or foliage. For weak devices.
  * **Medium:** bloom, FXAA, grading, foliage and shadows. The default on phones.
  * **High:** adds ambient occlusion, 4× MSAA, 4K shadow maps and denser foliage.
* **Dynamic resolution** (on by default) lowers the internal resolution while the frame rate is low and raises it again when there is headroom.
* The UI font (Barlow Condensed, SIL Open Font License) is embedded in the file, so it works offline.
* Every texture and sound is generated at runtime. There are no asset files.
* After editing anything in `src/`, run `npm run build` to regenerate `dist/VANGUARD.html`.
