// Client game session: input -> fixed-rate commands with client-side prediction, server reconciliation,
// snapshot interpolation of remote players/bots, effects, audio, HUD and camera.
import * as THREE from 'three';
import { BTN, TEAM } from '../shared/constants.js';
import { buildMap } from '../shared/map.js';
import { DEG, clamp, dirFromAngles, lerp, lerpAngle, rayBox, raySphere } from '../shared/math.js';
import { EMOTES, EMOTE_COOLDOWN, emoteById } from '../shared/emotes.js';
import { DANCES, JOIN_RADIUS, danceAt, danceById, danceIndex, isGroupDance } from '../shared/dances.js';
import { danceMusic } from './emotemusic.js';
import { VoiceChat } from './voice.js';
import { abilityById } from '../shared/abilities.js';
import { MODE_LIST } from '../shared/modes.js';
import { eyeHeightOf } from '../shared/movement.js';
import { createActor, hitboxesAt, stepCommand, unpackActor } from '../shared/sim.js';
import { WEAPONS, activeWeapon, carriedWeapons, currentSpread, spreadDirection } from '../shared/weapons.js';
import { World } from '../shared/world.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { GameRenderer } from './renderer.js';
import { onSettingsChanged, saveSettings, settings } from './settings.js';
import { MATERIAL_IDS, tracePath } from '../shared/ballistics.js';
import { difficultyLevel } from '../shared/difficulty.js';
import { profile, recordMatch } from './profile.js';
import { TeamPalette } from './teamcolors.js';
import { TouchControls, enterMobileFullscreen, touchControlsWanted } from './touch.js';

const CMD_DT = 1 / 60;
// Aim sway amplitude (radians) while fully aimed; horizontal recoil drift phase per weapon.
const SWAY = { sniper: 0.0075, dmr: 0.0045, rifle: 0.0022, lmg: 0.003, smg: 0.0018, pistol: 0.0025, shotgun: 0.0015 };
const RECOIL_BIAS = { pistol: 0.4, smg: 1.9, rifle: 0.9, shotgun: 0, lmg: 2.6, dmr: 1.3, sniper: 0.2 };
const TOUCH_LOOK = 0.0058;          // radians per CSS pixel of finger drag at sensitivity 1
const ASSIST_CONE = 4.5 * Math.PI / 180;

export class ClientSession {
  /**
   * @param {object} o
   *   requeue()      "Play again" that needs a new match (Ranked, squad leader, 1v1 rematch); else restart in place
   *   squad          { leader, label } when this is a squad match
   *   duel           { kind: 'showdown' | 'friendly', host, opp: { code, name, sr, sk } } for a 1v1 vs a friend
   *   onRecorded(report, session) after the result went into the profile
   */
  constructor({ transport, welcome, canvas, hudRoot, audio, onExit, requeue, squad, duel, onRecorded }) {
    this.transport = transport;
    this.requeue = requeue || null;
    this.squad = squad || null;
    this.duelInfo = welcome.cfg && welcome.cfg.duel && duel ? duel : null;
    this.onRecorded = onRecorded || null;
    // What guests are told when this player (as host) closes the room.
    this.closeReason = squad && squad.leader ? 'Your squad leader went back to the lobby.' : undefined;
    this.sawOpponent = false;
    this.wheel = { open: false, touch: false, page: 'emotes', key: 'KeyB', x: 0, y: 0, sel: -1 };
    this.dance = null;
    this.hostDance = 0;
    this.hostDanceStart = 0;
    this.joinable = null;
    this.danceAnchors = new Map();
    this.audio = audio;
    this.onExit = onExit;
    this.myId = welcome.id;
    this.modeId = welcome.mode;
    this.modeInfo = MODE_LIST.find((m) => m.id === welcome.mode) || MODE_LIST[0];
    this.teams = this.modeInfo.teams;
    this.config = welcome.cfg;
    this.ranked = !!(welcome.cfg && welcome.cfg.ranked);
    this.botLevel = difficultyLevel(welcome.cfg ? welcome.cfg.difficulty : 'normal');
    this.resetMatchStats();
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
    this.renderer.world = this.world;
    this.renderer.loadMap(this.map, this.modeId === 'dom');
    this.audio.setEnvironment(this.map.theme);
    this.input = new Input(canvas);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.palette = new TeamPalette();
    this.renderer.teamColor = (team) => this.palette.team(team);
    this.renderer.setLocalLook({ camo: profile.equipped.camo, outfit: profile.equipped.outfit, color: this.palette.colors.ally });
    this.damageFx = 0;
    this.losCache = new Map();
    this.crosshairAlly = null;
    this.sway = { t: 0, yaw: 0, pitch: 0, breath: 1, holding: false, recover: 0 };
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
      onChat: (text, team) => this.transport.send({ type: 'chat', text, team: !!team }),
      onLoadout: (patch) => this.transport.send({ type: 'loadout', ...patch }),
      onScopeMode: () => this.input.cancelAim(),
      onEmote: (id) => this.closeEmoteWheel(id),
      onWheelPage: (page) => this.setWheelPage(page),
      onVoiceMute: (id) => { if (this.voice) this.voice.toggleMute(id); },
    });
    this.touchUI = new TouchControls(hudRoot, this.input, {
      onPause: () => { if (!this.paused) this.input.releaseLock(); },
      onScoreboard: () => {},
      onEmote: () => (this.wheel.open ? this.closeEmoteWheel(null) : this.openEmoteWheel(true, 'emotes')),
      onChat: () => this.openChat(false),
      onKnife: () => this.toggleKnife(),
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

    this.actor = createActor(0, 0, 0, 0, carriedWeapons(settings.weaponSet));
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
      if (this.voice) { this.voice.setMode(settings.voiceChat); this.voice.applyVolumes(); }
    });

    // Voice chat (online matches only): see voice.js.
    this.voice = !this.offline && transport.peer ? new VoiceChat({ transport, myId: this.myId, onChange: () => this.voiceChanged() }) : null;
    if (this.voice) this.voice.setMode(settings.voiceChat);
    this.voiceTimer = 0;

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
      case 'roster': { const r = this.applyRoster(msg.l); this.voiceChanged(); return r; }
      case 'voice':
        if (this.voice) this.voice.setRoster(msg.l);
        return undefined;
      case 'scores':
        for (const [id, kills, deaths, score, tier, ping] of msg.l) this.scores.set(id, { kills, deaths, score, tier, ping });
        for (const [id, s] of this.scores) { const r = this.roster.get(id); if (r) r.tier = s.tier; }
        if (this.input.scoreboard) this.hud.showScoreboard(true, this.roster, this.scores, this.myId, this.teams);
        return undefined;
      case 'pong':
        this.rtt = Math.round(performance.now() - msg.t);
        return undefined;
      case 'restart':
        this.resetMatchStats();
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
        // 1v1: the host quitting mid-match is a win for the player who stayed.
        if (this.duelInfo && !this.ended && this.phase === 'live' && this.match && this.match.seconds > 10) this.recordMatchResult(TEAM.NONE, this.myId, false);
        this.leave();
        return undefined;
      default:
        return undefined;
    }
  }

  applyRoster(list) {
    const seen = new Set();
    for (const [id, name, team, isBot, camo, outfit] of list) {
      seen.add(id);
      const prev = this.roster.get(id);
      this.roster.set(id, { id, name, team, isBot: isBot === 1, tier: prev ? prev.tier : 0, camo, outfit });
      if (id === this.myId) this.myTeam = team;
    }
    for (const id of [...this.roster.keys()]) if (!seen.has(id)) { this.roster.delete(id); this.renderer.removeCharacter(id); }
    if (this.duelInfo) this.checkOpponent();
  }

  /** 1v1: if the other player leaves, the one who stayed wins (a no-show before the start just ends it). */
  checkOpponent() {
    const others = [...this.roster.values()].filter((r) => r.id !== this.myId && !r.isBot).length;
    if (others > 0) { this.sawOpponent = true; return; }
    if (!this.sawOpponent || this.ended) return;
    this.opponentLeft();
  }

  opponentLeft() {
    if (this.ended) return;
    const name = this.duelInfo.opp.name;
    if (this.phase === 'live' && this.match && this.match.seconds > 10) {
      this.showEnd(`${name} LEFT THE MATCH`, TEAM.NONE, this.myId);
    } else {
      if (this.match) this.match.recorded = true; // nothing to score yet
      this.showEnd(`${name} LEFT BEFORE THE START`, TEAM.NONE, -1);
    }
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
    this.pickupList = snap.pk || [];
    this.grenadeList = snap.gr || [];
    this.smokeList = snap.sm || [];
    this.revealedIds = snap.rv ? new Set(snap.rv) : null;
    if (snap.you) { this.cloakLeft = snap.you.ck || 0; this.hostDance = snap.you.dn || 0; this.hostDanceStart = snap.you.ds || 0; }
    if (snap.m.ph !== this.phase) {
      this.phase = snap.m.ph;
      if (this.phase === 'live' && this.ended) { this.ended = false; this.hud.hideEnd(); }
    }
    if (snap.m.res && !this.ended && snap.m.ph === 'ended') this.showEnd(snap.m.res[2], snap.m.res[0], snap.m.res[1]);

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
      case 'mel': {
        // Knife swing: third-person slash for others, and the swing / hit sounds where it happened.
        const w = WEAPONS[ev.w] || WEAPONS.knife;
        const mine = ev.s === this.myId;
        const pose = this.renderPoses.get(ev.s);
        const at = ev.p ? { x: ev.p[0], y: ev.p[1], z: ev.p[2] } : pose ? { x: pose.x, y: pose.y + 1.3, z: pose.z } : null;
        if (!mine) {
          this.renderer.characterSlash(ev.s, w.shape === 'hatchet' || w.shape === 'machete');
          if (pose) this.audio.knifeSwing(w.id, { x: pose.x, y: pose.y + 1.3, z: pose.z });
        }
        if ((ev.h === 1 || ev.h === 2) && at) {
          this.audio.knifeHit(w.id, 'body', mine ? null : at);
          this.renderer.impact([at.x, at.y, at.z, 0, 1, 0], true, 'body');
        } else if (ev.h === 3 && at) {
          const material = ev.m >= 0 ? MATERIAL_IDS[ev.m] : 'ground';
          this.audio.knifeHit(w.id, material, at);
          this.renderer.impact([at.x, at.y, at.z, 0, 1, 0], false, material);
        }
        return;
      }
      case 'shot': {
        if (ev.s === this.myId) return;
        this.lastFireSeen.set(ev.s, performance.now());
        const origin = { x: ev.o[0], y: ev.o[1], z: ev.o[2] };
        const muzzle = this.renderer.characterMuzzle(ev.s, this.tmpV) || this.tmpV.set(origin.x, origin.y, origin.z);
        const from = { x: muzzle.x, y: muzzle.y, z: muzzle.z };
        const w = WEAPONS[ev.w] || WEAPONS.rifle;
        const shooter = this.roster.get(ev.s);
        const hostile = !this.palette.isAlly(ev.s, shooter ? shooter.team : TEAM.NONE);
        const color = this.palette.tracer(ev.s, shooter ? shooter.team : TEAM.NONE);
        const dirs = ev.d || [];
        let whizzed = false;
        dirs.forEach((d, i) => {
          const path = tracePath(this.world, origin.x, origin.y, origin.z, d[0], d[1], d[2], w);
          if (dirs.length === 1 || i % 2 === 0) this.renderer.tracer(from, [path.x, path.y, path.z], color, path.time * 1000);
          if (!whizzed && hostile && this.actor.alive) whizzed = this.nearMiss(origin, path, w);
        });
        this.renderer.muzzleLight(this.tmpV.set(from.x, from.y, from.z));
        this.audio.gunshot(w.id, origin, false);
        return;
      }
      case 'imp':
        // Server-confirmed bullet impacts (entry, exit after penetration, body hits) with the surface material.
        for (const [sid, x, y, z, nx, ny, nz, kind, mat] of ev.l) {
          if (sid === this.myId && kind === 0) continue; // already shown by our own prediction
          const material = mat >= 0 ? MATERIAL_IDS[mat] : 'ground';
          this.renderer.impact([x, y, z, nx, ny, nz], kind === 1, material);
          this.audio.impact(material, { x, y, z }, kind === 1);
        }
        return;
      case 'hit':
        this.hud.hitmarker(ev.hs === 1, ev.k === 1);
        if (ev.k) this.audio.kill(); else this.audio.hit(ev.hs === 1);
        if (ev.bs) this.hud.announce('BACKSTAB!');
        this.vibrate(ev.k ? 45 : 12);
        if (this.match) this.match.hits++;
        return;
      case 'dmg': {
        const m = this.actor.motor;
        const toSource = Math.atan2(-(ev.f[0] - m.x), -(ev.f[2] - m.z));
        this.hud.damageIndicator(this.viewYaw - toSource);
        this.audio.hurt();
        this.vibrate(35);
        this.damageFx = Math.min(1, this.damageFx + ev.d / 45);
        if (settings.cameraBob) this.shake = Math.min(1.2, this.shake + ev.d / 40);
        return;
      }
      case 'kill': {
        const killer = this.roster.get(ev.k), victim = this.roster.get(ev.v);
        this.hud.killfeed(killer ? killer.name : '', victim ? victim.name : '?', ev.w, ev.hs === 1,
          this.palette.entity(ev.k, killer ? killer.team : TEAM.NONE), this.palette.entity(ev.v, victim ? victim.team : TEAM.NONE), ev.k === this.myId || ev.v === this.myId);
        if (ev.k === this.myId && ev.v !== this.myId) this.hud.streak(ev.st);
        if (this.match && this.phase === 'live') {
          if (ev.k === this.myId && ev.v !== this.myId) {
            this.match.kills++;
            this.match.streak++;
            this.match.bestStreak = Math.max(this.match.bestStreak, this.match.streak);
            if (ev.hs === 1) this.match.headshots++;
          }
          if (ev.v === this.myId) { this.match.deaths++; this.match.streak = 0; }
        }
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
        this.showEnd(ev.text, ev.team, ev.winner);
        return;
      case 'emote': {
        const em = emoteById(ev.e);
        if (!em) return;
        if (ev.id === this.myId) this.hud.selfEmote(em);
        else this.renderer.characterEmote(ev.id, em);
        const who = this.roster.get(ev.id);
        if (who) this.hud.chatMessage(who.name, `${em.icon} ${em.label}`, who.team, false, who.isBot, true);
        return;
      }
      case 'abl': {
        if (ev.id === this.myId) { this.audio.ability(ev.a, null); return; }
        const at = { x: ev.x, y: ev.y, z: ev.z };
        this.audio.ability(ev.a, at);
        if (ev.a === 'pulse') this.renderer.pulseRing(ev.x, ev.y - 1, ev.z);
        else if (ev.a === 'dash' || ev.a === 'stim' || ev.a === 'cloak') this.renderer.abilityPuff(ev.a, ev.x, ev.y - 0.5, ev.z);
        return;
      }
      case 'boom': {
        this.renderer.explosion(ev.x, ev.y, ev.z);
        this.audio.boom({ x: ev.x, y: ev.y, z: ev.z });
        const m = this.actor.motor;
        const d = Math.hypot(m.x - ev.x, m.y - ev.y, m.z - ev.z);
        if (d < 20 && settings.cameraBob) this.shake = Math.max(this.shake, 1.6 * (1 - d / 20));
        return;
      }
      case 'smoke':
        this.audio.ability('smoke', { x: ev.x, y: ev.y, z: ev.z });
        return;
      case 'pulse':
        this.renderer.pulseRing(this.actor.motor.x, this.actor.motor.y, this.actor.motor.z);
        this.hud.abilityNotice(ev.n ? `RECON PULSE: ${ev.n} ${ev.n === 1 ? 'ENEMY' : 'ENEMIES'} REVEALED` : 'RECON PULSE: NO ENEMIES IN RANGE', '#5ad1ff');
        return;
      case 'revealed':
        this.hud.abilityNotice('YOU WERE REVEALED BY A RECON PULSE', '#ff5a4a');
        return;
      case 'ammo':
        this.hud.ammoPickup(ev.n, ev.from);
        this.audio.pickup();
        return;
      case 'pkup':
        return;
      case 'chat': {
        const r = this.roster.get(ev.id);
        this.hud.chatMessage(r ? r.name : '?', ev.text, r ? r.team : TEAM.NONE, ev.tm === 1, r && r.isBot);
        return;
      }
      case 'rl':
        return;
      default:
        return;
    }
  }

  showEnd(text, team, winner = -1) {
    if (this.ended) return;
    this.ended = true;
    this.input.releaseLock();
    this.hud.showPause(false);
    const report = this.recordMatchResult(team, winner, false);
    this.hud.showEnd(text, team, this.roster, this.scores, this.myId, this.teams, this.offline, report, this.ranked, this.endActions());
  }

  /** End screen buttons: who can start the next match, and what everyone else is told. */
  endActions() {
    if (this.duelInfo) {
      return this.duelInfo.host ? { again: 'REMATCH', leave: 'BACK TO FRIENDS' } : { hint: `${this.duelInfo.opp.name} can call a rematch…`, leave: 'BACK TO FRIENDS' };
    }
    if (this.squad) {
      return this.squad.leader ? { again: this.ranked ? 'PLAY RANKED AGAIN' : 'PLAY AGAIN', leave: 'BACK TO LOBBY' } : { hint: 'Waiting for your squad leader to start the next match…', leave: 'BACK TO LOBBY' };
    }
    if (this.offline) return { again: this.ranked ? 'PLAY RANKED AGAIN' : 'PLAY AGAIN' };
    return { hint: 'Next match starts automatically…' };
  }

  // ==============================================================================================
  // Match stats -> profile (XP, skill rating for adaptive bots, Ranked SR, unlocks)
  // ==============================================================================================
  resetMatchStats() {
    this.match = { shots: 0, hits: 0, headshots: 0, kills: 0, deaths: 0, seconds: 0, streak: 0, bestStreak: 0, recorded: false };
  }

  recordMatchResult(team, winner, abandoned) {
    if (!this.match || this.match.recorded) return null;
    this.match.recorded = true;
    const mine = this.scores.get(this.myId) || { kills: 0, deaths: 0, score: 0 };
    let result;
    if (abandoned) result = 'loss';
    else if (this.teams) result = team === TEAM.NONE ? 'draw' : team === this.myTeam ? 'win' : 'loss';
    else result = winner === this.myId ? 'win' : winner === -1 || winner === undefined ? 'draw' : 'loss';
    const rows = [...this.roster.values()].map((r) => ({ id: r.id, s: this.scores.get(r.id) || { score: 0, kills: 0, tier: 0 } }));
    rows.sort((a, b) => (this.modeId === 'gungame' ? b.s.tier - a.s.tier || b.s.kills - a.s.kills : b.s.score - a.s.score || b.s.kills - a.s.kills));
    const place = rows.findIndex((r) => r.id === this.myId) + 1 || rows.length;
    const d = this.duelInfo;
    try {
      const report = recordMatch({
        ranked: this.ranked, mode: this.modeId,
        kills: Math.max(mine.kills, this.match.kills), deaths: Math.max(mine.deaths, this.match.deaths),
        headshots: this.match.headshots, shots: this.match.shots, hits: this.match.hits,
        score: mine.score || this.match.kills * 100, seconds: this.match.seconds,
        result, place, players: rows.length, botLevel: this.botLevel, bestStreak: this.match.bestStreak, abandoned,
        duel: d ? { kind: d.kind, oppRating: d.opp.sr, oppSkill: d.opp.sk, oppName: d.opp.name } : null,
      });
      if (this.onRecorded) { try { this.onRecorded(report, this); } catch (err) { console.error(err); } }
      return report;
    } catch (err) {
      console.error('Could not record match', err);
      return null;
    }
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
      if (!this.soundsReady) {
        // Render this weapon set's gunshots in the background (one gun per frame) so the first shot doesn't hitch.
        this.soundsReady = true;
        this.actor.ws.slots.filter((slot) => !WEAPONS[slot.id].melee).forEach((slot, i) => setTimeout(() => this.running && this.audio.preload([slot.id]), 60 + i * 120));
      }
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
    // Ranked, squad and 1v1 rematches start a fresh match (Ranked: new random map, bots re-tuned to the new skill).
    if (this.requeue) {
      const requeue = this.requeue;
      if (this.squad) this.closeReason = 'Your squad leader is starting the next match…';
      else if (this.duelInfo) this.closeReason = `${settings.name} wants a rematch.`;
      this.requeued = true;
      this.leave();
      requeue();
      return;
    }
    if (this.offline && this.transport.restart) {
      this.resetMatchStats();
      this.transport.restart();
      this.ended = false;
      this.hud.hideEnd();
      this.resume();
    }
  }

  leave() {
    if (!this.running) return;
    // Leaving a match part-way still counts (an abandoned Ranked game is a loss).
    if (!this.ended && this.phase === 'live' && this.match && this.match.seconds > 20) this.recordMatchResult(TEAM.NONE, -1, true);
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('pointerdown', this._pointerKind, true);
    this.touchUI.dispose();
    this.input.dispose();
    this.unsubscribeSettings();
    if (this.voice) { this.voice.dispose(); this.voice = null; }
    if (this.dance) this.stopDance(false);
    if (this.remoteDanceMusic) { for (const m of this.remoteDanceMusic.values()) m.handle.stop(); this.remoteDanceMusic.clear(); }
    this.hud.destroy();
    this.renderer.dispose();
    this.transport.close(this.closeReason);
    if (this.onExit) this.onExit(this.transport, this.exitReason, this);
  }

  // ==============================================================================================
  // Frame
  // ==============================================================================================
  frame(t) {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000);
    this.lastFrame = t;

    if (this.phase === 'live' && !this.ended && this.match) this.match.seconds += dt;
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
    this.updateSway(dt);
    this.touchUI.update({ autoFiring: this.crosshairTarget === 2 && this.autoFireAllowed(), ability: abilityById(this.actor.ability), cooldown: Math.max(0, (this.actor.abilityReady || 0) - this.actor.clock), joinable: !!this.joinable, knife: !!activeWeapon(this.actor.ws).melee });
    // T: chat to everyone · Y: team chat · B: emote wheel.
    const wantChat = this.input.consume('chat'), wantTeam = this.input.consume('teamChat');
    const wantWheel = this.input.consume('emote'), wantQuick = this.input.consume('quick');
    if (!this.paused && !this.wheel.open && (wantChat || wantTeam)) this.openChat(wantTeam && this.teams);
    if (!this.paused && (wantWheel || wantQuick) && !this.wheel.open && !this.hud.chatOpen) this.openEmoteWheel(false, wantQuick ? 'quick' : 'emotes');
    this.updateEmoteWheel();
    this.updateJoin();
    this.checkDanceCancel();
    this.updateVoice(dt);

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
    // While the emote wheel is open the mouse picks an emote instead of turning the view.
    if (this.wheel.open && !this.wheel.touch) {
      const w = this.wheel;
      w.x += look.x; w.y += look.y;
      const len = Math.hypot(w.x, w.y);
      if (len > 140) { w.x *= 140 / len; w.y *= 140 / len; }
      look.x = 0; look.y = 0;
    }
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
    this.updateAimToggle(active, sw);
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
      yaw: this.dance ? this.dance.yaw : this.viewYaw + this.recoilYaw + this.sway.yaw,
      pitch: this.dance ? this.dance.pitch : clamp(this.viewPitch + this.recoilPitch + this.sway.pitch, -1.5, 1.5),
      b: active && !this.wheel.open ? input.buildButtons() : 0,
      sw,
      r: active ? input.consume('reload') : false,
      vt: this.estimatedServerTime() - this.interpDelay,
    };
  }

  /**
   * Toggle aim (click to scope in, click again to scope out) also scopes out when you die, switch weapons, or start
   * sprinting. With a sniper or DMR on a keyboard, Shift holds breath instead, so it doesn't cancel the scope.
   */
  updateAimToggle(active, switching) {
    const input = this.input;
    const sprint = input.sprint;
    const sprintPressed = sprint && !this.prevSprint;
    this.prevSprint = sprint;
    if (!input.aimToggled && !input.touch.aim) return;
    const w = activeWeapon(this.actor.ws);
    const breathKey = (w.id === 'sniper' || w.id === 'dmr') && !this.touchUI.enabled;
    if (!this.actor.alive || this.ended || switching >= 0 || (active && sprintPressed && !breathKey && input.moveZ > 0)) input.cancelAim();
  }

  // ==============================================================================================
  // Chat and emotes
  // ==============================================================================================
  // ==============================================================================================
  // Voice chat
  // ==============================================================================================
  updateVoice(dt) {
    const v = this.voice;
    if (!v) return;
    v.setTalking(this.input.talkHeld && !this.paused && !this.hud.chatOpen);
    this.voiceTimer -= dt;
    if (this.voiceTimer > 0) return;
    this.voiceTimer = 0.12;
    const name = (id) => (this.roster.get(id) || {}).name || '?';
    this.hud.setVoiceStatus({
      mode: v.mode, transmitting: v.transmitting, mic: v.micState, touch: this.touchUI.enabled,
      speakers: v.mode === 'off' ? [] : v.speakers().map((id) => ({ name: name(id), team: (this.roster.get(id) || {}).team })),
    });
  }

  voiceChanged() {
    if (!this.hud) return;
    const v = this.voice;
    if (this.touchUI) this.touchUI.el.classList.toggle('voice', !!v && v.mode !== 'off');
    this.hud.setVoiceMembers(v && v.mode !== 'off' ? v.members().map((m) => ({ ...m, name: (this.roster.get(m.id) || {}).name || '?' })) : null, !!v);
  }

  openChat(team) {
    // Mark the chat open first: releasing the mouse (or, on touch, pausing input) must not show the pause menu.
    this.hud.openChat(team);
    this.input.releaseLock();
    this.hud.showPause(false);
    this.hud.el.chatInput.focus();
  }

  /** The wheel has two pages: EMOTES (dances, B) and QUICK CHAT (Z). */
  wheelItems(page) { return page === 'quick' ? EMOTES : DANCES; }

  openEmoteWheel(touch, page = 'emotes') {
    if (!this.actor.alive || this.ended) return;
    this.wheel = { open: true, touch, page, key: page === 'quick' ? 'KeyZ' : 'KeyB', x: 0, y: 0, sel: -1 };
    this.input.consume('cycle');
    this.hud.showEmoteWheel(true, touch, page);
  }

  setWheelPage(page) {
    if (!this.wheel.open || this.wheel.page === page) return;
    this.wheel.page = page;
    this.wheel.sel = -1;
    this.hud.showEmoteWheel(true, this.wheel.touch, page);
  }

  /** Mouse picks the wedge it points at; releasing the key (or clicking) plays it. Mouse wheel / Q / E flip pages. */
  updateEmoteWheel() {
    const w = this.wheel;
    if (!w.open) return;
    if (!this.actor.alive || this.paused || this.ended) { this.closeEmoteWheel(null); return; }
    if (this.input.consume('cycle')) this.setWheelPage(w.page === 'quick' ? 'emotes' : 'quick');
    if (w.touch) return;
    const items = this.wheelItems(w.page);
    const len = Math.hypot(w.x, w.y);
    const sel = len > 35 ? Math.round(((Math.atan2(w.x, -w.y) / (Math.PI * 2)) * items.length + items.length)) % items.length : -1;
    if (sel !== w.sel) { w.sel = sel; this.hud.setEmoteSelection(sel, w.page); }
    if (this.input.consume('firePressed')) { this.closeEmoteWheel(sel >= 0 ? items[sel].id : null); return; }
    if (!this.input.keys.has(w.key)) this.closeEmoteWheel(sel >= 0 ? items[sel].id : null);
  }

  closeEmoteWheel(id) {
    const { touch: wasTouch, page } = this.wheel;
    this.wheel = { open: false, touch: false, page: 'emotes', key: 'KeyB', x: 0, y: 0, sel: -1 };
    this.hud.showEmoteWheel(false);
    if (!id) return;
    if (wasTouch) this.input.touch.fire = 0;
    if (page === 'emotes') { this.startDance(id); return; }
    const now = performance.now();
    if (now - (this.lastEmoteSent || 0) < EMOTE_COOLDOWN * 1000) return;
    this.lastEmoteSent = now;
    this.transport.send({ type: 'emote', e: id });
  }

  // ==============================================================================================
  // Emote dances: third-person camera you can orbit with the mouse; moving, jumping, shooting, aiming, crouching,
  // reloading, switching weapons or using an ability stops it.
  // ==============================================================================================
  /**
   * Starts a dance. join = { id, name, startMs, serverStart, yaw } joins that player's group dance: same dance,
   * same start time (so the same move on the same beat), facing the same way, like a rehearsed crew.
   */
  startDance(id, join = null) {
    const d = danceById(id);
    if (!d || !this.actor.alive || this.ended) return;
    if (this.dance) this.stopDance(false);
    this.input.cancelAim();
    const now = performance.now();
    const yaw = join ? join.yaw : this.viewYaw;
    this.dance = {
      id, start: join ? join.startMs : now, began: now, yaw, pitch: this.viewPitch, name: d.name,
      serverStart: join ? join.serverStart : 0, anchored: !!join, leader: join ? join.name : null,
    };
    // Start the camera in front of you, a little to the side, looking back at your character.
    this.viewYaw = yaw + Math.PI * 0.82;
    this.viewPitch = -0.12;
    this.transport.send(join ? { type: 'dance', j: join.id } : { type: 'dance', d: id });
    this.playSelfDanceMusic();
    this.hud.setDanceHint(d, this.touchUI.enabled, join ? join.name : null);
  }

  playSelfDanceMusic() {
    if (this.danceMusicSelf) { this.danceMusicSelf.stop(); this.danceMusicSelf = null; }
    if (!this.dance || !settings.emoteMusic || !this.audio.ensure()) return;
    this.danceMusicSelf = this.audio.playLoop(danceMusic(this.audio.ctx, this.dance.id), { volume: 0.45, offset: (performance.now() - this.dance.start) / 1000 });
  }

  stopDance(send) {
    if (!this.dance) return;
    this.viewYaw = this.dance.yaw;
    this.viewPitch = this.dance.pitch;
    this.snapYaw = false;
    this.dance = null;
    if (this.danceMusicSelf) { this.danceMusicSelf.stop(); this.danceMusicSelf = null; }
    this.renderer.syncSelf(null);
    this.hud.setDanceHint(null);
    if (send) this.transport.send({ type: 'dance', d: null });
  }

  /** Called every frame before commands are built: any action input ends your dance (the action still happens). */
  checkDanceCancel() {
    if (!this.dance) return;
    const i = this.input;
    const acted = Math.abs(i.moveX) > 0.1 || Math.abs(i.moveZ) > 0.1 || i.fire || i.latched.firePressed || i.latched.jump || i.aim
      || i.abilityHeld || i.crouch || i.latched.slot >= 0 || i.latched.cycle !== 0 || i.latched.reload;
    const age = performance.now() - this.dance.began;
    const hostStopped = this.hostDance === 0 && age > 800;
    // The host said no (e.g. you walked out of range before the join arrived): back to what it says.
    const mismatch = this.hostDance !== 0 && this.hostDance !== danceIndex(this.dance.id) && age > 1200;
    if (acted || !this.actor.alive || this.ended || hostStopped || mismatch) { this.stopDance(!hostStopped); return; }
    if (!this.dance.anchored && this.hostDance === danceIndex(this.dance.id) && this.hostDanceStart) {
      // Your own dance: the host's start time for it now means your local start, so anyone who joins you is drawn
      // (and their music played) on exactly your beat.
      this.dance.anchored = true;
      this.dance.serverStart = this.hostDanceStart;
      if (!this.danceAnchors.has(this.hostDanceStart)) this.danceAnchors.set(this.hostDanceStart, this.dance.start);
    }
  }

  /**
   * A dance's start (host time) as a local performance.now() time, fixed the first time it's seen. Everyone in a crew
   * shares one start, so they share one anchor: on your screen they're always on the same move, even if the clocks
   * drift (a slow host's game clock can run behind real time).
   */
  danceAnchor(serverStart) {
    let ms = this.danceAnchors.get(serverStart);
    if (ms === undefined) {
      if (this.danceAnchors.size > 64) this.danceAnchors.clear();
      ms = Math.min(performance.now(), (serverStart - (this.serverOffset || 0)) * 1000);
      this.danceAnchors.set(serverStart, ms);
    }
    return ms;
  }

  /** "Press Q to join": the nearest player within JOIN_RADIUS doing a group dance you're not already in. */
  updateJoin() {
    const want = this.input.consume('join');
    let best = null;
    if (this.actor.alive && !this.ended && !this.paused) {
      const m = this.actor.motor;
      let bestD = JOIN_RADIUS;
      for (const [id, pose] of this.renderPoses) {
        if (!pose.alive || !pose.dance || !isGroupDance(pose.dance) || id === this.myId) continue;
        if (this.dance && this.dance.id === pose.dance && this.dance.serverStart === pose.danceStart) continue;
        const d = Math.hypot(pose.x - m.x, pose.z - m.z);
        if (d > bestD || Math.abs(pose.y - m.y) > 3) continue;
        const r = this.roster.get(id);
        if (!r) continue; // left the match
        bestD = d;
        best = { id, name: r.name, dance: pose.dance, startMs: pose.danceStartMs, serverStart: pose.danceStart, yaw: pose.yaw };
      }
    }
    this.joinable = best;
    this.hud.setJoinHint(best ? { name: best.name, dance: danceById(best.dance) } : null, this.touchUI.enabled);
    if (want && best && !this.wheel.open && !this.hud.chatOpen) {
      this.input.consume('cycle'); // Q joins instead of switching weapons
      this.startDance(best.dance, best);
    }
  }

  /**
   * Music for other players' dances (positional), started and stopped as their snapshots change. A crew dancing
   * the same dance from the same start shares one copy of the music (yours, if you're in it), on their beat.
   */
  syncDanceMusic(dancers) {
    if (!this.remoteDanceMusic) this.remoteDanceMusic = new Map();
    const groups = new Map();
    const mine = this.dance && this.dance.serverStart ? `${this.dance.id}@${this.dance.serverStart}` : null;
    const l = this.audio.listenerPos;
    for (const [, d] of dancers) {
      const key = `${d.id}@${d.start}`;
      if (key === mine) continue;
      const dist = Math.hypot(d.at.x - l.x, d.at.z - l.z);
      const g = groups.get(key);
      if (!g || dist < g.dist) groups.set(key, { ...d, dist });
    }
    for (const [key, m] of this.remoteDanceMusic) {
      if (!groups.has(key) || !settings.emoteMusic) { m.handle.stop(); this.remoteDanceMusic.delete(key); }
    }
    if (!settings.emoteMusic) return;
    for (const [key, d] of groups) {
      const m = this.remoteDanceMusic.get(key);
      if (m) { m.handle.setPosition(d.at); continue; }
      if (!this.audio.ensure()) return;
      const offset = d.start ? this.estimatedServerTime() - d.start : 0;
      const handle = this.audio.playLoop(danceMusic(this.audio.ctx, d.id), { volume: 0.5, position: d.at, offset });
      if (handle) this.remoteDanceMusic.set(key, { id: d.id, handle });
    }
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
  /** Touch 🔪 button: knife out, or back to the last gun. */
  toggleKnife() {
    const ws = this.actor.ws;
    const knife = ws.slots.findIndex((s) => WEAPONS[s.id].melee);
    if (knife < 0) return;
    this.input.latched.slot = ws.active === knife ? (this.lastGunSlot ?? 0) : knife;
  }

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

  /** What the feet at (x, y, z) are standing on, for footstep sounds. */
  surfaceAt(x, y, z) {
    let top = null;
    this.world.forEachNear(x, z, x, z, (b) => {
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] && Math.abs(b.max[1] - y) < 0.25) top = b;
      return false;
    });
    if (!top) return this.map.theme && this.map.theme.ground === 'grass' ? 'grass' : 'concrete';
    switch (top.m) {
      case 'crate': case 'floor': return 'wood';
      case 'metal': case 'container': case 'containerB': case 'stairs': return 'metal';
      case 'sand': return 'sand';
      default: return 'concrete';
    }
  }

  estimatedServerTime() {
    return performance.now() / 1000 + (this.serverOffset || 0);
  }

  predictionHooks() {
    if (this._hooks) return this._hooks;
    this._hooks = {
      onShot: (actor, shot) => this.onLocalShot(actor, shot),
      onNoise: (actor, radius, kind) => {
        if (kind === 'step') this.audio.footstep(null, actor.motor.crouching ? 0.06 : actor.motor.sprinting ? 0.22 : 0.14, this.surfaceAt(actor.motor.x, actor.motor.y, actor.motor.z));
      },
      onReload: (actor, duration) => {
        this.hud.showReload(duration);
        this.renderer.viewModelReload(duration);
        const slot = actor.ws.slots ? actor.ws.slots[actor.ws.active] : null;
        this.audio.reload(activeWeapon(actor.ws).id, duration, !!slot && slot.mag === 0);
      },
      onReloadDone: () => { this.audio.reloadDone(); this.hud.hideReload(); },
      onDryFire: () => this.audio.dryFire(),
      onSwitch: (actor, slot) => {
        this.hud.hideReload();
        this.audio.cancelReload();
        const w = activeWeapon(this.actor.ws);
        if (!w.melee) this.lastGunSlot = slot;
        else this.audio.knifeDraw(w.id);
        this.renderer.setViewWeapon(w.id);
      },
    };
    return this._hooks;
  }

  onLocalShot(actor, shot) {
    const w = shot.weapon;
    if (w.melee) {
      // Knife: swing animation and whoosh now; hits are confirmed by the host ('mel' + 'hit').
      this.renderer.viewModelFire();
      this.audio.knifeSwing(w.id, null);
      this.viewPitch = clamp(this.viewPitch - 0.004, -1.5, 1.5);
      return;
    }
    // Recoil: a learnable per-weapon pattern (the first shots stay close, then the climb grows and the gun walks
    // side to side), with a little randomness. Aiming down sights and crouching tame it.
    const now = performance.now();
    this.shotIndex = now - (this.lastShotAt || 0) > 320 ? 0 : (this.shotIndex || 0) + 1;
    this.lastShotAt = now;
    const n = this.shotIndex;
    const control = lerp(1, 0.62, actor.aim01) * (actor.motor.crouching ? 0.82 : 1);
    const climb = 1 + Math.min(n, 10) * 0.045;
    const vertical = lerp(w.recoil[0], w.recoil[1], 0.5 + 0.5 * Math.sin(n * 1.7 + 0.3)) * DEG * control * climb;
    const bias = RECOIL_BIAS[w.id] || 0;
    const pattern = n < 3 ? 0.15 * Math.sin(n * 2.1 + bias) : Math.sin(n * 0.55 + bias) * (n < 8 ? 0.75 : 1);
    const horizontal = (pattern + (Math.random() * 2 - 1) * 0.22) * w.recoilH * 1.5 * DEG * control;
    this.recoilPitch += vertical * 0.35;
    this.viewPitch = clamp(this.viewPitch + vertical * 0.65, -1.5, 1.5);
    this.recoilYaw += horizontal * 0.4;
    this.viewYaw += horizontal * 0.6;

    this.renderer.viewModelFire();
    this.audio.gunshot(w.id, null, true);
    this.audio.afterShot(w.id);
    if (this.match) this.match.shots++;
    const muzzle = this.renderer.muzzleWorldPosition(new THREE.Vector3());
    this.renderer.muzzleLight(muzzle);

    // Predicted bullets with the same ballistics as the server: the tracer flies at bullet speed and the impact
    // appears when the round arrives. Hits on players are confirmed by the server ('imp' + 'hit').
    const dir = { x: 0, y: 0, z: 0 };
    const hb = {};
    const hitTest = (ox, oy, oz, dx, dy, dz, maxT) => {
      let best = -1;
      for (const [id, pose] of this.renderPoses) {
        if (!pose.alive || id === this.myId) continue;
        const r = this.roster.get(id);
        if (this.teams && r && r.team === this.myTeam) continue;
        hitboxesAt(pose.x, pose.y, pose.z, pose.crouch, hb);
        const th = raySphere(ox, oy, oz, dx, dy, dz, hb.hx, hb.hy, hb.hz, hb.hr);
        if (th >= 0 && th <= maxT && (best < 0 || th < best)) best = th;
        const tb = rayBox(ox, oy, oz, dx, dy, dz, hb.minx, hb.miny, hb.minz, hb.maxx, hb.maxy, hb.maxz, maxT, null);
        if (tb >= 0 && (best < 0 || tb < best)) best = tb;
      }
      return best;
    };
    const pellets = Math.max(1, w.pellets);
    for (let p = 0; p < pellets; p++) {
      spreadDirection(shot.dx, shot.dy, shot.dz, shot.spread, shot.seed, p, dir);
      const path = tracePath(this.world, shot.ox, shot.oy, shot.oz, dir.x, dir.y, dir.z, w, hitTest);
      const point = [path.x, path.y, path.z, path.nx, path.ny, path.nz];
      if (pellets === 1 || p % 2 === 0) this.renderer.tracer(muzzle, point, 0xfff0b0, path.time * 1000);
      if (path.kind === 'world') {
        const material = path.box ? path.box.m : 'ground';
        this.renderer.impact(point, false, material, path.time * 1000);
        if (p === 0 || pellets < 3 || p % 3 === 0) {
          const at = { x: path.x, y: path.y, z: path.z };
          setTimeout(() => this.running && this.audio.impact(material, at, false), path.time * 1000);
        }
      }
    }
  }

  /** Crack / whiz when an enemy round passes close to the camera (once per shot). */
  nearMiss(origin, path, weapon) {
    const cam = this.renderer.camera.position;
    const ex = path.x - origin.x, ey = path.y - origin.y, ez = path.z - origin.z;
    const len2 = ex * ex + ey * ey + ez * ez;
    if (len2 < 1) return false;
    const k = ((cam.x - origin.x) * ex + (cam.y - origin.y) * ey + (cam.z - origin.z) * ez) / len2;
    if (k < 0.05 || k > 0.98) return false;
    const px = origin.x + ex * k, py = origin.y + ey * k, pz = origin.z + ez * k;
    const d = Math.hypot(cam.x - px, cam.y - py, cam.z - pz);
    if (d > 2.6) return false;
    const delay = path.time * k * 1000;
    setTimeout(() => this.running && this.audio.nearMiss({ x: px, y: py, z: pz }, weapon.muzzleVel > 343), delay);
    return true;
  }

  // ==============================================================================================
  // Weapon sway (aiming down sights) and holding breath
  // ==============================================================================================
  updateSway(dt) {
    const sw = this.sway;
    const w = activeWeapon(this.actor.ws);
    const m = this.actor.motor;
    const ads = this.actor.aim01;
    const scoped = w.id === 'sniper' || w.id === 'dmr';
    const canHold = scoped && ads > 0.6 && !this.touchUI.enabled;
    const wantHold = canHold && this.input.sprint && !this.paused;
    // Breath: up to 4 s of steady aim, then the shooter must recover (shakier) before holding again.
    if (wantHold && sw.breath > 0 && sw.recover <= 0) {
      sw.holding = true;
      sw.breath = Math.max(0, sw.breath - dt / 4);
      if (sw.breath === 0) sw.recover = 3;
    } else {
      sw.holding = false;
      if (sw.recover > 0) sw.recover -= dt;
      sw.breath = Math.min(1, sw.breath + dt / 5);
    }
    const base = SWAY[w.id] || 0.003;
    const speed = Math.hypot(m.vx, m.vz);
    const stance = m.crouching ? 0.55 : 1;
    const moving = 1 + Math.min(1.5, speed / 3);
    const breath = sw.holding ? 0.1 : sw.recover > 0 ? 2.2 : 1;
    const touch = this.touchUI.enabled ? 0.5 : 1; // touch players can't hold breath; aim assist covers the rest
    const amp = base * ads * stance * moving * breath * touch * (this.actor.alive ? 1 : 0);
    sw.t += dt * (sw.recover > 0 ? 1.7 : 1);
    sw.yaw += (amp * Math.sin(sw.t * 0.9) - sw.yaw) * Math.min(1, dt * 6);
    sw.pitch += (amp * 0.6 * Math.sin(sw.t * 1.8 + 0.5) - sw.pitch) * Math.min(1, dt * 6);
    this.hud.setBreath(scoped && ads > 0.6 && !this.touchUI.enabled ? { breath: sw.breath, holding: sw.holding, recovering: sw.recover > 0 } : null);
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
    const dancers = new Map();
    for (const [id, eb] of b.ents) {
      const ea = a.ents.get(id) || eb;
      const info = this.roster.get(id);
      if (!info) continue;
      live.add(id);
      const pose = {
        x: lerp(ea[1], eb[1], f), y: lerp(ea[2], eb[2], f), z: lerp(ea[3], eb[3], f),
        yaw: lerpAngle(ea[4], eb[4], f), pitch: lerp(ea[5], eb[5], f), crouch: lerp(ea[6], eb[6], f),
        alive: (eb[7] & 1) === 1, sprint: (eb[7] & 2) !== 0, weapon: eb[8], hp: eb[9],
        cloak: (eb[7] & 32) !== 0, revealed: !!(this.revealedIds && this.revealedIds.has(id)),
        dance: danceAt(eb[10] || 0), danceStart: eb[11] || 0, danceStartMs: undefined,
      };
      if (pose.dance && pose.danceStart) pose.danceStartMs = this.danceAnchor(pose.danceStart);
      if (pose.dance && pose.alive) dancers.set(id, { id: pose.dance, start: pose.danceStart, at: { x: pose.x, y: pose.y + 1, z: pose.z } });
      this.renderPoses.set(id, pose);
      const ally = this.palette.isAlly(id, info.team);
      const color = this.palette.entity(id, info.team);
      const label = ally && settings.allyMarkers ? info.name : null;
      const marker = ally ? settings.allyMarkers : settings.enemyMarkers && this.enemyInSight(id, pose);
      const speed = this.renderer.syncCharacter(id, { team: info.team, weapon: pose.weapon, color, ally, outline: settings.outlines, camo: info.camo, outfit: info.outfit }, pose, dt, label, color, marker);
      // Remote footsteps.
      if (pose.alive && speed > 1.2) {
        const stride = (this.strides.get(id) || 0) + speed * dt;
        if (stride > (pose.sprint ? 2.6 : 2.0)) {
          this.strides.set(id, 0);
          this.audio.footstep({ x: pose.x, y: pose.y, z: pose.z }, pose.crouch > 0.5 ? 0.12 : 0.35, this.surfaceAt(pose.x, pose.y, pose.z));
        } else this.strides.set(id, stride);
      }
    }
    this.renderer.pruneCharacters(live);
    this.syncDanceMusic(dancers);
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
    this.damageFx = Math.max(0, this.damageFx - dt * 1.2);
    const lowHealth = this.actor.alive ? Math.max(0, (40 - this.hp) / 40) * 0.5 : 0;
    this.renderer.setDamage(Math.min(1, this.damageFx * 0.8 + lowHealth));
    // Sniper / DMR: the scope view fades in over the last part of aiming down sights.
    const scopeKind = this.actor.alive && !this.ended && (w.id === 'sniper' || w.id === 'dmr') ? w.id : null;
    this.hud.setScope(scopeKind, scopeKind ? clamp((this.actor.aim01 - 0.78) / 0.15, 0, 1) : 0);
    let fov = settings.fov + (m.sprinting && speed > 1 ? 6 : 0);
    fov = lerp(fov, w.adsFov * (settings.fov / 80), this.actor.aim01);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 14);
    cam.updateProjectionMatrix();

    this.shake = Math.max(0, this.shake - dt * 4);
    const shakeX = (Math.random() - 0.5) * this.shake * 0.02, shakeY = (Math.random() - 0.5) * this.shake * 0.02;
    cam.rotation.order = 'YXZ';

    if (this.actor.alive && this.dance) {
      // Third-person orbit around your dancing character (mouse turns the camera, not the character).
      const tx = px, ty = py + 1.15, tz = pz;
      const dir = dirFromAngles(this.viewYaw, clamp(this.viewPitch, -1.1, 0.6));
      let dist = 3.4;
      const hit = this.world.raycast(tx, ty, tz, -dir.x, -dir.y, -dir.z, dist);
      if (hit) dist = Math.max(0.6, hit.t - 0.25);
      cam.position.set(tx - dir.x * dist, Math.max(0.3, ty - dir.y * dist), tz - dir.z * dist);
      cam.lookAt(tx, ty - 0.1, tz);
      this.renderer.syncSelf({
        pose: { x: px, y: py, z: pz, yaw: this.dance.yaw, pitch: 0, crouch: 0, alive: true, weapon: w.id },
        dance: this.dance.id, danceStartMs: this.dance.start, dt,
        info: { team: this.myTeam, color: this.palette.colors.ally, ally: true, outline: false, outfit: profile.equipped.outfit, camo: profile.equipped.camo, weapon: w.id },
      });
    } else if (this.actor.alive) {
      const bob = m.grounded && settings.cameraBob ? Math.sin(t * 0.012 * (1 + speed * 0.15)) * Math.min(1, speed / 7) * 0.03 * (1 - this.actor.aim01 * 0.85) : 0;
      cam.position.set(px, py + eyeHeightOf(m) + Math.abs(bob), pz);
      cam.rotation.set(clamp(this.viewPitch + this.recoilPitch + this.sway.pitch, -1.5, 1.5) + shakeY, this.viewYaw + this.recoilYaw + this.sway.yaw + shakeX, 0);
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
      aim: this.actor.aim01, reloading: this.actor.ws.reloading, alive: this.actor.alive && !this.ended && !this.dance,
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
    const visible = this.actor.alive && !this.dance && !(m.sprinting && Math.hypot(m.vx, m.vz) > 1) && !ws.reloading;
    this.hud.setCrosshair(px, w.id === 'sniper' ? Math.max(this.actor.aim01, 0) : this.actor.aim01, visible);
    this.hud.setAmmo(ws);
    this.hud.updateDeathTimer();
    this.hud.setTeamBadge(this.myTeam, this.teams, this.modeId);
    if (this.modeState) this.hud.setStatus(this.modeState, this.myTeam, this.myId, this.roster);
    if (this.modeState && this.modeState.z) this.renderer.updateZones(this.modeState.z, performance.now() / 1000);
    this.renderer.syncPickups(this.pickupList || [], performance.now() / 1000);
    this.renderer.syncGrenades(this.grenadeList || [], 1 / 60);
    this.renderer.syncSmokes(this.smokeList || [], performance.now() / 1000);
    // Special ability: icon, cooldown, and cloak / reveal status.
    const ab = abilityById(this.actor.ability);
    this.hud.setAbility(ab, Math.max(0, (this.actor.abilityReady || 0) - this.actor.clock), this.actor.alive, this.cloakLeft || 0);
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
