// Weapon definitions and the deterministic fire/reload/switch state machine shared by client and server.
import { DEG, clamp, hash2 } from './math.js';

/**
 * Data-driven weapon table (the browser equivalent of WeaponData ScriptableObjects).
 * spread values are full cone angles in degrees.
 */
export const WEAPONS = {
  pistol: {
    id: 'pistol', muzzleVel: 370, drag: 0.35, pen: 12, chamber: true, name: 'P9 Sidearm', slot: 1, mode: 'semi', rpm: 420, damage: 25, headMul: 2.0, pellets: 1,
    hip: 1.8, ads: 0.4, move: 1.2, air: 4, bloom: 0.6, bloomMax: 3, bloomRecover: 8,
    recoil: [1.1, 1.5], recoilH: 0.35, mag: 12, reserve: 72, reload: 1.4, reloadEmpty: 1.7,
    range: 90, falloff: [25, 70, 0.6], adsFov: 62, adsTime: 0.14, moveMul: 0.9, equip: 0.25,
    sound: 'pistol', color: '#2b2e33', accent: '#d9a441', size: [0.045, 0.09, 0.2], barrel: 0.06, botRange: [3, 25],
  },
  smg: {
    id: 'smg', muzzleVel: 400, drag: 0.30, pen: 14, chamber: true, name: 'MX-9 SMG', slot: 0, mode: 'auto', rpm: 900, damage: 19, headMul: 1.6, pellets: 1,
    hip: 2.0, ads: 0.6, move: 1.0, air: 3.5, bloom: 0.22, bloomMax: 3.5, bloomRecover: 7,
    recoil: [0.35, 0.55], recoilH: 0.45, mag: 35, reserve: 175, reload: 1.8, reloadEmpty: 2.2,
    range: 120, falloff: [15, 60, 0.5], adsFov: 62, adsTime: 0.16, moveMul: 0.85, equip: 0.35,
    sound: 'smg', color: '#26292d', accent: '#3fc1f2', size: [0.065, 0.1, 0.36], barrel: 0.14, botRange: [3, 25],
  },
  rifle: {
    id: 'rifle', muzzleVel: 790, drag: 0.10, pen: 32, chamber: true, name: 'VK-12 Rifle', slot: 0, mode: 'auto', rpm: 660, damage: 26, headMul: 1.8, pellets: 1,
    hip: 2.6, ads: 0.2, move: 2.2, air: 4, bloom: 0.32, bloomMax: 3, bloomRecover: 6,
    recoil: [0.55, 0.85], recoilH: 0.32, mag: 30, reserve: 150, reload: 2.1, reloadEmpty: 2.6,
    range: 300, falloff: [40, 120, 0.7], adsFov: 55, adsTime: 0.22, moveMul: 0.7, equip: 0.5,
    sound: 'rifle', color: '#2a2c30', accent: '#e8862a', size: [0.07, 0.11, 0.5], barrel: 0.3, botRange: [10, 60],
  },
  shotgun: {
    id: 'shotgun', muzzleVel: 420, drag: 0.80, pen: 6, chamber: false, name: 'Breacher', slot: 0, mode: 'semi', rpm: 85, damage: 13, headMul: 1.4, pellets: 9,
    hip: 7.5, ads: 5, move: 1, air: 2, bloom: 0, bloomMax: 0, bloomRecover: 1,
    recoil: [3.2, 4.2], recoilH: 1.1, mag: 7, reserve: 35, reload: 2.6, reloadEmpty: 3.1,
    range: 45, falloff: [8, 30, 0.25], adsFov: 65, adsTime: 0.2, moveMul: 0.75, equip: 0.55,
    sound: 'shotgun', color: '#2f2a27', accent: '#c0392b', size: [0.08, 0.12, 0.55], barrel: 0.38, botRange: [2, 12],
  },
  lmg: {
    id: 'lmg', muzzleVel: 830, drag: 0.09, pen: 40, chamber: false, name: 'Bulwark LMG', slot: 0, mode: 'auto', rpm: 720, damage: 24, headMul: 1.6, pellets: 1,
    hip: 3.4, ads: 0.6, move: 3, air: 5, bloom: 0.25, bloomMax: 4, bloomRecover: 5,
    recoil: [0.5, 0.75], recoilH: 0.55, mag: 80, reserve: 240, reload: 4.2, reloadEmpty: 4.8,
    range: 260, falloff: [40, 110, 0.65], adsFov: 55, adsTime: 0.32, moveMul: 0.55, equip: 0.8,
    sound: 'lmg', color: '#33302a', accent: '#8bc34a', size: [0.09, 0.13, 0.62], barrel: 0.34, botRange: [10, 55],
  },
  dmr: {
    id: 'dmr', muzzleVel: 840, drag: 0.07, pen: 46, chamber: true, name: 'Arbiter DMR', slot: 0, mode: 'semi', rpm: 260, damage: 48, headMul: 2.0, pellets: 1,
    hip: 3.5, ads: 0.08, move: 2.5, air: 5, bloom: 0.9, bloomMax: 3, bloomRecover: 7,
    recoil: [1.6, 2.1], recoilH: 0.4, mag: 15, reserve: 60, reload: 2.4, reloadEmpty: 2.9,
    range: 400, falloff: [70, 200, 0.8], adsFov: 40, adsTime: 0.26, moveMul: 0.65, equip: 0.55,
    sound: 'dmr', color: '#2c2f2b', accent: '#d4c34a', size: [0.07, 0.12, 0.6], barrel: 0.36, botRange: [20, 110],
  },
  sniper: {
    id: 'sniper', muzzleVel: 900, drag: 0.05, pen: 70, chamber: true, name: 'Longshot', slot: 0, mode: 'semi', rpm: 50, damage: 95, headMul: 2.5, pellets: 1,
    hip: 7, ads: 0.02, move: 4, air: 8, bloom: 2, bloomMax: 4, bloomRecover: 3,
    recoil: [2.6, 3.4], recoilH: 0.6, mag: 5, reserve: 30, reload: 2.9, reloadEmpty: 3.4,
    range: 700, falloff: [150, 600, 0.85], adsFov: 22, adsTime: 0.32, moveMul: 0.5, equip: 0.7,
    sound: 'sniper', color: '#262a26', accent: '#66bb6a', size: [0.07, 0.12, 0.72], barrel: 0.45, botRange: [35, 220],
  },
};

export const PRIMARY_WEAPONS = ['rifle', 'smg', 'shotgun', 'lmg', 'dmr', 'sniper'];
export const SECONDARY_WEAPONS = ['pistol'];
export const BOT_PRIMARY_POOL = ['rifle', 'rifle', 'rifle', 'smg', 'smg', 'shotgun', 'lmg', 'dmr', 'sniper'];
export const GUNGAME_LADDER = ['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'dmr', 'sniper', 'pistol'];

export function secondsPerShot(w) {
  return 60 / w.rpm;
}

export function damageAt(w, distance) {
  const [start, end, minMul] = w.falloff;
  if (distance <= start) return w.damage;
  if (distance >= end) return w.damage * minMul;
  const t = (distance - start) / (end - start);
  return w.damage * (1 + (minMul - 1) * t);
}

/** Creates the per-entity weapon state for a loadout (array of weapon ids, max 2). */
export function createWeaponState(loadout) {
  return {
    slots: loadout.map((id) => ({ id, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve })),
    active: 0,
    nextFire: 0,
    reloadEnd: 0,
    reloading: false,
    equipEnd: 0,
    bloom: 0,
    lastShot: -10,
    burst: 0,
  };
}

export function activeWeapon(ws) {
  const slot = ws.slots[ws.active];
  return slot ? WEAPONS[slot.id] : WEAPONS.pistol;
}

export function refillWeapons(ws) {
  for (const slot of ws.slots) {
    const w = WEAPONS[slot.id];
    slot.mag = w.mag;
    slot.reserve = w.reserve;
  }
  ws.reloading = false;
  ws.bloom = 0;
}

/** Current spread (degrees) given movement state and aim fraction. */
export function currentSpread(ws, speed01, grounded, crouched, aim01) {
  const w = activeWeapon(ws);
  let spread = w.hip + (w.ads - w.hip) * aim01;
  spread += w.move * speed01 * (1 - 0.65 * aim01);
  if (!grounded) spread += w.air;
  spread += ws.bloom * (1 - 0.5 * aim01);
  if (crouched) spread *= 0.75;
  return Math.max(0, spread);
}

export function canFire(ws, now) {
  const slot = ws.slots[ws.active];
  return !!slot && !ws.reloading && slot.mag > 0 && now >= ws.nextFire && now >= ws.equipEnd;
}

/** Consumes a round and advances timing. Assumes canFire() was true. */
export function consumeShot(ws, now) {
  const w = activeWeapon(ws);
  const slot = ws.slots[ws.active];
  slot.mag--;
  const interval = secondsPerShot(w);
  ws.nextFire = now - ws.nextFire < 0.034 ? ws.nextFire + interval : now + interval;
  ws.bloom = Math.min(w.bloomMax, ws.bloom + w.bloom);
  ws.lastShot = now;
}

export function canReload(ws) {
  const slot = ws.slots[ws.active];
  if (!slot || ws.reloading) return false;
  const w = WEAPONS[slot.id];
  return slot.mag < w.mag && slot.reserve > 0;
}

export function startReload(ws, now) {
  if (!canReload(ws)) return 0;
  const slot = ws.slots[ws.active];
  const w = WEAPONS[slot.id];
  const duration = slot.mag === 0 ? w.reloadEmpty : w.reload;
  ws.tactical = slot.mag > 0; // a round stays in the chamber: the magazine ends up at capacity + 1
  ws.reloading = true;
  ws.reloadEnd = now + duration;
  ws.burst = 0;
  return duration;
}

export function finishReload(ws) {
  const slot = ws.slots[ws.active];
  ws.reloading = false;
  if (!slot) return;
  const w = WEAPONS[slot.id];
  const capacity = w.mag + (ws.tactical && w.chamber ? 1 : 0);
  const take = Math.max(0, Math.min(capacity - slot.mag, slot.reserve));
  slot.mag += take;
  slot.reserve -= take;
}

/** Advances timers. Returns true if a reload just completed. */
export function tickWeapons(ws, now, dt) {
  const w = activeWeapon(ws);
  ws.bloom = Math.max(0, ws.bloom - w.bloomRecover * dt);
  if (ws.reloading && now >= ws.reloadEnd) {
    finishReload(ws);
    return true;
  }
  return false;
}

export function switchWeapon(ws, slotIndex, now) {
  if (slotIndex < 0 || slotIndex >= ws.slots.length || slotIndex === ws.active) return false;
  ws.active = slotIndex;
  ws.reloading = false;
  ws.burst = 0;
  ws.bloom = 0;
  const w = activeWeapon(ws);
  ws.equipEnd = now + w.equip;
  ws.nextFire = Math.max(ws.nextFire, ws.equipEnd);
  return true;
}

/** Replaces the whole loadout (gun game, respawn loadout change). */
export function setLoadout(ws, loadout, now) {
  const fresh = createWeaponState(loadout);
  ws.slots = fresh.slots;
  ws.active = 0;
  ws.reloading = false;
  ws.bloom = 0;
  ws.equipEnd = now + activeWeapon(ws).equip;
  ws.nextFire = ws.equipEnd;
}

/** Deterministic spread pattern: identical on shooter (prediction) and server (validation). */
export function spreadDirection(dx, dy, dz, spreadDeg, seed, pellet, out = { x: 0, y: 0, z: 0 }) {
  if (spreadDeg <= 0.0001) {
    out.x = dx; out.y = dy; out.z = dz;
    return out;
  }
  const h = hash2(seed, pellet);
  const u = (h & 0xffff) / 65535;
  const v = ((h >>> 16) & 0xffff) / 65535;
  const cone = Math.sqrt(u) * spreadDeg * 0.5 * DEG;
  const theta = v * Math.PI * 2;
  // Orthonormal basis around the direction.
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(dy) > 0.95) { ux = 1; uy = 0; uz = 0; }
  let rx = uy * dz - uz * dy, ry = uz * dx - ux * dz, rz = ux * dy - uy * dx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const qx = dy * rz - dz * ry, qy = dz * rx - dx * rz, qz = dx * ry - dy * rx;
  const s = Math.sin(cone), c = Math.cos(cone);
  const ct = Math.cos(theta) * s, st = Math.sin(theta) * s;
  out.x = dx * c + rx * ct + qx * st;
  out.y = dy * c + ry * ct + qy * st;
  out.z = dz * c + rz * ct + qz * st;
  const l = Math.hypot(out.x, out.y, out.z) || 1;
  out.x /= l; out.y /= l; out.z /= l;
  return out;
}

export function clampSpreadForValidation(w, spread) {
  return clamp(spread, w.ads * 0.8, 60);
}
