// Client game session: input -> fixed-rate commands with client-side prediction, server reconciliation,
// snapshot interpolation of remote players/bots, effects, audio, HUD and camera.
import * as THREE from 'three';
import { BTN, TEAM } from '../shared/constants.js';
import { buildMap } from '../shared/map.js';
import { DEG, clamp, dirFromAngles, lerp, lerpAngle, rayBox, raySphere } from '../shared/math.js';
import { MODE_LIST } from '../shared/modes.js';
import { eyeHeightOf } from '../shared/movement.js';
import { createActor, hitboxesAt, stepCommand, unpackActor } from '../shared/sim.js';
import { WEAPONS, activeWeapon, currentSpread, spreadDirection } from '../shared/weapons.js';
import { World } from '../shared/world.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { GameRenderer } from './renderer.js';
import { onSettingsChanged, saveSettings, settings } from './settings.js';
import { TeamPalette } from './teamcolors.js';
import { TouchControls, enterMobileFullscreen, touchControlsWanted } from './touch.js';

const CMD_DT = 1 / 60;
const TOUCH_LOOK = 0.0058;          // radians per CSS pixel of finger drag at sensitivity 1
const ASSIST_CONE = 4.5 * Math.PI / 180;

export class ClientSession {
  constructor({ transport, welcome, canvas, hudRoot, audio, onExit }) {
    this.transport = transport;
    this.audio = audio;
    this.onExit = onExit;
    this.myId = welcome.id;
    this.modeId = welcome.mode;
    this.modeInfo = MODE_LIST.find((m) => m.id === welcome.mode) || MODE_LIST[0];
    this.teams = this.modeInfo.teams;
    this.config = welcome.cfg;
    this.offline = transport.offline;
    this.isHost = !this.offline && !!transport.isHost;
    this.roomCode = transport.code || '';
    this.interpDelay = this.offline ? 0.07 : 0.1;
    this.lastSnapT = -Infinity;
    this.exitReason = '';

    this.map = buildMap(welcome.map);
    this.world = new World(this.map.boxes, this.map.half + 2);
    for (const z of this.map.zones) z.y = this.world.surfaceHeight(z.x, z.z, 3);

    this.renderer = new GameRenderer(canvas);
    this.renderer.loadMap(this.map, this.modeId === 'dom');
    this.input = new Input(canvas);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.palette = new TeamPalette();
    this.renderer.teamColor = (team) => this.palette.team(team);
    this.losCache = new Map();
    this.crosshairAlly = null;
    this.hud = new Hud(hudRoot, {
      palette: this.palette,
      map: this.map,
      modeId: this.modeId,
      online: !this.offline,
      isHost: this.isHost,
      roomCode: this.roomCode,
      onLeave: () => this.leave(),
      onResume: () => this.resume(),
      onPlayAgain: () => this.playAgain(),
      onChat: (text) => this.transport.send({ type: 'chat', text }),
      onLoadout: (primary) => this.transport.send({ type: 'loadout', primary }),
    });
    this.touchUI = new TouchControls(hudRoot, this.input, {
      onPause: () => { if (!this.paused) this.input.releaseLock(); },
      onScoreboard: () => {},
    });
    this.touchUI.setEnabled(touchControlsWanted());
    // "Auto" touch mode follows the last thing the player used: a finger or a mouse.
    this._pointerKind = (e) => {
      if (settings.touchControls !== 'auto') return;
      if (e.pointerType === 'touch') this.touchUI.setEnabled(true);
      else if (e.pointerType === 'mouse') this.touchUI.setEnabled(false);
    };
    window.addEventListener('pointerdown', this._pointerKind, true);
    this.crosshairTarget = false;

    this.actor = createActor(0, 0, 0, 0, [settings.primary, 'pistol']);
    this.actor.id = this.myId;
    this.actor.alive = false;
    this.scratch = createActor(0, 0, 0, 0, ['rifle', 'pistol']);
    this.pending = [];
    this.seq = 0;
    this.cmdAccumulator = 0;
    this.viewYaw = 0;
    this.viewPitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.snapYaw = true;
    this.myTeam = TEAM.NONE;
    this.hp = 100;
    this.prevPos = new THREE.Vector3();
    this.currPos = new THREE.Vector3();
    this.correction = new THREE.Vector3();
    this.lastStepTime = performance.now();
    this.roster = new Map();
    this.scores = new Map();
    this.snapshots = [];
    this.renderPoses = new Map();
    this.lastFireSeen = new Map();
    this.strides = new Map();
    this.serverOffset = null;
    this.serverTime = 0;
    this.modeState = null;
    this.phase = 'warmup';
    this.ended = false;
    this.rtt = 0;
    this.pingTimer = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.lookDX = 0; this.lookDY = 0;
    this.shake = 0;
    this.deathCam = 0;
    this.running = true;
    this.paused = true;
    this.tmpV = new THREE.Vector3();
    this.unsubscribeSettings = onSettingsChanged(() => {
      this.renderer.camera.fov = settings.fov;
      this.renderer.applyPixelRatio();
      if (this.touchUI) this.touchUI.refresh();
      if (this.hud) this.hud.applySettings();
    });

    this.applyRoster(welcome.roster);
    this.transport.setHandler((msg) => this.onMessage(msg));
    this.hud.showPause(true);
    this.hud.el.pause.querySelector('h2').textContent = this.touchUI.enabled ? 'TAP RESUME TO DEPLOY' : 'CLICK RESUME TO DEPLOY';
    this.lastFrame = performance.now();
    this.frameHandle = requestAnimationFrame((t) => this.frame(t));
  }

  // ==============================================================================================
  // Messages
  // ==============================================================================================
  onMessage(msg) {
    switch (msg.type) {
      case 'snap': return this.onSnapshot(msg);
      case 'ev': for (const ev of msg.l) this.onEvent(ev); return undefined;
      case 'roster': return this.applyRoster(msg.l);
      case 'scores':
        for (const [id, kills, deaths, score, tier, ping] of msg.l) this.scores.set(id, { kills, deaths, score, tier, ping });
        for (const [id, s] of this.scores) { const r = this.roster.get(id); if (r) r.tier = s.tier; }
        if (this.input.scoreboard) this.hud.showScoreboard(true, this.roster, this.scores, this.myId, this.teams);
        return undefined;
      case 'pong':
        this.rtt = Math.round(performance.now() - msg.t);
        return undefined;
      case 'restart':
        this.ended = false;
        this.hud.hideEnd();
        this.snapYaw = true;
        if (!this.input.locked) {
          this.hud.el.pause.querySelector('h2').textContent = 'NEXT MATCH — PRESS RESUME';
          this.hud.showPause(true);
        }
        return undefined;
      case 'kicked':
      case 'roomClosed':
        this.exitReason = msg.reason || 'The match was closed.';
        this.leave();
        return undefined;
      default:
        return undefined;
    }
  }

  applyRoster(list) {
    const seen = new Set();
    for (const [id, name, team, isBot] of list) {
      seen.add(id);
      const prev = this.roster.get(id);
      this.roster.set(id, { id, name, team, isBot: isBot === 1, tier: prev ? prev.tier : 0 });
      if (id === this.myId) this.myTeam = team;
    }
    for (const id of [...this.roster.keys()]) if (!seen.has(id)) { this.roster.delete(id); this.renderer.removeCharacter(id); }
  }

  onSnapshot(snap) {
    // Snapshots travel on an unordered channel online: ignore any that arrive after a newer one.
    if (snap.t <= this.lastSnapT) return undefined;
    this.lastSnapT = snap.t;
    const now = performance.now() / 1000;
    const sample = snap.t - now;
    if (this.serverOffset === null) this.serverOffset = sample;
    else this.serverOffset += (sample - this.serverOffset) * (sample > this.serverOffset ? 0.3 : 0.05);

    const ents = new Map();
    for (const e of snap.e) ents.set(e[0], e);
    this.snapshots.push({ t: snap.t, ents });
    while (this.snapshots.length > 30) this.snapshots.shift();

    this.modeState = snap.m;
    if (snap.m.ph !== this.phase) {
      this.phase = snap.m.ph;
      if (this.phase === 'live' && this.ended) { this.ended = false; this.hud.hideEnd(); }
    }
    if (snap.m.res && !this.ended && snap.m.ph === 'ended') this.showEnd(snap.m.res[2], snap.m.res[0]);

    if (snap.you) this.reconcile(snap.you, snap.ack);
  }

  reconcile(you, ack) {
    const wasAlive = this.actor.alive;
    this.hp = you.hp;
    this.myTeam = you.tm;
    this.hud.setHealth(you.hp);
    this.hud.setProtected(you.pr === 1);
    const before = this.tmpV.set(this.actor.motor.x, this.actor.motor.y, this.actor.motor.z);
    const bx = before.x, by = before.y, bz = before.z;

    unpackActor(you.a, this.actor);
    this.actor.alive = you.al === 1;
    this.pending = this.pending.filter((c) => c.s > ack);
    if (this.actor.alive) {
      for (const cmd of this.pending) stepCommand(this.actor, cmd, this.world, null);
    }

    const m = this.actor.motor;
    const dx = m.x - bx, dy = m.y - by, dz = m.z - bz;
    const err = Math.hypot(dx, dy, dz);
    if (!wasAlive || !this.actor.alive || err > 2.5) {
      this.correction.set(0, 0, 0);
      this.prevPos.set(m.x, m.y, m.z);
      this.currPos.set(m.x, m.y, m.z);
    } else if (err > 0.0005) {
      this.correction.x -= dx; this.correction.y -= dy; this.correction.z -= dz;
      this.prevPos.x += dx; this.prevPos.y += dy; this.prevPos.z += dz;
      this.currPos.set(m.x, m.y, m.z);
    }

    if (this.actor.alive && (!wasAlive || this.snapYaw)) {
      this.viewYaw = m.yaw;
      this.viewPitch = 0;
      this.recoilPitch = 0; this.recoilYaw = 0;
      this.snapYaw = false;
      this.hud.hideDeath();
      this.input.resetToggles();
    }
    this.hud.setAmmo(this.actor.ws);
    if (!this.actor.ws.reloading) this.hud.hideReload();
    this.renderer.setViewWeapon(activeWeapon(this.actor.ws).id);
  }

  onEvent(ev) {
    switch (ev.type) {
      case 'shot': {
        if (ev.s === this.myId) return;
        this.lastFireSeen.set(ev.s, performance.now());
        const origin = { x: ev.o[0], y: ev.o[1], z: ev.o[2] };
        const muzzle = this.renderer.characterMuzzle(ev.s, this.tmpV) || this.tmpV.set(origin.x, origin.y, origin.z);
        const from = { x: muzzle.x, y: muzzle.y, z: muzzle.z };
        const w = WEAPONS[ev.w] || WEAPONS.rifle;
        ev.p.forEach((p, i) => {
          const shooter = this.roster.get(ev.s);
          if (ev.p.length === 1 || i % 2 === 0) this.renderer.tracer(from, p, this.palette.tracer(ev.s, shooter ? shooter.team : TEAM.NONE));
          if (p[6] !== 2) this.renderer.impact(p, p[6] === 1);
        });
        this.renderer.muzzleLight(this.tmpV.set(from.x, from.y, from.z));
        this.audio.gunshot(w.id, origin, false);
        return;
      }
      case 'hit':
        this.hud.hitmarker(ev.hs === 1, ev.k === 1);
        if (ev.k) this.audio.kill(); else this.audio.hit(ev.hs === 1);
        this.vibrate(ev.k ? 45 : 12);
        return;
      case 'dmg': {
        const m = this.actor.motor;
        const toSource = Math.atan2(-(ev.f[0] - m.x), -(ev.f[2] - m.z));
        this.hud.damageIndicator(this.viewYaw - toSource);
        this.audio.hurt();
        this.vibrate(35);
        if (settings.cameraBob) this.shake = Math.min(1.2, this.shake + ev.d / 40);
        return;
      }
      case 'kill': {
        const killer = this.roster.get(ev.k), victim = this.roster.get(ev.v);
        this.hud.killfeed(killer ? killer.name : '', victim ? victim.name : '?', ev.w, ev.hs === 1,
          this.palette.entity(ev.k, killer ? killer.team : TEAM.NONE), this.palette.entity(ev.v, victim ? victim.team : TEAM.NONE), ev.k === this.myId || ev.v === this.myId);
        if (ev.k === this.myId && ev.v !== this.myId) this.hud.streak(ev.st);
        return;
      }
      case 'died': {
        const killer = this.roster.get(ev.by);
        this.hud.showDeath(killer && ev.by !== this.myId ? killer.name : '', ev.w, ev.ra);
        this.vibrate([70, 50, 70]);
        this.deathCam = 0;
        this.deathFocus = ev.by;
        return;
      }
      case 'spawn':
        this.snapYaw = true;
        this.hud.hideDeath();
        return;
      case 'ann':
        this.hud.announce(ev.text, ev.team);
        this.audio.announce();
        return;
      case 'zone':
        this.audio.capture();
        return;
      case 'end':
        this.showEnd(ev.text, ev.team);
        return;
      case 'chat': {
        const r = this.roster.get(ev.id);
        this.hud.chatMessage(r ? r.name : '?', ev.text, r ? r.team : TEAM.NONE);
        return;
      }
      case 'rl':
        return;
      default:
        return;
    }
  }

  showEnd(text, team) {
    if (this.ended) return;
    this.ended = true;
    this.input.releaseLock();
    this.hud.showPause(false);
    this.hud.showEnd(text, team, this.roster, this.scores, this.myId, this.teams, this.offline);
  }

  // ==============================================================================================
  // Lock / pause
  // ==============================================================================================
  onLockChange(locked) {
    this.paused = !locked;
    if (!locked) this.touchUI.releaseAll();
    if (locked) {
      this.hud.showPause(false);
      this.audio.ensure();
    } else if (!this.ended && !this.hud.chatOpen) {
      this.hud.el.pause.querySelector('h2').textContent = 'PAUSED';
      this.hud.showPause(true);
    }
  }

  resume() {
    this.audio.ensure();
    if (this.touchUI.enabled) enterMobileFullscreen();
    this.input.requestLock();
  }

  playAgain() {
    if (this.offline && this.transport.restart) {
      this.transport.restart();
      this.ended = false;
      this.hud.hideEnd();
      this.resume();
    }
  }

  leave() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('pointerdown', this._pointerKind, true);
    this.touchUI.dispose();
    this.input.dispose();
    this.unsubscribeSettings();
    this.hud.destroy();
    this.renderer.dispose();
    this.transport.close();
    if (this.onExit) this.onExit(this.transport, this.exitReason);
  }

  // ==============================================================================================
  // Frame
  // ==============================================================================================
  frame(t) {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000);
    this.lastFrame = t;

    // Offline: advance the in-browser authoritative host first.
    this.transport.update(dt);
    if (!this.running) return;

    this.palette.setContext(this.myId, this.myTeam, this.teams);
    const wantTarget = (this.touchUI.enabled && (settings.aimAssist || settings.autoFire !== 'off')) || settings.crosshairTargetColor;
    this.crosshairAlly = null;
    this.crosshairTarget = wantTarget && !this.paused && this.actor.alive ? this.findCrosshairTarget() : 0;
    this.hud.setCrosshairTarget(
      settings.crosshairTargetColor ? (this.crosshairTarget === 2 ? 'enemy' : this.crosshairAlly ? 'ally' : null) : null,
      this.crosshairAlly,
    );
    this.updateLook(dt);
    this.touchUI.update({ autoFiring: this.crosshairTarget === 2 && this.autoFireAllowed() });
    if (!this.paused && this.input.consume('chat')) {
      this.input.releaseLock();
      this.hud.openChat();
    }

    // Fixed-rate command generation (60 Hz) with prediction.
    this.cmdAccumulator += dt;
    const batch = [];
    let steps = 0;
    while (this.cmdAccumulator >= CMD_DT && steps < 6) {
      this.cmdAccumulator -= CMD_DT;
      steps++;
      const cmd = this.buildCommand();
      this.prevPos.set(this.actor.motor.x, this.actor.motor.y, this.actor.motor.z);
      if (this.actor.alive) stepCommand(this.actor, cmd, this.world, this.predictionHooks());
      else stepCommand(this.actor, cmd, this.world, null);
      this.currPos.set(this.actor.motor.x, this.actor.motor.y, this.actor.motor.z);
      this.lastStepTime = t;
      this.pending.push(cmd);
      batch.push(cmd);
    }
    if (this.pending.length > 240) this.pending.splice(0, this.pending.length - 240);
    if (batch.length) this.transport.send({ type: 'cmds', c: batch });

    this.pingTimer += dt;
    if (!this.offline && this.pingTimer > 2) {
      this.pingTimer = 0;
      this.transport.send({ type: 'ping', t: performance.now(), rtt: this.rtt });
    }

    this.updateRemote(dt);
    this.updateCamera(dt, t);
    this.updateHud(dt);
    this.renderer.updateEffects();
    this.renderer.render();

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime > 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0; this.fpsTime = 0;
      const net = this.offline ? ' · OFFLINE' : this.isHost ? ` · HOSTING · ROOM ${this.roomCode}` : ` · ${this.rtt} ms · ROOM ${this.roomCode}`;
      this.hud.setNetStats(`${this.fps} FPS${net}`);
    }
  }

  updateLook(dt) {
    const look = this.input.consumeLook();
    if (this.paused) { this.lookDX = 0; this.lookDY = 0; return; }
    const w = activeWeapon(this.actor.ws);
    const aim = this.actor.aim01;
    const zoom = aim > 0.01 ? lerp(1, (w.adsFov / settings.fov) * settings.adsSensitivity / 0.8, aim) : 1;
    const k = 0.0022 * settings.sensitivity * zoom;
    this.viewYaw -= look.x * k;
    this.viewPitch += look.y * k * (settings.invertY ? 1 : -1);
    this.viewPitch = clamp(this.viewPitch, -1.5, 1.5);
    // Touch look: finger drag, slowed while the crosshair is on an enemy (aim assist).
    const touch = this.input.consumeTouchLook();
    if (touch.x || touch.y) {
      const assist = settings.aimAssist && this.crosshairTarget ? 0.45 : 1;
      const touchZoom = aim > 0.01 ? lerp(1, (w.adsFov / settings.fov) * settings.touchAdsSensitivity / 0.8, aim) : 1;
      const kt = TOUCH_LOOK * settings.touchSensitivity * touchZoom * assist;
      this.viewYaw -= touch.x * kt;
      this.viewPitch = clamp(this.viewPitch + touch.y * kt * (settings.invertY ? 1 : -1), -1.5, 1.5);
    }
    this.lookDX = look.x + touch.x * 2; this.lookDY = look.y + touch.y * 2;
    // Recoverable recoil returns smoothly.
    const recover = Math.min(1, dt * 9);
    this.recoilPitch -= this.recoilPitch * recover;
    this.recoilYaw -= this.recoilYaw * recover;
  }

  buildCommand() {
    const input = this.input;
    const active = !this.paused && !this.ended && !this.hud.chatOpen;
    let sw = -1;
    if (active) {
      const slot = input.consume('slot');
      const cycle = input.consume('cycle');
      const n = this.actor.ws.slots.length;
      if (slot >= 0 && slot < n) sw = slot;
      else if (cycle !== 0 && n > 1) sw = (this.actor.ws.active + cycle + n) % n;
    }
    // Touch auto-fire: shoot while an enemy is in the crosshair (semi-auto guns get a pulsed trigger).
    if (active && this.touchUI.enabled && this.crosshairTarget === 2 && this.autoFireAllowed()) {
      const w = activeWeapon(this.actor.ws);
      input.touch.autoFire = w.mode === 'auto' || Math.floor(this.seq / 4) % 2 === 0;
    } else {
      input.touch.autoFire = false;
    }
    return {
      s: ++this.seq,
      dt: CMD_DT,
      mx: active ? input.moveX : 0,
      mz: active ? input.moveZ : 0,
      yaw: this.viewYaw + this.recoilYaw,
      pitch: clamp(this.viewPitch + this.recoilPitch, -1.5, 1.5),
      b: active ? input.buildButtons() : 0,
      sw,
      r: active ? input.consume('reload') : false,
      vt: this.estimatedServerTime() - this.interpDelay,
    };
  }

  /** Is this enemy visible from the camera (not behind a wall)? Re-checked about 8 times a second per enemy. */
  enemyInSight(id, pose) {
    if (!pose.alive || !this.actor.alive) return false;
    const now = performance.now();
    const cached = this.losCache.get(id);
    if (cached && now - cached.t < 120) return cached.v;
    const m = this.actor.motor;
    const ox = m.x, oy = m.y + eyeHeightOf(m), oz = m.z;
    let visible = false;
    for (const h of [1.55 - 0.5 * pose.crouch, 1.0 - 0.3 * pose.crouch]) { // head, then chest
      const dx = pose.x - ox, dy = pose.y + h - oy, dz = pose.z - oz;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 160) break;
      const wall = this.world.raycast(ox, oy, oz, dx / dist, dy / dist, dz / dist, dist);
      if (!wall || wall.t >= dist - 0.3) { visible = true; break; }
    }
    this.losCache.set(id, { t: now - (id % 5) * 15, v: visible });
    return visible;
  }

  /** Auto-fire setting: 'off', 'hip' (never while aiming down sights) or 'always'. */
  autoFireAllowed() {
    const mode = settings.autoFire;
    if (mode === 'always') return true;
    if (mode === 'hip') return !this.input.aim;
    return false;
  }

  /** Short vibration on phones that support it (Android), if enabled. */
  vibrate(pattern) {
    if (!this.touchUI.enabled || !settings.vibration || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }

  /**
   * What is under the crosshair: 0 nothing, 1 an enemy close to it (aim assist), 2 an enemy directly in it
   * and in range with a clear line of sight (auto-fire). Also sets this.crosshairAlly to the name of a
   * teammate directly under the crosshair, if any.
   */
  findCrosshairTarget() {
    const m = this.actor.motor;
    const yaw = this.viewYaw + this.recoilYaw;
    const pitch = clamp(this.viewPitch + this.recoilPitch, -1.5, 1.5);
    const dir = dirFromAngles(yaw, pitch);
    const ox = m.x, oy = m.y + eyeHeightOf(m), oz = m.z;
    const w = activeWeapon(this.actor.ws);
    const range = Math.min(w.range, 120);
    const hb = this.tmpHitbox || (this.tmpHitbox = {});
    let result = 0;
    let allyDist = Infinity;
    for (const [id, pose] of this.renderPoses) {
      if (!pose.alive || id === this.myId) continue;
      const r = this.roster.get(id);
      const ally = this.teams && r && r.team === this.myTeam;
      hitboxesAt(pose.x, pose.y, pose.z, pose.crouch, hb);
      const cx = (hb.minx + hb.maxx) / 2 - ox, cy = (hb.miny + hb.maxy) / 2 - oy, cz = (hb.minz + hb.maxz) / 2 - oz;
      const dist = Math.hypot(cx, cy, cz);
      if (dist > range || dist < 0.5) continue;
      const cos = (cx * dir.x + cy * dir.y + cz * dir.z) / dist;
      const cone = ASSIST_CONE + Math.atan(0.6 / dist); // wider for close targets
      if (cos < Math.cos(cone)) continue;
      // Direct hit test along the crosshair, then line of sight to the target.
      let t = raySphere(ox, oy, oz, dir.x, dir.y, dir.z, hb.hx, hb.hy, hb.hz, hb.hr);
      const tb = rayBox(ox, oy, oz, dir.x, dir.y, dir.z, hb.minx, hb.miny, hb.minz, hb.maxx, hb.maxy, hb.maxz, range, null);
      if (tb >= 0 && (t < 0 || tb < t)) t = tb;
      const probe = t >= 0 ? t : dist;
      const pdx = t >= 0 ? dir.x : cx / dist, pdy = t >= 0 ? dir.y : cy / dist, pdz = t >= 0 ? dir.z : cz / dist;
      const wall = this.world.raycast(ox, oy, oz, pdx, pdy, pdz, probe);
      if (wall && wall.t < probe - 0.05) continue;
      if (ally) {
        // A teammate directly under the crosshair: remembered for the "friendly" crosshair and name tag.
        if (t >= 0 && t < allyDist) { allyDist = t; this.crosshairAlly = r.name; }
        continue;
      }
      if (t >= 0) result = 2;
      else if (result < 1) result = 1;
    }
    return result;
  }

  estimatedServerTime() {
    return performance.now() / 1000 + (this.serverOffset || 0);
  }

  predictionHooks() {
    if (this._hooks) return this._hooks;
    this._hooks = {
      onShot: (actor, shot) => this.onLocalShot(actor, shot),
      onNoise: (actor, radius, kind) => { if (kind === 'step') this.audio.footstep(null, actor.motor.crouching ? 0.06 : actor.motor.sprinting ? 0.22 : 0.14); },
      onReload: (_actor, duration) => { this.hud.showReload(duration); this.renderer.viewModelReload(duration); this.audio.reload(); },
      onReloadDone: () => { this.audio.reloadDone(); this.hud.hideReload(); },
      onDryFire: () => this.audio.dryFire(),
      onSwitch: () => { this.hud.hideReload(); this.renderer.setViewWeapon(activeWeapon(this.actor.ws).id); },
    };
    return this._hooks;
  }

  onLocalShot(actor, shot) {
    const w = shot.weapon;
    // Recoil (view punch carried into following commands).
    const aimMul = lerp(1, 0.65, actor.aim01);
    const kick = (w.recoil[0] + Math.random() * (w.recoil[1] - w.recoil[0])) * DEG * aimMul;
    this.recoilPitch += kick * 0.35;
    this.viewPitch = clamp(this.viewPitch + kick * 0.65, -1.5, 1.5);
    const h = (Math.random() * 2 - 1) * w.recoilH * DEG * aimMul;
    this.recoilYaw += h * 0.4;
    this.viewYaw += h * 0.6;

    this.renderer.viewModelFire();
    this.audio.gunshot(w.id, null, true);
    const muzzle = this.renderer.muzzleWorldPosition(new THREE.Vector3());
    this.renderer.muzzleLight(muzzle);

    // Cosmetic predicted hits against what this client sees.
    const dir = { x: 0, y: 0, z: 0 };
    const hb = {};
    const pellets = Math.max(1, w.pellets);
    for (let p = 0; p < pellets; p++) {
      spreadDirection(shot.dx, shot.dy, shot.dz, shot.spread, shot.seed, p, dir);
      const wh = this.world.raycast(shot.ox, shot.oy, shot.oz, dir.x, dir.y, dir.z, w.range);
      let best = wh ? wh.t : w.range;
      let char = false;
      for (const [id, pose] of this.renderPoses) {
        if (!pose.alive || id === this.myId) continue;
        const r = this.roster.get(id);
        if (this.teams && r && r.team === this.myTeam) continue;
        hitboxesAt(pose.x, pose.y, pose.z, pose.crouch, hb);
        const th = raySphere(shot.ox, shot.oy, shot.oz, dir.x, dir.y, dir.z, hb.hx, hb.hy, hb.hz, hb.hr);
        if (th >= 0 && th < best) { best = th; char = true; }
        const tb = rayBox(shot.ox, shot.oy, shot.oz, dir.x, dir.y, dir.z, hb.minx, hb.miny, hb.minz, hb.maxx, hb.maxy, hb.maxz, best, null);
        if (tb >= 0 && tb < best) { best = tb; char = true; }
      }
      const point = [shot.ox + dir.x * best, shot.oy + dir.y * best, shot.oz + dir.z * best, wh ? wh.nx : 0, wh ? wh.ny : 1, wh ? wh.nz : 0];
      if (pellets === 1 || p % 2 === 0) this.renderer.tracer(muzzle, point, 0xfff0b0);
      if (char || wh) this.renderer.impact(point, char);
    }
  }

  // ==============================================================================================
  // Remote entities
  // ==============================================================================================
  updateRemote(dt) {
    const renderTime = this.estimatedServerTime() - this.interpDelay;
    const snaps = this.snapshots;
    this.renderPoses.clear();
    if (snaps.length === 0) return;
    let a = snaps[0], b = snaps[0];
    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i].t <= renderTime) { a = snaps[i]; b = snaps[i + 1] || snaps[i]; } else break;
    }
    const span = b.t - a.t;
    const f = span > 1e-4 ? clamp((renderTime - a.t) / span, 0, 1) : 1;
    const live = new Set();
    for (const [id, eb] of b.ents) {
      const ea = a.ents.get(id) || eb;
      const info = this.roster.get(id);
      if (!info) continue;
      live.add(id);
      const pose = {
        x: lerp(ea[1], eb[1], f), y: lerp(ea[2], eb[2], f), z: lerp(ea[3], eb[3], f),
        yaw: lerpAngle(ea[4], eb[4], f), pitch: lerp(ea[5], eb[5], f), crouch: lerp(ea[6], eb[6], f),
        alive: (eb[7] & 1) === 1, sprint: (eb[7] & 2) !== 0, weapon: eb[8], hp: eb[9],
      };
      this.renderPoses.set(id, pose);
      const ally = this.palette.isAlly(id, info.team);
      const color = this.palette.entity(id, info.team);
      const label = ally && settings.allyMarkers ? info.name : null;
      const marker = ally ? settings.allyMarkers : settings.enemyMarkers && this.enemyInSight(id, pose);
      const speed = this.renderer.syncCharacter(id, { team: info.team, weapon: pose.weapon, color, ally, outline: settings.outlines }, pose, dt, label, color, marker);
      // Remote footsteps.
      if (pose.alive && speed > 1.2) {
        const stride = (this.strides.get(id) || 0) + speed * dt;
        if (stride > (pose.sprint ? 2.6 : 2.0)) {
          this.strides.set(id, 0);
          this.audio.footstep({ x: pose.x, y: pose.y, z: pose.z }, pose.crouch > 0.5 ? 0.12 : 0.35);
        } else this.strides.set(id, stride);
      }
    }
    this.renderer.pruneCharacters(live);
  }

  // ==============================================================================================
  // Camera & HUD
  // ==============================================================================================
  updateCamera(dt, t) {
    const cam = this.renderer.camera;
    const m = this.actor.motor;
    const alpha = clamp((t - this.lastStepTime) / (CMD_DT * 1000), 0, 1);
    const decay = Math.exp(-14 * dt);
    this.correction.multiplyScalar(decay);
    const px = lerp(this.prevPos.x, this.currPos.x, alpha) + this.correction.x;
    const py = lerp(this.prevPos.y, this.currPos.y, alpha) + this.correction.y;
    const pz = lerp(this.prevPos.z, this.currPos.z, alpha) + this.correction.z;

    const w = activeWeapon(this.actor.ws);
    const speed = Math.hypot(m.vx, m.vz);
    let fov = settings.fov + (m.sprinting && speed > 1 ? 6 : 0);
    fov = lerp(fov, w.adsFov * (settings.fov / 80), this.actor.aim01);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 14);
    cam.updateProjectionMatrix();

    this.shake = Math.max(0, this.shake - dt * 4);
    const shakeX = (Math.random() - 0.5) * this.shake * 0.02, shakeY = (Math.random() - 0.5) * this.shake * 0.02;
    cam.rotation.order = 'YXZ';

    if (this.actor.alive) {
      const bob = m.grounded && settings.cameraBob ? Math.sin(t * 0.012 * (1 + speed * 0.15)) * Math.min(1, speed / 7) * 0.03 * (1 - this.actor.aim01 * 0.85) : 0;
      cam.position.set(px, py + eyeHeightOf(m) + Math.abs(bob), pz);
      cam.rotation.set(clamp(this.viewPitch + this.recoilPitch, -1.5, 1.5) + shakeY, this.viewYaw + this.recoilYaw + shakeX, 0);
    } else {
      // Death cam: orbit above the body, looking at the killer if visible.
      this.deathCam = Math.min(1, this.deathCam + dt * 1.5);
      const focus = this.renderPoses && this.renderPoses.get(this.deathFocus);
      const tx = focus ? focus.x : m.x, tz = focus ? focus.z : m.z;
      const yaw = focus && Math.hypot(tx - m.x, tz - m.z) > 0.5 ? Math.atan2(-(tx - m.x), -(tz - m.z)) : this.viewYaw;
      const back = dirFromAngles(yaw, 0);
      cam.position.set(m.x - back.x * 3.5 * this.deathCam, m.y + 1.6 + 2.6 * this.deathCam, m.z - back.z * 3.5 * this.deathCam);
      cam.rotation.set(-0.45 * this.deathCam, yaw, 0);
    }

    this.renderer.vmCamera.fov = 58;
    this.renderer.updateViewModel(dt, {
      lookDX: this.lookDX, lookDY: this.lookDY, speed: m.grounded ? speed : 0, sprinting: m.sprinting && speed > 1,
      aim: this.actor.aim01, reloading: this.actor.ws.reloading, alive: this.actor.alive && !this.ended,
    });
    const forward = dirFromAngles(this.viewYaw, this.viewPitch);
    this.audio.setListener(cam.position, forward);
  }

  updateHud() {
    const m = this.actor.motor;
    const ws = this.actor.ws;
    const w = activeWeapon(ws);
    const speed01 = clamp(Math.hypot(m.vx, m.vz) / 4.8, 0, 1.5);
    const spread = currentSpread(ws, speed01, m.grounded, m.crouch > 0.5, this.actor.aim01);
    const cam = this.renderer.camera;
    const px = Math.tan((spread * 0.5) * DEG) / Math.tan((cam.fov * 0.5) * DEG) * (window.innerHeight / 2);
    const visible = this.actor.alive && !(m.sprinting && Math.hypot(m.vx, m.vz) > 1) && !ws.reloading;
    this.hud.setCrosshair(px, w.id === 'sniper' ? Math.max(this.actor.aim01, 0) : this.actor.aim01, visible);
    this.hud.setAmmo(ws);
    this.hud.updateDeathTimer();
    this.hud.setTeamBadge(this.myTeam, this.teams, this.modeId);
    if (this.modeState) this.hud.setStatus(this.modeState, this.myTeam, this.myId, this.roster);
    if (this.modeState && this.modeState.z) this.renderer.updateZones(this.modeState.z, performance.now() / 1000);
    this.hud.showScoreboard(this.input.scoreboard && !this.ended, this.roster, this.scores, this.myId, this.teams);

    // Location name.
    const area = this.map.areas.find((a) => Math.abs(m.x - a.x) <= a.w / 2 && Math.abs(m.z - a.z) <= a.d / 2);
    this.hud.setArea(area ? area.name.toUpperCase() : '');

    // Minimap.
    const others = [];
    const now = performance.now();
    if (this.renderPoses) {
      for (const [id, pose] of this.renderPoses) {
        if (!pose.alive) continue;
        const r = this.roster.get(id);
        const ally = this.teams && r && r.team === this.myTeam;
        if (ally || now - (this.lastFireSeen.get(id) || -1e9) < 1500) others.push({ x: pose.x, z: pose.z, ally, color: this.palette.entity(id, r ? r.team : TEAM.NONE) });
      }
    }
    if (settings.showMinimap) this.hud.drawMinimap({ x: m.x, z: m.z, yaw: this.viewYaw }, others, this.modeState && this.modeState.z ? this.modeState.z : [], this.myTeam, this.modeId === 'dom');
  }
}

export function sanitizePrimary(id) {
  return WEAPONS[id] && id !== 'pistol' ? id : 'rifle';
}

export { saveSettings, BTN };
