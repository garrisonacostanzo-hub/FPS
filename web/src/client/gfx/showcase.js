// Live 3D background for the main menu: your operator (equipped outfit) holding your weapon (equipped camo) in a
// moody studio, with dust in the light, slow camera drift and a weapon close-up for the Armory.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { animateCamos, buildGun, buildOperator } from './models.js';
import { surfaceTextures } from './textures.js';

export class MenuShowcase {
  constructor(canvas) {
    this.canvas = canvas;
    this.running = false;
    this.focus = 'operator';
    this.look = { outfit: 'rifleman', camo: 'default', weapon: 'rifle', color: '#4c5a46' };
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
    } catch {
      this.renderer = null; // no WebGL: the menu still works over its CSS background
      return;
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d10);
    scene.fog = new THREE.Fog(0x0b0d10, 7, 22);
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    pmrem.dispose();
    this.scene = scene;

    // Floor: dark concrete with a soft light pool.
    const tex = surfaceTextures('concrete', '#2a2c30', 256);
    for (const t of [tex.map, tex.normalMap]) t.repeat.set(6, 6);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, roughness: 0.6, metalness: 0.2 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    // Back wall panels for depth.
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.8, metalness: 0.3 });
    for (let i = -3; i <= 3; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.8, 6, 0.2), panelMat);
      p.position.set(i * 1.95, 3, -5.5 - Math.abs(i) * 0.3);
      p.rotation.y = -i * 0.08;
      scene.add(p);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.03, 0.05), new THREE.MeshBasicMaterial({ color: i === 0 ? 0xc8ff00 : 0x3a4048 }));
      strip.position.set(i * 1.95, 0.6 + (i % 2) * 0.2, -5.38 - Math.abs(i) * 0.3);
      strip.rotation.y = -i * 0.08;
      scene.add(strip);
    }

    // Lighting: warm key, cold rim, low fill.
    const key = new THREE.SpotLight(0xffe2c4, 38, 22, 0.5, 0.6, 1.5);
    key.position.set(3.5, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    scene.add(key, key.target);
    const rim = new THREE.SpotLight(0x6fa8ff, 70, 18, 0.6, 0.5, 1.5);
    rim.position.set(-3, 4, -4);
    scene.add(rim, rim.target);
    scene.add(new THREE.HemisphereLight(0x8090a0, 0x101214, 0.6));
    this.key = key;

    // Dust motes drifting through the light.
    const n = 260;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 9; pos[i * 3 + 1] = Math.random() * 4.5; pos[i * 3 + 2] = (Math.random() - 0.5) * 6; }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xffe9c8, size: 0.018, transparent: true, opacity: 0.55, depthWrite: false }));
    scene.add(this.dust);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
    this.operatorAnchor = new THREE.Group();
    scene.add(this.operatorAnchor);
    this.weaponAnchor = new THREE.Group();
    this.weaponAnchor.position.set(0.15, 1.35, 1.2);
    scene.add(this.weaponAnchor);
    this.rebuild();
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
  }

  get available() { return !!this.renderer; }

  setLook(look) {
    const next = { ...this.look, ...look };
    const changed = Object.keys(next).some((k) => next[k] !== this.look[k]);
    this.look = next;
    if (changed) this.rebuild();
  }

  setFocus(focus) {
    this.focus = focus;
  }

  rebuild() {
    if (!this.renderer) return;
    this.operatorAnchor.clear();
    this.weaponAnchor.clear();
    const op = buildOperator({ color: this.look.color, outfit: this.look.outfit, outline: false, simple: false, glow: 0.04 });
    op.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    op.root.rotation.y = Math.PI * 0.82;
    op.armPivot.rotation.x = -0.12;
    const gun = buildGun(this.look.weapon, 1, this.look.camo, true);
    gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    op.gunSocket.add(gun);
    this.op = op;
    this.operatorAnchor.add(op.root);
    const big = buildGun(this.look.weapon, 1.7, this.look.camo, true);
    this.weaponAnchor.add(big);
    this.bigGun = big;
  }

  resize() {
    if (!this.renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (!this.renderer || this.running) return;
    this.running = true;
    this.canvas.style.display = 'block';
    this.last = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (t - this.lastDraw < 1000 / 40) return; // 40 fps is plenty for a menu backdrop
      this.lastDraw = t;
      this.draw(t / 1000);
    };
    this.lastDraw = 0;
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.canvas) this.canvas.style.display = 'none';
  }

  draw(time) {
    const narrow = window.innerWidth < window.innerHeight * 1.1;
    const weapon = this.focus === 'weapon';
    // The operator stands at the right edge of the screen, clear of the menu panels (centred on narrow screens).
    const ox = narrow ? 0 : 2.05;
    this.operatorAnchor.position.set(ox, 0, 0);
    this.operatorAnchor.visible = !weapon;
    this.weaponAnchor.visible = weapon;
    if (this.op) {
      this.op.body.position.y = Math.sin(time * 1.6) * 0.008;
      this.op.headPivot.rotation.y = Math.sin(time * 0.4) * 0.18;
      this.op.armPivot.rotation.x = -0.12 + Math.sin(time * 1.6) * 0.01;
    }
    if (this.bigGun) {
      // Weapon close-up floats in the upper right, above the Armory detail panel.
      this.weaponAnchor.position.set(narrow ? 0 : 1.55, narrow ? 1.75 : 1.98, 0.7);
      this.bigGun.rotation.set(0.08, Math.PI / 2 + Math.sin(time * 0.45) * 0.55, 0.04);
    }
    const sway = Math.sin(time * 0.15) * 0.12;
    this.camera.position.set(sway, 1.45, 5.4 + Math.sin(time * 0.11) * 0.15);
    this.camera.lookAt(sway * 0.5, 1.2, 0);
    this.key.target.position.set(ox, 1, 0);
    const p = this.dust.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + 0.0025;
      if (y > 4.5) y = 0;
      p.setY(i, y);
      p.setX(i, p.getX(i) + Math.sin(time + i) * 0.0008);
    }
    p.needsUpdate = true;
    animateCamos(time);
    this.renderer.render(this.scene, this.camera);
  }
}
