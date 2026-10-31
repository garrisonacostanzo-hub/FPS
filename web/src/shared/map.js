// Procedural, data-driven map generation. Produces axis-aligned boxes plus gameplay metadata
// (team spawns, FFA spawns, capture zones, cover sources, patrol points, tactical areas).
import { makeRng } from './math.js';

export const MAP_LIST = [
  { id: 'outpost', name: 'Outpost', description: 'Large mixed map: sniper towers, two CQB compounds, three lanes.', size: 'Large' },
  { id: 'foundry', name: 'Foundry', description: 'Dense industrial blocks with rooms, alleys and courtyards.', size: 'Medium' },
  { id: 'crossfire', name: 'Crossfire', description: 'Compact symmetric arena built for fast FFA and Elimination rounds.', size: 'Small' },
];

class MapBuilder {
  constructor(id, name, half, seed) {
    this.map = {
      id, name, half,
      boxes: [],
      spawns: { 0: [], 1: [], ffa: [] },
      zones: [],
      coverSources: [],
      patrol: [],
      areas: [],
      theme: {},
    };
    this.rng = makeRng(seed);
  }

  /** Raw box from min/max corners. cover: 0 none, 1 low, 2 high. */
  box(x0, y0, z0, x1, y1, z1, m, cover = 0) {
    const b = {
      min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
      max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
      m,
    };
    this.map.boxes.push(b);
    if (cover) this.map.coverSources.push(b);
    return b;
  }

  /** Box by footprint centre and size. */
  block(cx, cz, w, h, d, m, y = 0, cover = 0) {
    return this.box(cx - w / 2, y, cz - d / 2, cx + w / 2, y + h, cz + d / 2, m, cover);
  }

  /** Wall along X from x0..x1 at z with door gaps [[a,b],...] and windows [[a,b],...]. */
  wallX(x0, x1, z, opts = {}) {
    const h = opts.h ?? 3, t = opts.t ?? 0.3, m = opts.m ?? 'wall';
    const openings = [...(opts.doors || []).map((d) => ({ a: d[0], b: d[1], door: true })), ...(opts.windows || []).map((w) => ({ a: w[0], b: w[1], door: false }))]
      .sort((p, q) => p.a - q.a);
    let cursor = x0;
    for (const o of openings) {
      if (o.a > cursor) this.box(cursor, 0, z - t / 2, o.a, h, z + t / 2, m, 2);
      if (!o.door) {
        this.box(o.a, 0, z - t / 2, o.b, 1.0, z + t / 2, m, 1);
        this.box(o.a, 2.2, z - t / 2, o.b, h, z + t / 2, m);
      }
      cursor = Math.max(cursor, o.b);
    }
    if (cursor < x1) this.box(cursor, 0, z - t / 2, x1, h, z + t / 2, m, 2);
  }

  wallZ(z0, z1, x, opts = {}) {
    const h = opts.h ?? 3, t = opts.t ?? 0.3, m = opts.m ?? 'wall';
    const openings = [...(opts.doors || []).map((d) => ({ a: d[0], b: d[1], door: true })), ...(opts.windows || []).map((w) => ({ a: w[0], b: w[1], door: false }))]
      .sort((p, q) => p.a - q.a);
    let cursor = z0;
    for (const o of openings) {
      if (o.a > cursor) this.box(x - t / 2, 0, cursor, x + t / 2, h, o.a, m, 2);
      if (!o.door) {
        this.box(x - t / 2, 0, o.a, x + t / 2, 1.0, o.b, m, 1);
        this.box(x - t / 2, 2.2, o.a, x + t / 2, h, o.b, m);
      }
      cursor = Math.max(cursor, o.b);
    }
    if (cursor < z1) this.box(x - t / 2, 0, cursor, x + t / 2, h, z1, m, 2);
  }

  /**
   * Rectangular roofless building with doors (2 m) and windows on each side.
   * doors/windows: { n:[offset...], s:[...], e:[...], w:[...] } offsets from the side centre.
   */
  building(cx, cz, w, d, opts = {}) {
    const m = opts.m ?? 'wall';
    const hw = w / 2, hd = d / 2;
    const gap = (list, half) => (list || []).map((o) => [o - half, o + half]);
    const doors = opts.doors || {}, windows = opts.windows || {};
    // north = -z, south = +z
    this.wallX(cx - hw, cx + hw, cz - hd, { m, doors: gap(doors.n, 1).map(([a, b]) => [cx + a, cx + b]), windows: gap(windows.n, 1.1).map(([a, b]) => [cx + a, cx + b]) });
    this.wallX(cx - hw, cx + hw, cz + hd, { m, doors: gap(doors.s, 1).map(([a, b]) => [cx + a, cx + b]), windows: gap(windows.s, 1.1).map(([a, b]) => [cx + a, cx + b]) });
    this.wallZ(cz - hd + 0.15, cz + hd - 0.15, cx - hw, { m, doors: gap(doors.w, 1).map(([a, b]) => [cz + a, cz + b]), windows: gap(windows.w, 1.1).map(([a, b]) => [cz + a, cz + b]) });
    this.wallZ(cz - hd + 0.15, cz + hd - 0.15, cx + hw, { m, doors: gap(doors.e, 1).map(([a, b]) => [cz + a, cz + b]), windows: gap(windows.e, 1.1).map(([a, b]) => [cz + a, cz + b]) });
    this.block(cx, cz, w, 0.08, d, 'floor', 0);
    this.map.areas.push({ name: opts.name || 'Building', type: 'cqb', x: cx, z: cz, w, d });
  }

  /**
   * Sniper tower: solid base with a staircase on one side and railings on top.
   * dir: side of the stairs 'n' | 's' | 'e' | 'w'.
   */
  tower(cx, cz, size, height, dir, name) {
    const half = size / 2;
    this.block(cx, cz, size, height, size, 'concrete');
    const rise = 0.4, run = 0.55, width = 1.8;
    const steps = Math.ceil(height / rise);
    for (let i = 0; i < steps; i++) {
      const top = Math.min(height, rise * (i + 1));
      const offset = half + run * (steps - i) - run / 2;
      const along = -half + width / 2 + 0.2;
      if (dir === 's') this.block(cx + along, cz + offset, width, top, run, 'stairs');
      if (dir === 'n') this.block(cx - along, cz - offset, width, top, run, 'stairs');
      if (dir === 'e') this.block(cx + offset, cz - along, run, top, width, 'stairs');
      if (dir === 'w') this.block(cx - offset, cz + along, run, top, width, 'stairs');
    }
    // Railings (low cover) on top, leaving the stair side open where the stairs arrive.
    const y = height, rh = 1.05, t = 0.25;
    if (dir !== 'n') this.box(cx - half, y, cz - half, cx + half, y + rh, cz - half + t, 'metal', 1);
    else this.box(cx - half + 2.4, y, cz - half, cx + half, y + rh, cz - half + t, 'metal', 1);
    if (dir !== 's') this.box(cx - half, y, cz + half - t, cx + half, y + rh, cz + half, 'metal', 1);
    else this.box(cx - half, y, cz + half - t, cx + half - 2.4, y + rh, cz + half, 'metal', 1);
    if (dir !== 'w') this.box(cx - half, y, cz - half + t, cx - half + t, y + rh, cz + half - t, 'metal', 1);
    else this.box(cx - half, y, cz - half + 2.4, cx - half + t, y + rh, cz + half - t, 'metal', 1);
    if (dir !== 'e') this.box(cx + half - t, y, cz - half + t, cx + half, y + rh, cz + half - t, 'metal', 1);
    else this.box(cx + half - t, y, cz - half + t, cx + half, y + rh, cz + half - 2.4, 'metal', 1);
    this.map.areas.push({ name: name || 'Tower', type: 'perch', x: cx, z: cz, w: size + 6, d: size + 6 });
    this.map.patrol.push({ x: cx, z: cz });
  }

  crate(cx, cz, s = 1.2, stack = 1) {
    for (let i = 0; i < stack; i++) this.block(cx, cz, s, s, s, 'crate', i * s, i === stack - 1 ? (s * stack >= 1.6 ? 2 : 1) : 0);
  }

  crateCluster(cx, cz, rot = 0) {
    const pts = rot ? [[0, 0, 2], [1.3, 0, 1], [0, 1.3, 1]] : [[0, 0, 2], [0, 1.3, 1], [1.3, 0, 1]];
    for (const [dx, dz, st] of pts) this.crate(cx + dx, cz + dz, 1.2, st);
  }

  container(cx, cz, alongX, color = 'container') {
    if (alongX) this.block(cx, cz, 6, 2.6, 2.4, color, 0, 2);
    else this.block(cx, cz, 2.4, 2.6, 6, color, 0, 2);
  }

  barrier(cx, cz, alongX) {
    if (alongX) this.block(cx, cz, 2.8, 1.0, 0.55, 'concrete', 0, 1);
    else this.block(cx, cz, 0.55, 1.0, 2.8, 'concrete', 0, 1);
  }

  sandbags(cx, cz, alongX) {
    if (alongX) this.block(cx, cz, 3, 0.95, 0.8, 'sand', 0, 1);
    else this.block(cx, cz, 0.8, 0.95, 3, 'sand', 0, 1);
  }

  rock(cx, cz, s) {
    const r = this.rng;
    this.block(cx, cz, s * r.range(0.9, 1.3), s * r.range(0.6, 0.9), s * r.range(0.9, 1.3), 'rock', 0, s * 0.75 >= 1.6 ? 2 : 1);
    this.block(cx + s * r.range(-0.25, 0.25), cz + s * r.range(-0.25, 0.25), s * 0.6, s * r.range(0.9, 1.2), s * 0.6, 'rock', 0, 0);
  }

  zone(id, x, z, r, name) {
    this.map.zones.push({ id, x, z, r, name });
    this.map.patrol.push({ x, z });
    this.map.areas.push({ name: name || 'Objective ' + id, type: 'objective', x, z, w: r * 2.6, d: r * 2.6 });
  }

  spawnRow(team, cx, cz, yaw, count, spacing = 2.6) {
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * spacing;
      const sx = Math.abs(Math.sin(yaw)) > 0.5 ? cx : cx + offset;
      const sz = Math.abs(Math.sin(yaw)) > 0.5 ? cz + offset : cz;
      this.map.spawns[team].push({ x: sx, z: sz, yaw });
    }
  }

  boundary(height = 7) {
    const h = this.map.half;
    this.box(-h - 1, 0, -h - 1, h + 1, height, -h, 'boundary');
    this.box(-h - 1, 0, h, h + 1, height, h + 1, 'boundary');
    this.box(-h - 1, 0, -h, -h, height, h, 'boundary');
    this.box(h, 0, -h, h + 1, height, h, 'boundary');
  }

  /** Mirrors a placement callback through the map centre (point symmetry) for fair layouts. */
  mirrored(fn) {
    fn(1);
    fn(-1);
  }

  finish() {
    const map = this.map;
    // FFA spawns: both team spawns plus scattered safe points near patrol locations.
    map.spawns.ffa = [...map.spawns[0], ...map.spawns[1]];
    for (const p of map.patrol) {
      map.spawns.ffa.push({ x: p.x + 4, z: p.z + 4, yaw: this.rng.range(-Math.PI, Math.PI) });
    }
    return map;
  }
}

// ------------------------------------------------------------------------------------------------
// OUTPOST: large, mixed engagement distances
// ------------------------------------------------------------------------------------------------
function buildOutpost(seed) {
  const b = new MapBuilder('outpost', 'Outpost', 90, seed);
  b.map.theme = { sky: 0x9ec9ff, fog: 0xbdd4ea, fogDensity: 0.0075, ground: 'grass', sun: [0.55, 1, 0.35], sunIntensity: 2.6, timeOfDay: 'day' };
  b.boundary(8);

  // Team bases: Alpha south (+z, facing -z), Bravo north (-z, facing +z).
  b.mirrored((s) => {
    const z = 74 * s;
    b.wallX(-22, 22, z + 8 * s, { h: 3.2, m: s > 0 ? 'baseA' : 'baseB' });
    b.wallZ(Math.min(z - 4 * s, z + 8 * s), Math.max(z - 4 * s, z + 8 * s), -22, { h: 3.2, m: s > 0 ? 'baseA' : 'baseB' });
    b.wallZ(Math.min(z - 4 * s, z + 8 * s), Math.max(z - 4 * s, z + 8 * s), 22, { h: 3.2, m: s > 0 ? 'baseA' : 'baseB' });
    for (const x of [-16, -8, 8, 16]) b.sandbags(x, z - 5 * s, true);
    b.container(-12, z + 2 * s, true);
    b.container(12, z + 2 * s, true);
    b.spawnRow(s > 0 ? 0 : 1, 0, z + 3 * s, s > 0 ? 0 : Math.PI, 8, 2.4);
    b.map.areas.push({ name: s > 0 ? 'Alpha Base' : 'Bravo Base', type: 'base', x: 0, z: z + 2 * s, w: 44, d: 14 });
  });

  // Objectives on the midline.
  b.zone('A', -46, 0, 7, 'Quarry');
  b.zone('B', 0, 0, 6.5, 'Crossroads');
  b.zone('C', 46, 0, 7, 'Depot');

  // B: crossroads plaza.
  for (const [x, z, ax] of [[-6, -6, true], [6, 6, true], [-6, 6, false], [6, -6, false]]) b.barrier(x, z, ax);
  b.crate(0, -10.5, 1.2, 2); b.crate(0, 10.5, 1.2, 2);
  b.block(-11, 0, 0.6, 3, 4, 'wallDark', 0, 2); b.block(11, 0, 0.6, 3, 4, 'wallDark', 0, 2);

  // A: quarry rocks / C: container depot (mirror-ish).
  for (const [x, z, s] of [[-54, -7, 3], [-38, 7, 3.2], [-52, 8, 2.4], [-40, -8, 2.6], [-46, 12, 2]]) b.rock(x, z, s);
  b.crateCluster(-47, -3);
  for (const [x, z, ax] of [[52, -7, true], [40, 7, true], [54, 6, false], [38, -6, false]]) b.container(x, z, ax, 'container');
  b.crateCluster(45, 2, 1);

  // CQB compounds (point-symmetric).
  b.mirrored((s) => {
    const cx = -52 * s, cz = 38 * s;
    b.building(cx, cz, 26, 18, {
      name: s > 0 ? 'West Compound' : 'East Compound',
      doors: { n: [-6, 6], s: [0], e: [-3], w: [4] },
      windows: { n: [0], s: [-8, 8], e: [5], w: [-5] },
    });
    // Interior partitions
    b.wallZ(cz - 9 + 0.15, cz + 9 - 0.15, cx, { doors: [[cz - 5, cz - 3], [cz + 3, cz + 5]] });
    b.wallX(cx, cx + 13 - 0.15, cz, { doors: [[cx + 5, cx + 7]] });
    b.crate(cx - 7, cz - 4, 1.2, 2); b.crate(cx - 9, cz + 5, 1.2, 1); b.crate(cx + 5, cz + 5, 1.2, 2); b.crate(cx + 9, cz - 5, 1.2, 1);
    b.map.patrol.push({ x: cx - 6, z: cz }, { x: cx + 6, z: cz + 4 });
  });

  // Sniper towers on the flanks.
  b.tower(-72, -26, 6, 6, 'e', 'West Tower');
  b.tower(72, 26, 6, 6, 'w', 'East Tower');
  b.map.areas.push({ name: 'West Tower', type: 'perch', x: -72, z: -26, w: 12, d: 12 });

  // Lanes with cover.
  b.mirrored((s) => {
    for (const lx of [-46, 0, 46]) {
      for (const lz of [22, 36, 52]) {
        const x = (lx + (lz === 36 ? 5 : -5)) * s, z = lz * s;
        if (Math.abs(x) > 40 && Math.abs(z - 38 * s) < 12 && Math.sign(x) === -Math.sign(s)) continue;
        const pick = (Math.abs(lx) + lz) % 3;
        if (pick === 0) b.barrier(x, z, true);
        else if (pick === 1) b.sandbags(x, z, true);
        else b.crate(x, z, 1.2, 2);
      }
    }
    b.wallX(-30 * s - 4, -30 * s + 4, 18 * s, { h: 2.4, m: 'wallDark' });
    b.wallZ(-4 + 26 * s, 4 + 26 * s, 24 * s, { h: 2.4, m: 'wallDark' });
    b.container(28 * s, -20 * s, false);
    b.crateCluster(-24 * s, 46 * s);
  });

  // Scatter rocks (mirrored), avoiding structures.
  for (let i = 0; i < 14; i++) {
    const x = b.rng.range(-80, 80), z = b.rng.range(-60, 60);
    if (Math.abs(z) < 14 || (Math.abs(x) > 35 && Math.abs(Math.abs(z) - 38) < 14) || Math.abs(Math.abs(x) - 72) < 9) continue;
    const s = b.rng.range(1.6, 3.2);
    b.rock(x, z, s);
    b.rock(-x, -z, s);
  }

  b.map.patrol.push({ x: -25, z: 25 }, { x: 25, z: -25 }, { x: -60, z: -45 }, { x: 60, z: 45 }, { x: 0, z: 40 }, { x: 0, z: -40 });
  b.map.areas.push({ name: 'West Lane', type: 'corridor', x: -46, z: 0, w: 14, d: 120 });
  b.map.areas.push({ name: 'Main Street', type: 'corridor', x: 0, z: 0, w: 14, d: 120 });
  b.map.areas.push({ name: 'East Lane', type: 'corridor', x: 46, z: 0, w: 14, d: 120 });
  return b.finish();
}

// ------------------------------------------------------------------------------------------------
// FOUNDRY: dense CQB blocks with alleys and courtyards
// ------------------------------------------------------------------------------------------------
function buildFoundry(seed) {
  const b = new MapBuilder('foundry', 'Foundry', 62, seed);
  b.map.theme = { sky: 0xc9a77c, fog: 0xb59a7a, fogDensity: 0.012, ground: 'concrete', sun: [-0.4, 1, 0.6], sunIntensity: 2.2, timeOfDay: 'dusk' };
  b.boundary(9);

  b.zone('A', -36, 0, 6, 'Smelter Yard');
  b.zone('B', 0, 0, 6, 'Central Court');
  b.zone('C', 36, 0, 6, 'Loading Bay');

  // Six buildings around three courtyards.
  for (const sx of [-36, 0, 36]) {
    for (const sz of [-30, 30]) {
      b.building(sx, sz, 22, 18, {
        name: sz < 0 ? 'North Works' : 'South Works',
        m: 'brick',
        doors: { n: [-5, 5], s: [-5, 5], e: [0], w: [0] },
        windows: { n: [0], s: [0], e: [-5, 5], w: [-5, 5] },
      });
      b.wallX(sx - 11 + 0.15, sx + 11 - 0.15, sz, { doors: [[sx - 7, sx - 5], [sx + 5, sx + 7]], m: 'brick' });
      b.wallZ(sz - 9 + 0.15, sz + 9 - 0.15, sx, { doors: [[sz - 6, sz - 4], [sz + 4, sz + 6]], m: 'brick' });
      b.crate(sx - 6, sz - 5, 1.2, 2);
      b.crate(sx + 6, sz + 5, 1.2, 1);
      b.block(sx + 6, sz - 5, 2.5, 1.1, 1, 'metal', 0, 1);
      b.map.patrol.push({ x: sx - 5, z: sz - 4 }, { x: sx + 5, z: sz + 4 });
    }
  }

  // Courtyard cover.
  b.mirrored((s) => {
    b.container(-36 + 8 * s, 6 * s, true, 'container');
    b.crateCluster(-30 * s, -5 * s);
    b.barrier(5 * s, 5 * s, false);
    b.barrier(-5 * s, 5 * s, true);
    b.container(36 - 7 * s, -6 * s, false, 'containerB');
    b.sandbags(36 + 5 * s, 4 * s, true);
    b.block(18 * s, 0, 1.2, 2.6, 6, 'metal', 0, 2);
  });
  b.crate(0, 0, 1.4, 2);

  // Catwalk towers in the alleys.
  b.tower(-18, -12, 4, 5, 'e', 'West Gantry');
  b.tower(18, 12, 4, 5, 'w', 'East Gantry');

  // Team spawns along the north/south edges.
  b.spawnRow(0, 0, 54, 0, 8, 3);
  b.spawnRow(1, 0, -54, Math.PI, 8, 3);
  b.mirrored((s) => {
    for (const x of [-20, 20]) b.sandbags(x, 47 * s, true);
    b.container(-44, 50 * s, true); b.container(44, 50 * s, true);
  });
  b.map.areas.push({ name: 'Alpha Gate', type: 'base', x: 0, z: 53, w: 50, d: 10 });
  b.map.areas.push({ name: 'Bravo Gate', type: 'base', x: 0, z: -53, w: 50, d: 10 });
  b.map.patrol.push({ x: -18, z: 0 }, { x: 18, z: 0 }, { x: 0, z: 18 }, { x: 0, z: -18 });
  return b.finish();
}

// ------------------------------------------------------------------------------------------------
// CROSSFIRE: compact symmetric arena
// ------------------------------------------------------------------------------------------------
function buildCrossfire(seed) {
  const b = new MapBuilder('crossfire', 'Crossfire', 38, seed);
  b.map.theme = { sky: 0x1d2440, fog: 0x2a3150, fogDensity: 0.02, ground: 'dark', sun: [0.3, 1, -0.5], sunIntensity: 1.6, timeOfDay: 'night' };
  b.boundary(6);
  b.zone('A', -20, 0, 5, 'West Pit');
  b.zone('B', 0, 0, 5, 'Core');
  b.zone('C', 20, 0, 5, 'East Pit');

  b.block(0, 0, 3, 1.1, 3, 'metal', 0, 1);
  b.mirrored((s) => {
    b.wallX(-10, 10, 10 * s, { h: 2.8, m: 'wallDark', doors: [[-2, 2]], windows: [[-7, -5], [5, 7]] });
    b.wallZ(-6, 6, 12 * s, { h: 2.8, m: 'wallDark', doors: [[-1, 1]] });
    b.crate(-20 * s, 6 * s, 1.2, 2);
    b.barrier(-20 * s, -5 * s, true);
    b.sandbags(-26 * s, 0, false);
    b.container(26 * s, 22 * s, true);
    b.crateCluster(-28 * s, 24 * s);
    b.barrier(8 * s, 24 * s, true);
    b.barrier(-8 * s, 20 * s, false);
  });
  b.tower(-30, -28, 4, 4, 'e', 'NW Perch');
  b.tower(30, 28, 4, 4, 'w', 'SE Perch');

  b.spawnRow(0, 0, 32, 0, 6, 2.6);
  b.spawnRow(1, 0, -32, Math.PI, 6, 2.6);
  b.map.areas.push({ name: 'Alpha Side', type: 'base', x: 0, z: 32, w: 30, d: 8 });
  b.map.areas.push({ name: 'Bravo Side', type: 'base', x: 0, z: -32, w: 30, d: 8 });
  b.map.patrol.push({ x: -14, z: 18 }, { x: 14, z: -18 }, { x: 28, z: 0 }, { x: -28, z: 0 });
  return b.finish();
}

const BUILDERS = { outpost: buildOutpost, foundry: buildFoundry, crossfire: buildCrossfire };

export function buildMap(id, seed = 1337) {
  const builder = BUILDERS[id] || BUILDERS.outpost;
  return builder(seed);
}

/**
 * Generates cover points around cover sources: positions next to each side of an obstacle, with the
 * direction pointing at the obstacle and its height class. Validation against navigation happens in nav.js.
 */
export function generateCoverPoints(map, spacing = 1.6) {
  const points = [];
  for (const b of map.coverSources) {
    const height = b.max[1] - b.min[1];
    if (height < 0.9 || b.min[1] > 0.5) continue;
    const high = height >= 1.65;
    const sides = [
      { nx: 0, nz: -1, ax: 'x', at: b.min[2] - 0.65 },
      { nx: 0, nz: 1, ax: 'x', at: b.max[2] + 0.65 },
      { nx: -1, nz: 0, ax: 'z', at: b.min[0] - 0.65 },
      { nx: 1, nz: 0, ax: 'z', at: b.max[0] + 0.65 },
    ];
    for (const side of sides) {
      const lo = side.ax === 'x' ? b.min[0] : b.min[2];
      const hi = side.ax === 'x' ? b.max[0] : b.max[2];
      const length = hi - lo;
      const count = Math.max(1, Math.floor(length / spacing));
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : (i + 0.5) / count;
        const along = lo + length * t;
        const x = side.ax === 'x' ? along : side.at;
        const z = side.ax === 'x' ? side.at : along;
        points.push({ x, z, y: 0, dx: -side.nx, dz: -side.nz, high });
      }
    }
  }
  return points;
}
