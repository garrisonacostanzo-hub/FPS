// Tactical bot AI. Each bot "presses buttons": the brain outputs the same command format as a human player,
// so bots obey exactly the same movement, weapon and network rules.
//
// Layers: perception (vision cone + LOS raycasts with awareness, hearing, suppression) -> decision (priority
// rules evaluated every few hundred ms) -> state behaviour (patrol / investigate / engage / cover / reload /
// flank / search) -> steering (A* path following, strafing) + human-like aim and trigger discipline.
import { BTN, MOVE, TICK_DT } from './constants.js';
import { dropAt, flightTime } from './ballistics.js';
import { resolveDifficulty } from './difficulty.js';
import { DEG, angleDiff, clamp, dist2, dist3, distToSegment, moveTowardsAngle, anglesFromDir } from './math.js';
import { eyeHeightOf } from './movement.js';
import { WEAPONS, activeWeapon, canReload } from './weapons.js';

const S = {
  PATROL: 'patrol', INVESTIGATE: 'investigate', ENGAGE: 'engage', COVER: 'cover',
  RELOAD: 'reload', FLANK: 'flank', SEARCH: 'search', DEAD: 'dead',
};

export class BotBrain {
  constructor(game, entity, difficulty, rng) {
    this.game = game;
    this.e = entity;
    this.rng = rng;
    this.setDifficulty(difficulty);
    this.seq = 0;
    this.reset();
  }

  setDifficulty(key) {
    this.diffKey = key;
    this.d = resolveDifficulty(key);
  }

  reset() {
    this.state = S.PATROL;
    this.stateTime = 0;
    this.target = null;
    this.targetVisible = false;
    this.lastKnown = null;
    this.lastKnownVel = { x: 0, z: 0 };
    this.lastSeen = -99;
    this.acquired = -99;
    this.awareness = new Map();
    this.investigate = null;
    this.suppression = 0;
    this.threat = null;
    this.lastThreat = -99;
    this.lastDamaged = -99;
    this.attacker = null;
    this.cover = null;
    this.coverPhase = null;
    this.flank = null;
    this.searchPoints = null;
    this.goal = null;
    this.goalWait = 0;
    this.path = null;
    this.pathIndex = 0;
    this.pathGoal = null;
    this.repathAt = 0;
    this.stuckCheck = { x: this.e.motor.x, z: this.e.motor.z, t: this.game.time };
    this.jumpNext = false;
    this.aimYaw = this.e.motor.yaw;
    this.aimPitch = 0;
    this.err = { x: 0, y: 0, z: 0 };
    this.nextErr = 0;
    this.trackId = -1;
    this.trackStart = 0;
    this.burstLeft = 0;
    this.nextBurst = 0;
    this.triggerToggle = false;
    this.perceptionTimer = this.rng() * 0.1;
    this.decisionTimer = this.rng() * this.d.reaction;
    this.lookPoint = null;
    this.crouch = false;
    this.strafeUntil = 0;
    this.strafeDir = 0;
    this.lastNoiseIndex = this.game.noiseCounter;
    this.reloadWanted = false;
    this.lastCoverTime = -99;
  }

  get now() { return this.game.time; }

  // ============================================================================================
  // Main entry: returns a command for this tick.
  // ============================================================================================
  think(dt) {
    const e = this.e;
    const cmd = { s: ++this.seq, dt: TICK_DT, mx: 0, mz: 0, yaw: this.aimYaw, pitch: this.aimPitch, b: 0, sw: -1, r: false, vt: this.now };
    if (!e.alive) {
      this.state = S.DEAD;
      return cmd;
    }
    if (this.state === S.DEAD) this.reset();

    this.perceptionTimer -= dt;
    if (this.perceptionTimer <= 0) {
      const interval = this.game.botLod(e);
      this.perceive(interval);
      this.perceptionTimer += interval;
    }

    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = 0.22 + this.rng() * 0.12;
      this.decide();
    }

    this.stateTime += dt;
    this.fireAllowed = false;
    this.aimWanted = false;
    this.lookPoint = null;
    this.moveGoal = null;
    this.moveSpeed = 'run';
    this.runState(dt);

    this.updateAim(dt);
    this.steer(cmd, dt);
    this.trigger(cmd);

    cmd.yaw = this.aimYaw;
    cmd.pitch = this.aimPitch;
    if (this.crouch) cmd.b |= BTN.CROUCH;
    if (this.aimWanted && this.targetVisible) cmd.b |= BTN.AIM;
    if (this.reloadWanted) { cmd.r = true; this.reloadWanted = false; }

    // Switch to the sidearm when the primary is completely empty.
    const ws = e.ws;
    const slot = ws.slots[ws.active];
    if (slot && slot.mag === 0 && slot.reserve === 0 && ws.slots.length > 1) {
      const other = ws.active === 0 ? 1 : 0;
      if (ws.slots[other].mag + ws.slots[other].reserve > 0) cmd.sw = other;
    }
    return cmd;
  }

  // ============================================================================================
  // Perception
  // ============================================================================================
  perceive(dt) {
    const game = this.game, e = this.e, d = this.d;
    const m = e.motor;
    const eyeY = m.y + eyeHeightOf(m);
    const fx = -Math.sin(this.aimYaw), fz = -Math.cos(this.aimYaw);
    const halfFov = d.fov * 0.5 * DEG;
    let best = null, bestScore = -Infinity;

    for (const [id, value] of this.awareness) this.awareness.set(id, Math.max(0, value - dt * 0.35));

    for (const o of game.entities.values()) {
      if (o === e || !o.alive || !game.mode.isHostile(e, o)) continue;
      const om = o.motor;
      const oEye = om.y + eyeHeightOf(om);
      const dx = om.x - m.x, dz = om.z - m.z;
      const dy = oEye - 0.3 - eyeY;
      const dist = Math.hypot(dx, dy, dz);
      const firedRecently = this.now - o.lastFire < 0.6;
      const range = d.detect * (firedRecently ? 1.7 : 1);
      if (dist > range) continue;
      const hd = Math.hypot(dx, dz) || 1;
      const cos = (dx * fx + dz * fz) / hd;
      const angle = Math.acos(clamp(cos, -1, 1));
      const proximity = dist < 3.5;
      if (angle > halfFov && !proximity && !(firedRecently && angle < halfFov + 0.7)) continue;

      if (!game.world.lineOfSight(m.x, eyeY, m.z, om.x, oEye, om.z) &&
          !game.world.lineOfSight(m.x, eyeY, m.z, om.x, om.y + 1.0, om.z)) continue;

      const distFactor = 3.5 + (0.55 - 3.5) * Math.min(1, dist / d.detect);
      const centre = angle < halfFov * 0.35 ? 1.35 : angle > halfFov ? 0.45 : 1;
      const motion = Math.hypot(om.vx, om.vz) > 2 ? 1.3 : 0.8;
      const crouched = om.crouch > 0.5 && dist > 15 ? 0.7 : 1;
      const gain = (dt / d.detectTime) * distFactor * centre * motion * crouched * (firedRecently ? 2.2 : 1);
      const aw = Math.min(1.5, (this.awareness.get(o.id) || 0) + gain + dt * 0.35);
      this.awareness.set(o.id, aw);

      if (aw >= 1) {
        let score = 100 / Math.max(1, dist);
        if (o === this.target) score += 2.5;
        if (o === this.attacker && this.now - this.lastDamaged < 4) score += 4;
        score += (1 - o.hp / o.maxHp) * 1.5;
        if (score > bestScore) { bestScore = score; best = o; }
      } else if (aw > 0.35 && !this.targetVisible) {
        this.investigate = { x: om.x, z: om.z, t: this.now, reason: 'glimpse' };
      }
    }

    if (best) {
      if (best !== this.target) this.acquired = this.now;
      this.target = best;
      this.targetVisible = true;
      this.lastKnown = { x: best.motor.x, y: best.motor.y, z: best.motor.z };
      this.lastKnownVel = { x: best.motor.vx, z: best.motor.vz };
      this.lastSeen = this.now;
      game.reportIntel(e.team, best, this.now);
    } else {
      this.targetVisible = false;
      if (this.target && (!this.target.alive || this.now - this.lastSeen > d.memory)) this.forgetTarget();
    }

    this.processNoises();
    this.suppression = Math.max(0, this.suppression - dt * 0.3);
  }

  processNoises() {
    const game = this.game, e = this.e, d = this.d;
    const m = e.motor;
    const eyeY = m.y + eyeHeightOf(m);
    const list = game.noises;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.index <= this.lastNoiseIndex) continue;
      if (!n.source || n.source === e) continue;
      const hostile = game.mode.isHostile(e, n.source);
      const allyFight = !hostile && n.kind === 'gun';
      if (!hostile && !allyFight) continue;
      const dist = dist3(m.x, eyeY, m.z, n.x, n.y, n.z);
      let radius = n.r * d.hearing;
      if (!game.world.lineOfSight(m.x, eyeY, m.z, n.x, n.y + 0.5, n.z)) radius *= 0.6;
      if (dist > radius) continue;
      if (allyFight) {
        if (!this.target && dist > 12) this.investigate = { x: n.x, z: n.z, t: this.now, reason: 'support' };
        continue;
      }
      const error = dist * (n.kind === 'gun' ? 0.06 : 0.12);
      if (!this.targetVisible) {
        this.investigate = { x: n.x + (this.rng() - 0.5) * error * 2, z: n.z + (this.rng() - 0.5) * error * 2, t: this.now, reason: n.kind };
      }
      const boost = (n.kind === 'gun' ? 0.45 : 0.2) + (dist < radius * 0.35 ? 0.3 : 0);
      this.awareness.set(n.source.id, Math.min(0.95, (this.awareness.get(n.source.id) || 0) + boost));
    }
    this.lastNoiseIndex = game.noiseCounter;
  }

  onIncomingFire(shooter, ox, oy, oz, intensity) {
    this.suppression = clamp(this.suppression + intensity * 0.35, 0, 1);
    this.threat = { x: ox, y: oy, z: oz };
    this.lastThreat = this.now;
    if (shooter) {
      this.awareness.set(shooter.id, Math.min(1.2, (this.awareness.get(shooter.id) || 0) + 0.5 * intensity + 0.2));
      if (!this.targetVisible) this.investigate = { x: ox, z: oz, t: this.now, reason: 'gun' };
    }
  }

  onDamaged(attacker, ox, oy, oz) {
    this.suppression = clamp(this.suppression + 0.4, 0, 1);
    this.lastDamaged = this.now;
    this.threat = { x: ox, y: oy, z: oz };
    this.lastThreat = this.now;
    if (attacker && attacker !== this.e) {
      this.attacker = attacker;
      this.awareness.set(attacker.id, 1.2);
      if (!this.targetVisible) {
        this.target = attacker;
        this.lastKnown = { x: ox, y: oy, z: oz };
        this.lastSeen = this.now - 0.5;
      }
    }
  }

  forgetTarget() {
    this.target = null;
    this.targetVisible = false;
    this.flank = null;
  }

  // ============================================================================================
  // Decision layer
  // ============================================================================================
  decide() {
    const d = this.d, e = this.e;
    const ws = e.ws;
    const slot = ws.slots[ws.active];
    const hpFrac = e.hp / e.maxHp;
    const visible = this.targetVisible && this.target && this.target.alive;
    const remembered = this.target && this.target.alive && !visible;
    const threatened = this.suppression >= d.suppressTol || (hpFrac < d.retreatHp && this.now - this.lastDamaged < 3);
    const empty = slot && slot.mag === 0 && slot.reserve > 0;
    const w = WEAPONS[slot ? slot.id : 'pistol'];
    const lowMag = slot && slot.mag / w.mag < 0.35;
    const canCover = this.game.coverPoints.length > 0 && this.now - this.lastCoverTime > 2.5 + 4.5 * d.aggression;

    // Locked states keep running until they finish.
    if (this.state === S.COVER && this.coverPhase === 'move') return;
    if (this.state === S.RELOAD && ws.reloading) return;
    if (this.state === S.FLANK && this.flank && this.stateTime < 15 && this.suppression < 0.7) {
      if (!visible || dist2(e.motor.x, e.motor.z, this.flank.x, this.flank.z) > 6) return;
    }

    if (threatened && canCover) return this.enter(S.COVER);
    if (empty) {
      if (visible && canCover) { this.coverReload = true; return this.enter(S.COVER); }
      return this.enter(S.RELOAD);
    }
    if (visible) {
      if (this.state === S.COVER && this.coverPhase !== 'done' && this.stateTime < 6) return;
      if (this.shouldFlank()) return this.enter(S.FLANK);
      return this.enter(S.ENGAGE);
    }
    if (lowMag && canReload(ws) && this.now - this.lastSeen > 1.5 && this.game.teamReloadOk(e)) return this.enter(S.RELOAD);
    if (remembered) {
      if (this.now - this.lastSeen < 1.2) return this.enter(S.ENGAGE);
      if (this.state !== S.SEARCH || !this.searchDone) return this.enter(S.SEARCH);
      this.forgetTarget();
    }
    if (this.investigate && this.now - this.investigate.t < 14) return this.enter(S.INVESTIGATE);
    const intel = this.game.freshestIntel(e);
    if (intel && this.now - intel.t < 5 && dist2(e.motor.x, e.motor.z, intel.x, intel.z) < 70) {
      this.investigate = { x: intel.x, z: intel.z, t: this.now, reason: 'intel' };
      return this.enter(S.INVESTIGATE);
    }
    return this.enter(S.PATROL);
  }

  enter(state) {
    if (this.state === state) return;
    this.exit(this.state);
    this.state = state;
    this.stateTime = 0;
    if (state === S.COVER) this.enterCover();
    if (state === S.FLANK) this.enterFlank();
    if (state === S.SEARCH) this.enterSearch();
    if (state === S.RELOAD) this.reloadWanted = true;
    if (state === S.PATROL) this.goal = null;
  }

  exit(state) {
    if (state === S.COVER) {
      if (this.cover) this.game.releaseCover(this.cover, this.e);
      this.cover = null;
      this.coverPhase = null;
      this.coverReload = false;
      this.lastCoverTime = this.now;
      this.crouch = false;
    }
    if (state === S.FLANK) {
      this.game.releaseFlank(this.e);
      this.flank = null;
    }
    if (state === S.SEARCH) this.searchPoints = null;
    if (state === S.INVESTIGATE && this.investigateDone) { this.investigate = null; this.investigateDone = false; }
  }

  shouldFlank() {
    if (!this.target) return false;
    const dist = dist2(this.e.motor.x, this.e.motor.z, this.target.motor.x, this.target.motor.z);
    if (dist < 14) return false;
    const chance = this.d.flank * (0.5 + this.d.aggression) * 0.12;
    return this.rng() < chance && this.game.claimFlank(this.e);
  }

  // ============================================================================================
  // State behaviours
  // ============================================================================================
  runState(dt) {
    switch (this.state) {
      case S.PATROL: return this.patrol(dt);
      case S.INVESTIGATE: return this.doInvestigate();
      case S.ENGAGE: return this.engage();
      case S.COVER: return this.doCover();
      case S.RELOAD: return this.doReload();
      case S.FLANK: return this.doFlank();
      case S.SEARCH: return this.doSearch();
      default: return undefined;
    }
  }

  patrol(dt) {
    const e = this.e;
    this.fireAllowed = true;
    if (!this.goal || this.reached(this.goal, 2.2)) {
      if (this.goal && this.goalWait <= 0) this.goalWait = 0.8 + this.rng() * 2.2;
      if (this.goalWait > 0) {
        this.goalWait -= dt;
        this.crouch = this.goal && this.goal.reason === 'zone' && this.rng() < 0.01 ? !this.crouch : this.crouch;
        if (this.goal) this.lookPoint = { x: e.motor.x + Math.sin(this.now * 0.6 + e.id) * 10, y: e.motor.y + 1.5, z: e.motor.z + Math.cos(this.now * 0.6 + e.id) * 10 };
        if (this.goalWait > 0) return;
      }
      this.goal = this.game.mode.botGoal(e, this.rng);
      this.crouch = false;
    }
    this.moveGoal = this.goal;
    this.moveSpeed = dist2(e.motor.x, e.motor.z, this.goal.x, this.goal.z) > 30 ? 'sprint' : 'run';
  }

  doInvestigate() {
    const inv = this.investigate;
    this.fireAllowed = true;
    if (!inv) return;
    if (this.stateTime > 15) { this.investigateDone = true; this.investigate = null; return; }
    const dist = dist2(this.e.motor.x, this.e.motor.z, inv.x, inv.z);
    if (dist > 2.5 && !this.arrivedAt) {
      this.moveGoal = inv;
      this.moveSpeed = inv.reason === 'gun' || inv.reason === 'support' || inv.reason === 'intel' ? 'run' : 'walk';
      this.lookPoint = { x: inv.x, y: this.e.motor.y + 1.4, z: inv.z };
      this.crouch = this.d.aggression < 0.4 && dist < 10;
      return;
    }
    if (!this.arrivedAt) this.arrivedAt = this.now;
    const yaw = this.aimYaw + Math.sin(this.stateTime * 1.7) * 0.05;
    this.lookPoint = { x: this.e.motor.x - Math.sin(yaw) * 10, y: this.e.motor.y + 1.5, z: this.e.motor.z - Math.cos(yaw) * 10 };
    if (this.now - this.arrivedAt > 2.5) {
      this.investigateDone = true;
      this.investigate = null;
      this.arrivedAt = 0;
      this.crouch = false;
    }
  }

  engage() {
    const e = this.e, d = this.d, t = this.target;
    this.fireAllowed = true;
    this.aimWanted = true;
    if (!t) return;
    if (!this.targetVisible) {
      // Hold the angle; aggressive bots lay down suppressive fire for a moment.
      this.lookPoint = { x: this.lastKnown.x, y: this.lastKnown.y + 1.3, z: this.lastKnown.z };
      this.crouch = false;
      this.suppressive = this.now - this.lastSeen < 0.6 && d.aggression > 0.55;
      return;
    }
    this.suppressive = false;
    const w = activeWeapon(e.ws);
    const range = [w.botRange[0] * (1.25 - 0.6 * d.aggression), w.botRange[1] * (1.1 - 0.35 * d.aggression)];
    const dist = dist2(e.motor.x, e.motor.z, t.motor.x, t.motor.z);
    if (dist > range[1]) {
      const zoneGoal = this.game.mode.usesZones() && this.goal && this.goal.reason === 'zone' && !this.reached(this.goal, 4);
      this.moveGoal = zoneGoal ? this.goal : { x: t.motor.x, z: t.motor.z };
      this.moveSpeed = 'run';
      this.crouch = false;
      return;
    }

    // Objective modes: keep pushing onto the assigned zone while fighting.
    const objectiveMode = this.game.mode.usesZones();
    if (objectiveMode && (!this.goal || this.goal.reason !== 'zone')) this.goal = this.game.mode.botGoal(e, this.rng);
    const offObjective = objectiveMode && this.goal && !this.reached(this.goal, 4);

    if (this.now >= this.strafeUntil) {
      this.strafeUntil = this.now + 0.8 + this.rng() * 1.3;
      const r = this.rng();
      if (offObjective && r < 0.55 + 0.35 * d.aggression) { this.strafeDir = 3; this.crouch = false; }
      else if (dist < range[0] && d.aggression < 0.6) { this.strafeDir = 2; this.crouch = false; }
      else if (r < d.strafe || w.id === 'shotgun') { this.strafeDir = this.rng() < 0.5 ? -1 : 1; this.crouch = false; }
      else { this.strafeDir = 0; this.crouch = this.rng() < (0.65 - 0.45 * d.aggression) && w.id !== 'shotgun'; }
    }

    const dx = t.motor.x - e.motor.x, dz = t.motor.z - e.motor.z;
    const l = Math.hypot(dx, dz) || 1;
    const fx = dx / l, fz = dz / l;
    if (this.strafeDir === 3 && offObjective) {
      this.moveGoal = this.goal;
      this.moveSpeed = 'run';
    } else if (this.strafeDir === 2) {
      this.moveGoal = { x: e.motor.x - fx * 5, z: e.motor.z - fz * 5, direct: true };
      this.moveSpeed = 'walk';
    } else if (this.strafeDir !== 0) {
      const forwardPush = (w.id === 'shotgun' || d.aggression > 0.7) ? 0.6 : 0;
      this.moveGoal = { x: e.motor.x + (-fz * this.strafeDir + fx * forwardPush) * 4, z: e.motor.z + (fx * this.strafeDir + fz * forwardPush) * 4, direct: true };
      this.moveSpeed = d.aggression > 0.5 ? 'run' : 'walk';
    }
  }

  enterCover() {
    const e = this.e;
    const threat = this.threatPosition();
    this.cover = threat ? this.game.findCover(e, threat, 26, 5, this.d.aggression) : null;
    if (this.cover) {
      this.coverPhase = 'move';
    } else {
      this.coverPhase = 'retreat';
      const ax = e.motor.x - (threat ? threat.x : e.motor.x), az = e.motor.z - (threat ? threat.z : e.motor.z + 1);
      const l = Math.hypot(ax, az) || 1;
      this.retreat = { x: e.motor.x + (ax / l) * 12, z: e.motor.z + (az / l) * 12 };
    }
  }

  doCover() {
    const e = this.e, d = this.d;
    const threat = this.threatPosition();
    if (this.coverPhase === 'retreat') {
      this.fireAllowed = this.targetVisible;
      this.moveGoal = this.retreat;
      this.moveSpeed = 'sprint';
      if (this.reached(this.retreat, 1.5) || this.stateTime > 5) this.coverPhase = 'done';
      return;
    }
    if (!this.cover) { this.coverPhase = 'done'; return; }
    if (this.coverPhase === 'move') {
      this.fireAllowed = this.targetVisible && d.aggression > 0.6;
      this.moveGoal = this.cover;
      this.moveSpeed = 'sprint';
      if (this.reached(this.cover, 0.7)) {
        this.coverPhase = 'hide';
        this.hideUntil = this.now + (5 - 3.2 * d.aggression) + this.suppression * 2;
      } else if (this.stateTime > 8) this.coverPhase = 'done';
      return;
    }
    if (this.coverPhase === 'hide') {
      this.crouch = !this.cover.high || this.suppression > 0.6;
      if (threat) this.lookPoint = { x: threat.x, y: threat.y + 1.4, z: threat.z };
      const ws = e.ws, slot = ws.slots[ws.active];
      if (canReload(ws) && (this.coverReload || (slot && slot.mag / WEAPONS[slot.id].mag < 0.6))) {
        this.reloadWanted = true;
        this.coverReload = false;
      }
      if (this.now >= this.hideUntil && this.suppression < d.suppressTol * 0.7 && !ws.reloading) {
        this.coverPhase = 'peek';
        this.peekUntil = this.now + 1.2 + this.rng() * 1.4;
        this.crouch = false;
      }
      return;
    }
    if (this.coverPhase === 'peek') {
      this.fireAllowed = true;
      this.aimWanted = true;
      this.crouch = false;
      if (threat) this.lookPoint = { x: threat.x, y: threat.y + 1.4, z: threat.z };
      if (this.suppression >= d.suppressTol) {
        this.coverPhase = 'hide';
        this.hideUntil = this.now + 2;
      } else if (this.targetVisible || this.now > this.peekUntil) {
        this.coverPhase = 'done';
        this.lastCoverTime = this.now;
        this.state = S.ENGAGE;
        this.stateTime = 0;
        if (this.cover) this.game.releaseCover(this.cover, e);
        this.cover = null;
      }
    }
  }

  doReload() {
    this.fireAllowed = false;
    const e = this.e;
    if (this.lastKnown && this.now - this.lastSeen < 4) this.lookPoint = { x: this.lastKnown.x, y: this.lastKnown.y + 1.4, z: this.lastKnown.z };
    if (!e.ws.reloading && this.stateTime > 0.3) {
      this.state = S.PATROL;
      this.stateTime = 0;
      this.goal = null;
      this.crouch = false;
      return;
    }
    this.crouch = this.now - this.lastSeen < 4;
  }

  enterFlank() {
    const e = this.e, t = this.target;
    if (!t) { this.flank = null; return; }
    const centroid = this.game.teamCentroid(e.team, e);
    let ax = t.motor.x - centroid.x, az = t.motor.z - centroid.z;
    let l = Math.hypot(ax, az);
    if (l < 1) { ax = t.motor.x - e.motor.x; az = t.motor.z - e.motor.z; l = Math.hypot(ax, az) || 1; }
    ax /= l; az /= l;
    const px = -az, pz = ax;
    const side = ((e.motor.x - centroid.x) * px + (e.motor.z - centroid.z) * pz) >= 0 ? 1 : -1;
    const w = activeWeapon(e.ws);
    const distance = clamp((w.botRange[0] + w.botRange[1]) * 0.5, 12, 28);
    for (const s of [side, -side]) {
      const fx = t.motor.x + px * s * distance - ax * distance * 0.3;
      const fz = t.motor.z + pz * s * distance - az * distance * 0.3;
      const i = this.game.nav.nearestWalkable(fx, fz, 6);
      if (i < 0) continue;
      const p = this.game.nav.point(i);
      const path = this.game.nav.findPath(e.motor.x, e.motor.z, p.x, p.z, 5000);
      if (path) { this.flank = p; this.path = path; this.pathIndex = 0; this.pathGoal = { x: p.x, z: p.z }; return; }
    }
    this.flank = null;
  }

  doFlank() {
    this.fireAllowed = this.targetVisible;
    if (!this.flank) { this.state = S.ENGAGE; return; }
    this.moveGoal = this.flank;
    this.moveSpeed = 'sprint';
    if (this.reached(this.flank, 1.5) || this.stateTime > 16) {
      this.flank = null;
      this.state = S.ENGAGE;
      this.stateTime = 0;
      this.game.releaseFlank(this.e);
    }
  }

  enterSearch() {
    this.searchDone = false;
    const lk = this.lastKnown;
    if (!lk) { this.searchDone = true; return; }
    const px = lk.x + clamp(this.lastKnownVel.x * 1.5, -6, 6), pz = lk.z + clamp(this.lastKnownVel.z * 1.5, -6, 6);
    this.searchPoints = [{ x: px, z: pz }];
    for (let i = 0; i < 2; i++) {
      const p = this.game.nav.randomPoint(this.rng, px, pz, 10);
      if (p) this.searchPoints.push({ x: p.x, z: p.z });
    }
    this.searchIndex = 0;
    this.holdUntil = this.now + (this.d.aggression < 0.35 ? 2 + this.rng() * 2 : this.d.aggression < 0.65 ? 0.5 + this.rng() : 0);
    this.lookUntil = 0;
  }

  doSearch() {
    this.fireAllowed = true;
    this.aimWanted = true;
    if (!this.searchPoints || this.stateTime > 22) { this.searchDone = true; this.forgetTarget(); return; }
    if (this.now < this.holdUntil && this.lastKnown) {
      this.lookPoint = { x: this.lastKnown.x, y: this.lastKnown.y + 1.4, z: this.lastKnown.z };
      return;
    }
    if (this.searchIndex >= this.searchPoints.length) { this.searchDone = true; this.forgetTarget(); return; }
    const p = this.searchPoints[this.searchIndex];
    if (this.lookUntil > 0) {
      const yaw = this.aimYaw + 0.04;
      this.lookPoint = { x: this.e.motor.x - Math.sin(yaw) * 10, y: this.e.motor.y + 1.5, z: this.e.motor.z - Math.cos(yaw) * 10 };
      if (this.now > this.lookUntil) { this.lookUntil = 0; this.searchIndex++; }
      return;
    }
    this.moveGoal = p;
    this.moveSpeed = this.searchIndex === 0 ? 'run' : 'walk';
    this.lookPoint = { x: p.x, y: this.e.motor.y + 1.4, z: p.z };
    if (this.reached(p, 1.5)) this.lookUntil = this.now + 1.2 + this.rng();
  }

  threatPosition() {
    if (this.target && this.now - this.lastSeen < 6) {
      return this.targetVisible ? { x: this.target.motor.x, y: this.target.motor.y, z: this.target.motor.z } : this.lastKnown;
    }
    if (this.threat && this.now - this.lastThreat < 6) return this.threat;
    return this.lastKnown;
  }

  reached(p, tolerance) {
    return dist2(this.e.motor.x, this.e.motor.z, p.x, p.z) <= tolerance;
  }

  // ============================================================================================
  // Steering: path following converted into local stick input
  // ============================================================================================
  steer(cmd, dt) {
    const e = this.e, m = e.motor;
    const goal = this.moveGoal;
    if (!goal) { this.path = null; return; }

    let tx = goal.x, tz = goal.z;
    if (!goal.direct) {
      const needPath = !this.path || !this.pathGoal || dist2(this.pathGoal.x, this.pathGoal.z, goal.x, goal.z) > 2 || this.now >= this.repathAt;
      if (needPath && this.now >= (this.nextPathAllowed || 0)) {
        this.path = this.game.nav.findPath(m.x, m.z, goal.x, goal.z);
        this.pathIndex = 0;
        this.pathGoal = { x: goal.x, z: goal.z };
        this.repathAt = this.now + 2.5 + this.rng();
        this.nextPathAllowed = this.now + 0.35;
        if (!this.path) {
          // Unreachable goal: drop it so the decision layer picks another.
          if (this.state === S.PATROL) this.goal = null;
          if (this.state === S.INVESTIGATE) { this.investigate = null; this.investigateDone = true; }
          return;
        }
      }
      if (!this.path) return;
      while (this.pathIndex < this.path.length - 1 && dist2(m.x, m.z, this.path[this.pathIndex].x, this.path[this.pathIndex].z) < 0.8) this.pathIndex++;
      const wp = this.path[this.pathIndex];
      if (!wp) return;
      tx = wp.x; tz = wp.z;
    } else if (!this.game.nav.isWalkable(tx, tz)) {
      // Direct strafe target off the mesh: try the opposite direction next time.
      this.strafeDir = -this.strafeDir;
      return;
    }

    const dx = tx - m.x, dz = tz - m.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) return;
    const wx = dx / dist, wz = dz / dist;

    // When sprinting with nothing to shoot, look where we run (sprint only works forward).
    const sprint = this.moveSpeed === 'sprint' && !this.targetVisible && !this.crouch;
    if (sprint || (!this.targetVisible && !this.lookPoint)) {
      const desired = Math.atan2(-wx, -wz);
      this.aimYaw = moveTowardsAngle(this.aimYaw, desired, this.d.tracking * 0.7 * DEG * dt);
      this.aimPitch = moveTowardsAngle(this.aimPitch, 0, 2 * dt);
    }

    const sy = Math.sin(this.aimYaw), cy = Math.cos(this.aimYaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    let mz = wx * -sy + wz * -cy;
    let mx = wx * cy + wz * -sy;
    const scale = this.moveSpeed === 'walk' ? 0.6 : 1;
    cmd.mx = mx * scale;
    cmd.mz = mz * scale;
    if (sprint && mz > 0.6) cmd.b |= BTN.SPRINT;

    // Stuck detection: jump and re-path.
    if (this.now - this.stuckCheck.t > 1.2) {
      const moved = dist2(m.x, m.z, this.stuckCheck.x, this.stuckCheck.z);
      if (moved < 0.35 && dist > 1) {
        this.jumpNext = true;
        this.path = null;
        this.repathAt = 0;
        if (this.state === S.PATROL && this.rng() < 0.4) this.goal = null;
      }
      this.stuckCheck = { x: m.x, z: m.z, t: this.now };
    }
    if (this.jumpNext) { cmd.b |= BTN.JUMP; this.jumpNext = false; }
  }

  // ============================================================================================
  // Aim and trigger discipline
  // ============================================================================================
  updateAim(dt) {
    const e = this.e, d = this.d, m = e.motor;
    const eyeY = m.y + eyeHeightOf(m);
    const speed = d.tracking * DEG * dt;
    if (this.targetVisible && this.target) {
      const t = this.target, tm = t.motor;
      if (this.trackId !== t.id) { this.trackId = t.id; this.trackStart = this.now; this.nextErr = 0; }
      const dist = dist3(m.x, eyeY, m.z, tm.x, tm.y + 1.2, tm.z);
      if (this.now >= this.nextErr) {
        this.nextErr = this.now + 0.25 + this.rng() * 0.35;
        this.headAim = this.rng() < d.headshot;
        const settle = clamp((this.now - this.trackStart) / d.settle, 0, 1);
        const situational = 1 + Math.hypot(tm.vx, tm.vz) / 6 + Math.hypot(m.vx, m.vz) / 8 + this.suppression * 1.2 - (this.crouch ? 0.15 : 0);
        const base = d.maxError + (d.maxError * 0.06 - d.maxError) * d.accuracy;
        const errDeg = (base * 2.2 + (base - base * 2.2) * settle) * Math.max(0.1, situational);
        const meters = Math.tan(errDeg * DEG) * dist;
        let rx = this.rng() * 2 - 1, ry = this.rng() * 2 - 1, rz = this.rng() * 2 - 1;
        const rl = Math.hypot(rx, ry, rz) || 1;
        const k = meters * this.rng() / rl;
        this.err = { x: rx * k, y: ry * k * 0.7, z: rz * k };
      }
      const eyeT = tm.y + eyeHeightOf(tm);
      // Ballistics: lead a moving target by the bullet's flight time and aim above for drop. Better bots do it better.
      const w = activeWeapon(e.ws);
      const tof = flightTime(w, dist);
      const lead = 0.35 + 0.65 * d.accuracy;
      const ax = tm.x + this.err.x + tm.vx * tof * lead;
      const ay = (this.headAim ? eyeT + 0.05 : tm.y + (eyeT - tm.y) * 0.72) + this.err.y + dropAt(w, dist) * (0.4 + 0.6 * d.accuracy);
      const az = tm.z + this.err.z + tm.vz * tof * lead;
      this.aimPoint = { x: ax, y: ay, z: az };
      const desired = anglesFromDir(ax - m.x, ay - eyeY, az - m.z);
      this.aimYaw = moveTowardsAngle(this.aimYaw, desired.yaw, speed);
      this.aimPitch = moveTowardsAngle(this.aimPitch, desired.pitch, speed);
      this.aimError = Math.abs(angleDiff(this.aimYaw, desired.yaw)) + Math.abs(angleDiff(this.aimPitch, desired.pitch));
      return;
    }
    this.trackId = -1;
    const look = this.lookPoint || (this.suppressive && this.lastKnown ? { x: this.lastKnown.x, y: this.lastKnown.y + 1.3, z: this.lastKnown.z } : null);
    if (look) {
      const desired = anglesFromDir(look.x - m.x, look.y - eyeY, look.z - m.z);
      this.aimYaw = moveTowardsAngle(this.aimYaw, desired.yaw, speed * 0.6);
      this.aimPitch = moveTowardsAngle(this.aimPitch, desired.pitch, speed * 0.6);
      this.aimError = Math.abs(angleDiff(this.aimYaw, desired.yaw)) + Math.abs(angleDiff(this.aimPitch, desired.pitch));
    }
  }

  trigger(cmd) {
    const e = this.e, d = this.d;
    const ws = e.ws;
    const slot = ws.slots[ws.active];
    if (!slot || ws.reloading || !this.fireAllowed) { this.triggerToggle = false; return; }
    const w = WEAPONS[slot.id];
    const visibleShot = this.targetVisible && this.target && this.now - this.acquired >= d.reaction;
    const suppressShot = !this.targetVisible && this.suppressive;
    if (!visibleShot && !suppressShot) { this.triggerToggle = false; return; }
    if (slot.mag === 0) { this.reloadWanted = true; return; }
    if (this.now < this.nextBurst) { this.triggerToggle = false; return; }

    const m = e.motor;
    const target = this.aimPoint || this.lastKnown;
    if (!target) return;
    const dist = Math.max(1, dist3(m.x, m.y + 1.5, m.z, target.x, target.y || m.y, target.z));
    const tolerance = Math.max(1.2 * DEG, Math.atan2(0.45, dist)) * 2.5;
    if ((this.aimError || 0) > tolerance * (suppressShot ? 3 : 1)) { this.triggerToggle = false; return; }
    if (w.id === 'sniper' && this.now - this.trackStart < d.settle * 0.8) return;

    if (this.burstLeft <= 0) {
      this.burstLeft = w.mode === 'auto' ? Math.round(d.burst[0] + this.rng() * (d.burst[1] - d.burst[0])) : 1 + Math.floor(this.rng() * 3);
      if (suppressShot) this.burstLeft = Math.min(this.burstLeft, 3);
    }

    if (w.mode === 'auto') {
      cmd.b |= BTN.FIRE;
      if (this.lastShotSeen !== ws.lastShot) {
        this.lastShotSeen = ws.lastShot;
        this.burstLeft--;
        if (this.burstLeft <= 0) this.nextBurst = this.now + (d.pause[0] + this.rng() * (d.pause[1] - d.pause[0])) * (1.3 - 0.6 * d.aggression);
      }
    } else {
      // Semi-automatic: release and press again (edge triggered).
      this.triggerToggle = !this.triggerToggle;
      if (this.triggerToggle) {
        cmd.b |= BTN.FIRE;
        this.burstLeft--;
        const extra = w.id === 'sniper' ? 0.6 : 0.08 + this.rng() * 0.22;
        this.nextBurst = this.now + extra * (1.4 - 0.8 * d.aggression) + (this.burstLeft <= 0 ? d.pause[0] : 0);
      }
    }
  }
}

export { S as BOT_STATES, MOVE as BOT_MOVE, distToSegment };
