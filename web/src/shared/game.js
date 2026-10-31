// Authoritative game simulation. Runs in the host player's browser for online play and in your own tab for offline
// play (same code path), so offline and online behave identically.
import { BOT_NAMES, DIFFICULTY, HISTORY_SECONDS, MAX_REWIND, PLAYER, TEAM, TEAM_NAMES, TICK_RATE } from './constants.js';
import { BotBrain } from './bots.js';
import { clamp, dist2, dist3, distToSegment, makeRng, rayBox, raySphere } from './math.js';
import { buildMap, generateCoverPoints } from './map.js';
import { createMode } from './modes.js';
import { createMotorState, eyeHeightOf } from './movement.js';
import { NavGrid } from './nav.js';
import { NOISE, hitboxesAt, packActor, stepCommand } from './sim.js';
import { BOT_PRIMARY_POOL, PRIMARY_WEAPONS, WEAPONS, createWeaponState, damageAt, refillWeapons, setLoadout, spreadDirection } from './weapons.js';
import { World } from './world.js';

const HISTORY_LEN = Math.ceil(HISTORY_SECONDS * TICK_RATE) + 4;
const WARMUP = 4;
const END_SCREEN = 12;

const mapCache = new Map();

/** Map + collision world + navigation are immutable per map id, so they are cached and shared by rooms. */
export function loadMapBundle(mapId) {
  if (mapCache.has(mapId)) return mapCache.get(mapId);
  const map = buildMap(mapId);
  const world = new World(map.boxes, map.half + 2);
  const nav = new NavGrid(world, map);
  for (const zone of map.zones) zone.y = nav.heightAt(zone.x, zone.z);
  const cover = [];
  for (const p of generateCoverPoints(map)) {
    const i = nav.nearestWalkable(p.x, p.z, 0.6);
    if (i < 0) continue;
    const q = nav.point(i);
    if (Math.abs(q.x - p.x) > 0.75 || Math.abs(q.z - p.z) > 0.75 || q.y > 0.6) continue;
    cover.push({ x: p.x, y: q.y, z: p.z, dx: p.dx, dz: p.dz, high: p.high });
  }
  const bundle = { map, world, nav, cover };
  mapCache.set(mapId, bundle);
  return bundle;
}

export class Game {
  /**
   * @param {object} config { mode, map, bots, difficulty, scoreLimit?, timeLimit?, friendlyFire? }
   */
  constructor(config) {
    this.config = {
      mode: config.mode || 'tdm',
      map: config.map || 'outpost',
      bots: clamp(config.bots ?? 8, 0, 24),
      difficulty: DIFFICULTY[config.difficulty] ? config.difficulty : 'normal',
      scoreLimit: config.scoreLimit || 0,
      timeLimit: config.timeLimit || 0,
    };
    const bundle = loadMapBundle(this.config.map);
    this.map = bundle.map;
    this.world = bundle.world;
    this.nav = bundle.nav;
    this.coverPoints = bundle.cover;
    this.coverOwners = new Map();
    this.rng = makeRng((Math.random() * 1e9) | 0);
    this.entities = new Map();
    this.nextId = 1;
    this.time = 0;
    this.tick = 0;
    this.events = [];          // broadcast events (flushed by the host every tick)
    this.direct = new Map();   // entity id -> targeted events
    this.noises = [];
    this.noiseCounter = 0;
    this.intel = [new Map(), new Map(), new Map()];
    this.flankers = new Map();
    this.rosterDirty = true;
    this.zones = this.map.zones.map((z) => ({ ...z, owner: TEAM.NONE, progress: 0, contested: false }));
    this.mode = createMode(this.config.mode, this);
    this.botNameIndex = Math.floor(this.rng() * BOT_NAMES.length);
    this.startMatch();
  }

  // ==============================================================================================
  // Match flow
  // ==============================================================================================
  startMatch() {
    this.teamScores = [0, 0];
    this.result = null;
    this.phase = 'warmup';
    this.phaseEnd = this.time + WARMUP;
    for (const e of this.entities.values()) {
      e.kills = 0; e.deaths = 0; e.score = 0; e.tier = 0; e.streak = 0;
    }
    for (const z of this.zones) { z.owner = TEAM.NONE; z.progress = 0; z.contested = false; }
    if (this.mode.managesEnemyBots) this.removeBots(TEAM.B);
    this.rebalanceBots();
    this.respawnAll();
    this.event({ type: 'phase', phase: 'warmup' });
  }

  goLive() {
    this.phase = 'live';
    this.phaseEnd = this.time + this.mode.timeLimit;
    this.mode.setup();
    this.announce('FIGHT!', TEAM.NONE);
    this.event({ type: 'phase', phase: 'live' });
  }

  finish(result) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.phaseEnd = this.time + END_SCREEN;
    this.result = result;
    this.event({ type: 'end', team: result.team, winner: result.winner ?? -1, text: result.text });
  }

  // ==============================================================================================
  // Entities
  // ==============================================================================================
  createEntity({ name, isBot, team, loadout, clientId }) {
    const id = this.nextId++;
    const primary = loadout && PRIMARY_WEAPONS.includes(loadout[0]) ? loadout[0] : 'rifle';
    const e = {
      id, name, isBot, clientId,
      team: TEAM.NONE,
      motor: createMotorState(0, 0, 0, 0),
      ws: createWeaponState([primary, 'pistol']),
      loadoutPref: [primary, 'pistol'],
      clock: 0, aim01: 0, prevFire: false, sprintLock: 0,
      alive: false, hp: PLAYER.maxHealth, maxHp: PLAYER.maxHealth,
      respawnAt: this.time + 0.5, protectUntil: 0, lastDamage: -99, lastFire: -99,
      kills: 0, deaths: 0, score: 0, tier: 0, streak: 0,
      queue: [], lastSeq: 0, budget: 0.1,
      history: new Float32Array(HISTORY_LEN * 6), historyHead: 0, historyCount: 0,
      brain: null, ping: 0,
    };
    e.team = team ?? this.mode.assignTeam(e);
    this.entities.set(id, e);
    if (isBot) e.brain = new BotBrain(this, e, this.config.difficulty, makeRng((this.rng() * 1e9) | 0));
    this.rosterDirty = true;
    return e;
  }

  addHuman(clientId, name, loadout) {
    const e = this.createEntity({ name: name || 'Player', isBot: false, loadout, clientId });
    this.rebalanceBots();
    if (this.phase !== 'ended' && (this.mode.respawns || this.phase === 'warmup')) e.respawnAt = this.time + 0.2;
    else e.respawnAt = Infinity;
    return e;
  }

  removeEntity(id) {
    const e = this.entities.get(id);
    if (!e) return;
    this.entities.delete(id);
    for (const [index, owner] of this.coverOwners) if (owner.id === id) this.coverOwners.delete(index);
    this.flankers.delete(id);
    this.rosterDirty = true;
  }

  removeHuman(id) {
    this.removeEntity(id);
    this.rebalanceBots();
  }

  spawnBot(team, difficulty, options = {}) {
    const name = BOT_NAMES[this.botNameIndex++ % BOT_NAMES.length];
    const primary = BOT_PRIMARY_POOL[Math.floor(this.rng() * BOT_PRIMARY_POOL.length)];
    const e = this.createEntity({ name: (options.horde ? 'X-' : 'BOT ') + name, isBot: true, team, loadout: [primary, 'pistol'] });
    if (difficulty) e.brain.setDifficulty(difficulty);
    const loadout = this.mode.loadoutFor(e);
    if (loadout) setLoadout(e.ws, loadout, e.clock);
    this.respawnEntity(e);
    return e;
  }

  removeBots(team) {
    for (const e of [...this.entities.values()]) if (e.isBot && e.team === team) this.removeEntity(e.id);
  }

  humanCount() {
    let n = 0;
    for (const e of this.entities.values()) if (!e.isBot) n++;
    return n;
  }

  teamCounts() {
    const humans = [0, 0, 0], bots = [0, 0, 0], total = [0, 0, 0];
    for (const e of this.entities.values()) {
      total[e.team]++;
      if (e.isBot) bots[e.team]++; else humans[e.team]++;
    }
    return { humans, bots, total };
  }

  aliveCount(team) {
    let n = 0;
    for (const e of this.entities.values()) if (e.alive && e.team === team) n++;
    return n;
  }

  /** Keeps teams even by adding/removing bots around the human players. */
  rebalanceBots() {
    const mode = this.mode;
    const target = this.config.bots;
    if (mode.managesEnemyBots) {
      // Horde: config.bots = allied bots (capped).
      const allies = Math.min(target, 5);
      this.adjustBots(TEAM.A, allies);
      return;
    }
    if (!mode.teams) {
      this.adjustBots(TEAM.NONE, target);
      return;
    }
    const counts = this.teamCounts();
    const total = counts.humans[0] + counts.humans[1] + target;
    const wantA = Math.ceil(total / 2), wantB = total - wantA;
    this.adjustBots(TEAM.A, Math.max(0, wantA - counts.humans[0]));
    this.adjustBots(TEAM.B, Math.max(0, wantB - counts.humans[1]));
  }

  adjustBots(team, wanted) {
    const bots = [...this.entities.values()].filter((e) => e.isBot && e.team === team);
    for (let i = bots.length; i < wanted; i++) this.spawnBot(team, this.config.difficulty);
    for (let i = bots.length - 1; i >= wanted; i--) this.removeEntity(bots[i].id);
  }

  setEntityLoadout(e, loadout) {
    setLoadout(e.ws, loadout, e.clock);
    e.aim01 = 0;
  }

  refill(e) {
    refillWeapons(e.ws);
  }

  setPreferredPrimary(e, primary) {
    if (!PRIMARY_WEAPONS.includes(primary)) return;
    e.loadoutPref = [primary, 'pistol'];
  }

  // ==============================================================================================
  // Spawning
  // ==============================================================================================
  pickSpawn(e) {
    let list;
    if (this.mode.managesEnemyBots && e.team === TEAM.B) list = [...this.map.spawns[1], ...this.map.spawns.ffa];
    else if (!this.mode.teams) list = this.map.spawns.ffa;
    else list = this.map.spawns[e.team === TEAM.B ? 1 : 0];
    if (!list || list.length === 0) list = this.map.spawns[0];

    let best = list[0], bestScore = -Infinity;
    for (const s of list) {
      let nearest = 80;
      let seen = false;
      for (const o of this.entities.values()) {
        if (o === e || !o.alive || !this.mode.isHostile(e, o)) continue;
        const d = dist2(s.x, s.z, o.motor.x, o.motor.z);
        nearest = Math.min(nearest, d);
        if (!seen && d < 60 && this.world.lineOfSight(o.motor.x, o.motor.y + 1.5, o.motor.z, s.x, 1.5, s.z)) seen = true;
      }
      let crowd = 0;
      for (const o of this.entities.values()) if (o !== e && o.alive && dist2(s.x, s.z, o.motor.x, o.motor.z) < 1.2) crowd++;
      const score = nearest * 0.6 + this.rng() * 8 - (seen ? 30 : 0) - crowd * 50;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    const i = this.nav.nearestWalkable(best.x, best.z, 6);
    const p = i >= 0 ? this.nav.point(i) : { x: best.x, y: 0, z: best.z };
    return { x: p.x, y: p.y, z: p.z, yaw: best.yaw ?? 0 };
  }

  respawnEntity(e) {
    const s = this.pickSpawn(e);
    e.motor = createMotorState(s.x, s.y, s.z, s.yaw);
    e.alive = true;
    e.hp = e.maxHp;
    e.respawnAt = Infinity;
    e.protectUntil = this.time + PLAYER.spawnProtection;
    e.lastDamage = -99;
    const loadout = this.mode.loadoutFor(e) || e.loadoutPref;
    const current = e.ws.slots.map((x) => x.id).join(',');
    if (current !== loadout.join(',')) setLoadout(e.ws, loadout, e.clock);
    else { refillWeapons(e.ws); e.ws.active = 0; }
    e.ws.reloading = false;
    e.aim01 = 0;
    e.historyCount = 0;
    if (e.brain) e.brain.reset();
    if (!e.isBot) this.eventTo(e, { type: 'spawn' });
  }

  respawnAll() {
    for (const e of this.entities.values()) this.respawnEntity(e);
  }

  // ==============================================================================================
  // Input
  // ==============================================================================================
  queueCommands(e, cmds) {
    if (!e || !Array.isArray(cmds)) return;
    for (const c of cmds) {
      if (!c || typeof c.s !== 'number' || c.s <= e.lastSeq) continue;
      if (e.queue.length && c.s <= e.queue[e.queue.length - 1].s) continue;
      e.queue.push({
        s: c.s | 0,
        dt: clamp(+c.dt || 0, 0, 0.05),
        mx: clamp(+c.mx || 0, -1, 1),
        mz: clamp(+c.mz || 0, -1, 1),
        yaw: +c.yaw || 0,
        pitch: clamp(+c.pitch || 0, -1.5, 1.5),
        b: c.b | 0,
        sw: Number.isInteger(c.sw) ? c.sw : -1,
        r: !!c.r,
        vt: +c.vt || this.time,
      });
    }
    if (e.queue.length > 90) e.queue.splice(0, e.queue.length - 90);
  }

  makeHooks() {
    if (this._hooks) return this._hooks;
    this._hooks = {
      onShot: (actor, shot) => this.resolveShot(actor, shot),
      onNoise: (actor, radius, kind) => this.noise(actor.motor.x, actor.motor.y, actor.motor.z, radius, kind, actor),
      onReload: (actor) => this.event({ type: 'rl', id: actor.id }),
    };
    return this._hooks;
  }

  processCommand(e, cmd) {
    e.currentCmd = cmd;
    stepCommand(e, cmd, this.world, this.makeHooks());
    e.lastSeq = cmd.s;
  }

  // ==============================================================================================
  // Main step
  // ==============================================================================================
  step(dt) {
    this.time += dt;
    this.tick++;
    if (this.noises.length > 64) this.noises.splice(0, this.noises.length - 64);

    if (this.phase === 'warmup' && this.time >= this.phaseEnd) this.goLive();

    for (const e of this.entities.values()) {
      if (e.isBot) {
        const cmd = e.brain.think(dt);
        if (this.phase === 'ended') { cmd.b = 0; cmd.mx = 0; cmd.mz = 0; }
        this.processCommand(e, cmd);
      } else {
        // Process queued human commands within a real-time budget (prevents speed hacks, absorbs jitter).
        e.budget = Math.min(e.budget + dt, 0.25);
        while (e.queue.length && e.queue[0].dt <= e.budget + 0.002) {
          const cmd = e.queue.shift();
          e.budget -= cmd.dt;
          if (this.phase === 'ended') cmd.b &= 0;
          this.processCommand(e, cmd);
        }
      }

      if (e.alive) {
        if (e.motor.y < -20) this.kill(e, null, 'world', false);
        if (e.hp < e.maxHp && this.time - e.lastDamage > PLAYER.regenDelay && this.phase !== 'ended') {
          e.hp = Math.min(e.maxHp, e.hp + PLAYER.regenRate * dt);
        }
      } else if (this.time >= e.respawnAt && this.phase !== 'ended') {
        this.respawnEntity(e);
      }
      this.record(e);
    }

    if (this.phase !== 'ended') this.mode.update(dt);
    if (this.phase === 'ended' && this.time >= this.phaseEnd) {
      this.restartPending = true;
    }

    // Intel expiry.
    if (this.tick % 30 === 0) {
      for (const map of this.intel) for (const [id, v] of map) if (this.time - v.t > 10) map.delete(id);
    }
  }

  record(e) {
    const base = e.historyHead * 6;
    const h = e.history;
    h[base] = this.time; h[base + 1] = e.motor.x; h[base + 2] = e.motor.y; h[base + 3] = e.motor.z;
    h[base + 4] = e.motor.crouch; h[base + 5] = e.alive ? 1 : 0;
    e.historyHead = (e.historyHead + 1) % HISTORY_LEN;
    e.historyCount = Math.min(e.historyCount + 1, HISTORY_LEN);
  }

  /** Interpolated past pose for lag compensation. */
  poseAt(e, t, out) {
    out.x = e.motor.x; out.y = e.motor.y; out.z = e.motor.z; out.c = e.motor.crouch; out.alive = e.alive;
    if (e.historyCount === 0 || t >= this.time - 1e-4) return out;
    const h = e.history;
    let newer = -1;
    for (let k = 0; k < e.historyCount; k++) {
      const idx = (e.historyHead - 1 - k + HISTORY_LEN) % HISTORY_LEN;
      if (h[idx * 6] <= t) {
        const a = idx * 6;
        if (newer < 0) { out.x = h[a + 1]; out.y = h[a + 2]; out.z = h[a + 3]; out.c = h[a + 4]; out.alive = h[a + 5] > 0; return out; }
        const b = newer * 6;
        const span = h[b] - h[a];
        const f = span > 1e-6 ? (t - h[a]) / span : 0;
        out.x = h[a + 1] + (h[b + 1] - h[a + 1]) * f;
        out.y = h[a + 2] + (h[b + 2] - h[a + 2]) * f;
        out.z = h[a + 3] + (h[b + 3] - h[a + 3]) * f;
        out.c = h[a + 4] + (h[b + 4] - h[a + 4]) * f;
        out.alive = h[a + 5] > 0 && h[b + 5] > 0;
        return out;
      }
      newer = idx;
    }
    // Older than history: oldest pose.
    const oldest = ((e.historyHead - e.historyCount) + HISTORY_LEN) % HISTORY_LEN * 6;
    out.x = h[oldest + 1]; out.y = h[oldest + 2]; out.z = h[oldest + 3]; out.c = h[oldest + 4]; out.alive = h[oldest + 5] > 0;
    return out;
  }

  // ==============================================================================================
  // Combat
  // ==============================================================================================
  resolveShot(shooter, shot) {
    const w = shot.weapon;
    shooter.lastFire = this.time;
    if (this.phase === 'warmup' || this.phase === 'ended') {
      // Shots are still visualised but deal no damage outside the live phase.
    }

    const viewTime = shooter.isBot ? this.time : clamp(shooter.currentCmd ? shooter.currentCmd.vt : this.time, this.time - MAX_REWIND, this.time);
    const pose = { x: 0, y: 0, z: 0, c: 0, alive: true };
    const hb = {};
    const candidates = [];
    for (const o of this.entities.values()) {
      if (o === shooter || !o.alive) continue;
      if (!this.mode.isHostile(shooter, o)) continue; // bullets pass through teammates
      this.poseAt(o, viewTime, pose);
      if (!pose.alive) continue;
      // Broad phase: within weapon range of the ray origin.
      if (dist3(pose.x, pose.y + 1, pose.z, shot.ox, shot.oy, shot.oz) > w.range + 2) continue;
      candidates.push({ e: o, x: pose.x, y: pose.y, z: pose.z, c: pose.c });
    }

    const pellets = Math.max(1, w.pellets);
    const damageBy = new Map();
    const fxPoints = [];
    const dir = { x: 0, y: 0, z: 0 };
    const n = { nx: 0, ny: 0, nz: 0 };
    let headshot = false;
    for (let p = 0; p < pellets; p++) {
      spreadDirection(shot.dx, shot.dy, shot.dz, shot.spread, shot.seed, p, dir);
      const wh = this.world.raycast(shot.ox, shot.oy, shot.oz, dir.x, dir.y, dir.z, w.range);
      let bestT = wh ? wh.t : w.range;
      let victim = null, head = false;
      for (const c of candidates) {
        hitboxesAt(c.x, c.y, c.z, c.c, hb);
        const th = raySphere(shot.ox, shot.oy, shot.oz, dir.x, dir.y, dir.z, hb.hx, hb.hy, hb.hz, hb.hr);
        if (th >= 0 && th < bestT) { bestT = th; victim = c.e; head = true; }
        const tb = rayBox(shot.ox, shot.oy, shot.oz, dir.x, dir.y, dir.z, hb.minx, hb.miny, hb.minz, hb.maxx, hb.maxy, hb.maxz, bestT, n);
        if (tb >= 0 && tb < bestT) { bestT = tb; victim = c.e; head = false; }
      }
      const px = shot.ox + dir.x * bestT, py = shot.oy + dir.y * bestT, pz = shot.oz + dir.z * bestT;
      if (victim) {
        const dmg = damageAt(w, bestT) * (head ? w.headMul : 1);
        const prev = damageBy.get(victim) || { amount: 0, head: false };
        prev.amount += dmg;
        prev.head = prev.head || head;
        damageBy.set(victim, prev);
        headshot = headshot || head;
        fxPoints.push([r2(px), r2(py), r2(pz), 0, 0, 0, 1]);
      } else if (wh) {
        fxPoints.push([r2(px), r2(py), r2(pz), wh.nx, wh.ny, wh.nz, 0]);
      } else {
        fxPoints.push([r2(px), r2(py), r2(pz), 0, 0, 0, 2]);
      }

      // Near misses suppress bots.
      for (const o of this.entities.values()) {
        if (!o.isBot || !o.alive || o === shooter || o === victim || !this.mode.isHostile(shooter, o)) continue;
        const d = distToSegment(o.motor.x, o.motor.y + 1.2, o.motor.z, shot.ox, shot.oy, shot.oz, px, py, pz);
        if (d < 3.5) o.brain.onIncomingFire(shooter, shot.ox, shot.oy, shot.oz, (1 - d / 3.5) / pellets);
      }
    }

    let total = 0, killed = false;
    for (const [victim, info] of damageBy) {
      const before = victim.hp;
      this.damage(victim, info.amount, shooter, w.id, info.head, shot.ox, shot.oy, shot.oz);
      total += before - Math.max(0, victim.hp);
      if (before > 0 && !victim.alive) killed = true;
    }

    this.noise(shot.ox, shot.oy, shot.oz, NOISE[w.id] || 70, 'gun', shooter);
    this.event({ type: 'shot', s: shooter.id, w: w.id, o: [r2(shot.ox), r2(shot.oy), r2(shot.oz)], p: fxPoints }, shooter.isBot ? null : shooter.id);
    if (total > 0 && !shooter.isBot) this.eventTo(shooter, { type: 'hit', d: Math.round(total), hs: headshot ? 1 : 0, k: killed ? 1 : 0 });
  }

  damage(victim, amount, attacker, weaponId, headshot, ox, oy, oz) {
    if (!victim.alive || this.phase !== 'live' || this.time < victim.protectUntil) return;
    if (attacker && attacker !== victim && !this.mode.isHostile(attacker, victim)) return;
    victim.hp -= amount;
    victim.lastDamage = this.time;
    if (victim.brain) victim.brain.onDamaged(attacker, ox, oy, oz);
    if (!victim.isBot) this.eventTo(victim, { type: 'dmg', d: Math.round(amount), f: [r2(ox), r2(oy), r2(oz)] });
    if (victim.hp <= 0) this.kill(victim, attacker, weaponId, headshot);
  }

  kill(victim, attacker, weaponId, headshot) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.streak = 0;
    const valid = attacker && attacker !== victim;
    if (valid) {
      attacker.kills++;
      attacker.streak++;
      attacker.score += headshot ? 150 : 100;
    }
    this.mode.onKill(valid ? attacker : null, victim, { weaponId, headshot });
    victim.respawnAt = this.mode.canRespawn(victim) ? this.time + this.mode.respawnDelay(victim) : Infinity;
    if (this.coverOwners.size) for (const [index, owner] of this.coverOwners) if (owner === victim) this.coverOwners.delete(index);
    this.flankers.delete(victim.id);
    this.event({
      type: 'kill', k: valid ? attacker.id : -1, v: victim.id, w: weaponId || 'world', hs: headshot ? 1 : 0,
      st: valid ? attacker.streak : 0,
    });
    if (!victim.isBot) {
      this.eventTo(victim, { type: 'died', by: valid ? attacker.id : -1, w: weaponId || 'world', ra: Number.isFinite(victim.respawnAt) ? victim.respawnAt - this.time : -1 });
    }
  }

  // ==============================================================================================
  // AI services
  // ==============================================================================================
  noise(x, y, z, r, kind, source) {
    this.noises.push({ x, y, z, r, kind, source, index: ++this.noiseCounter });
  }

  botLod(e) {
    let nearest = Infinity;
    for (const o of this.entities.values()) if (!o.isBot && o.alive) nearest = Math.min(nearest, dist2(o.motor.x, o.motor.z, e.motor.x, e.motor.z));
    if (nearest === Infinity) return 0.12;
    return nearest > 90 ? 0.25 : nearest > 45 ? 0.15 : 0.1;
  }

  reportIntel(team, enemy, t) {
    if (team === TEAM.NONE) return;
    this.intel[team].set(enemy.id, { x: enemy.motor.x, z: enemy.motor.z, t, id: enemy.id });
  }

  freshestIntel(e) {
    if (e.team === TEAM.NONE) return null;
    let best = null, bestScore = Infinity;
    for (const v of this.intel[e.team].values()) {
      const target = this.entities.get(v.id);
      if (!target || !target.alive) continue;
      const score = (this.time - v.t) * 10 + dist2(e.motor.x, e.motor.z, v.x, v.z);
      if (score < bestScore) { bestScore = score; best = v; }
    }
    return best;
  }

  teamReloadOk(e) {
    // Stagger reloads: allow if no nearby teammate is already reloading.
    for (const o of this.entities.values()) {
      if (o === e || !o.isBot || o.team !== e.team || o.team === TEAM.NONE || !o.alive) continue;
      if (o.ws.reloading && dist2(o.motor.x, o.motor.z, e.motor.x, e.motor.z) < 15) return false;
    }
    return true;
  }

  claimFlank(e) {
    if (e.team === TEAM.NONE) return true;
    let current = 0;
    for (const [id, until] of this.flankers) {
      const o = this.entities.get(id);
      if (!o || until < this.time) { this.flankers.delete(id); continue; }
      if (o.team === e.team) current++;
    }
    const teamSize = this.aliveCount(e.team);
    if (current >= Math.max(1, Math.floor(teamSize / 3))) return false;
    this.flankers.set(e.id, this.time + 16);
    return true;
  }

  releaseFlank(e) {
    this.flankers.delete(e.id);
  }

  teamCentroid(team, exclude) {
    let x = 0, z = 0, n = 0;
    for (const o of this.entities.values()) {
      if (!o.alive || o.team !== team || o === exclude) continue;
      x += o.motor.x; z += o.motor.z; n++;
    }
    return n ? { x: x / n, z: z / n } : { x: exclude.motor.x, z: exclude.motor.z };
  }

  /** Best protected, reachable, unreserved cover point against a threat position. */
  findCover(e, threat, radius, minThreatDist, aggression) {
    const m = e.motor;
    const preferred = 30 + (12 - 30) * aggression;
    const scored = [];
    for (let i = 0; i < this.coverPoints.length; i++) {
      const c = this.coverPoints[i];
      const d = dist2(m.x, m.z, c.x, c.z);
      if (d > radius) continue;
      const owner = this.coverOwners.get(i);
      if (owner && owner !== e && owner.alive) continue;
      const td = dist2(c.x, c.z, threat.x, threat.z);
      if (td < minThreatDist) continue;
      const tx = threat.x - c.x, tz = threat.z - c.z;
      const tl = Math.hypot(tx, tz) || 1;
      const facing = (c.dx * tx + c.dz * tz) / tl;
      if (facing < -0.2) continue;
      let score = -d * 1.1 - Math.abs(td - preferred) * 0.35 + facing * 6 + (c.high ? 2 : 0);
      const sx = c.x - m.x, sz = c.z - m.z, sl = Math.hypot(sx, sz) || 1;
      const ex = threat.x - m.x, ez = threat.z - m.z, el = Math.hypot(ex, ez) || 1;
      if ((sx * ex + sz * ez) / (sl * el) > 0.6 && sl > 6) score -= 10;
      scored.push({ i, c, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const threatEye = (threat.y || 0) + 1.6;
    for (let k = 0; k < Math.min(5, scored.length); k++) {
      const { i, c } = scored[k];
      const hiddenY = c.y + (c.high ? 1.55 : 0.95);
      if (this.world.lineOfSight(threat.x, threatEye, threat.z, c.x, hiddenY, c.z)) continue;
      const path = this.nav.findPath(m.x, m.z, c.x, c.z, 3000);
      if (!path) continue;
      this.coverOwners.set(i, e);
      return { ...c, index: i };
    }
    return null;
  }

  releaseCover(cover, e) {
    if (cover && this.coverOwners.get(cover.index) === e) this.coverOwners.delete(cover.index);
  }

  leader() {
    let best = null;
    for (const e of this.entities.values()) if (!best || e.kills > best.kills) best = e;
    return best;
  }

  // ==============================================================================================
  // Events & replication
  // ==============================================================================================
  event(ev, exceptId = null) {
    if (exceptId !== null) ev._except = exceptId;
    this.events.push(ev);
  }

  eventTo(e, ev) {
    if (!e || e.isBot) return;
    let list = this.direct.get(e.id);
    if (!list) { list = []; this.direct.set(e.id, list); }
    list.push(ev);
  }

  announce(text, team = TEAM.NONE) {
    this.event({ type: 'ann', text, team });
  }

  roster() {
    return [...this.entities.values()].map((e) => [e.id, e.name, e.team, e.isBot ? 1 : 0]);
  }

  scores() {
    return [...this.entities.values()].map((e) => [e.id, e.kills, e.deaths, e.score, e.tier || 0, e.ping | 0]);
  }

  hudState() {
    return {
      ph: this.phase,
      tl: Math.max(0, Math.round((this.phaseEnd - this.time) * 10) / 10),
      ...this.mode.hud(),
      res: this.result ? [this.result.team, this.result.winner ?? -1, this.result.text] : null,
    };
  }

  /** Snapshot for one client entity: authoritative self state + compact remote entity states. */
  snapshot(forEntity) {
    const ents = [];
    for (const e of this.entities.values()) {
      if (forEntity && e === forEntity) continue;
      const m = e.motor;
      const flags = (e.alive ? 1 : 0) | (m.sprinting ? 2 : 0) | (e.aim01 > 0.5 ? 4 : 0) | (m.grounded ? 8 : 0) | (e.ws.reloading ? 16 : 0);
      const slot = e.ws.slots[e.ws.active];
      ents.push([e.id, r2(m.x), r2(m.y), r2(m.z), r3(m.yaw), r3(m.pitch), r2(m.crouch), flags, slot ? slot.id : 'pistol', Math.ceil(e.hp)]);
    }
    const snap = { type: 'snap', t: r3(this.time), e: ents, m: this.hudState() };
    if (forEntity) {
      snap.ack = forEntity.lastSeq;
      snap.you = {
        id: forEntity.id,
        al: forEntity.alive ? 1 : 0,
        hp: Math.ceil(forEntity.hp),
        tm: forEntity.team,
        ra: Number.isFinite(forEntity.respawnAt) && !forEntity.alive ? Math.max(0, r2(forEntity.respawnAt - this.time)) : -1,
        pr: this.time < forEntity.protectUntil ? 1 : 0,
        a: packActor(forEntity),
      };
    }
    return snap;
  }
}

function r2(v) { return Math.round(v * 100) / 100; }
function r3(v) { return Math.round(v * 1000) / 1000; }

export { WEAPONS, TEAM_NAMES, eyeHeightOf };
