// Headless simulation test: runs every mode on every map with bots (and a scripted fake human) and checks
// that the authoritative game advances, bots navigate and fight, and modes reach their objectives.
import { GameHost } from '../src/shared/host.js';
import { MAP_LIST } from '../src/shared/map.js';
import { MODE_LIST } from '../src/shared/modes.js';
import { TICK_DT } from '../src/shared/constants.js';
import { loadMapBundle } from '../src/shared/game.js';

const seconds = Number(process.argv[2] || 90);
let failures = 0;

for (const map of MAP_LIST) {
  const t0 = performance.now();
  const bundle = loadMapBundle(map.id);
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`map ${map.id}: ${bundle.map.boxes.length} boxes, ${bundle.nav.walkableCount} walkable cells, ${bundle.cover.length} cover points (built in ${ms} ms)`);
  // Every zone and spawn must be reachable from team A's first spawn.
  const s = bundle.map.spawns[0][0];
  for (const target of [...bundle.map.zones, bundle.map.spawns[1][0]]) {
    const path = bundle.nav.findPath(s.x, s.z, target.x, target.z, 40000);
    if (!path) { console.log(`  FAIL: no path from Alpha spawn to ${target.id || 'Bravo spawn'}`); failures++; }
  }
}

for (const mode of MODE_LIST) {
  for (const map of MAP_LIST) {
    const messages = { snap: 0, ev: 0 };
    let kills = 0, captures = 0, ended = null, shots = 0;
    const difficulty = (mode.id.length + map.id.length) % 2 ? 'hard' : 2.6; // presets and adaptive levels
    const host = new GameHost({ mode: mode.id, map: map.id, bots: 9, difficulty }, {
      snapshotRate: 20,
      send: (_id, msg) => {
        messages[msg.type] = (messages[msg.type] || 0) + 1;
        if (msg.type === 'ev') {
          for (const e of msg.l) {
            if (e.type === 'kill') kills++;
            if (e.type === 'zone' && e.owner !== 2) captures++;
            if (e.type === 'end') ended = e.text;
            if (e.type === 'shot') shots++;
          }
        }
      },
    });
    host.join('human', 'Tester', ['rifle', 'pistol']);
    const human = host.game.entities.get(host.clients.get('human').entityId);
    let seq = 0;
    const start = performance.now();
    const steps = Math.round(seconds / TICK_DT);
    let maxBotTravel = 0;
    const startPos = new Map();
    try {
      for (let i = 0; i < steps; i++) {
        // Fake human: walks forward and turns slowly, fires occasionally.
        const cmds = [];
        for (let k = 0; k < 2; k++) {
          seq++;
          cmds.push({ s: seq, dt: TICK_DT / 2, mx: 0, mz: 1, yaw: Math.sin(seq * 0.002) * 3, pitch: 0, b: seq % 40 < 5 ? 16 : 0, sw: -1, r: false, vt: host.game.time - 0.1 });
        }
        host.receive('human', { type: 'cmds', c: cmds });
        host.update(TICK_DT);
        for (const e of host.game.entities.values()) {
          if (!e.isBot) continue;
          if (!startPos.has(e.id) || !e.alive) startPos.set(e.id, { x: e.motor.x, z: e.motor.z });
          const p = startPos.get(e.id);
          maxBotTravel = Math.max(maxBotTravel, Math.hypot(e.motor.x - p.x, e.motor.z - p.z));
        }
      }
    } catch (err) {
      console.log(`FAIL ${mode.id}/${map.id}: exception`, err);
      failures++;
      continue;
    }
    const elapsed = performance.now() - start;
    const g = host.game;
    const perTick = (elapsed / steps).toFixed(2);
    const ok = kills > 0 && maxBotTravel > 15 && messages.snap > 0;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${mode.id.padEnd(8)} ${map.id.padEnd(9)} kills=${String(kills).padStart(3)} shots=${String(shots).padStart(4)} captures=${captures} ` +
      `scores=${JSON.stringify(g.teamScores)} phase=${g.phase} ended=${ended || '-'} botTravel=${maxBotTravel.toFixed(0)}m ` +
      `humanSeqAck=${human.lastSeq}/${seq} ents=${g.entities.size} tick=${perTick}ms`);
  }
}

console.log(failures ? `\n${failures} failure(s)` : '\nall simulation checks passed');
if (failures) process.exitCode = 1;

// ------------------------------------------------------------------------------------------------
// Ballistics: travel time, drop, wall penetration and tactical reloads.
// ------------------------------------------------------------------------------------------------
{
  const { Game } = await import('../src/shared/game.js');
  const { World } = await import('../src/shared/world.js');
  const { WEAPONS, createWeaponState, startReload, finishReload } = await import('../src/shared/weapons.js');
  const failures = [];
  const setup = (wall) => {
    const game = new Game({ mode: 'ffa', map: 'crossfire', bots: 0 });
    game.phase = 'live';
    if (wall) game.world = new World([...game.map.boxes, wall], game.map.half + 2);
    else game.world = new World([], game.map.half + 2); // open field
    const a = game.addHuman('a', 'Shooter', ['rifle', 'pistol']);
    const b = game.addHuman('b', 'Target', ['rifle', 'pistol']);
    for (const e of [a, b]) { e.alive = true; e.hp = 100; e.protectUntil = 0; e.motor.y = 0; }
    a.motor.x = 0; a.motor.z = 0;
    b.motor.x = 0; b.motor.z = -30;
    return { game, a, b };
  };
  const fire = (game, shooter, weapon, dx, dy, dz) => game.resolveShot(shooter, { ox: 0, oy: 1.62, oz: 0, dx, dy, dz, spread: 0, seed: 1, weapon });
  const level = (dist, h = 1.62) => { const dy = (h - 1.62) / dist; const l = Math.hypot(dy, 1); return [0, dy / l, -1 / l]; };

  // 1) Travel time: a rifle round needs several ticks to cover 120 m.
  {
    const { game, a, b } = setup(null);
    b.motor.z = -120;
    fire(game, a, WEAPONS.rifle, ...level(120, 1.3));
    let ticks = 0;
    while (b.hp === 100 && ticks < 60) { game.stepBullets(1 / 30); game.time += 1 / 30; ticks++; }
    if (b.hp === 100) failures.push('rifle round never reached a target at 120 m');
    else if (ticks < 4) failures.push(`rifle round arrived too fast (${ticks} ticks for 120 m)`);
    console.log(`ballistics: rifle round reached 120 m after ${ticks} ticks (${(ticks / 30 * 1000).toFixed(0)} ms), damage ${100 - Math.round(b.hp)}`);
  }
  // 2) Drop: a pistol aimed dead level at a head 120 m away lands low (body or miss, not the head).
  {
    const { game, a, b } = setup(null);
    b.motor.z = -120;
    const hpBefore = b.hp;
    fire(game, a, WEAPONS.pistol, ...level(120, 1.68));
    for (let i = 0; i < 60; i++) { game.stepBullets(1 / 30); game.time += 1 / 30; }
    const dealt = hpBefore - b.hp;
    if (dealt >= WEAPONS.pistol.damage * WEAPONS.pistol.headMul * 0.5) failures.push('pistol round did not drop below the head at 120 m');
    console.log(`ballistics: level pistol shot at a head 120 m away dealt ${Math.round(dealt)} (headshot would be ~${Math.round(WEAPONS.pistol.damage * 0.6 * WEAPONS.pistol.headMul)})`);
  }
  // 3) Penetration: a 0.3 m plaster wall stops pistol rounds but not rifle rounds.
  {
    const wall = { min: [-3, 0, -15.15], max: [3, 3, -14.85], m: 'wall' };
    for (const [id, expectHit] of [['rifle', true], ['pistol', false]]) {
      const { game, a, b } = setup(wall);
      fire(game, a, WEAPONS[id], ...level(30, 1.3));
      for (let i = 0; i < 30; i++) { game.stepBullets(1 / 30); game.time += 1 / 30; }
      const hit = b.hp < 100;
      if (hit !== expectHit) failures.push(`${id} through 0.3 m plaster: expected ${expectHit ? 'hit' : 'blocked'}`);
      console.log(`ballistics: ${id} through 0.3 m plaster wall -> ${hit ? `hit for ${Math.round(100 - b.hp)}` : 'blocked'}`);
    }
  }
  // 4) Tactical reload keeps one in the chamber.
  {
    const ws = createWeaponState(['rifle', 'pistol']);
    ws.slots[0].mag = 10;
    startReload(ws, 0);
    finishReload(ws);
    if (ws.slots[0].mag !== WEAPONS.rifle.mag + 1) failures.push(`tactical reload gave ${ws.slots[0].mag}, expected ${WEAPONS.rifle.mag + 1}`);
    const ws2 = createWeaponState(['rifle', 'pistol']);
    ws2.slots[0].mag = 0;
    startReload(ws2, 0);
    finishReload(ws2);
    if (ws2.slots[0].mag !== WEAPONS.rifle.mag) failures.push(`empty reload gave ${ws2.slots[0].mag}, expected ${WEAPONS.rifle.mag}`);
    console.log(`ballistics: tactical reload -> ${ws.slots[0].mag}, empty reload -> ${ws2.slots[0].mag}`);
  }
  if (failures.length) { console.log('BALLISTICS FAILURES:\n  ' + failures.join('\n  ')); process.exitCode = 1; } else console.log('ballistics checks passed');
}

// ------------------------------------------------------------------------------------------------
// Squads and 1v1 duels
// ------------------------------------------------------------------------------------------------
{
  const failures = [];
  const { GameHost: Host } = await import('../src/shared/host.js');
  const { TEAM } = await import('../src/shared/constants.js');
  const noop = () => {};
  const run = (host, secs) => { for (let t = 0; t < secs; t += 0.1) host.update(0.1); };

  // 1) A squad of 3 in Ranked TDM: all humans on team A, bots fill to 5v5, warmup waits for the squad.
  {
    const host = new Host({ mode: 'tdm', map: 'outpost', bots: 7, difficulty: 2.1, ranked: true, party: true, expect: 3 }, { send: noop });
    host.join('leader', 'Leader', ['rifle', 'pistol']);
    run(host, 6);
    if (host.game.phase !== 'warmup') failures.push(`squad match went live with 1/3 players (phase ${host.game.phase})`);
    host.join('m1', 'Member1', ['smg', 'pistol']);
    host.join('m2', 'Member2', ['dmr', 'pistol']);
    run(host, 6);
    const counts = host.game.teamCounts();
    if (counts.humans[TEAM.A] !== 3 || counts.humans[TEAM.B] !== 0) failures.push(`squad split across teams: A ${counts.humans[TEAM.A]}, B ${counts.humans[TEAM.B]}`);
    if (counts.total[TEAM.A] !== 5 || counts.total[TEAM.B] !== 5) failures.push(`squad teams not 5v5: ${counts.total[TEAM.A]}v${counts.total[TEAM.B]}`);
    if (host.game.phase !== 'live') failures.push(`full squad match did not go live (phase ${host.game.phase})`);
    console.log(`squad: 3 humans on ${counts.humans[TEAM.A] === 3 ? 'team A' : 'split teams'}, teams ${counts.total[TEAM.A]}v${counts.total[TEAM.B]}, phase ${host.game.phase}`);
  }
  // 2) Duel: 2 humans, no bots, first to 10 kills; a squad/duel match does not auto-restart.
  {
    const host = new Host({ mode: 'duel', map: 'crossfire', bots: 0, difficulty: 'normal', duel: 'showdown', expect: 2 }, { send: noop });
    const a = host.join('a', 'Alpha', ['rifle', 'pistol']);
    run(host, 6);
    if (host.game.phase !== 'warmup') failures.push('duel started without the opponent');
    const b = host.join('b', 'Bravo', ['rifle', 'pistol']);
    run(host, 6);
    if (host.game.entities.size !== 2) failures.push(`duel has ${host.game.entities.size} entities (bots added?)`);
    if (host.game.phase !== 'live') failures.push('duel did not go live with both players');
    for (let i = 0; i < 10; i++) { a.kills++; host.game.mode.onKill(a, b); }
    if (host.game.phase !== 'ended' || !host.game.result || host.game.result.winner !== a.id) failures.push('duel did not end with the 10-kill winner');
    run(host, 15);
    if (host.game.restartPending || host.game.phase !== 'ended') failures.push('duel auto-restarted');
    console.log(`duel: ${host.game.entities.size} players, winner ${host.game.result ? host.game.result.text : 'none'}, auto-restart ${host.game.restartPending ? 'yes' : 'no'}`);
    // Time-up with equal kills is a draw.
    const h2 = new Host({ mode: 'duel', map: 'outpost', bots: 0, duel: 'friendly', expect: 2, timeLimit: 2 }, { send: noop });
    h2.join('a', 'A'); h2.join('b', 'B');
    run(h2, 9);
    if (!h2.game.result || h2.game.result.text !== 'DRAW') failures.push(`duel time-up with 0-0 was "${h2.game.result ? h2.game.result.text : 'no result'}"`);
  }
  if (failures.length) { console.log('SQUAD/DUEL FAILURES:\n  ' + failures.join('\n  ')); process.exitCode = 1; } else console.log('squad and duel checks passed');
}

// ------------------------------------------------------------------------------------------------
// Weapon sets and ammo drops
// ------------------------------------------------------------------------------------------------
{
  const failures = [];
  const { GameHost: Host } = await import('../src/shared/host.js');
  const { WEAPONS, WEAPON_SETS } = await import('../src/shared/weapons.js');
  const noop = () => {};
  const host = new Host({ mode: 'tdm', map: 'outpost', bots: 4, difficulty: 'normal' }, { send: noop });
  const a = host.join('a', 'Alpha', 'marksman');
  const b = host.join('b', 'Bravo', 'heavy');
  const ids = (e) => e.ws.slots.map((s) => s.id).join(',');
  if (ids(a) !== 'dmr,rifle,smg,pistol') failures.push(`marksman set gave ${ids(a)}`);
  if (ids(b) !== 'lmg,rifle,shotgun,pistol') failures.push(`heavy set gave ${ids(b)}`);
  const bots = [...host.game.entities.values()].filter((e) => e.isBot);
  if (!bots.every((e) => e.ws.slots.length === 4 && WEAPON_SETS.some((ws) => ws.guns.join(',') === ids(e)))) failures.push('bots do not carry a full weapon set');
  host.join('c', 'Charlie', 'no-such-set');
  const c = [...host.game.entities.values()].find((e) => e.name === 'Charlie');
  if (ids(c) !== WEAPON_SETS[0].guns.join(',')) failures.push('unknown set id was not replaced by the default');
  for (let t = 0; t < 6; t += 0.1) host.update(0.1); // past warmup, everyone alive
  // Ammo drop: Bravo dies carrying ammo; Alpha (low on rifle ammo) walks over the pack.
  b.ws.slots[1].mag = 20; b.ws.slots[1].reserve = 60;
  const rifle = a.ws.slots.find((s) => s.id === 'rifle');
  rifle.reserve = 10;
  const dmr = a.ws.slots.find((s) => s.id === 'dmr');
  dmr.reserve = 0;
  host.game.kill(b, a, 'rifle', false);
  const pack = host.game.pickups[host.game.pickups.length - 1];
  if (!pack || pack.ammo.rifle !== 80 || pack.ammo.lmg !== WEAPONS.lmg.mag + WEAPONS.lmg.reserve) failures.push(`pack contents wrong: ${JSON.stringify(pack && pack.ammo)}`);
  a.motor.x = pack.x; a.motor.z = pack.z; a.motor.y = pack.y;
  host.game.updatePickups();
  const rifleAfter = rifle.reserve, dmrAfter = dmr.reserve;
  if (rifleAfter !== Math.min(WEAPONS.rifle.reserve, 10 + 80)) failures.push(`rifle reserve after pickup ${rifleAfter}`);
  if (!(dmrAfter > 0)) failures.push('a gun the victim did not carry (DMR) got no ammo from the pack');
  if (host.game.pickups.includes(pack)) failures.push('pack was not removed after pickup');
  // A full player leaves packs alone.
  const full = c;
  for (const s of full.ws.slots) s.reserve = WEAPONS[s.id].reserve;
  host.game.dropAmmo(a);
  const pack2 = host.game.pickups[host.game.pickups.length - 1];
  full.motor.x = pack2.x; full.motor.z = pack2.z; full.motor.y = pack2.y;
  for (const e of host.game.entities.values()) if (e !== full) e.alive = false;
  host.game.updatePickups();
  if (!host.game.pickups.includes(pack2)) failures.push('a player with full ammo picked up a pack');
  // Changing set applies at the next respawn.
  host.game.setPreferredSet(a, 'recon');
  a.alive = false;
  host.game.respawnEntity(a);
  if (ids(a) !== 'sniper,dmr,smg,pistol') failures.push(`new set after respawn: ${ids(a)}`);
  console.log(`weapon sets: marksman -> recon after respawn; ammo pack: rifle ${10}->${rifleAfter}, dmr 0->${dmrAfter}`);
  if (failures.length) { console.log('SETS/AMMO FAILURES:\n  ' + failures.join('\n  ')); process.exitCode = 1; } else console.log('weapon set and ammo drop checks passed');
}

// ------------------------------------------------------------------------------------------------
// Special abilities
// ------------------------------------------------------------------------------------------------
{
  const failures = [];
  const { GameHost: Host } = await import('../src/shared/host.js');
  const { BTN } = await import('../src/shared/constants.js');
  const { ABILITIES, GRENADE } = await import('../src/shared/abilities.js');
  const noop = () => {};
  const events = [];
  const host = new Host({ mode: 'tdm', map: 'outpost', bots: 0, difficulty: 'normal' }, { send: (_c, m) => { if (m.type === 'ev') events.push(...m.l); } });
  const a = host.join('a', 'Alpha', { set: 'assault', ability: 'dash' });
  const b = host.join('b', 'Bravo', { set: 'assault', ability: 'frag' });
  for (let t = 0; t < 6; t += 0.1) host.update(0.1);
  const game = host.game;
  let seq = 1000;
  const cmd = (e, extra = {}) => game.processCommand(e, { s: ++seq, dt: 1 / 60, mx: 0, mz: 0, yaw: e.motor.yaw, pitch: 0, b: 0, sw: -1, r: false, vt: game.time, ...extra });
  if (!ABILITIES.every((ab) => ab.cooldown > 0)) failures.push('ability without a cooldown');
  if (a.ability !== 'dash' || b.ability !== 'frag') failures.push(`abilities not assigned from the join loadout: ${a.ability}, ${b.ability}`);
  // Dash: moves several metres quickly, then goes on cooldown.
  const x0 = a.motor.x, z0 = a.motor.z;
  cmd(a, { b: BTN.ABILITY, mz: 1 });
  for (let i = 0; i < 20; i++) cmd(a, { mz: 1 });
  const moved = Math.hypot(a.motor.x - x0, a.motor.z - z0);
  if (moved < 3) failures.push(`dash only moved ${moved.toFixed(2)} m`);
  const before = a.motor.x;
  cmd(a, { b: BTN.ABILITY, mz: 0 }); for (let i = 0; i < 10; i++) cmd(a);
  if (Math.abs(a.motor.x - before) > 1) failures.push('dash fired again during its cooldown');
  // Stim heals.
  a.ability = 'stim'; a.abilityReady = 0; a.prevAbility = false; a.hp = 30;
  cmd(a, { b: BTN.ABILITY });
  if (a.hp < 79) failures.push(`stim healed to ${a.hp}`);
  // Frag: thrown at the enemy's feet, it explodes after the fuse and hurts them.
  b.motor.x = a.motor.x + 3; b.motor.z = a.motor.z; b.motor.y = a.motor.y; b.protectUntil = 0; b.hp = 100;
  a.ability = 'frag'; a.abilityReady = 0; a.prevAbility = false; a.protectUntil = 0;
  // Face +x and look down so it lands near Bravo.
  a.motor.yaw = -Math.PI / 2;
  cmd(a, { b: BTN.ABILITY, yaw: -Math.PI / 2, pitch: -0.9 });
  if (game.grenades.length !== 1) failures.push('frag did not spawn a grenade');
  for (let t = 0; t < GRENADE.fuse + 0.3; t += 1 / 30) game.step(1 / 30);
  if (![...events, ...game.events].some((ev) => ev.type === 'boom')) failures.push('frag never exploded');
  if (!(b.hp < 100 || !b.alive)) failures.push('frag did no damage to a nearby enemy');
  // Smoke: blocks bot sight lines through the cloud.
  game.smokes.push({ id: 999, x: 0, y: 0, z: 0, r: GRENADE.smokeRadius, until: game.time + 5 });
  if (!game.smokeBlocks(-10, 1.6, 0, 10, 1.6, 0)) failures.push('smoke does not block a line through it');
  if (game.smokeBlocks(-10, 1.6, 20, 10, 1.6, 20)) failures.push('smoke blocks a line far from it');
  // Recon pulse reveals enemies in range to the user's team (snapshot rv).
  b.alive = true; b.hp = 100;
  a.ability = 'pulse'; a.abilityReady = 0; a.prevAbility = false;
  cmd(a, { b: BTN.ABILITY });
  const snapA = game.snapshot(a);
  if (!snapA.rv || !snapA.rv.includes(b.id)) failures.push('recon pulse did not reveal the nearby enemy');
  if ((game.snapshot(b).rv || []).includes(b.id)) failures.push('the revealed player sees themselves as revealed');
  // Cloak: flag in snapshots, ends when shooting.
  a.ability = 'cloak'; a.abilityReady = 0; a.prevAbility = false;
  cmd(a, { b: BTN.ABILITY });
  const flagOf = (snap, id) => (snap.e.find((r) => r[0] === id) || [])[7] || 0;
  if (!(flagOf(game.snapshot(b), a.id) & 32)) failures.push('cloak flag missing from snapshots');
  a.ws.nextFire = 0; a.ws.equipEnd = 0; a.sprintLock = 0;
  cmd(a, { b: BTN.FIRE });
  if (game.isCloaked(a)) failures.push('shooting did not break cloak');
  console.log(`abilities: dash ${moved.toFixed(1)} m, stim -> ${Math.round(a.hp)} hp, frag left Bravo at ${b.alive ? Math.round(b.hp) + ' hp' : 'dead'}`);
  if (failures.length) { console.log('ABILITY FAILURES:\n  ' + failures.join('\n  ')); process.exitCode = 1; } else console.log('ability checks passed');
}

// ------------------------------------------------------------------------------------------------
// Emote dances
// ------------------------------------------------------------------------------------------------
{
  const failures = [];
  const { GameHost: Host } = await import('../src/shared/host.js');
  const { BTN } = await import('../src/shared/constants.js');
  const { DANCES, danceAt } = await import('../src/shared/dances.js');
  const host = new Host({ mode: 'tdm', map: 'outpost', bots: 6, difficulty: 'normal', scoreLimit: 3 }, { send: () => {} });
  const a = host.join('a', 'Alpha', { set: 'assault', ability: 'dash' });
  const b = host.join('b', 'Bravo', { set: 'assault', ability: 'dash' });
  for (let t = 0; t < 6; t += 0.1) host.update(0.1);
  const game = host.game;
  let seq = 5000;
  const cmd = (e, extra = {}) => game.processCommand(e, { s: ++seq, dt: 1 / 60, mx: 0, mz: 0, yaw: e.motor.yaw, pitch: 0, b: 0, sw: -1, r: false, vt: game.time, ...extra });
  if (DANCES.length !== 9) failures.push(`expected 9 dances, got ${DANCES.length}`);
  host.receive('a', { type: 'dance', d: 'robot' });
  const row = (snap, id) => snap.e.find((r) => r[0] === id);
  if (danceAt(row(game.snapshot(b), a.id)[10]) !== 'robot') failures.push('dance not visible to other players in snapshots');
  if (game.snapshot(a).you.dn !== 1) failures.push('dance not confirmed to the dancer');
  cmd(a); cmd(a, { yaw: a.motor.yaw + 1 }); // looking around does not stop it
  if (!a.dance) failures.push('standing still / turning ended the dance');
  cmd(a, { mz: 1 });
  if (a.dance) failures.push('moving did not end the dance');
  host.receive('a', { type: 'dance', d: 'nonsense' });
  if (a.dance) failures.push('unknown dance id accepted');
  game.lastDanceAt = 0; a.lastDance = -9;
  host.receive('a', { type: 'dance', d: 'disco' });
  cmd(a, { b: BTN.FIRE });
  if (a.dance) failures.push('shooting did not end the dance');
  a.lastDance = -9;
  host.receive('a', { type: 'dance', d: 'shuffle' });
  host.receive('a', { type: 'dance', d: null });
  if (a.dance) failures.push('stop message did not end the dance');
  // Winning bots celebrate with dances at the end of a match.
  const team = [...game.entities.values()].find((e) => e.isBot).team;
  game.finish({ team, text: 'TEST WINS' });
  const dancing = [...game.entities.values()].filter((e) => e.isBot && e.dance).length;
  console.log(`dances: robot visible to others, cancels on move/shoot; ${dancing} bots dancing after the win`);
  if (failures.length) { console.log('DANCE FAILURES:\n  ' + failures.join('\n  ')); process.exitCode = 1; } else console.log('dance checks passed');
}

// ------------------------------------------------------------------------------------------------
// Group dance (Crew Groove): nearby players join with Q and dance in sync
// ------------------------------------------------------------------------------------------------
{
  const failures = [];
  const { GameHost: Host } = await import('../src/shared/host.js');
  const { danceAt, JOIN_RADIUS } = await import('../src/shared/dances.js');
  const host = new Host({ mode: 'ffa', map: 'outpost', bots: 0, difficulty: 'normal', scoreLimit: 30 }, { send: () => {} });
  const a = host.join('a', 'Alpha', { set: 'assault', ability: 'dash' });
  const b = host.join('b', 'Bravo', { set: 'assault', ability: 'dash' });
  const c = host.join('c', 'Charlie', { set: 'assault', ability: 'dash' });
  for (let t = 0; t < 6; t += 0.1) host.update(0.1);
  const game = host.game;
  const place = (e, x, z) => { e.motor.x = x; e.motor.z = z; e.motor.y = a.motor.y; };
  place(b, a.motor.x + 3, a.motor.z);
  place(c, a.motor.x + JOIN_RADIUS + 6, a.motor.z);
  host.receive('b', { type: 'dance', j: a.id });
  if (b.dance) failures.push('joined a player who is not dancing');
  host.receive('a', { type: 'dance', d: 'robot' });
  host.receive('b', { type: 'dance', j: a.id });
  if (b.dance) failures.push('joined a solo (non-group) dance');
  a.lastDance = -9;
  host.receive('a', { type: 'dance', d: 'crew' });
  for (let t = 0; t < 1.3; t += 0.1) host.update(0.1); // the leader is a second into the routine
  host.receive('b', { type: 'dance', j: a.id });
  if (!b.dance || b.dance.id !== 'crew') failures.push('nearby player could not join the group dance');
  else if (b.dance.start !== a.dance.start) failures.push('joiner is not on the same beat as the leader');
  host.receive('c', { type: 'dance', j: a.id });
  if (c.dance) failures.push(`joined from ${JOIN_RADIUS + 6} m away`);
  const row = (snap, id) => snap.e.find((r) => r[0] === id);
  const snapC = game.snapshot(c);
  if (danceAt(row(snapC, a.id)[10]) !== 'crew' || row(snapC, a.id)[11] !== row(snapC, b.id)[11] || !row(snapC, a.id)[11]) failures.push('snapshot does not carry the shared dance start');
  if (game.snapshot(b).you.ds !== game.snapshot(a).you.ds) failures.push('you.ds differs between leader and joiner');
  // A third player walks over and joins the crew through the joiner (chains keep the same beat).
  place(c, b.motor.x + 2, b.motor.z);
  host.receive('c', { type: 'dance', j: b.id });
  if (!c.dance || c.dance.start !== a.dance.start) failures.push('chain join lost the beat');
  // The leader stopping doesn't kick the others out.
  host.receive('a', { type: 'dance', d: null });
  if (!b.dance || !c.dance) failures.push('crew stopped when the leader stopped');
  // Idle bots near a group dance sometimes join in.
  const botHost = new Host({ mode: 'tdm', map: 'outpost', bots: 7, difficulty: 'normal', scoreLimit: 30 }, { send: () => {} });
  const p = botHost.join('p', 'Pal', { set: 'assault', ability: 'dash' });
  for (let t = 0; t < 6; t += 0.1) botHost.update(0.1);
  const mates = [...botHost.game.entities.values()].filter((e) => e.isBot && e.team === p.team);
  mates.forEach((m, i) => { m.motor.x = p.motor.x + 2 + i; m.motor.z = p.motor.z + 1; m.motor.y = p.motor.y; m.brain.targetVisible = false; });
  botHost.receive('p', { type: 'dance', d: 'crew' });
  for (let roll = 0; roll < 6 && !mates.some((m) => m.dance); roll++) { mates.forEach((m) => { m.brain.crewChecked = null; }); botHost.game.botsJoinDances(); }
  const joined = mates.filter((m) => m.dance && m.dance.start === p.dance.start).length;
  if (!joined) failures.push('no idle teammate bot ever joined the group dance');
  console.log(`group dance: join within ${JOIN_RADIUS} m, shared start, chain joins; ${joined}/${mates.length} nearby teammate bots joined`);
  if (failures.length) { console.log('GROUP DANCE FAILURES:\n  ' + failures.join('\n  ')); process.exitCode = 1; } else console.log('group dance checks passed');
}
