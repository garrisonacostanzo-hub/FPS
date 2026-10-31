// 2.5D navigation grid (one walkable surface per cell) + A* pathfinding with path smoothing.
import { MOVE } from './constants.js';

const STEP = 0.85;     // max climb between neighbouring cell centres (stairs: 0.4 m steps, ~2 per cell)
const DROP = 4.5;      // max one-way drop
const SQRT2 = Math.SQRT2;

class MinHeap {
  constructor(capacity) {
    this.items = new Int32Array(capacity);
    this.keys = new Float32Array(capacity);
    this.size = 0;
  }

  clear() { this.size = 0; }

  push(item, key) {
    let i = this.size++;
    if (i >= this.items.length) {
      const grow = this.items.length * 2;
      const items = new Int32Array(grow); items.set(this.items); this.items = items;
      const keys = new Float32Array(grow); keys.set(this.keys); this.keys = keys;
    }
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.items[i] = this.items[p]; this.keys[i] = this.keys[p];
      i = p;
    }
    this.items[i] = item; this.keys[i] = key;
  }

  pop() {
    const top = this.items[0];
    const lastItem = this.items[--this.size];
    const lastKey = this.keys[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= lastKey) break;
      this.items[i] = this.items[c]; this.keys[i] = this.keys[c];
      i = c;
    }
    this.items[i] = lastItem; this.keys[i] = lastKey;
    return top;
  }
}

export class NavGrid {
  /**
   * @param {import('./world.js').World} world
   * @param {object} map built map (spawns are used as reachability seeds)
   * @param {number} cellSize metres
   */
  constructor(world, map, cellSize = 1) {
    this.world = world;
    this.cell = cellSize;
    this.half = map.half;
    this.n = Math.floor((map.half * 2) / cellSize);
    const count = this.n * this.n;
    this.height = new Float32Array(count);
    this.walk = new Uint8Array(count);
    this.g = new Float32Array(count);
    this.from = new Int32Array(count);
    this.visit = new Uint32Array(count);
    this.closed = new Uint32Array(count);
    this.stamp = 1;
    this.heap = new MinHeap(4096);

    const r = MOVE.radius + 0.05;
    for (let iz = 0; iz < this.n; iz++) {
      for (let ix = 0; ix < this.n; ix++) {
        const i = iz * this.n + ix;
        const x = this.cx(ix), z = this.cz(iz);
        const h = world.surfaceHeight(x, z);
        this.height[i] = h;
        const blocked = world.overlaps(x - r, h + 0.06, z - r, x + r, h + MOVE.standHeight - 0.1, z + r);
        this.walk[i] = blocked ? 0 : 1;
      }
    }

    // Keep only cells reachable from the spawn areas (removes wall tops and sealed pockets).
    const seeds = [...map.spawns[0], ...map.spawns[1]];
    const reach = new Uint8Array(count);
    const queue = new Int32Array(count);
    let head = 0, tail = 0;
    for (const s of seeds) {
      const i = this.nearestWalkable(s.x, s.z, 6);
      if (i >= 0 && !reach[i]) { reach[i] = 1; queue[tail++] = i; }
    }
    while (head < tail) {
      const i = queue[head++];
      this.forNeighbours(i, (j) => {
        if (!reach[j]) { reach[j] = 1; queue[tail++] = j; }
      });
    }
    // Cells that can only be reached by dropping down remain valid; cells that cannot be reached at all are removed.
    for (let i = 0; i < count; i++) if (!reach[i]) this.walk[i] = 0;
    this.walkableCount = tail;
  }

  cx(ix) { return -this.half + (ix + 0.5) * this.cell; }
  cz(iz) { return -this.half + (iz + 0.5) * this.cell; }

  index(x, z) {
    const ix = Math.floor((x + this.half) / this.cell);
    const iz = Math.floor((z + this.half) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return -1;
    return iz * this.n + ix;
  }

  isWalkable(x, z) {
    const i = this.index(x, z);
    return i >= 0 && this.walk[i] === 1;
  }

  heightAt(x, z) {
    const i = this.index(x, z);
    return i >= 0 ? this.height[i] : 0;
  }

  point(i) {
    const ix = i % this.n, iz = (i / this.n) | 0;
    return { x: this.cx(ix), y: this.height[i], z: this.cz(iz) };
  }

  /** Calls fn(j, cost) for every traversable neighbour of i. */
  forNeighbours(i, fn) {
    const n = this.n;
    const ix = i % n, iz = (i / n) | 0;
    const h = this.height[i];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
        const j = jz * n + jx;
        if (!this.walk[j]) continue;
        const dh = this.height[j] - h;
        if (dh > STEP || dh < -DROP) continue;
        if (dx && dz) {
          // No corner cutting.
          const a = iz * n + jx, b = jz * n + ix;
          if (!this.walk[a] || !this.walk[b]) continue;
          if (Math.abs(this.height[a] - h) > STEP || Math.abs(this.height[b] - h) > STEP) continue;
        }
        const cost = (dx && dz ? SQRT2 : 1) + (dh > 0.05 ? dh * 1.5 : dh < -STEP ? 2 : 0);
        fn(j, cost);
      }
    }
  }

  nearestWalkable(x, z, maxRadius = 8) {
    const i0 = this.index(x, z);
    if (i0 >= 0 && this.walk[i0]) return i0;
    const n = this.n;
    const cx = Math.floor((x + this.half) / this.cell), cz = Math.floor((z + this.half) / this.cell);
    const maxR = Math.ceil(maxRadius / this.cell);
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const ix = cx + dx, iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
          const j = iz * n + ix;
          if (!this.walk[j]) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = j; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  randomPoint(rng, nearX = 0, nearZ = 0, radius = 0) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = radius > 0 ? nearX + rng.range(-radius, radius) : rng.range(-this.half, this.half);
      const z = radius > 0 ? nearZ + rng.range(-radius, radius) : rng.range(-this.half, this.half);
      const i = this.index(x, z);
      if (i >= 0 && this.walk[i]) return this.point(i);
    }
    const i = this.nearestWalkable(nearX, nearZ, 20);
    return i >= 0 ? this.point(i) : null;
  }

  /** A* from world position to world position. Returns smoothed array of {x,y,z} or null. */
  findPath(sx, sz, tx, tz, maxExpansions = 9000) {
    const start = this.nearestWalkable(sx, sz, 4);
    const goal = this.nearestWalkable(tx, tz, 6);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [this.point(goal)];

    this.stamp++;
    if (this.stamp > 0xfffffff0) { this.visit.fill(0); this.closed.fill(0); this.stamp = 1; }
    const s = this.stamp;
    const n = this.n;
    const gx = goal % n, gz = (goal / n) | 0;
    const heuristic = (i) => {
      const dx = Math.abs((i % n) - gx), dz = Math.abs(((i / n) | 0) - gz);
      return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz);
    };
    const heap = this.heap;
    heap.clear();
    this.g[start] = 0;
    this.from[start] = -1;
    this.visit[start] = s;
    heap.push(start, heuristic(start));
    let expansions = 0;
    let found = false;
    while (heap.size > 0) {
      const i = heap.pop();
      if (this.closed[i] === s) continue;
      this.closed[i] = s;
      if (i === goal) { found = true; break; }
      if (++expansions > maxExpansions) break;
      const gi = this.g[i];
      this.forNeighbours(i, (j, cost) => {
        if (this.closed[j] === s) return;
        const ng = gi + cost;
        if (this.visit[j] !== s || ng < this.g[j]) {
          this.visit[j] = s;
          this.g[j] = ng;
          this.from[j] = i;
          heap.push(j, ng + heuristic(j));
        }
      });
    }
    if (!found) return null;

    const cells = [];
    for (let i = goal; i !== -1; i = this.from[i]) cells.push(i);
    cells.reverse();
    return this.smooth(cells);
  }

  /** Greedy string pulling: skip intermediate cells while the straight segment stays walkable. */
  smooth(cells) {
    const out = [];
    let anchor = 0;
    out.push(this.point(cells[0]));
    while (anchor < cells.length - 1) {
      let next = anchor + 1;
      for (let k = cells.length - 1; k > anchor + 1; k--) {
        if (this.straightWalkable(cells[anchor], cells[k])) { next = k; break; }
      }
      out.push(this.point(cells[next]));
      anchor = next;
    }
    return out;
  }

  straightWalkable(a, b) {
    const pa = this.point(a), pb = this.point(b);
    const dist = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    if (dist > 24) return false;
    const steps = Math.ceil(dist / (this.cell * 0.5));
    let prevH = pa.y;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const x = pa.x + (pb.x - pa.x) * t, z = pa.z + (pb.z - pa.z) * t;
      // Check a small cross so the agent's width also fits.
      for (const [ox, oz] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
        const i = this.index(x + ox, z + oz);
        if (i < 0 || !this.walk[i]) return false;
      }
      const i = this.index(x, z);
      const h = this.height[i];
      if (h - prevH > STEP || prevH - h > STEP) return false;
      prevH = h;
    }
    return true;
  }
}
