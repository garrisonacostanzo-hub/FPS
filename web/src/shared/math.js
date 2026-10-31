// Small, allocation-light math helpers shared by client and server.

export const DEG = Math.PI / 180;

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function moveTowards(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export function angleDiff(a, b) {
  return wrapAngle(b - a);
}

export function lerpAngle(a, b, t) {
  return a + angleDiff(a, b) * t;
}

export function moveTowardsAngle(current, target, maxDelta) {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Forward vector for yaw/pitch (radians). Convention matches three.js cameras: yaw 0 looks down -Z. */
export function dirFromAngles(yaw, pitch, out = { x: 0, y: 0, z: 0 }) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

export function anglesFromDir(dx, dy, dz) {
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return { yaw, pitch };
}

export function dist3(ax, ay, az, bx, by, bz) {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function normalize(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  v.x /= l; v.y /= l; v.z /= l;
  return v;
}

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (min, max) => min + rng() * (max - min);
  rng.int = (min, maxExclusive) => Math.floor(min + rng() * (maxExclusive - min));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return rng;
}

/** Integer hash used for reproducible pellet spread (identical on client and server). */
export function hash2(a, b) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b + 0x7f4a7c15) | 0, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Point-to-segment distance (3D). */
export function distToSegment(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const len = abx * abx + aby * aby + abz * abz;
  let t = len > 1e-9 ? ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len : 0;
  t = clamp(t, 0, 1);
  return dist3(px, py, pz, ax + abx * t, ay + aby * t, az + abz * t);
}

/** Ray vs sphere; returns distance or -1. Direction must be normalized. */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  const t0 = tca - thc;
  if (t0 >= 0) return t0;
  const t1 = tca + thc;
  return t1 >= 0 ? 0 : -1;
}

/** Ray vs AABB (slab test). Returns entry distance or -1, writes the hit normal into out. */
export function rayBox(ox, oy, oz, dx, dy, dz, minx, miny, minz, maxx, maxy, maxz, maxDist, out) {
  let tmin = 0, tmax = maxDist, axis = -1, sign = 0;
  // X
  if (Math.abs(dx) < 1e-9) {
    if (ox < minx || ox > maxx) return -1;
  } else {
    const inv = 1 / dx;
    let t1 = (minx - ox) * inv, t2 = (maxx - ox) * inv, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Y
  if (Math.abs(dy) < 1e-9) {
    if (oy < miny || oy > maxy) return -1;
  } else {
    const inv = 1 / dy;
    let t1 = (miny - oy) * inv, t2 = (maxy - oy) * inv, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Z
  if (Math.abs(dz) < 1e-9) {
    if (oz < minz || oz > maxz) return -1;
  } else {
    const inv = 1 / dz;
    let t1 = (minz - oz) * inv, t2 = (maxz - oz) * inv, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (out) {
    out.nx = axis === 0 ? sign : 0;
    out.ny = axis === 1 ? sign : 0;
    out.nz = axis === 2 ? sign : 0;
  }
  return tmin;
}
