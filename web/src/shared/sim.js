// Per-command simulation step shared by the authoritative game, client-side prediction and bots.
// Keeping this in one place guarantees that prediction replays produce the same results as the server.
import { BTN, MOVE, PLAYER } from './constants.js';
import { clamp, dirFromAngles, hash2, moveTowards } from './math.js';
import { createMotorState, eyeHeightOf, heightOf, simulateMotor } from './movement.js';
import {
  WEAPONS, activeWeapon, canFire, canReload, consumeShot, createWeaponState, currentSpread,
  startReload, switchWeapon, tickWeapons,
} from './weapons.js';

export const NOISE = { pistol: 50, smg: 55, rifle: 75, shotgun: 80, lmg: 85, dmr: 95, sniper: 130 };

/** Minimal predicted actor: everything stepCommand needs. */
export function createActor(x, y, z, yaw, loadout) {
  return {
    motor: createMotorState(x, y, z, yaw),
    ws: createWeaponState(loadout),
    clock: 0,
    aim01: 0,
    prevFire: false,
    sprintLock: 0,
    alive: true,
  };
}

/**
 * Applies one input command to an actor.
 * hooks.onShot(actor, shot) where shot = { ox, oy, oz, dx, dy, dz, spread, seed, weapon, index }
 * hooks.onNoise(actor, radius, kind)
 * hooks.onReload(actor, duration)
 * hooks.onSwitch(actor, slot)
 */
export function stepCommand(actor, cmd, world, hooks) {
  const dt = clamp(cmd.dt || 0, 0, 0.05);
  actor.clock += dt;
  const m = actor.motor;
  if (!actor.alive) {
    m.yaw = cmd.yaw; m.pitch = cmd.pitch;
    actor.prevFire = ((cmd.b | 0) & BTN.FIRE) !== 0;
    return;
  }

  const ws = actor.ws;
  if (cmd.sw >= 0 && switchWeapon(ws, cmd.sw, actor.clock)) {
    actor.aim01 = 0;
    hooks && hooks.onSwitch && hooks.onSwitch(actor, cmd.sw);
  }

  if (cmd.r && canReload(ws)) {
    const duration = startReload(ws, actor.clock);
    if (duration > 0 && hooks && hooks.onReload) hooks.onReload(actor, duration);
  }

  let buttons = cmd.b | 0;
  const w = activeWeapon(ws);
  const aiming = (buttons & BTN.AIM) !== 0 && !ws.reloading && actor.clock >= ws.equipEnd - w.equip * 0.5;
  if (!aiming) buttons &= ~BTN.AIM;
  actor.aim01 = moveTowards(actor.aim01, aiming ? 1 : 0, dt / Math.max(0.05, w.adsTime));
  if (aiming) buttons &= ~BTN.SPRINT;

  const event = simulateMotor(m, { dt, mx: cmd.mx, mz: cmd.mz, yaw: cmd.yaw, pitch: cmd.pitch, buttons }, world, w.moveMul);
  if (m.noise > 0 && hooks && hooks.onNoise) hooks.onNoise(actor, m.noise, event === 2 ? 'land' : 'step');

  if (tickWeapons(ws, actor.clock, dt) && hooks && hooks.onReloadDone) hooks.onReloadDone(actor);
  if (m.sprinting && Math.hypot(m.vx, m.vz) > 1) actor.sprintLock = actor.clock + 0.16;

  const fireHeld = (buttons & BTN.FIRE) !== 0;
  const pressed = fireHeld && !actor.prevFire;
  actor.prevFire = fireHeld;
  if (!fireHeld || m.sprinting || actor.clock < actor.sprintLock) return;

  const slot = ws.slots[ws.active];
  if (slot && slot.mag <= 0) {
    if (pressed && canReload(ws)) {
      const duration = startReload(ws, actor.clock);
      if (duration > 0 && hooks && hooks.onReload) hooks.onReload(actor, duration);
    } else if (pressed && hooks && hooks.onDryFire) {
      hooks.onDryFire(actor);
    }
    return;
  }

  const maxShots = w.mode === 'auto' ? 3 : 1;
  if (w.mode !== 'auto' && !pressed) return;
  let shots = 0;
  while (shots < maxShots && canFire(ws, actor.clock)) {
    const speed01 = clamp(Math.hypot(m.vx, m.vz) / MOVE.walkSpeed, 0, 1.5);
    const spread = currentSpread(ws, speed01, m.grounded, m.crouch > 0.5, actor.aim01);
    consumeShot(ws, actor.clock);
    const eye = m.y + eyeHeightOf(m);
    const dir = dirFromAngles(m.yaw, m.pitch);
    if (hooks && hooks.onShot) {
      hooks.onShot(actor, {
        ox: m.x, oy: eye, oz: m.z, dx: dir.x, dy: dir.y, dz: dir.z,
        spread, seed: hash2(actor.id | 0, ((cmd.s | 0) * 4 + shots) | 0), weapon: w, index: shots,
      });
    }
    shots++;
    if (w.mode !== 'auto') break;
  }

  // Auto-reload when the magazine runs dry.
  if (slot && slot.mag <= 0 && canReload(ws)) {
    const duration = startReload(ws, actor.clock + Math.max(0, ws.nextFire - actor.clock));
    if (duration > 0 && hooks && hooks.onReload) hooks.onReload(actor, duration);
  }
}

/** Hitbox geometry for an actor at a position (used identically by server hit detection and client effects). */
export function hitboxesAt(x, y, z, crouch, out) {
  const height = MOVE.standHeight + (MOVE.crouchHeight - MOVE.standHeight) * crouch;
  const eye = MOVE.standEye + (MOVE.crouchEye - MOVE.standEye) * crouch;
  out.hx = x; out.hy = y + eye + 0.06; out.hz = z; out.hr = PLAYER.headRadius;
  const w = PLAYER.bodyHalfWidth;
  out.minx = x - w; out.miny = y; out.minz = z - w;
  out.maxx = x + w; out.maxy = y + height - 0.34; out.maxz = z + w;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Compact (de)serialisation of predicted actor state used in snapshots for reconciliation.
// ---------------------------------------------------------------------------------------------

const r3 = (v) => Math.round(v * 1000) / 1000;

export function packActor(a) {
  const m = a.motor, ws = a.ws;
  return [
    r3(m.x), r3(m.y), r3(m.z), r3(m.vx), r3(m.vy), r3(m.vz), r3(m.crouch), m.crouching ? 1 : 0, m.grounded ? 1 : 0,
    m.sprinting ? 1 : 0, r3(m.coyote), r3(m.jumpBuffer), r3(m.stride),
    r3(a.clock), r3(a.aim01), a.prevFire ? 1 : 0, r3(a.sprintLock),
    ws.active, r3(ws.nextFire), r3(ws.reloadEnd), ws.reloading ? 1 : 0, r3(ws.equipEnd), r3(ws.bloom), r3(ws.lastShot),
    ws.slots.map((s) => [s.id, s.mag, s.reserve]),
  ];
}

export function unpackActor(p, a) {
  const m = a.motor, ws = a.ws;
  m.x = p[0]; m.y = p[1]; m.z = p[2]; m.vx = p[3]; m.vy = p[4]; m.vz = p[5]; m.crouch = p[6];
  m.crouching = p[7] === 1; m.grounded = p[8] === 1; m.sprinting = p[9] === 1;
  m.coyote = p[10]; m.jumpBuffer = p[11]; m.stride = p[12];
  a.clock = p[13]; a.aim01 = p[14]; a.prevFire = p[15] === 1; a.sprintLock = p[16];
  ws.active = p[17]; ws.nextFire = p[18]; ws.reloadEnd = p[19]; ws.reloading = p[20] === 1; ws.equipEnd = p[21];
  ws.bloom = p[22]; ws.lastShot = p[23];
  const slots = p[24];
  if (ws.slots.length !== slots.length || ws.slots.some((s, i) => s.id !== slots[i][0])) {
    ws.slots = slots.map(([id, mag, reserve]) => ({ id, mag, reserve }));
  } else {
    for (let i = 0; i < slots.length; i++) { ws.slots[i].mag = slots[i][1]; ws.slots[i].reserve = slots[i][2]; }
  }
  return a;
}

export function weaponById(id) {
  return WEAPONS[id] || WEAPONS.pistol;
}

export { heightOf, eyeHeightOf };
