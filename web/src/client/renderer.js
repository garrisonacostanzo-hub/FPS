// Three.js presentation layer: physically based sky + image-based lighting, detailed procedural materials, shadows,
// foliage, operators (outfits) and guns (camos), first-person arms + weapon, combat effects and post-processing.
import * as THREE from 'three';
import { TEAM, TEAM_COLORS } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { Effects } from './gfx/effects.js';
import { addFoliage } from './gfx/foliage.js';
import { animateCamos, buildFirstPersonArms, buildGun, buildOperator, mat } from './gfx/models.js';
import { PostFX } from './gfx/post.js';
import { buildSky } from './gfx/sky.js';
import { surfaceTextures } from './gfx/textures.js';
import { settings } from './settings.js';

const PALETTE = {
  floor: '#6b6e73', wall: '#b9764a', wallDark: '#4b4f57', concrete: '#8a8d90', crate: '#8a6a43', metal: '#737a82',
  sand: '#a89268', container: '#2f6f8f', containerB: '#8f3a2f', rock: '#77736c', stairs: '#5c6066', brick: '#8e4f3a',
  baseA: '#56677d', baseB: '#7d5f56', boundary: '#34373c',
};
const SURFACE = {
  floor: 'floor', wall: 'brick', wallDark: 'concrete', concrete: 'concrete', crate: 'crate', metal: 'metal', sand: 'sand',
  container: 'container', containerB: 'container', rock: 'rock', stairs: 'stairs', brick: 'brick', baseA: 'concrete', baseB: 'concrete', boundary: 'boundary',
};
const GROUND = { grass: ['grass', '#4c6a35'], concrete: ['asphalt', '#5f5b55'], dark: ['asphalt', '#2a2e36'] };

// ---------------------------------------------------------------------------------------------------------------
// Map geometry: one merged mesh per material with world-scaled UVs
// ---------------------------------------------------------------------------------------------------------------
function buildMapMeshes(map, scene, quality) {
  const groups = new Map();
  for (const b of map.boxes) {
    if (!groups.has(b.m)) groups.set(b.m, []);
    groups.get(b.m).push(b);
  }
  const texSize = quality === 'high' ? 512 : quality === 'medium' ? 256 : 128;
  for (const [m, boxes] of groups) {
    const positions = [], normals = [], uvs = [], indices = [];
    const tile = m === 'floor' ? 4 : 2.5;
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
        if (n[1] === -1 && y0 <= 0.01) continue;
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
    const shiny = m === 'metal' || m.startsWith('container');
    const tex = surfaceTextures(SURFACE[m] || 'concrete', PALETTE[m] || '#888888', texSize);
    const material = new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: quality === 'low' ? null : tex.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: tex.roughness,
      metalness: shiny ? 0.45 : 0.02,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = quality !== 'low';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Labels and markers
// ---------------------------------------------------------------------------------------------------------------
/** Dropped ammo pack: an olive ammo can with a yellow band and handle, floating over a glowing ring. */
function buildAmmoPack() {
  const g = new THREE.Group();
  const crate = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.24), mat('#4b5a2e', { rough: 0.7, metal: 0.25 }));
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.06, 0.245), new THREE.MeshStandardMaterial({ color: 0xf2c230, emissive: 0x6b4d00, roughness: 0.5 }));
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, 0.26), mat('#3b4724', { rough: 0.6, metal: 0.4 }));
  lid.position.y = 0.15;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 12, Math.PI), mat('#222', { rough: 0.4, metal: 0.8 }));
  handle.position.y = 0.17;
  crate.add(body, band, lid, handle);
  crate.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.5, 28), new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.4, 1.9, 0.5), transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(crate, ring);
  g.userData = { crate, ring };
  return g;
}

const EMOTE_TIME = 2.4;

function revealSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ff3b30';
  g.strokeStyle = '#fff';
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(32, 6); g.lineTo(56, 32); g.lineTo(32, 58); g.lineTo(8, 32); g.closePath();
  g.fill(); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  sprite.scale.set(0.42, 0.42, 1);
  sprite.renderOrder = 12;
  return sprite;
}

/** Emote bubble: the emote's icon in a rounded tag with its label. */
function emoteSprite(emote) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,12,16,0.82)';
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect ? g.roundRect(18, 10, 220, 92, 22) : g.rect(18, 10, 220, 92);
  g.fill(); g.stroke();
  g.beginPath(); g.moveTo(116, 102); g.lineTo(128, 120); g.lineTo(140, 102); g.closePath(); g.fill();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '56px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  g.fillStyle = '#fff';
  g.fillText(emote.icon, 70, 58);
  g.font = '700 30px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
  g.fillText(emote.label, 168, 58, 120);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  sprite.scale.set(1.3, 0.65, 1);
  sprite.renderOrder = 11;
  return sprite;
}

function nameSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 30px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(text, 128, 40);
  g.fillStyle = color;
  g.fillText(text, 128, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}

const markerCache = new Map();
function markerSprite(color, throughWalls) {
  const key = color + throughWalls;
  if (!markerCache.has(key)) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.beginPath(); g.moveTo(10, 14); g.lineTo(54, 14); g.lineTo(32, 50); g.closePath();
    g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.stroke();
    g.fillStyle = color; g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    markerCache.set(key, new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: !throughWalls, depthWrite: false, sizeAttenuation: false, fog: false }));
  }
  const sprite = new THREE.Sprite(markerCache.get(key));
  sprite.scale.set(0.045, 0.045, 1);
  sprite.renderOrder = 11;
  return sprite;
}

// ---------------------------------------------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------------------------------------------
class CharacterModel {
  constructor(scene, info, simple) {
    this.info = info;
    const op = buildOperator({ color: info.color || TEAM_COLORS[info.team] || TEAM_COLORS[2], outfit: info.outfit, outline: info.outline, simple });
    Object.assign(this, op);
    scene.add(this.root);
    this.weapon = null;
    this.weaponKey = '';
    this.setWeapon(info.weapon || 'rifle');
    this.label = null;
    this.marker = markerSprite(info.color, !!info.ally);
    this.marker.position.set(0, info.ally ? 2.55 : 2.25, 0);
    this.marker.visible = false;
    this.root.add(this.marker);
    this.walkPhase = 0;
    this.deathBlend = 0;
    this.lastPos = null;
  }

  setWeapon(id) {
    const key = id + ':' + this.info.camo;
    if (this.weaponKey === key) return;
    this.weaponKey = key;
    if (this.weapon) this.gunSocket.remove(this.weapon);
    this.weapon = buildGun(id, 1, this.info.camo, false);
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

  setMarker(visible) {
    this.marker.visible = visible;
  }

  update(p, dt) {
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    const crouch = p.crouch;
    this.body.scale.y = 1 - 0.3 * crouch;
    this.armPivot.rotation.x = p.pitch;
    this.headPivot.rotation.x = p.pitch * 0.6;
    let speed = 0;
    if (this.lastPos) speed = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z) / Math.max(dt, 1e-3);
    this.lastPos = { x: p.x, z: p.z };
    if (speed > 0.3 && p.alive) {
      this.walkPhase += dt * (4 + speed * 1.4);
      const swing = Math.sin(this.walkPhase) * Math.min(0.75, speed * 0.12);
      this.legL.rotation.x = swing - crouch * 0.6;
      this.legR.rotation.x = -swing - crouch * 0.6;
      this.body.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.03;
    } else {
      this.legL.rotation.x += (-crouch * 0.6 - this.legL.rotation.x) * Math.min(1, dt * 10);
      this.legR.rotation.x += (crouch * 0.3 - this.legR.rotation.x) * Math.min(1, dt * 10);
      this.body.position.y = 0; // set every frame, so emote hops never accumulate
    }
    this.deathBlend += ((p.alive ? 0 : 1) - this.deathBlend) * Math.min(1, dt * 6);
    this.body.rotation.x = -this.deathBlend * 1.45;
    if (this.deathBlend > 0.01) this.body.position.y = this.deathBlend * 0.15;
    if (this.label) this.label.visible = p.alive && !this.cloaked;
    if (this.cloaked) this.marker.visible = false;
    this.animateEmote(p);
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

  /** Cloak: enemies see only a faint shimmer; teammates still see you. */
  setCloak(on, ally) {
    const hide = on && !ally;
    if (this.cloaked === hide) return;
    this.cloaked = hide;
    this.body.visible = !hide;
    if (!this.ghost) {
      this.ghost = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.05, 4, 10), new THREE.MeshBasicMaterial({
        color: 0x9fd8ff, transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      this.ghost.position.y = 0.9;
      this.root.add(this.ghost);
    }
    this.ghost.visible = hide;
  }

  /** Recon Pulse: a red diamond over a revealed enemy, visible through walls. */
  setRevealed(on) {
    if (on && !this.revealMark) {
      this.revealMark = revealSprite();
      this.revealMark.position.set(0, 2.35, 0);
      this.root.add(this.revealMark);
    }
    if (this.revealMark) {
      this.revealMark.visible = on;
      if (on) this.revealMark.material.opacity = 0.65 + 0.35 * Math.sin(performance.now() / 120);
    }
  }

  /** Starts an emote: an icon bubble over the head and a short body animation (see animateEmote). */
  playEmote(emote) {
    this.clearBubble();
    this.emote = { id: emote.id, start: performance.now() };
    this.bubble = emoteSprite(emote);
    this.bubble.position.set(0, 2.62, 0);
    this.root.add(this.bubble);
  }

  clearBubble() {
    if (!this.bubble) return;
    this.root.remove(this.bubble);
    this.bubble.material.map.dispose();
    this.bubble.material.dispose();
    this.bubble = null;
  }

  /** Layered on top of the normal pose each frame while an emote plays (2.4 s). */
  animateEmote(p) {
    this.body.rotation.y = 0; this.body.rotation.z = 0; this.armPivot.rotation.z = 0; this.headPivot.rotation.z = 0;
    if (!this.emote) return;
    const t = (performance.now() - this.emote.start) / 1000;
    if (t > EMOTE_TIME || !p.alive) { this.emote = null; this.clearBubble(); return; }
    const k = Math.min(1, t * 5) * Math.min(1, (EMOTE_TIME - t) * 5); // ease in and out
    const toward = (from, to) => from + (to - from) * k;
    this.bubble.position.y = 2.62 + Math.min(1, t * 6) * 0.1;
    this.bubble.material.opacity = Math.min(1, (EMOTE_TIME - t) * 3);
    switch (this.emote.id) {
      case 'wave':
        this.armPivot.rotation.x = toward(p.pitch, -1.25);
        this.armPivot.rotation.z = Math.sin(t * 11) * 0.38 * k;
        break;
      case 'cheer':
        this.armPivot.rotation.x = toward(p.pitch, -1.6);
        this.body.position.y += Math.abs(Math.sin(t * 7)) * 0.2 * k;
        break;
      case 'flex':
        this.armPivot.rotation.x = toward(p.pitch, -0.9);
        this.armPivot.rotation.z = Math.sin(t * 5) * 0.15 * k;
        this.body.rotation.y = Math.sin(t * 2.5) * 0.35 * k;
        break;
      case 'gg':
        this.headPivot.rotation.x = toward(p.pitch * 0.6, Math.abs(Math.sin(t * 7)) * 0.45);
        this.armPivot.rotation.x = toward(p.pitch, 0.35);
        break;
      case 'nice':
        this.armPivot.rotation.x = toward(p.pitch, -0.7);
        this.headPivot.rotation.x = toward(p.pitch * 0.6, Math.sin(t * 6) * 0.25);
        break;
      case 'lol':
        this.headPivot.rotation.x = toward(p.pitch * 0.6, -0.4);
        this.body.rotation.z = Math.sin(t * 24) * 0.06 * k;
        this.body.position.y += Math.abs(Math.sin(t * 12)) * 0.04 * k;
        break;
      case 'cool':
        this.body.rotation.x = -0.14 * k;
        this.headPivot.rotation.z = 0.22 * k;
        this.armPivot.rotation.x = toward(p.pitch, 0.5);
        break;
      case 'oops':
        this.headPivot.rotation.z = Math.sin(t * 3.5) * 0.3 * k;
        this.armPivot.rotation.x = toward(p.pitch, 0.7);
        break;
      default:
        this.body.rotation.y = Math.sin(t * 6) * 0.5 * k;
    }
  }

  dispose(scene) {
    this.setLabel(null);
    this.clearBubble();
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
    const post = this.quality !== 'low';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.applyPixelRatio(false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 700);
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.vmScene.add(new THREE.HemisphereLight(0xdfe8ff, 0x55504a, 1.6));
    const vmSun = new THREE.DirectionalLight(0xffffff, 2.2);
    vmSun.position.set(1, 2, 1);
    this.vmScene.add(vmSun);
    const vmRim = new THREE.DirectionalLight(0x9fc4ff, 1.2);
    vmRim.position.set(-1.5, 0.5, -1);
    this.vmScene.add(vmRim);

    this.localLook = { camo: 'default', outfit: 'rifleman', color: '#1e90ff' };
    this.characters = new Map();
    this.zoneVisuals = [];
    this.fx = new Effects(this.scene);
    this.post = post ? new PostFX(this.renderer, this.scene, this.camera, this.vmScene, this.vmCamera, this.quality) : null;
    this.lastEffects = performance.now();
    this.dynScale = 1;
    this.resize();
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
  }

  /** Pixel ratio from the quality preset, scaled by the Resolution setting. */
  applyPixelRatio(resize = true) {
    const base = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.25 : 1);
    const dyn = settings.dynamicResolution === false ? 1 : this.dynScale || 1;
    const ratio = base * Math.max(0.5, Math.min(1, settings.renderScale || 1)) * dyn;
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
    if (this.post) this.post.setSize(w, h, this.pixelRatio);
  }

  loadMap(map, modeUsesZones) {
    const theme = map.theme || {};
    const night = theme.timeOfDay === 'night', dusk = theme.timeOfDay === 'dusk';
    const fogColor = new THREE.Color(theme.fog || 0xbdd4ea);
    if (!night) fogColor.multiplyScalar(0.82); // match the toned-down sky so the horizon doesn't glow white
    this.scene.fog = new THREE.FogExp2(fogColor, (theme.fogDensity || 0.008) * 0.7);
    const sky = buildSky(this.renderer, this.scene, theme, this.quality);
    this.vmScene.environment = this.scene.environment;
    this.vmScene.environmentIntensity = 0.6;

    const low = this.quality === 'low';
    if (low) { this.scene.environment = null; this.vmScene.environment = null; } // cheapest shading for weak devices
    this.scene.add(new THREE.HemisphereLight(night ? 0x5566aa : 0xdfeeff, night ? 0x14161c : 0x4a4232, (night ? 0.5 : 0.55) * (low ? 2.2 : 1)));
    const sun = new THREE.DirectionalLight(night ? 0x9fb0ff : dusk ? 0xffb07a : 0xfff1dc, (theme.sunIntensity || 2.4) * (night ? 0.7 : 0.95));
    sun.position.copy(sky.sunDir).multiplyScalar(120);
    sun.castShadow = this.quality !== 'low';
    const size = map.half + 10;
    sun.shadow.camera.left = -size; sun.shadow.camera.right = size;
    sun.shadow.camera.top = size; sun.shadow.camera.bottom = -size;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 400;
    const sm = this.quality === 'high' ? 4096 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun, sun.target);

    // Ground (extends past the boundary so the horizon is not empty).
    const [gKind, gColor] = GROUND[theme.ground] || GROUND.grass;
    const gTex = surfaceTextures(gKind, gColor, this.quality === 'low' ? 256 : 512);
    const rep = (map.half * 6) / 5;
    for (const t of [gTex.map, gTex.normalMap]) t.repeat.set(rep, rep);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(map.half * 6, map.half * 6),
      new THREE.MeshStandardMaterial({ map: gTex.map, normalMap: this.quality === 'low' ? null : gTex.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughness: gTex.roughness }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    buildMapMeshes(map, this.scene, this.quality);
    if (this.world) addFoliage(this.scene, map, this.world, this.quality);

    // Distant hills.
    const hillMat = new THREE.MeshStandardMaterial({ color: night ? 0x161a26 : dusk ? 0x6a5444 : 0x55704c, roughness: 1, flatShading: true });
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const r = map.half * 2.2 + (i % 3) * 14;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(30 + (i % 4) * 10, 34 + (i % 5) * 14, 7), hillMat);
      hill.position.set(Math.cos(a) * r, 10, Math.sin(a) * r);
      this.scene.add(hill);
    }
    if (modeUsesZones) this.buildZones(map.zones);
  }

  buildZones(zones) {
    for (const z of zones) {
      const group = new THREE.Group();
      group.position.set(z.x, z.y || 0, z.z);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(z.r - 0.3, z.r, 64), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      group.add(ring);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(z.r, z.r, 10, 48, 1, true), beamMat);
      beam.position.y = 5;
      group.add(beam);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6), mat('#b8bcc2', { rough: 0.4, metal: 0.7 }));
      pole.position.set(0, 3, 0);
      group.add(pole);
      const flagMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, side: THREE.DoubleSide });
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9, 6, 1), flagMat);
      flag.position.set(0.78, 5.4, 0);
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
      const teamColor = this.teamColor || ((t) => TEAM_COLORS[t] || TEAM_COLORS[2]);
      const ownerColor = new THREE.Color(owner === TEAM.NONE ? TEAM_COLORS[2] : teamColor(owner));
      const capColor = new THREE.Color(teamColor(progress < 0 ? TEAM.A : TEAM.B));
      const color = owner === TEAM.NONE ? ownerColor.clone().lerp(capColor, Math.abs(progress)) : ownerColor;
      if (contested) color.lerp(new THREE.Color(0xffffff), (Math.sin(time * 8) + 1) * 0.25);
      v.ringMat.color.copy(color);
      v.beamMat.color.copy(color);
      v.flagMat.color.copy(color);
      v.flagMat.emissive.copy(color);
      v.flag.position.y = 1.4 + 4 * (owner === TEAM.NONE ? Math.abs(progress) : 1);
      v.flag.rotation.y = Math.sin(time * 2 + v.id.charCodeAt(0)) * 0.15;
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Abilities: grenades in flight, smoke clouds, explosions, the Recon Pulse ring
  // ------------------------------------------------------------------------------------------------
  syncGrenades(list, dt) {
    if (!this.grenadeMeshes) {
      this.grenadeMeshes = new Map();
      this.grenadeGeo = [new THREE.SphereGeometry(0.075, 10, 8), new THREE.CylinderGeometry(0.05, 0.05, 0.16, 10)];
      this.grenadeMat = [mat('#3d4a2a', { rough: 0.6, metal: 0.4 }), mat('#9aa0a6', { rough: 0.5, metal: 0.5 })];
    }
    const seen = new Set();
    for (const [id, x, y, z, kind] of list) {
      seen.add(id);
      let m = this.grenadeMeshes.get(id);
      if (!m) {
        m = new THREE.Mesh(this.grenadeGeo[kind], this.grenadeMat[kind]);
        m.position.set(x, y, z);
        m.castShadow = true;
        this.scene.add(m);
        this.grenadeMeshes.set(id, m);
      }
      m.position.lerp(new THREE.Vector3(x, y, z), Math.min(1, dt * 18));
      m.rotation.x += dt * 9; m.rotation.z += dt * 6;
    }
    for (const [id, m] of this.grenadeMeshes) if (!seen.has(id)) { this.scene.remove(m); this.grenadeMeshes.delete(id); }
  }

  /** Smoke clouds: overlapping soft sprites, thick enough to hide players behind and inside them. */
  syncSmokes(list, time) {
    if (!this.smokeClouds) this.smokeClouds = new Map();
    const seen = new Set();
    for (const [id, x, y, z, r, left] of list) {
      seen.add(id);
      let cloud = this.smokeClouds.get(id);
      if (!cloud) {
        cloud = { group: new THREE.Group(), born: time, parts: [] };
        let seed = id * 7919;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let i = 0; i < 22; i++) {
          const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 0.75;
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.fx.smokeTex, color: 0xb9bcc0, transparent: true, depthWrite: false, opacity: 0 }));
          const size = r * (0.9 + rnd() * 0.6);
          sprite.position.set(Math.cos(a) * d, 0.6 + rnd() * r * 0.55, Math.sin(a) * d);
          sprite.scale.set(size, size, 1);
          sprite.material.rotation = rnd() * 6;
          sprite.userData.spin = (rnd() - 0.5) * 0.3;
          cloud.group.add(sprite);
          cloud.parts.push(sprite);
        }
        cloud.group.position.set(x, y, z);
        this.scene.add(cloud.group);
        this.smokeClouds.set(id, cloud);
      }
      const grow = Math.min(1, (time - cloud.born) / 0.8);
      const fade = Math.min(1, left / 1.5);
      for (const sp of cloud.parts) {
        sp.material.opacity = 0.9 * grow * fade;
        sp.material.rotation += sp.userData.spin * 0.016;
      }
      cloud.group.scale.setScalar(0.5 + 0.5 * grow);
    }
    for (const [id, cloud] of this.smokeClouds) {
      if (seen.has(id)) continue;
      this.scene.remove(cloud.group);
      for (const sp of cloud.parts) sp.material.dispose();
      this.smokeClouds.delete(id);
    }
  }

  explosion(x, y, z) { this.fx.explosion(x, y, z); }

  /** Recon Pulse: a ring sweeping out over the ground from where it was used. */
  pulseRing(x, y, z) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.4, 1.6, 2.2), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.1, z);
    this.scene.add(ring);
    const start = performance.now();
    const grow = () => {
      const k = (performance.now() - start) / 900;
      if (k >= 1 || !this.scene) { this.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); return; }
      ring.scale.setScalar(1 + k * 40);
      ring.material.opacity = 0.8 * (1 - k);
      requestAnimationFrame(grow);
    };
    requestAnimationFrame(grow);
  }

  /** Small puff where someone dashed / healed (others' abilities). */
  abilityPuff(kind, x, y, z) {
    const color = kind === 'stim' ? 0x7dffa0 : kind === 'cloak' ? 0x9fd8ff : 0xdfe6ee;
    for (let i = 0; i < 4; i++) this.fx.puff(x + (Math.random() - 0.5) * 0.6, y + Math.random() * 0.6, z + (Math.random() - 0.5) * 0.6, color, 0.5, 0.45, 500);
  }

  // ------------------------------------------------------------------------------------------------
  // Dropped ammo packs
  // ------------------------------------------------------------------------------------------------
  /** Shows exactly the packs in the latest snapshot ([id, x, y, z] rows), spinning and bobbing. */
  syncPickups(list, time) {
    if (!this.pickupMeshes) this.pickupMeshes = new Map();
    const seen = new Set();
    for (const [id, x, y, z] of list) {
      seen.add(id);
      let m = this.pickupMeshes.get(id);
      if (!m) {
        m = buildAmmoPack();
        m.position.set(x, y, z);
        this.scene.add(m);
        this.pickupMeshes.set(id, m);
      }
      m.userData.crate.position.y = 0.32 + Math.sin(time * 2.6 + id) * 0.06;
      m.userData.crate.rotation.y = time * 1.4 + id;
      m.userData.ring.material.opacity = 0.35 + 0.2 * Math.sin(time * 4 + id);
    }
    for (const [id, m] of this.pickupMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      m.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.pickupMeshes.delete(id);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Characters
  // ------------------------------------------------------------------------------------------------
  syncCharacter(id, info, pose, dt, labelText, labelColor, markerVisible = false) {
    let c = this.characters.get(id);
    const look = `${info.color}${info.outline ? 'o' : ''}${info.ally ? 'a' : 'e'}${info.outfit}${info.camo}`;
    if (!c || c.info.team !== info.team || c.look !== look) {
      if (c) c.dispose(this.scene);
      c = new CharacterModel(this.scene, info, this.quality === 'low');
      c.look = look;
      this.characters.set(id, c);
      c.labelKey = null;
    }
    c.setMarker(markerVisible && pose.alive);
    c.setCloak(!!pose.cloak && pose.alive, !!info.ally);
    c.setRevealed(!!pose.revealed && pose.alive);
    const key = (labelText || '') + labelColor;
    if (c.labelKey !== key) { c.setLabel(labelText, labelColor); c.labelKey = key; }
    c.setWeapon(pose.weapon);
    c.tick();
    return c.update(pose, dt);
  }

  characterEmote(id, emote) {
    const c = this.characters.get(id);
    if (c) c.playEmote(emote);
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
    const p = c.muzzleWorld(out);
    if (Math.random() < 0.5) this.fx.muzzleSmoke(p);
    return p;
  }

  // ------------------------------------------------------------------------------------------------
  // Effects
  // ------------------------------------------------------------------------------------------------
  tracer(from, to, color = 0xffd27a, durationMs) { this.fx.tracer(from, to, color, durationMs); }

  impact(point, character, material, delayMs = 0) { this.fx.impactAt(point, character, material, delayMs); }

  muzzleLight(position) { this.fx.muzzleLight(position); }

  setDamage(amount) { if (this.post) this.post.setDamage(amount); }

  updateEffects() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastEffects) / 1000);
    this.lastEffects = now;
    this.fx.update(dt);
  }

  // ------------------------------------------------------------------------------------------------
  // View model
  // ------------------------------------------------------------------------------------------------
  /** Camo, outfit (sleeves) and team colour (armbands) for the first-person view. */
  setLocalLook(look) {
    const changed = look.camo !== this.localLook.camo || look.outfit !== this.localLook.outfit || look.color !== this.localLook.color;
    this.localLook = { ...look };
    if (changed && this.vmWeaponId) { const id = this.vmWeaponId; this.vmWeaponId = null; this.setViewWeapon(id); }
  }

  setViewWeapon(id) {
    if (this.vmWeaponId === id && this.vmGun) return;
    this.vmWeaponId = id;
    if (this.vmGun) this.vmScene.remove(this.vmGun);
    this.vmGun = buildGun(id, 0.55, this.localLook.camo, true);
    buildFirstPersonArms(this.vmGun, { outfit: this.localLook.outfit, color: this.localLook.color, weapon: id });
    this.vmGun.traverse((o) => { o.castShadow = false; });
    this.vmScene.add(this.vmGun);
    this.vm = { kick: 0, kickV: 0, swayX: 0, swayY: 0, bob: 0, equipStart: performance.now(), reloadStart: 0, reloadDur: 0, sprint: 0 };
  }

  viewModelFire() {
    if (!this.vm) return;
    this.vm.kickV += 1;
    const f = this.vmGun.userData.flash;
    if (f) { f.visible = true; f.material.rotation = Math.random() * 6; f.scale.setScalar(0.26 + Math.random() * 0.12); this.vmFlashUntil = performance.now() + 45; }
    // Brass out of the ejection port, in world space next to the camera.
    const q = this.camera.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q), fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const origin = this.camera.position.clone().addScaledVector(right, 0.1).addScaledVector(up, -0.07).addScaledVector(fwd, 0.32);
    if (this.vmWeaponId !== 'shotgun' || Math.random() < 0.5) this.fx.ejectCasing(origin, right, up);
  }

  viewModelReload(duration) {
    if (!this.vm) return;
    this.vm.reloadStart = performance.now();
    this.vm.reloadDur = duration * 1000;
  }

  muzzleWorldPosition(out) {
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
    const bobScale = Math.min(1, state.speed / 7) * 0.012 * (1 - aim * 0.85) * (1 + vm.sprint);
    const now = performance.now();
    const equip = Math.max(0, 1 - (now - vm.equipStart) / (w.equip * 1000));
    let reload = 0;
    if (vm.reloadDur > 0 && now - vm.reloadStart < vm.reloadDur) reload = Math.sin(((now - vm.reloadStart) / vm.reloadDur) * Math.PI);
    if (!state.reloading) vm.reloadDur = vm.reloadDur > 0 && now - vm.reloadStart < vm.reloadDur ? vm.reloadDur : 0;

    // Hip position, and aiming down sights with the sight line on the screen centre.
    const hip = new THREE.Vector3(0.13, -0.13, -0.4);
    const scoped = this.vmWeaponId === 'sniper' || this.vmWeaponId === 'dmr';
    // Red-dot / holo guns come close to the eye so the sight window is big; scoped guns switch to the scope view.
    const ads = new THREE.Vector3(0, -this.vmGun.userData.sightY, scoped ? -0.2 : this.vmWeaponId === 'pistol' ? -0.24 : -0.17);
    const pos = hip.lerp(ads, aim);
    pos.x += vm.swayX * (1 - aim * 0.7) + Math.sin(vm.bob) * bobScale - 0.06 * vm.sprint;
    pos.y += vm.swayY * (1 - aim * 0.7) + Math.abs(Math.cos(vm.bob)) * bobScale - 0.05 * vm.sprint - 0.12 * reload - 0.3 * equip * equip;
    pos.z += kick * 0.045 * (1 - aim * 0.5) + 0.04 * vm.sprint;
    this.vmGun.position.copy(pos);
    this.vmGun.rotation.set(
      kick * 0.08 * (1 - aim * 0.6) + 0.35 * reload + 0.4 * vm.sprint - 0.7 * equip * equip + vm.swayY * 2 * (1 - aim * 0.7),
      -0.55 * vm.sprint + vm.swayX * 3 * (1 - aim * 0.7),
      0.4 * reload + 0.2 * vm.sprint,
    );
    // Sniper and DMR: once fully aimed you look through the scope (HUD scope view), so the gun is hidden.
    this.vmGun.visible = state.alive && !(scoped && aim > 0.93);
    if (this.vmFlashUntil && now > this.vmFlashUntil) {
      const f = this.vmGun.userData.flash;
      if (f) f.visible = false;
      this.vmFlashUntil = 0;
    }
  }

  /** Dynamic resolution: lower the internal resolution while frames are slow, raise it again when there is headroom. */
  adaptResolution(now) {
    const ft = this.lastRender ? now - this.lastRender : 16;
    this.lastRender = now;
    this.frameAvg = this.frameAvg ? this.frameAvg * 0.94 + Math.min(ft, 100) * 0.06 : ft;
    if (settings.dynamicResolution === false || now - (this.dynCheck || 0) < 1500) return;
    this.dynCheck = now;
    let s = this.dynScale;
    if (this.frameAvg > 24 && s > 0.6) s = Math.max(0.6, s - 0.1);
    else if (this.frameAvg < 13 && s < 1) s = Math.min(1, s + 0.05);
    if (s !== this.dynScale) { this.dynScale = s; this.applyPixelRatio(); }
  }

  render() {
    this.adaptResolution(performance.now());
    const time = performance.now() / 1000;
    animateCamos(time);
    if (this.post) {
      this.post.render();
      return;
    }
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }

  dispose() {
    window.removeEventListener('resize', this._resize);
    for (const c of this.characters.values()) c.dispose(this.scene);
    if (this.post) this.post.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

function clampNum(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
