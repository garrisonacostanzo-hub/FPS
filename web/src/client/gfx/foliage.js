// Set dressing: instanced grass, pine forest around the grass map, industrial stacks around Foundry and street
// lamps for the night map. Skipped on Low quality.
import * as THREE from 'three';
import { rng } from './textures.js';

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = rng(99);
  for (let i = 0; i < 26; i++) {
    const x = 6 + r() * 52, h = 28 + r() * 34, lean = (r() - 0.5) * 18;
    g.strokeStyle = `rgb(${60 + r() * 50 | 0},${95 + r() * 60 | 0},${30 + r() * 30 | 0})`;
    g.lineWidth = 2 + r() * 2;
    g.beginPath(); g.moveTo(x, 64); g.quadraticCurveTo(x + lean * 0.3, 64 - h * 0.6, x + lean, 64 - h); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function crossedQuads(w, h) {
  const a = new THREE.PlaneGeometry(w, h);
  a.translate(0, h / 2, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const geo = new THREE.BufferGeometry();
  const merge = (geos) => {
    const pos = [], nor = [], uv = [], idx = [];
    let off = 0;
    for (const gg of geos) {
      pos.push(...gg.attributes.position.array); nor.push(...gg.attributes.normal.array); uv.push(...gg.attributes.uv.array);
      idx.push(...gg.index.array.map((i) => i + off));
      off += gg.attributes.position.count;
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
  };
  merge([a, b]);
  // Normals pointing up make the tufts light like the ground instead of flat cards.
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return geo;
}

export function addFoliage(scene, map, world, quality) {
  if (quality === 'low') return;
  const theme = map.theme || {};
  const r = rng(map.half * 13 + 5);
  const half = map.half;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const high = quality === 'high';

  if (theme.ground === 'grass') {
    // Grass tufts on open ground (not on floors, inside walls or under crates).
    const count = high ? 7000 : 2600;
    const mat = new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 });
    const mesh = new THREE.InstancedMesh(crossedQuads(0.7, 0.42), mat, count);
    let placed = 0;
    for (let tries = 0; tries < count * 4 && placed < count; tries++) {
      const inside = r() < 0.8;
      const x = (r() * 2 - 1) * (inside ? half - 1 : half * 1.6), z = (r() * 2 - 1) * (inside ? half - 1 : half * 1.6);
      if (inside && (world.surfaceHeight(x, z, 0.5) > 0.01 || world.overlaps(x - 0.35, 0.05, z - 0.35, x + 0.35, 0.5, z + 0.35))) continue;
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, r() * Math.PI, 0);
      dummy.scale.setScalar(0.7 + r() * 0.8);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      mesh.setColorAt(placed, color.setHSL(0.24 + r() * 0.06, 0.45, 0.32 + r() * 0.12));
      placed++;
    }
    mesh.count = placed;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Pine forest ring outside the boundary.
    const trees = high ? 220 : 120;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 7), new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }), trees);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 7, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), trees * 2);
    for (let i = 0; i < trees; i++) {
      const a = r() * Math.PI * 2, d = half + 6 + r() * half * 0.9;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, s = 0.8 + r() * 0.9;
      dummy.position.set(x, 1.5 * s, z); dummy.rotation.set(0, r() * 6, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
      trunk.setMatrixAt(i, dummy.matrix);
      for (let k = 0; k < 2; k++) {
        dummy.position.set(x, (4.5 + k * 2.6) * s, z); dummy.scale.setScalar(s * (1 - k * 0.3)); dummy.updateMatrix();
        crown.setMatrixAt(i * 2 + k, dummy.matrix);
        crown.setColorAt(i * 2 + k, color.setHSL(0.3 + r() * 0.05, 0.4, 0.17 + r() * 0.08));
      }
    }
    trunk.castShadow = crown.castShadow = high;
    scene.add(trunk, crown);
  } else if (theme.timeOfDay === 'dusk') {
    // Industrial skyline: chimney stacks with blinking red lights.
    const stackMat = new THREE.MeshStandardMaterial({ color: 0x5a4a40, roughness: 0.9 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff3020 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r() * 0.3, d = half + 25 + r() * 40, h = 30 + r() * 35;
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, h, 12), stackMat);
      stack.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d);
      scene.add(stack);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), lightMat);
      bulb.position.set(stack.position.x, h + 0.6, stack.position.z);
      scene.add(bulb);
    }
  } else if (theme.timeOfDay === 'night') {
    // Street lamps along the inside of the boundary: glowing heads (bloom) and pools of light on the ground.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6, metalness: 0.5 });
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,220,160,0.55)'); grad.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const poolTex = new THREE.CanvasTexture(c);
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const step = 16;
    for (let x = -half + 3; x <= half - 3; x += step) {
      for (const z of [-half + 2.2, half - 2.2]) {
        for (const [px, pz] of [[x, z], [z, x]]) {
          if (world.overlaps(px - 0.4, 0.1, pz - 0.4, px + 0.4, 4, pz + 0.4)) continue;
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 5, 8), poleMat);
          pole.position.set(px, 2.5, pz);
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), bulbMat);
          bulb.position.set(px, 5.1, pz);
          const pool = new THREE.Mesh(new THREE.CircleGeometry(4.5, 24), poolMat);
          pool.rotation.x = -Math.PI / 2;
          pool.position.set(px, 0.03, pz);
          scene.add(pole, bulb, pool);
        }
      }
    }
  }
}
