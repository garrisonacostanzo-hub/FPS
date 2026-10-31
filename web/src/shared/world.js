// Static collision world made of axis-aligned boxes, with a uniform XZ grid for fast queries.
import { rayBox } from './math.js';

const CELL = 8;

export class World {
  /**
   * @param {Array<{min:number[],max:number[],m:string}>} boxes
   * @param {number} halfSize half extent of the playable square (metres)
   */
  constructor(boxes, halfSize) {
    this.boxes = boxes;
    this.half = halfSize;
    this.cells = Math.ceil((halfSize * 2) / CELL) + 2;
    this.grid = new Array(this.cells * this.cells);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = [];
    this.stamp = new Uint32Array(boxes.length);
    this.stampId = 1;
    boxes.forEach((b, index) => {
      const x0 = this.cellX(b.min[0]), x1 = this.cellX(b.max[0]);
      const z0 = this.cellX(b.min[2]), z1 = this.cellX(b.max[2]);
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) this.grid[cz * this.cells + cx].push(index);
    });
    this._hit = { nx: 0, ny: 0, nz: 0 };
  }

  cellX(v) {
    const c = Math.floor((v + this.half) / CELL) + 1;
    return c < 0 ? 0 : c >= this.cells ? this.cells - 1 : c;
  }

  nextStamp() {
    this.stampId++;
    if (this.stampId > 0xfffffff0) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    return this.stampId;
  }

  /** Calls fn(box, index) for every box whose grid cells overlap the XZ rectangle. */
  forEachNear(minx, minz, maxx, maxz, fn) {
    const s = this.nextStamp();
    const x0 = this.cellX(minx), x1 = this.cellX(maxx), z0 = this.cellX(minz), z1 = this.cellX(maxz);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.grid[cz * this.cells + cx];
        for (let i = 0; i < list.length; i++) {
          const index = list[i];
          if (this.stamp[index] === s) continue;
          this.stamp[index] = s;
          if (fn(this.boxes[index], index) === true) return true;
        }
      }
    }
    return false;
  }

  /** True if the AABB overlaps any box (or the ground plane / outside bounds when checkGround). */
  overlaps(minx, miny, minz, maxx, maxy, maxz) {
    if (miny < 0) return true;
    return this.forEachNear(minx, minz, maxx, maxz, (b) =>
      minx < b.max[0] && maxx > b.min[0] && miny < b.max[1] && maxy > b.min[1] && minz < b.max[2] && maxz > b.min[2]);
  }

  /** Collects boxes overlapping an AABB into out[]. */
  collect(minx, miny, minz, maxx, maxy, maxz, out) {
    out.length = 0;
    this.forEachNear(minx, minz, maxx, maxz, (b) => {
      if (minx < b.max[0] && maxx > b.min[0] && miny < b.max[1] && maxy > b.min[1] && minz < b.max[2] && maxz > b.min[2]) out.push(b);
      return false;
    });
    return out;
  }

  /** Highest walkable surface at (x,z) not above maxY (ground = 0). */
  surfaceHeight(x, z, maxY = 1e9) {
    let best = 0;
    this.forEachNear(x, z, x, z, (b) => {
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] && b.max[1] <= maxY && b.max[1] > best) best = b.max[1];
      return false;
    });
    return best;
  }

  /**
   * Raycast against the ground plane and all boxes. Direction must be normalized.
   * Returns { t, nx, ny, nz } or null.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let bestT = maxDist;
    let hit = false;
    let nx = 0, ny = 1, nz = 0;
    // Ground plane y = 0.
    if (dy < -1e-6) {
      const tg = -oy / dy;
      if (tg >= 0 && tg < bestT) { bestT = tg; hit = true; nx = 0; ny = 1; nz = 0; }
    }

    // Walk the grid cells covered by the ray in slices of one cell length to keep the candidate set small.
    const maxT = bestT;
    const steps = Math.max(1, Math.ceil(maxT / CELL));
    const s = this.nextStamp();
    const h = this._hit;
    for (let i = 0; i < steps; i++) {
      const t0 = (i / steps) * maxT, t1 = ((i + 1) / steps) * maxT;
      const ax = ox + dx * t0, az = oz + dz * t0, bx = ox + dx * t1, bz = oz + dz * t1;
      const x0 = this.cellX(Math.min(ax, bx)), x1 = this.cellX(Math.max(ax, bx));
      const z0 = this.cellX(Math.min(az, bz)), z1 = this.cellX(Math.max(az, bz));
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const list = this.grid[cz * this.cells + cx];
          for (let k = 0; k < list.length; k++) {
            const index = list[k];
            if (this.stamp[index] === s) continue;
            this.stamp[index] = s;
            const b = this.boxes[index];
            const t = rayBox(ox, oy, oz, dx, dy, dz, b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2], bestT, h);
            if (t >= 0 && t < bestT) {
              bestT = t; hit = true; nx = h.nx; ny = h.ny; nz = h.nz;
            }
          }
        }
      }
      if (hit && bestT <= t1) break; // nothing in later slices can be closer
    }
    return hit ? { t: bestT, nx, ny, nz } : null;
  }

  /** Unobstructed line between two points? */
  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-4) return true;
    const hit = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d);
    return !hit || hit.t >= d - 0.05;
  }
}
