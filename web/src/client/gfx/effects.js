// Combat effects: glowing tracers, impact sparks, dust/smoke puffs, bullet-hole decals, ejected shell casings and
// pooled muzzle lights. Everything is pooled so firing never allocates.
import * as THREE from 'three';

function softTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function holeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(0.25, 'rgba(10,10,10,0.95)'); grad.addColorStop(0.45, 'rgba(40,36,30,0.6)'); grad.addColorStop(1, 'rgba(60,55,50,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const UP = new THREE.Vector3(0, 1, 0);
const SPARKS = 400;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.puffs = [];
    this.decals = [];
    this.decalIndex = 0;
    this.casings = [];
    this.lights = [];
    this.tmp = new THREE.Vector3();
    this.tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
    this.smokeTex = softTexture('rgba(255,255,255,0.8)', 'rgba(255,255,255,0)');
    this.holeTex = holeTexture();
    this.holeGeo = new THREE.PlaneGeometry(0.14, 0.14);
    this.holeMat = new THREE.MeshBasicMaterial({ map: this.holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    // Sparks: one Points cloud updated on the CPU.
    this.sparkPos = new Float32Array(SPARKS * 3);
    this.sparkCol = new Float32Array(SPARKS * 3);
    this.sparkVel = new Float32Array(SPARKS * 3);
    this.sparkLife = new Float32Array(SPARKS);
    this.sparkNext = 0;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.06, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
    // Casings.
    const casingGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.03, 6);
    const casingMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.9, roughness: 0.3 });
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(casingGeo, casingMat);
      m.visible = false;
      scene.add(m);
      this.casings.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), until: 0 });
    }
    // Muzzle lights (fixed count keeps shader programs stable).
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffb060, 0, 10, 2);
      scene.add(light);
      this.lights.push({ light, until: 0 });
    }
  }

  tracer(from, to, color, durationMs) {
    let t = this.tracers.find((x) => !x.mesh.visible);
    if (!t) {
      if (this.tracers.length >= 60) t = this.tracers[0];
      else {
        const mesh = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        t = { mesh, until: 0 };
        this.tracers.push(t);
      }
    }
    const a = this.tmp.set(from.x, from.y, from.z);
    const dir = new THREE.Vector3(to[0] - a.x, to[1] - a.y, to[2] - a.z);
    const len = dir.length();
    if (len < 0.01) return;
    // Draw the streak as a moving segment of the shot rather than the whole line.
    const seg = Math.min(len, 6);
    t.from = a.clone(); t.dir = dir.normalize(); t.len = len; t.seg = seg;
    t.mesh.quaternion.setFromUnitVectors(UP, t.dir);
    t.mesh.scale.set(1.4, seg, 1.4);
    t.mesh.material.color.set(color || 0xffd27a).multiplyScalar(3);
    t.mesh.visible = true;
    t.start = performance.now();
    t.until = t.start + Math.max(40, durationMs ?? (len / 450) * 1000);
    this.placeTracer(t, 0);
  }

  placeTracer(t, k) {
    const d = Math.min(t.len - t.seg * 0.5, t.seg * 0.5 + (t.len - t.seg) * k);
    t.mesh.position.copy(t.from).addScaledVector(t.dir, d);
  }

  /** Impact after `delayMs` (when the bullet actually arrives). */
  impactAt(point, character, material, delayMs) {
    if (!delayMs || delayMs < 8) { this.impact(point, character, material); return; }
    (this.pending || (this.pending = [])).push({ at: performance.now() + delayMs, point, character, material });
  }

  impact(point, character, material = null) {
    const [x, y, z, nx = 0, ny = 1, nz = 0] = point;
    if (!character) {
      // Bullet hole.
      let d = this.decals[this.decalIndex];
      if (!d) {
        d = new THREE.Mesh(this.holeGeo, this.holeMat);
        this.scene.add(d);
        this.decals[this.decalIndex] = d;
      }
      this.decalIndex = (this.decalIndex + 1) % 140;
      const n = this.tmp.set(nx, ny, nz);
      if (n.lengthSq() < 0.5) n.set(0, 1, 0);
      d.position.set(x + n.x * 0.01, y + n.y * 0.01, z + n.z * 0.01);
      d.lookAt(d.position.x + n.x, d.position.y + n.y, d.position.z + n.z);
      d.rotation.z = Math.random() * 6;
      d.scale.setScalar(0.7 + Math.random() * 0.6);
      // Material response: metal sparks, masonry dust, wood splinters, sand and dirt.
      const m = material || 'ground';
      if (m === 'metal' || m === 'container' || m === 'containerB' || m === 'stairs' || m === 'boundary') {
        this.spawnSparks(x, y, z, nx, ny, nz, 14, 1, 0.8, 0.4);
        this.puff(x, y, z, 0x6a6a6a, 0.12, 0.35, 220);
      } else if (m === 'crate' || m === 'floor') {
        this.puff(x, y, z, 0x8a6a43, 0.22, 0.6, 450);
        this.spawnSparks(x, y, z, nx, ny, nz, 5, 0.55, 0.38, 0.2);
      } else if (m === 'sand') {
        this.puff(x, y, z, 0xc2a173, 0.4, 0.7, 700);
      } else if (m === 'ground') {
        this.puff(x, y, z, 0x6b5a44, 0.35, 0.65, 600);
      } else {
        this.puff(x, y, z, 0xa89c8c, 0.3, 0.6, 520);
        this.spawnSparks(x, y, z, nx, ny, nz, 4, 1, 0.75, 0.35);
      }
    } else {
      this.puff(x, y, z, 0x8a1010, 0.18, 0.4, 240);
      this.spawnSparks(x, y, z, 0, 1, 0, 4, 1, 0.25, 0.2);
    }
  }

  muzzleSmoke(pos) {
    this.puff(pos.x, pos.y, pos.z, 0xcfcfcf, 0.12, 0.25, 500);
  }

  puff(x, y, z, color, size, opacity, life) {
    let p = this.puffs.find((q) => !q.sprite.visible);
    if (!p) {
      if (this.puffs.length >= 60) return;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false }));
      this.scene.add(sprite);
      p = { sprite };
      this.puffs.push(p);
    }
    p.sprite.material.color.set(color);
    p.sprite.position.set(x, y, z);
    p.sprite.scale.set(size, size, 1);
    p.base = opacity;
    p.size = size;
    p.sprite.visible = true;
    p.start = performance.now();
    p.until = p.start + life;
  }

  spawnSparks(x, y, z, nx, ny, nz, count, r, g, b) {
    for (let i = 0; i < count; i++) {
      const k = this.sparkNext;
      this.sparkNext = (this.sparkNext + 1) % SPARKS;
      this.sparkPos[k * 3] = x; this.sparkPos[k * 3 + 1] = y; this.sparkPos[k * 3 + 2] = z;
      const s = 2 + Math.random() * 4;
      this.sparkVel[k * 3] = (nx + (Math.random() - 0.5) * 1.4) * s;
      this.sparkVel[k * 3 + 1] = (ny + Math.random() * 0.8) * s;
      this.sparkVel[k * 3 + 2] = (nz + (Math.random() - 0.5) * 1.4) * s;
      this.sparkLife[k] = 0.25 + Math.random() * 0.25;
      this.sparkCol[k * 3] = r * 2; this.sparkCol[k * 3 + 1] = g * 2; this.sparkCol[k * 3 + 2] = b * 2;
    }
  }

  /** Brass flying out of the ejection port (first person). */
  ejectCasing(origin, right, up) {
    const c = this.casings.find((q) => q.until < performance.now()) || this.casings[0];
    c.mesh.position.copy(origin);
    c.vel.copy(right).multiplyScalar(1.6 + Math.random()).addScaledVector(up, 1.4 + Math.random() * 0.6);
    c.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    c.mesh.visible = true;
    c.until = performance.now() + 900;
  }

  muzzleLight(position, intensity = 7) {
    const slot = this.lights.reduce((a, b) => (a.until < b.until ? a : b), this.lights[0]);
    slot.light.position.copy(position);
    slot.light.intensity = intensity;
    slot.until = performance.now() + 50;
  }

  update(dt) {
    const now = performance.now();
    if (this.pending && this.pending.length) {
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const p = this.pending[i];
        if (now >= p.at) { this.impact(p.point, p.character, p.material); this.pending.splice(i, 1); }
      }
    }
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      if (now > t.until) { t.mesh.visible = false; continue; }
      this.placeTracer(t, (now - t.start) / (t.until - t.start));
    }
    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      if (now > p.until) { p.sprite.visible = false; continue; }
      const k = (now - p.start) / (p.until - p.start);
      p.sprite.material.opacity = p.base * (1 - k);
      const s = p.size * (1 + k * 2.5);
      p.sprite.scale.set(s, s, 1);
      p.sprite.position.y += dt * 0.3;
    }
    let live = 0;
    for (let k = 0; k < SPARKS; k++) {
      if (this.sparkLife[k] <= 0) continue;
      this.sparkLife[k] -= dt;
      if (this.sparkLife[k] <= 0) { this.sparkPos[k * 3 + 1] = -1000; continue; }
      live++;
      this.sparkVel[k * 3 + 1] -= 9.8 * dt;
      this.sparkPos[k * 3] += this.sparkVel[k * 3] * dt;
      this.sparkPos[k * 3 + 1] += this.sparkVel[k * 3 + 1] * dt;
      this.sparkPos[k * 3 + 2] += this.sparkVel[k * 3 + 2] * dt;
      this.sparkCol[k * 3] *= 0.92; this.sparkCol[k * 3 + 1] *= 0.9; this.sparkCol[k * 3 + 2] *= 0.88;
    }
    if (live || this.sparksWereLive) {
      this.sparks.geometry.attributes.position.needsUpdate = true;
      this.sparks.geometry.attributes.color.needsUpdate = true;
    }
    this.sparksWereLive = live > 0;
    for (const c of this.casings) {
      if (!c.mesh.visible) continue;
      if (now > c.until) { c.mesh.visible = false; continue; }
      c.vel.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
    }
    for (const l of this.lights) if (now > l.until) l.light.intensity = 0;
  }
}
