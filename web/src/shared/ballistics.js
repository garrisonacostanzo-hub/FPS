// Bullet ballistics shared by the authoritative match (real bullets, damage, penetration) and the client
// (predicted tracers and impacts). Bullets fly at the weapon's muzzle velocity, lose speed to air drag, drop
// under gravity, and can punch through thin cover depending on the material, its thickness and the cartridge.
import { rayBox } from './math.js';

export const GRAVITY = 9.81;
export const BULLET_STEP = 1 / 60; // integration step (seconds); server and client use the same one

// Material resistance per centimetre and the "effective thickness" cap for hollow objects (crates and shipping
// containers are hollow, the map stores them as solid boxes). Penetration power is in centimetres of soft wood.
const MATERIALS = {
  crate: [1.0, 0.24], wall: [0.7, 1], baseA: [0.7, 1], baseB: [0.7, 1], wallDark: [1.0, 1], brick: [1.5, 1],
  concrete: [2.6, 1], metal: [2.4, 1], container: [3.0, 0.08], containerB: [3.0, 0.08], sand: [4.0, 1],
  rock: [50, 1], stairs: [2.2, 1], floor: [1.2, 1], boundary: [1000, 1],
};
export const MATERIAL_IDS = Object.keys(MATERIALS);

/** Cost (cm of soft wood) of punching through `thickness` metres of `box`. */
export function penetrationCost(box, thickness) {
  const [resistance, cap] = MATERIALS[box.m] || [2, 1];
  return Math.min(thickness, cap) * 100 * resistance;
}

/** Distance from a point on/inside a box to where a ray leaves it. */
export function exitDistance(px, py, pz, dx, dy, dz, box) {
  let t = Infinity;
  const axis = (p, d, min, max) => {
    if (d > 1e-9) t = Math.min(t, (max - p) / d);
    else if (d < -1e-9) t = Math.min(t, (min - p) / d);
  };
  axis(px, dx, box.min[0], box.max[0]);
  axis(py, dy, box.min[1], box.max[1]);
  axis(pz, dz, box.min[2], box.max[2]);
  return Math.max(0, t);
}

/** New bullet state. */
export function createBullet(ox, oy, oz, dx, dy, dz, weapon) {
  const v = weapon.muzzleVel;
  return { x: ox, y: oy, z: oz, vx: dx * v, vy: dy * v, vz: dz * v, dist: 0, age: 0, power: weapon.pen, power0: weapon.pen, dmgMul: 1, drag: weapon.drag };
}

/** Advances velocity by one step (drag, then gravity). */
export function accelerate(b, h) {
  const k = Math.max(0, 1 - b.drag * h);
  b.vx *= k; b.vz *= k;
  b.vy = b.vy * k - GRAVITY * h;
}

/**
 * Simulates a bullet path against the static world (and optionally other targets) without penetration, for
 * tracers and predicted impacts. hitTest(x, y, z, dx, dy, dz, maxT) may return a distance (target hit) or -1.
 * Returns { x, y, z, nx, ny, nz, time, dist, kind: 'world' | 'target' | 'none', box }.
 */
export function tracePath(world, ox, oy, oz, dx, dy, dz, weapon, hitTest = null) {
  const b = createBullet(ox, oy, oz, dx, dy, dz, weapon);
  const maxDist = weapon.range * 1.5;
  while (b.dist < maxDist && b.age < 3) {
    accelerate(b, BULLET_STEP);
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    if (speed < 30) break;
    const len = speed * BULLET_STEP;
    const ux = b.vx / speed, uy = b.vy / speed, uz = b.vz / speed;
    const wh = world.raycast(b.x, b.y, b.z, ux, uy, uz, len);
    const limit = wh ? wh.t : len;
    const ht = hitTest ? hitTest(b.x, b.y, b.z, ux, uy, uz, limit) : -1;
    if (ht >= 0 && ht <= limit) {
      return { x: b.x + ux * ht, y: b.y + uy * ht, z: b.z + uz * ht, nx: 0, ny: 0, nz: 0, time: b.age + (ht / len) * BULLET_STEP, dist: b.dist + ht, kind: 'target', box: null };
    }
    if (wh) {
      return { x: b.x + ux * wh.t, y: b.y + uy * wh.t, z: b.z + uz * wh.t, nx: wh.nx, ny: wh.ny, nz: wh.nz, time: b.age + (wh.t / len) * BULLET_STEP, dist: b.dist + wh.t, kind: 'world', box: wh.box };
    }
    b.x += ux * len; b.y += uy * len; b.z += uz * len;
    b.dist += len;
    b.age += BULLET_STEP;
  }
  return { x: b.x, y: b.y, z: b.z, nx: 0, ny: 1, nz: 0, time: b.age, dist: b.dist, kind: 'none', box: null };
}

/** Time for a bullet to cover `distance` metres (approximate, includes drag), and how far it has dropped by then. */
export function flightTime(weapon, distance) {
  const v0 = weapon.muzzleVel, k = weapon.drag;
  // Linear drag: v(t) = v0 e^(-k t)  =>  x(t) = v0 (1 - e^(-k t)) / k.
  const frac = (distance * k) / v0;
  if (frac >= 0.99) return 3;
  const t = -Math.log(1 - frac) / k;
  return t;
}

export function dropAt(weapon, distance) {
  const t = flightTime(weapon, distance);
  return 0.5 * GRAVITY * t * t;
}

/** Nearest box-or-sphere hit along a segment (used for targets). */
export function segmentHitsBox(ox, oy, oz, dx, dy, dz, maxT, minx, miny, minz, maxx, maxy, maxz, out) {
  return rayBox(ox, oy, oz, dx, dy, dz, minx, miny, minz, maxx, maxy, maxz, maxT, out);
}
