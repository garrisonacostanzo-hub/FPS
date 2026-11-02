// Sky and image-based lighting: a physically based daytime/dusk sky (scattering shader) or a starry night dome.
// The sky is also baked into an environment map so metal, glass and wet-looking surfaces reflect it.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const SKY_SCALE = 380; // keep the sky box inside the camera's far plane

function nightDome(theme) {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(SKY_SCALE, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x02040b) }, horizon: { value: new THREE.Color(theme.fog || 0x1b2236) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main(){ float h = clamp(vDir.y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.45)), 1.0); }',
  });
  group.add(new THREE.Mesh(geo, mat));
  // Stars.
  const count = 1400;
  const pos = new Float32Array(count * 3);
  let s = 11;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < count; i++) {
    const u = r() * Math.PI * 2, v = 0.08 + r() * 0.92;
    const y = v, rr = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(u) * rr * (SKY_SCALE - 5);
    pos[i * 3 + 1] = y * (SKY_SCALE - 5);
    pos[i * 3 + 2] = Math.sin(u) * rr * (SKY_SCALE - 5);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 })));
  // Moon.
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grad.addColorStop(0, 'rgba(240,246,255,1)'); grad.addColorStop(0.35, 'rgba(220,232,255,0.9)'); grad.addColorStop(0.5, 'rgba(160,190,255,0.25)'); grad.addColorStop(1, 'rgba(120,150,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const moonTex = new THREE.CanvasTexture(c);
  moonTex.colorSpace = THREE.SRGBColorSpace;
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false, transparent: true }));
  const sd = new THREE.Vector3(...(theme.sun || [0.3, 1, -0.5])).normalize();
  moon.position.copy(sd).multiplyScalar(SKY_SCALE - 20);
  moon.scale.setScalar(46);
  group.add(moon);
  return group;
}

/**
 * Adds the sky to the scene and sets scene.environment. Returns { sunDir, mesh }.
 */
export function buildSky(renderer, scene, theme, quality = 'medium') {
  const night = theme.timeOfDay === 'night';
  const dusk = theme.timeOfDay === 'dusk';
  const sunDir = new THREE.Vector3(...(theme.sun || [0.5, 1, 0.3])).normalize();
  let skyObject;
  if (night) {
    skyObject = nightDome(theme);
  } else {
    const sky = new Sky();
    sky.scale.setScalar(SKY_SCALE);
    const u = sky.material.uniforms;
    u.turbidity.value = dusk ? 9 : 4.5;
    u.rayleigh.value = dusk ? 2.6 : 1.4;
    u.mieCoefficient.value = dusk ? 0.0032 : 0.0014;
    u.mieDirectionalG.value = 0.93;
    // Visible sun a little lower than the light direction for nicer gradients.
    const elevation = dusk ? 0.16 : 0.5;
    const flat = new THREE.Vector3(sunDir.x, 0, sunDir.z).normalize();
    u.sunPosition.value.copy(flat.multiplyScalar(Math.cos(elevation))).setY(Math.sin(elevation));
    u.cloudCoverage.value = dusk ? 0.55 : 0.42;
    u.cloudDensity.value = dusk ? 0.5 : 0.38;
    // The scattering model is physically scaled; bring it into the same range as the rest of the scene.
    sky.material.uniforms.skyExposure = { value: dusk ? 0.4 : 0.32 };
    sky.material.fragmentShader = 'uniform float skyExposure;\n' + sky.material.fragmentShader.replace(
      'gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min( texColor * skyExposure, vec3( 1.05 ) ), 1.0 );');
    sky.material.depthWrite = false;
    sky.material.needsUpdate = true;
    skyObject = sky;
  }
  skyObject.renderOrder = -10;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(skyObject);
  let envRT;
  if (night) {
    // The night dome is cheap to draw live (stars, moon).
    scene.add(skyObject.clone());
    scene.background = null;
    envRT = pmrem.fromScene(envScene, 0.02, 1, SKY_SCALE * 2);
  } else {
    // The scattering + cloud shader is expensive per pixel, so render it ONCE into a cube map and use that as the
    // background (and as the source of the environment lighting).
    const cubeRT = new THREE.WebGLCubeRenderTarget(quality === 'high' ? 512 : 256, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(1, SKY_SCALE * 3, cubeRT);
    cubeCam.update(renderer, envScene);
    scene.background = cubeRT.texture;
    envRT = pmrem.fromCubemap(cubeRT.texture);
  }
  scene.environment = envRT.texture;
  scene.environmentIntensity = night ? 0.35 : dusk ? 0.45 : 0.5;
  pmrem.dispose();
  return { sunDir, envRT };
}
