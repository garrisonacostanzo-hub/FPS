// Three.js presentation layer: map geometry (merged per material, box-mapped UVs), lighting and shadows,
// character models, capture zones, effects (tracers, impacts, muzzle flashes) and the first-person view model.
import * as THREE from 'three';
import { TEAM, TEAM_COLORS } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { settings } from './settings.js';

const PALETTE = {
  floor: '#6b6e73', wall: '#c27a43', wallDark: '#4b4f57', concrete: '#8a8d90', crate: '#8a6a43', metal: '#737a82',
  sand: '#a89268', container: '#2f6f8f', containerB: '#8f3a2f', rock: '#77736c', stairs: '#5c6066', brick: '#8e4f3a',
  baseA: '#3d6fb5', baseB: '#b5523d', boundary: '#34373c',
};
const GROUND = { grass: '#4f6b3a', concrete: '#6f6a62', dark: '#2b2f38' };

// ---------------------------------------------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------------------------------------------
function makeTexture(kind, color, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  const shade = (alpha) => `rgba(0,0,0,${alpha})`;
  const light = (alpha) => `rgba(255,255,255,${alpha})`;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rnd() < 0.5 ? shade(rnd() * 0.07) : light(rnd() * 0.05);
    g.fillRect(rnd() * size, rnd() * size, 2 + rnd() * 4, 2 + rnd() * 4);
  }
  g.strokeStyle = shade(0.22);
  g.lineWidth = 3;
  if (kind === 'brick') {
    const bh = size / 8;
    for (let y = 0; y < 8; y++) {
      g.beginPath(); g.moveTo(0, y * bh); g.lineTo(size, y * bh); g.stroke();
      const off = (y % 2) * size / 8;
      for (let x = 0; x < 4; x++) { g.beginPath(); g.moveTo(off + x * size / 4, y * bh); g.lineTo(off + x * size / 4, (y + 1) * bh); g.stroke(); }
    }
  } else if (kind === 'crate') {
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * size / 4); g.lineTo(size, i * size / 4); g.stroke(); }
    g.lineWidth = 10; g.strokeStyle = shade(0.25); g.strokeRect(5, 5, size - 10, size - 10);
  } else if (kind === 'container') {
    g.lineWidth = 6;
    for (let x = 0; x < size; x += 16) { g.strokeStyle = x % 32 ? light(0.08) : shade(0.2); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size); g.stroke(); }
  } else if (kind === 'stairs' || kind === 'boundary') {
    g.lineWidth = 8;
    for (let y = 0; y < size; y += 32) { g.strokeStyle = shade(0.25); g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke(); }
  } else if (kind === 'sand') {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) {
      g.fillStyle = shade(0.08); g.beginPath();
      g.ellipse((x + 0.5 + (y % 2) * 0.5) * size / 3, (y + 0.5) * size / 4, size / 7, size / 10, 0, 0, Math.PI * 2); g.fill();
    }
  } else if (kind !== 'rock') {
    const cells = kind === 'floor' || kind === 'ground' ? 4 : 2;
    for (let i = 0; i <= cells; i++) {
      g.beginPath(); g.moveTo(0, i * size / cells); g.lineTo(size, i * size / cells); g.stroke();
      g.beginPath(); g.moveTo(i * size / cells, 0); g.lineTo(i * size / cells, size); g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------------------------------------------
// Map geometry: one merged mesh per material with world-scaled UVs
// ---------------------------------------------------------------------------------------------------------------
function buildMapMeshes(map, scene, quality) {
  const groups = new Map();
  for (const b of map.boxes) {
    if (!groups.has(b.m)) groups.set(b.m, []);
    groups.get(b.m).push(b);
  }
  const meshes = [];
  for (const [m, boxes] of groups) {
    const positions = [], normals = [], uvs = [], indices = [];
    const tile = m === 'floor' ? 4 : 2;
    for (const b of boxes) {
      const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
      const faces = [
        [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], z1 - z0, y1 - y0, 'zy'],
        [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0], z1 - z0, y1 - y0, 'zy'],
        [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], x1 - x0, z1 - z0, 'xz'],
        [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0], x1 - x0, z1 - z0, 'xz'],
        [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1], x1 - x0, y1 - y0, 'xy'],
        [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], x1 - x0, y1 - y0, 'xy'],
      ];
      for (const [a, bq, c, d, n, w, h, plane] of faces) {
        if (n[1] === -1 && y0 <= 0.01) continue; // bottom faces on the ground are never visible
        const base = positions.length / 3;
        for (const p of [a, bq, c, d]) { positions.push(p[0], p[1], p[2]); normals.push(n[0], n[1], n[2]); }
        const ou = plane === 'xz' ? x0 / tile : plane === 'zy' ? z0 / tile : x0 / tile;
        const ov = plane === 'xz' ? z0 / tile : y0 / tile;
        uvs.push(ou, ov, ou, ov + h / tile, ou + w / tile, ov + h / tile, ou + w / tile, ov);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const kind = m.startsWith('container') ? 'container' : m === 'baseA' || m === 'baseB' ? 'wall' : m;
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: makeTexture(kind, PALETTE[m] || '#888888'),
      roughness: m === 'metal' || m.startsWith('container') ? 0.55 : 0.9,
      metalness: m === 'metal' || m.startsWith('container') ? 0.35 : 0.02,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = quality !== 'low';
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

// ---------------------------------------------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------------------------------------------
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const sphereGeo = new THREE.SphereGeometry(0.5, 12, 10);
const materialCache = new Map();
function mat(color, emissive = 0) {
  const key = color + ':' + emissive;
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive }));
  }
  return materialCache.get(key);
}

function part(geo, material, sx, sy, sz, x, y, z, parent) {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function buildGun(weaponId, scale = 1, flashParent = true) {
  const w = WEAPONS[weaponId] || WEAPONS.rifle;
  const g = new THREE.Group();
  const [sx, sy, sz] = w.size.map((v) => v * scale);
  const body = mat(w.color), accent = mat(w.accent);
  part(boxGeo, body, sx, sy, sz, 0, 0, 0, g);
  part(boxGeo, body, sx * 0.8, sy * 0.85, sz * 0.32, 0, -sy * 0.08, sz * 0.64, g);
  part(boxGeo, mat('#1c1d20'), sx * 0.7, sy * 0.95, sx * 1.1, 0, -sy * 0.75, sz * 0.2, g);
  part(boxGeo, accent, sx * 0.45, sy * 0.3, sz * 0.32, 0, sy * 0.62, sz * 0.05, g);
  part(boxGeo, accent, sx * 0.6, sy * 1.1, sx * 1.3, 0, -sy * 0.8, -sz * 0.12, g);
  const barrelLen = w.barrel * scale;
  part(boxGeo, mat('#111214'), sx * 0.35, sx * 0.35, barrelLen, 0, sy * 0.15, -sz * 0.5 - barrelLen * 0.5, g);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, sy * 0.15, -sz * 0.5 - barrelLen - 0.02);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  if (flashParent) {
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffcc66, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    flash.scale.set(0.25 * scale, 0.25 * scale, 1);
    flash.visible = false;
    muzzle.add(flash);
    g.userData.flash = flash;
  }
  return g;
}

function nameSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.strokeText(text, 128, 40);
  g.fillStyle = color;
  g.fillText(text, 128, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}

class CharacterModel {
  constructor(scene, info) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    scene.add(this.root);
    this.info = info;
    const teamColor = TEAM_COLORS[info.team] || TEAM_COLORS[2];
    const dark = mat('#2a2d33'), skin = mat('#3a3f47'), team = mat(teamColor);
    this.legL = part(boxGeo, dark, 0.18, 0.85, 0.22, -0.11, 0.43, 0, this.body);
    this.legR = part(boxGeo, dark, 0.18, 0.85, 0.22, 0.11, 0.43, 0, this.body);
    this.torso = part(boxGeo, team, 0.5, 0.62, 0.28, 0, 1.15, 0, this.body);
    part(boxGeo, dark, 0.38, 0.4, 0.14, 0, 1.18, 0.2, this.body);
    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 1.5, 0);
    this.body.add(this.headPivot);
    part(sphereGeo, skin, 0.3, 0.32, 0.3, 0, 0.14, 0, this.headPivot);
    part(boxGeo, mat('#ffd36b', 0.6), 0.22, 0.06, 0.05, 0, 0.17, -0.14, this.headPivot);
    this.armPivot = new THREE.Group();
    this.armPivot.position.set(0, 1.35, 0);
    this.body.add(this.armPivot);
    part(boxGeo, team, 0.12, 0.12, 0.5, 0.24, -0.05, -0.2, this.armPivot);
    part(boxGeo, team, 0.12, 0.12, 0.45, -0.18, -0.08, -0.25, this.armPivot);
    this.gunSocket = new THREE.Group();
    this.gunSocket.position.set(0.12, -0.02, -0.4);
    this.armPivot.add(this.gunSocket);
    this.weapon = null;
    this.setWeapon(info.weapon || 'rifle');
    this.label = null;
    this.walkPhase = 0;
    this.deathBlend = 0;
    this.lastPos = null;
  }

  setWeapon(id) {
    if (this.weaponId === id) return;
    this.weaponId = id;
    if (this.weapon) this.gunSocket.remove(this.weapon);
    this.weapon = buildGun(id, 1);
    this.gunSocket.add(this.weapon);
  }

  setLabel(text, color) {
    if (this.label) { this.root.remove(this.label); this.label.material.map.dispose(); this.label.material.dispose(); this.label = null; }
    if (text) {
      this.label = nameSprite(text, color);
      this.label.position.set(0, 2.15, 0);
      this.root.add(this.label);
    }
  }

  update(p, dt) {
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    const crouchScale = 1 - 0.36 * p.crouch;
    this.body.scale.y = crouchScale;
    this.armPivot.rotation.x = p.pitch;
    this.headPivot.rotation.x = p.pitch * 0.6;
    let speed = 0;
    if (this.lastPos) speed = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z) / Math.max(dt, 1e-3);
    this.lastPos = { x: p.x, z: p.z };
    if (speed > 0.3 && p.alive) {
      this.walkPhase += dt * (4 + speed * 1.4);
      const swing = Math.sin(this.walkPhase) * Math.min(0.7, speed * 0.12);
      this.legL.rotation.x = swing; this.legR.rotation.x = -swing;
    } else {
      this.legL.rotation.x *= 0.8; this.legR.rotation.x *= 0.8;
    }
    this.deathBlend += ((p.alive ? 0 : 1) - this.deathBlend) * Math.min(1, dt * 6);
    this.body.rotation.x = -this.deathBlend * 1.45;
    this.body.position.y = this.deathBlend * 0.15;
    if (this.label) this.label.visible = p.alive;
    return speed;
  }

  flash() {
    const f = this.weapon && this.weapon.userData.flash;
    if (f) { f.visible = true; f.material.rotation = Math.random() * 6; this.flashUntil = performance.now() + 50; }
  }

  tick() {
    if (this.flashUntil && performance.now() > this.flashUntil) {
      const f = this.weapon && this.weapon.userData.flash;
      if (f) f.visible = false;
      this.flashUntil = 0;
    }
  }

  muzzleWorld(out) {
    const muzzle = this.weapon && this.weapon.userData.muzzle;
    if (muzzle) muzzle.getWorldPosition(out);
    else out.set(this.root.position.x, this.root.position.y + 1.4, this.root.position.z);
    return out;
  }

  dispose(scene) {
    this.setLabel(null);
    scene.remove(this.root);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------------------------------------------
export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.quality = settings.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality !== 'low', powerPreference: 'high-performance' });
    this.applyPixelRatio(false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 700);
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.vmScene.add(new THREE.HemisphereLight(0xdfe8ff, 0x55504a, 3.2));
    const vmSun = new THREE.DirectionalLight(0xffffff, 2.4);
    vmSun.position.set(1, 2, 1);
    this.vmScene.add(vmSun);
    const vmRim = new THREE.DirectionalLight(0x9fc4ff, 1.4);
    vmRim.position.set(-1.5, 0.5, -1);
    this.vmScene.add(vmRim);

    this.characters = new Map();
    this.tracers = [];
    this.impacts = [];
    this.puffs = [];
    this.flashLights = [];
    this.zoneVisuals = [];
    this.tmp = new THREE.Vector3();
    this.resize();
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
  }

  /** Pixel ratio from the quality preset, scaled by the Resolution setting. */
  applyPixelRatio(resize = true) {
    const base = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1);
    const ratio = base * Math.max(0.5, Math.min(1, settings.renderScale || 1));
    if (ratio === this.pixelRatio) return;
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    if (resize) this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }

  loadMap(map, modeUsesZones) {
    const theme = map.theme || {};
    this.scene.background = new THREE.Color(theme.sky || 0x9ec9ff);
    this.scene.fog = new THREE.FogExp2(theme.fog || 0xbdd4ea, theme.fogDensity || 0.008);
    const night = theme.timeOfDay === 'night';
    this.scene.add(new THREE.HemisphereLight(night ? 0x6677aa : 0xdfeeff, night ? 0x1a1c22 : 0x4a4232, night ? 0.9 : 1.25));
    const sun = new THREE.DirectionalLight(night ? 0xaab8ff : theme.timeOfDay === 'dusk' ? 0xffc28a : 0xfff3df, theme.sunIntensity || 2.4);
    const s = theme.sun || [0.5, 1, 0.3];
    sun.position.set(s[0] * 120, s[1] * 120, s[2] * 120);
    sun.castShadow = this.quality !== 'low';
    const size = map.half + 10;
    sun.shadow.camera.left = -size; sun.shadow.camera.right = size;
    sun.shadow.camera.top = size; sun.shadow.camera.bottom = -size;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 400;
    sun.shadow.mapSize.set(this.quality === 'high' ? 4096 : 2048, this.quality === 'high' ? 4096 : 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // Ground (extends beyond the boundary so the horizon is not empty).
    const groundTex = makeTexture('ground', GROUND[theme.ground] || GROUND.grass);
    groundTex.repeat.set(map.half * 2 / 4 * 3, map.half * 2 / 4 * 3);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.half * 6, map.half * 6), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    buildMapMeshes(map, this.scene, this.quality);

    // Distant scenery ring.
    const hillMat = new THREE.MeshStandardMaterial({ color: night ? 0x1c2030 : theme.timeOfDay === 'dusk' ? 0x6e5a48 : 0x5f7a55, roughness: 1, flatShading: true });
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const r = map.half * 1.9 + (i % 3) * 12;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(25 + (i % 4) * 9, 30 + (i % 5) * 12, 6), hillMat);
      hill.position.set(Math.cos(a) * r, 8, Math.sin(a) * r);
      this.scene.add(hill);
    }

    // Muzzle-flash light pool (fixed count keeps shaders stable).
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffc070, 0, 9, 2);
      this.scene.add(light);
      this.flashLights.push({ light, until: 0 });
    }

    if (modeUsesZones) this.buildZones(map.zones);
  }

  buildZones(zones) {
    for (const z of zones) {
      const group = new THREE.Group();
      group.position.set(z.x, z.y || 0, z.z);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(z.r - 0.35, z.r, 48), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      group.add(ring);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(z.r, z.r, 10, 40, 1, true), beamMat);
      beam.position.y = 5;
      group.add(beam);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6), mat('#cccccc'));
      pole.position.set(0, 3, 0);
      group.add(pole);
      const flagMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 });
      const flag = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.04), flagMat);
      flag.position.set(0.72, 5.4, 0);
      group.add(flag);
      const label = nameSprite(z.id, '#ffffff');
      label.position.set(0, 7, 0);
      label.scale.set(3, 0.75, 1);
      group.add(label);
      this.scene.add(group);
      this.zoneVisuals.push({ id: z.id, ringMat, beamMat, flag, flagMat });
    }
  }

  updateZones(zoneStates, time) {
    if (!zoneStates) return;
    for (const [id, owner, progress, contested] of zoneStates) {
      const v = this.zoneVisuals.find((z) => z.id === id);
      if (!v) continue;
      const ownerColor = new THREE.Color(TEAM_COLORS[owner] || TEAM_COLORS[2]);
      const capColor = new THREE.Color(progress < 0 ? TEAM_COLORS[0] : TEAM_COLORS[1]);
      const color = owner === TEAM.NONE ? ownerColor.clone().lerp(capColor, Math.abs(progress)) : ownerColor;
      if (contested) color.lerp(new THREE.Color(0xffffff), (Math.sin(time * 8) + 1) * 0.25);
      v.ringMat.color.copy(color);
      v.beamMat.color.copy(color);
      v.flagMat.color.copy(color);
      v.flagMat.emissive.copy(color);
      v.flag.position.y = 1.4 + 4 * (owner === TEAM.NONE ? Math.abs(progress) : 1);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Characters
  // ------------------------------------------------------------------------------------------------
  syncCharacter(id, info, pose, dt, labelText, labelColor) {
    let c = this.characters.get(id);
    if (!c || c.info.team !== info.team) {
      if (c) c.dispose(this.scene);
      c = new CharacterModel(this.scene, info);
      this.characters.set(id, c);
      c.labelKey = null;
    }
    const key = (labelText || '') + labelColor;
    if (c.labelKey !== key) { c.setLabel(labelText, labelColor); c.labelKey = key; }
    c.setWeapon(pose.weapon);
    c.tick();
    return c.update(pose, dt);
  }

  removeCharacter(id) {
    const c = this.characters.get(id);
    if (c) { c.dispose(this.scene); this.characters.delete(id); }
  }

  pruneCharacters(liveIds) {
    for (const id of [...this.characters.keys()]) if (!liveIds.has(id)) this.removeCharacter(id);
  }

  characterMuzzle(id, out) {
    const c = this.characters.get(id);
    if (!c) return null;
    c.flash();
    return c.muzzleWorld(out);
  }

  // ------------------------------------------------------------------------------------------------
  // Effects
  // ------------------------------------------------------------------------------------------------
  tracer(from, to, color = 0xffd27a) {
    let t = this.tracers.find((x) => !x.line.visible);
    if (!t) {
      if (this.tracers.length > 60) t = this.tracers[0];
      else {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
        line.frustumCulled = false;
        this.scene.add(line);
        t = { line, until: 0 };
        this.tracers.push(t);
      }
    }
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to[0], to[1], to[2]);
    pos.needsUpdate = true;
    t.line.material.color.set(color);
    t.line.material.opacity = 0.9;
    t.line.visible = true;
    t.until = performance.now() + 60;
  }

  impact(point, character) {
    if (character) {
      let p = this.puffs.find((x) => !x.sprite.visible);
      if (!p) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xb01818, transparent: true, opacity: 0.85, depthWrite: false }));
        this.scene.add(sprite);
        p = { sprite, until: 0 };
        this.puffs.push(p);
      }
      p.sprite.position.set(point[0], point[1], point[2]);
      p.sprite.scale.set(0.3, 0.3, 1);
      p.sprite.visible = true;
      p.start = performance.now();
      p.until = p.start + 300;
      return;
    }
    let d = this.impacts.length < 120 ? null : this.impacts[(this.impactIndex = ((this.impactIndex || 0) + 1) % 120)];
    if (!d) {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.06, 6), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      this.scene.add(mesh);
      d = { mesh };
      this.impacts.push(d);
    }
    const n = new THREE.Vector3(point[3], point[4], point[5]);
    if (n.lengthSq() < 0.5) n.set(0, 1, 0);
    d.mesh.position.set(point[0] + n.x * 0.01, point[1] + n.y * 0.01, point[2] + n.z * 0.01);
    d.mesh.lookAt(d.mesh.position.x + n.x, d.mesh.position.y + n.y, d.mesh.position.z + n.z);
    d.mesh.scale.setScalar(0.7 + Math.random() * 0.8);
    // Spark puff.
    let p = this.puffs.find((x) => !x.sprite.visible);
    if (!p && this.puffs.length < 40) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.scene.add(sprite);
      p = { sprite, until: 0 };
      this.puffs.push(p);
    }
    if (p) {
      p.sprite.material.color.set(0xffe0a0);
      p.sprite.position.set(point[0], point[1], point[2]);
      p.sprite.scale.set(0.15, 0.15, 1);
      p.sprite.visible = true;
      p.start = performance.now();
      p.until = p.start + 90;
    }
  }

  muzzleLight(position) {
    const slot = this.flashLights.reduce((a, b) => (a.until < b.until ? a : b), this.flashLights[0]);
    if (!slot) return;
    slot.light.position.copy(position);
    slot.light.intensity = 6;
    slot.until = performance.now() + 50;
  }

  updateEffects() {
    const now = performance.now();
    for (const t of this.tracers) if (t.line.visible && now > t.until) t.line.visible = false;
    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      if (now > p.until) { p.sprite.visible = false; continue; }
      const k = (now - p.start) / (p.until - p.start);
      p.sprite.material.opacity = 0.9 * (1 - k);
      p.sprite.scale.multiplyScalar(1.04);
    }
    for (const f of this.flashLights) if (now > f.until) f.light.intensity = 0;
  }

  // ------------------------------------------------------------------------------------------------
  // View model
  // ------------------------------------------------------------------------------------------------
  setViewWeapon(id) {
    if (this.vmWeaponId === id && this.vmGun) return;
    this.vmWeaponId = id;
    if (this.vmGun) this.vmScene.remove(this.vmGun);
    this.vmGun = buildGun(id, 0.55);
    this.vmGun.traverse((o) => { o.castShadow = false; });
    this.vmScene.add(this.vmGun);
    this.vm = { kick: 0, kickV: 0, swayX: 0, swayY: 0, bob: 0, equipStart: performance.now(), reloadStart: 0, reloadDur: 0, sprint: 0 };
  }

  viewModelFire() {
    if (!this.vm) return;
    this.vm.kickV += 1;
    const f = this.vmGun.userData.flash;
    if (f) { f.visible = true; f.material.rotation = Math.random() * 6; this.vmFlashUntil = performance.now() + 45; }
  }

  viewModelReload(duration) {
    if (!this.vm) return;
    this.vm.reloadStart = performance.now();
    this.vm.reloadDur = duration * 1000;
  }

  muzzleWorldPosition(out) {
    // Approximate the view model muzzle in world space: in front of the camera, slightly right/down.
    const v = new THREE.Vector3(0.12, -0.09, -0.7).applyQuaternion(this.camera.quaternion);
    return out.copy(this.camera.position).add(v);
  }

  updateViewModel(dt, state) {
    if (!this.vmGun || !this.vm) return;
    const vm = this.vm;
    const w = WEAPONS[this.vmWeaponId] || WEAPONS.rifle;
    vm.kickV += (-vm.kick * 180 - vm.kickV * 18) * dt;
    vm.kick += vm.kickV * dt * 10;
    const kick = Math.max(0, vm.kick);
    vm.swayX += (clampNum(-state.lookDX * 0.0009, -0.05, 0.05) - vm.swayX) * Math.min(1, dt * 10);
    vm.swayY += (clampNum(state.lookDY * 0.0009, -0.05, 0.05) - vm.swayY) * Math.min(1, dt * 10);
    vm.bob += dt * (4 + state.speed * 1.3);
    vm.sprint += ((state.sprinting ? 1 : 0) - vm.sprint) * Math.min(1, dt * 8);
    const aim = state.aim;
    const bobScale = Math.min(1, state.speed / 7) * 0.012 * (1 - aim * 0.8) * (1 + vm.sprint);
    const now = performance.now();
    const equip = Math.max(0, 1 - (now - vm.equipStart) / (w.equip * 1000));
    let reload = 0;
    if (vm.reloadDur > 0 && now - vm.reloadStart < vm.reloadDur) reload = Math.sin(((now - vm.reloadStart) / vm.reloadDur) * Math.PI);
    if (!state.reloading) vm.reloadDur = vm.reloadDur > 0 && now - vm.reloadStart < vm.reloadDur ? vm.reloadDur : 0;

    const hip = new THREE.Vector3(0.13, -0.135, -0.42);
    const ads = new THREE.Vector3(0, -0.062 - w.size[1] * 0.26, -0.3);
    const pos = hip.lerp(ads, aim);
    pos.x += vm.swayX + Math.sin(vm.bob) * bobScale - 0.06 * vm.sprint;
    pos.y += vm.swayY + Math.abs(Math.cos(vm.bob)) * bobScale - 0.05 * vm.sprint - 0.12 * reload - 0.3 * equip * equip;
    pos.z += kick * 0.045 * (1 - aim * 0.5) + 0.04 * vm.sprint;
    this.vmGun.position.copy(pos);
    this.vmGun.rotation.set(
      kick * 0.08 * (1 - aim * 0.5) + 0.35 * reload + 0.4 * vm.sprint - 0.7 * equip * equip + vm.swayY * 2,
      -0.55 * vm.sprint + vm.swayX * 3,
      0.4 * reload + 0.2 * vm.sprint,
    );
    this.vmGun.visible = state.alive;
    if (this.vmFlashUntil && now > this.vmFlashUntil) {
      const f = this.vmGun.userData.flash;
      if (f) f.visible = false;
      this.vmFlashUntil = 0;
    }
  }

  render() {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }

  dispose() {
    window.removeEventListener('resize', this._resize);
    this.scene.traverse((o) => {
      if (o.geometry && o.geometry !== boxGeo && o.geometry !== sphereGeo) o.geometry.dispose();
      if (o.material && !materialCache.has(o.material)) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.renderer.dispose();
  }
}

function clampNum(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
