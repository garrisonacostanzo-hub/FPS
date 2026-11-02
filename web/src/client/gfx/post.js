// Post-processing chain (Medium/High quality):
//   scene -> [ambient occlusion: High] -> first-person weapon -> bloom -> tone mapping -> grading/vignette -> [FXAA]
// High renders into a 4x multisampled buffer, so it needs no FXAA. Low quality skips all of this.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0.32 },
    saturation: { value: 1.08 },
    contrast: { value: 1.06 },
    lift: { value: new THREE.Vector3(0.0, 0.004, 0.012) },     // cool shadows
    gain: { value: new THREE.Vector3(1.02, 1.0, 0.97) },       // warm highlights
    damage: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette; uniform float saturation; uniform float contrast;
    uniform vec3 lift; uniform vec3 gain; uniform float damage; varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float ca = 0.0012 + damage * 0.006;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + d * ca).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - d * ca).b;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, saturation * (1.0 - damage * 0.6));
      c = (c - 0.5) * contrast + 0.5;
      c = c * gain + lift * (1.0 - c);
      float v = smoothstep(0.85, 0.25, length(d) * (1.0 + vignette));
      c *= mix(1.0 - vignette, 1.0, v);
      c = mix(c, c * vec3(1.25, 0.55, 0.5), damage * smoothstep(0.2, 0.75, length(d)));
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, vmScene, vmCamera, quality) {
    this.renderer = renderer;
    this.quality = quality;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 0 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    if (quality === 'high') {
      this.ao = new GTAOPass(scene, camera, size.x, size.y);
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.blendIntensity = 0.85;
      this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 12 });
      this.composer.addPass(this.ao);
    }
    const vm = new RenderPass(vmScene, vmCamera);
    vm.clear = false;
    vm.clearDepth = true;
    this.composer.addPass(vm);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.45, 1.25); // the sky stays below the threshold
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    if (quality !== 'high') {
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    }
  }

  setSize(width, height, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
  }

  setDamage(amount) {
    this.grade.uniforms.damage.value = amount;
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
  }
}
