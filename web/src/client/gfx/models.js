// Detailed procedural models: guns (with camos and real sights), operators (with outfits; the team colour always
// stays on torso, arms, legs and headgear) and the first-person arms.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { outfitById } from '../../shared/cosmetics.js';
import { WEAPONS } from '../../shared/weapons.js';
import { camoTexture } from './textures.js';

// ---------------------------------------------------------------------------------------------------------------
// Shared geometry & materials
// ---------------------------------------------------------------------------------------------------------------
const geoCache = new Map();
export function rbox(w, h, d, r = 0.2) {
  const key = `rb${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}:${r}`;
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * r));
  return geoCache.get(key);
}
function cyl(rt, rb, h, seg = 12) {
  const key = `cy${rt}:${rb}:${h}:${seg}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.CylinderGeometry(rt, rb, h, seg));
  return geoCache.get(key);
}
function capsule(r, len) {
  const key = `ca${r}:${len}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.CapsuleGeometry(r, len, 4, 10));
  return geoCache.get(key);
}
function sphere(r, half = false) {
  const key = `sp${r}:${half}`;
  if (!geoCache.has(key)) geoCache.set(key, half ? new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2) : new THREE.SphereGeometry(r, 16, 12));
  return geoCache.get(key);
}

const matCache = new Map();
export function mat(color, { rough = 0.7, metal = 0.1, emissive = 0 } = {}) {
  const key = `${color}:${rough}:${metal}:${emissive}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: metal,
      emissive: emissive ? color : 0x000000, emissiveIntensity: emissive,
    }));
  }
  return matCache.get(key);
}
export const sharedMaterials = matCache;

const camoMatCache = new Map();
/** Material for a camo; animated camos are updated each frame by animateCamos(). */
export function camoMaterial(camoId) {
  if (camoMatCache.has(camoId)) return camoMatCache.get(camoId);
  const { def, map } = camoTexture(camoId);
  const m = new THREE.MeshStandardMaterial({
    map, roughness: def.metal ? 0.32 : 0.55, metalness: def.metal ?? 0.25,
    emissive: def.glow ? 0xffffff : 0x000000, emissiveMap: def.glow ? map : null, emissiveIntensity: def.glow ? def.glow * 0.55 : 0,
  });
  m.userData.anim = def.anim || null;
  m.userData.glow = def.glow || 0;
  camoMatCache.set(camoId, m);
  return m;
}

/** Animates mastery camos (scrolling, pulsing, shine, sparkle). */
export function animateCamos(time) {
  for (const m of camoMatCache.values()) {
    const a = m.userData.anim;
    if (!a) continue;
    if (a === 'scroll') m.map.offset.set(time * 0.04, time * 0.02);
    else if (a === 'pulse') m.emissiveIntensity = m.userData.glow * (0.35 + 0.35 * (Math.sin(time * 3) + 1));
    else if (a === 'shine') { m.map.offset.set((time * 0.15) % 1, 0); m.metalness = 0.95; }
    else if (a === 'sparkle') { m.map.offset.set(Math.floor(time * 6) * 0.137 % 1, 0); m.emissiveIntensity = 0.2 + 0.25 * Math.abs(Math.sin(time * 7)); }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
/** Capsule from point a to point b (local coordinates of parent). */
function limb(parent, a, b, r, material, shadow = true) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(capsule(r, Math.max(0.01, len - r)), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  m.castShadow = shadow;
  parent.add(m);
  return m;
}
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

function add(parent, geo, material, x, y, z, rx = 0, ry = 0, rz = 0, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = shadow;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Guns
// ---------------------------------------------------------------------------------------------------------------
const FLASH_TEXTURE = (() => {
  let tex = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,230,1)'); grad.addColorStop(0.25, 'rgba(255,210,120,0.9)'); grad.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = i % 2 ? 22 : 62;
      g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
})();

/**
 * Gun model. Muzzle points to -Z. userData: muzzle (Object3D), flash (Sprite), sightY / sightZ (for aiming down sights).
 * @param {string} weaponId
 * @param {number} scale
 * @param {string} camoId
 * @param {boolean} detailed false for distant third-person guns
 */
export function buildGun(weaponId, scale = 1, camoId = 'default', detailed = true) {
  const w = WEAPONS[weaponId] || WEAPONS.rifle;
  const g = new THREE.Group();
  const [W, H, L] = w.size;
  const camo = camoMaterial(camoId);
  const metal = mat('#1b1d21', { rough: 0.35, metal: 0.85 });
  const polymer = mat('#16171a', { rough: 0.8, metal: 0.05 });
  const accent = mat(w.accent, { rough: 0.5, metal: 0.3 });
  const pistol = weaponId === 'pistol';

  // Receiver + handguard (camo).
  add(g, rbox(W, H, L * 0.48, 0.25), camo, 0, 0, L * 0.06);
  if (!pistol) {
    add(g, rbox(W * 0.92, H * 0.78, L * 0.42, 0.3), camo, 0, -H * 0.02, -L * 0.38);
    if (detailed) add(g, rbox(W * 0.5, H * 0.12, L * 0.62), metal, 0, H * 0.56, -L * 0.18); // top rail
  } else {
    add(g, rbox(W * 0.95, H * 0.5, L * 0.5, 0.3), camo, 0, H * 0.2, -L * 0.3); // slide front
  }
  // Barrel + muzzle device.
  const barrelLen = w.barrel;
  const br = Math.max(0.008, W * 0.17);
  add(g, cyl(br, br, barrelLen, 10), metal, 0, H * 0.12, -L * 0.6 - barrelLen / 2, Math.PI / 2);
  if (detailed && !pistol) add(g, cyl(br * 1.6, br * 1.6, barrelLen * 0.22, 8), metal, 0, H * 0.12, -L * 0.6 - barrelLen + barrelLen * 0.11, Math.PI / 2);
  // Grip.
  add(g, rbox(W * 0.8, H * (pistol ? 1.3 : 1.1), W * 1.3, 0.3), polymer, 0, -H * (pistol ? 0.85 : 0.75), L * (pistol ? 0.16 : 0.12), -0.3);
  // Magazine.
  if (weaponId === 'shotgun') add(g, cyl(br * 1.4, br * 1.4, L * 0.55, 10), metal, 0, -H * 0.18, -L * 0.45, Math.PI / 2);
  else if (weaponId === 'lmg') add(g, rbox(W * 1.6, H * 0.9, L * 0.2, 0.2), polymer, -W * 0.3, -H * 0.75, -L * 0.04);
  else if (!pistol) add(g, rbox(W * 0.7, H * (weaponId === 'sniper' || weaponId === 'dmr' ? 0.7 : 1.15), L * 0.11, 0.2), accent, 0, -H * 0.85, -L * 0.08, weaponId === 'rifle' ? 0.22 : 0.08);
  // Stock.
  if (!pistol) {
    add(g, rbox(W * 0.75, H * 0.85, L * 0.32, 0.3), camo, 0, -H * 0.08, L * 0.42);
    if (detailed) add(g, rbox(W * 0.9, H * 1.0, L * 0.05, 0.3), polymer, 0, -H * 0.12, L * 0.6);
  }
  // Sight.
  let sightY = H * 0.62, sightZ = 0;
  if (weaponId === 'sniper' || weaponId === 'dmr') {
    const sr = weaponId === 'sniper' ? W * 0.42 : W * 0.34;
    const sl = L * (weaponId === 'sniper' ? 0.5 : 0.36);
    sightY = H * 0.62 + sr * 1.6;
    add(g, cyl(sr, sr, sl, 14), metal, 0, sightY, -L * 0.05, Math.PI / 2);
    add(g, cyl(sr * 1.25, sr, sl * 0.16, 14), metal, 0, sightY, -L * 0.05 - sl * 0.5, Math.PI / 2);
    add(g, rbox(W * 0.4, sr * 1.2, W * 0.5), metal, 0, H * 0.62 + sr * 0.5, -L * 0.15);
    add(g, rbox(W * 0.4, sr * 1.2, W * 0.5), metal, 0, H * 0.62 + sr * 0.5, L * 0.08);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(sr * 0.85, 20), new THREE.MeshStandardMaterial({ color: 0x2a6fff, emissive: 0x1a4fcc, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.8 }));
    lens.position.set(0, sightY, -L * 0.05 - sl * 0.58);
    lens.rotation.y = Math.PI;
    g.add(lens);
    sightZ = -L * 0.05;
  } else if (!pistol) {
    // Red-dot sight.
    const hy = H * 0.62 + H * 0.38;
    add(g, rbox(W * 0.85, H * 0.5, L * 0.13, 0.3), metal, 0, hy, -L * 0.02);
    const dot = new THREE.Mesh(sphere(W * 0.045), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    dot.position.set(0, hy + H * 0.06, -L * 0.07);
    g.add(dot);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.7, H * 0.36), new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.9 }));
    glass.position.set(0, hy + H * 0.06, -L * 0.06);
    g.add(glass);
    sightY = hy + H * 0.06;
    sightZ = -L * 0.07;
  } else {
    add(g, rbox(W * 0.3, H * 0.15, W * 0.3), metal, 0, H * 0.5, -L * 0.52);
    add(g, rbox(W * 0.7, H * 0.15, W * 0.3), metal, 0, H * 0.5, L * 0.25);
    sightY = H * 0.58;
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, H * 0.12, -L * 0.6 - barrelLen - 0.02);
  g.add(muzzle);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: FLASH_TEXTURE(), color: new THREE.Color(2.6, 2.2, 1.7), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  flash.scale.set(0.32, 0.32, 1);
  flash.visible = false;
  muzzle.add(flash);
  g.userData = { muzzle, flash, sightY: sightY * scale, sightZ: sightZ * scale, length: (L + barrelLen) * scale };
  g.scale.setScalar(scale);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------------------------------------------
const outlineMats = new Map();
function outlineMaterial(color) {
  if (!outlineMats.has(color)) outlineMats.set(color, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false }));
  return outlineMats.get(color);
}
function addOutline(mesh, color, t = 0.035) {
  const o = new THREE.Mesh(mesh.geometry, outlineMaterial(color));
  const s = mesh.scale;
  // Box/capsule/sphere geometries are unit-ish; inflate by an absolute thickness using the bounding box.
  mesh.geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  mesh.geometry.boundingBox.getSize(size);
  o.scale.set(1 + (2 * t) / (size.x * s.x || 1), 1 + (2 * t) / (size.y * s.y || 1), 1 + (2 * t) / (size.z * s.z || 1));
  o.castShadow = false;
  mesh.add(o);
  return o;
}

export function shade(color, k) {
  return '#' + new THREE.Color(color).multiplyScalar(k).getHexString();
}

/**
 * Operator model.
 * @param {object} opts { color (team colour), outfit id, outline (bool), simple (bool, fewer parts), visorOverride }
 * Returns { root, body, legL, legR, armPivot, headPivot, gunSocket }.
 */
export function buildOperator(opts) {
  const look = outfitById(opts.outfit).look;
  const glow = opts.glow ?? 0.35; // in-game the team colour glows a little so it reads in shade and at night
  const team = mat(opts.color, { rough: 0.6, emissive: glow });
  const teamDark = mat(shade(opts.color, 0.5), { rough: 0.75, emissive: glow * 0.5 });
  const vest = mat(look.vest, { rough: 0.85 });
  const dark = mat('#1a1c20', { rough: 0.9 });
  const skin = mat('#8a6a55', { rough: 0.8 });
  const visor = mat(look.visor, { rough: 0.15, metal: 0.6, emissive: 0.55 });
  const outlined = [];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const bulk = look.bulky ? 1.12 : 1;

  // Legs pivot at the hips.
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.11, 0.9, 0);
    body.add(leg);
    outlined.push(add(leg, capsule(0.085 * bulk, 0.3), teamDark, 0, -0.22, 0));
    outlined.push(add(leg, capsule(0.075 * bulk, 0.3), teamDark, 0, -0.6, 0.01));
    if (!opts.simple) {
      add(leg, rbox(0.12, 0.12, 0.08), look.pads ? mat(look.pads) : dark, 0, -0.42, -0.08);
      add(leg, rbox(0.13, 0.1, 0.25, 0.3), dark, 0, -0.85, -0.03);
    }
    legs.push(leg);
  }
  // Hips, torso (team colour), plates (outfit), belt, backpack.
  outlined.push(add(body, rbox(0.36 * bulk, 0.2, 0.22, 0.3), teamDark, 0, 0.94, 0));
  const torso = add(body, rbox(0.46 * bulk, 0.56, 0.26 * bulk, 0.25), team, 0, 1.24, 0);
  outlined.push(torso);
  add(body, rbox(0.34 * bulk, 0.32, 0.07, 0.3), vest, 0, 1.2, -0.15 * bulk);   // front plate
  add(body, rbox(0.34 * bulk, 0.34, 0.07, 0.3), vest, 0, 1.22, 0.15 * bulk);   // back plate
  if (!opts.simple) {
    add(body, rbox(0.1, 0.12, 0.05), dark, -0.09, 1.1, -0.2);                   // mag pouches
    add(body, rbox(0.1, 0.12, 0.05), dark, 0.09, 1.1, -0.2);
    add(body, rbox(0.48 * bulk, 0.07, 0.28 * bulk, 0.3), dark, 0, 0.99, 0);     // belt
    if (look.trim) add(body, rbox(0.35 * bulk, 0.02, 0.075), mat(look.trim, { emissive: 0.8 }), 0, 1.34, -0.16 * bulk);
  }
  if (look.pack) add(body, rbox(0.32, 0.38, 0.15, 0.3), look.vest === '#dfe6ec' ? vest : dark, 0, 1.24, 0.27 * bulk);
  if (look.pads) {
    add(body, rbox(0.16, 0.08, 0.2, 0.4), mat(look.pads, { rough: 0.6, metal: 0.4 }), -0.26 * bulk, 1.5, 0, 0, 0, 0.3);
    add(body, rbox(0.16, 0.08, 0.2, 0.4), mat(look.pads, { rough: 0.6, metal: 0.4 }), 0.26 * bulk, 1.5, 0, 0, 0, -0.3);
  }
  // Head.
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.55, 0);
  body.add(headPivot);
  add(headPivot, cyl(0.06, 0.07, 0.1), skin, 0, 0, 0);
  add(headPivot, sphere(0.125), look.mask ? mat(look.mask, { rough: 0.8 }) : skin, 0, 0.13, 0);
  switch (look.head) {
    case 'cap':
      outlined.push(add(headPivot, cyl(0.13, 0.135, 0.09, 16), team, 0, 0.22, 0));
      add(headPivot, rbox(0.2, 0.02, 0.12), team, 0, 0.19, -0.13);
      break;
    case 'beret': {
      const b = add(headPivot, sphere(0.14), team, 0.02, 0.22, 0.01, 0, 0, 0.25);
      b.scale.set(1, 0.38, 1);
      outlined.push(b);
      break;
    }
    case 'boonie':
      outlined.push(add(headPivot, cyl(0.12, 0.13, 0.1, 16), team, 0, 0.22, 0));
      add(headPivot, cyl(0.22, 0.22, 0.015, 20), team, 0, 0.18, 0);
      break;
    case 'hood': {
      const h = add(headPivot, sphere(0.155), team, 0, 0.14, 0.03);
      h.scale.set(1, 1.05, 1.1);
      outlined.push(h);
      break;
    }
    default: // helmet
      outlined.push(add(headPivot, sphere(0.15, true), team, 0, 0.15, 0.01));
      add(headPivot, cyl(0.155, 0.155, 0.03, 18), team, 0, 0.16, 0.01);
      if (!opts.simple) add(headPivot, rbox(0.05, 0.05, 0.05), dark, 0, 0.27, -0.1);
  }
  // Eyes: visor / goggles / shades.
  if (look.bigVisor) add(headPivot, rbox(0.24, 0.1, 0.05, 0.4), visor, 0, 0.15, -0.115);
  else if (look.goggles) {
    add(headPivot, cyl(0.035, 0.035, 0.04, 10), visor, -0.045, 0.16, -0.115, Math.PI / 2);
    add(headPivot, cyl(0.035, 0.035, 0.04, 10), visor, 0.045, 0.16, -0.115, Math.PI / 2);
  } else if (look.scopeEye) add(headPivot, cyl(0.03, 0.03, 0.06, 10), visor, 0.045, 0.16, -0.12, Math.PI / 2);
  else add(headPivot, rbox(0.2, look.shades ? 0.035 : 0.05, 0.04, 0.4), look.shades ? mat('#0c0c0e', { rough: 0.1, metal: 0.8 }) : visor, 0, 0.16, -0.11);
  if (look.skull) {
    add(headPivot, rbox(0.16, 0.08, 0.02), mat('#e6e2d8'), 0, 0.08, -0.12);
    add(headPivot, rbox(0.03, 0.02, 0.01), mat('#111111'), -0.03, 0.08, -0.132);
    add(headPivot, rbox(0.03, 0.02, 0.01), mat('#111111'), 0.03, 0.08, -0.132);
  }
  // Arms hold the gun forward; pitch with aim.
  const armPivot = new THREE.Group();
  armPivot.position.set(0, 1.42, 0);
  body.add(armPivot);
  // Shoulder -> elbow -> hand: right hand on the grip, left hand on the handguard.
  const rS = v3(0.25 * bulk, -0.04, 0), rE = v3(0.24, -0.24, -0.16), rH = v3(0.1, -0.13, -0.36);
  const lS = v3(-0.25 * bulk, -0.04, 0), lE = v3(-0.22, -0.2, -0.26), lH = v3(0.04, -0.08, -0.62);
  outlined.push(limb(armPivot, rS, rE, 0.065 * bulk, team), limb(armPivot, rE, rH, 0.056, team));
  outlined.push(limb(armPivot, lS, lE, 0.065 * bulk, team), limb(armPivot, lE, lH, 0.056, team));
  if (!opts.simple) {
    add(armPivot, sphere(0.05), dark, rH.x, rH.y, rH.z);
    add(armPivot, sphere(0.05), dark, lH.x, lH.y, lH.z);
  }
  const gunSocket = new THREE.Group();
  gunSocket.position.set(0.1, -0.02, -0.42);
  armPivot.add(gunSocket);

  // Only the big body parts cast shadows (small pouches, gloves and visors would cost draw calls for nothing).
  root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  for (const m of outlined) m.castShadow = true;
  if (opts.outline) for (const m of outlined) addOutline(m, opts.color);
  return { root, body, legL: legs[0], legR: legs[1], armPivot, headPivot, gunSocket };
}

// ---------------------------------------------------------------------------------------------------------------
// First-person arms (children of the view-model gun)
// ---------------------------------------------------------------------------------------------------------------
export function buildFirstPersonArms(gun, opts) {
  const look = outfitById(opts.outfit).look;
  const sleeve = mat(look.vest === '#dfe6ec' ? '#cfd6dc' : shade(look.vest, 1.6), { rough: 0.9 });
  const band = mat(opts.color, { rough: 0.6, emissive: 0.3 });
  const glove = mat('#202226', { rough: 0.85 });
  const w = WEAPONS[opts.weapon] || WEAPONS.rifle;
  const [, H, L] = w.size;
  const pistol = opts.weapon === 'pistol';
  // Authored in the gun's local units (metres before the view-model scale), so the arms move and scale with it.
  const arms = new THREE.Group();
  const grip = v3(0.005, -H * 0.95, L * (pistol ? 0.16 : 0.13));
  const fore = v3(-0.01, -H * 0.42, pistol ? L * 0.02 : -L * 0.42);
  const rElbow = v3(0.11, -0.2, grip.z + 0.26), rShoulderDir = v3(0.2, -0.32, grip.z + 0.6);
  const lElbow = v3(-0.2, -0.22, fore.z + 0.3), lShoulderDir = v3(-0.26, -0.36, fore.z + 0.75);
  add(arms, sphere(0.048), glove, grip.x, grip.y, grip.z, 0, 0, 0, false).scale.set(0.9, 1.25, 1.2);
  limb(arms, grip, rElbow, 0.045, sleeve, false);
  limb(arms, rElbow, rShoulderDir, 0.055, sleeve, false);
  add(arms, cyl(0.05, 0.05, 0.03, 12), band, (grip.x + rElbow.x) * 0.5, (grip.y + rElbow.y) * 0.5, (grip.z + rElbow.z) * 0.5, 1.2, 0, 0, false);
  add(arms, sphere(0.05), glove, fore.x, fore.y, fore.z, 0, 0, 0, false).scale.set(1.25, 1, 1.35);
  limb(arms, fore, lElbow, 0.045, sleeve, false);
  limb(arms, lElbow, lShoulderDir, 0.055, sleeve, false);
  add(arms, cyl(0.05, 0.05, 0.03, 12), band, (fore.x + lElbow.x) * 0.5, (fore.y + lElbow.y) * 0.5, (fore.z + lElbow.z) * 0.5, 1.1, -0.5, 0, false);
  gun.add(arms);
  return arms;
}
