// Procedural WebAudio sound effects (no asset files): gunshots per weapon, footsteps, hit/kill markers,
// reloads, captures and UI clicks, with 3D positioning relative to the camera.
import { settings, onSettingsChanged } from './settings.js';

const PROFILES = {
  pistol: { dur: 0.22, body: 260, vol: 0.5, noise: 0.7 },
  smg: { dur: 0.18, body: 320, vol: 0.42, noise: 0.65 },
  rifle: { dur: 0.32, body: 180, vol: 0.55, noise: 0.75 },
  shotgun: { dur: 0.55, body: 90, vol: 0.75, noise: 0.85 },
  lmg: { dur: 0.36, body: 150, vol: 0.6, noise: 0.8 },
  dmr: { dur: 0.45, body: 120, vol: 0.65, noise: 0.8 },
  sniper: { dur: 0.85, body: 70, vol: 0.85, noise: 0.85 },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.listener = null;
    this.unsubscribe = onSettingsChanged(() => this.applyVolume());
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.applyVolume();
    return true;
  }

  applyVolume() {
    if (this.master) this.master.gain.value = settings.volume;
  }

  buffer(key, build) {
    if (!this.buffers.has(key)) this.buffers.set(key, build(this.ctx));
    return this.buffers.get(key);
  }

  gunBuffer(weaponId) {
    const p = PROFILES[weaponId] || PROFILES.rifle;
    return this.buffer('gun:' + weaponId, (ctx) => synth(ctx, p.dur, (t, rnd, state) => {
      const env = Math.exp(-t * (12 / p.dur));
      state.lp = state.lp * 0.65 + rnd() * 0.35;
      const body = Math.sin(2 * Math.PI * p.body * t * (1 - t * 0.8)) * Math.exp(-t * 18);
      return (state.lp * 2 - 1) * p.noise * env + body * 0.6;
    }, p.vol));
  }

  setListener(position, forward) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = position.x; l.positionY.value = position.y; l.positionZ.value = position.z;
      l.forwardX.value = forward.x; l.forwardY.value = forward.y; l.forwardZ.value = forward.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else if (l.setPosition) {
      l.setPosition(position.x, position.y, position.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  play(buffer, { volume = 1, rate = 1, position = null, maxDistance = 120 } = {}) {
    if (!this.ctx || !buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    if (position) {
      const panner = this.ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'linear';
      panner.refDistance = 2;
      panner.maxDistance = maxDistance;
      panner.rolloffFactor = 1;
      if (panner.positionX) { panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z; }
      else panner.setPosition(position.x, position.y, position.z);
      src.connect(gain).connect(panner).connect(this.master);
    } else {
      src.connect(gain).connect(this.master);
    }
    src.start();
  }

  gunshot(weaponId, position, local) {
    if (!this.ensure()) return;
    this.play(this.gunBuffer(weaponId), { volume: local ? 0.8 : 1, rate: 0.95 + Math.random() * 0.1, position: local ? null : position, maxDistance: 160 });
  }

  footstep(position, volume = 0.25) {
    if (!this.ctx) return;
    const b = this.buffer('step', (ctx) => synth(ctx, 0.09, (t, rnd) => (Math.sin(2 * Math.PI * 95 * t) + (rnd() - 0.5) * 0.5) * Math.exp(-t * 90), 0.5));
    this.play(b, { volume, rate: 0.85 + Math.random() * 0.3, position, maxDistance: 35 });
  }

  tone(key, freq, dur, vol, type = 'sine') {
    if (!this.ensure()) return;
    const b = this.buffer(key, (ctx) => synth(ctx, dur, (t) => {
      const attack = Math.min(1, t / 0.004);
      const s = type === 'square' ? Math.sign(Math.sin(2 * Math.PI * freq * t)) * 0.5 : Math.sin(2 * Math.PI * freq * t);
      return s * attack * Math.exp(-t * (6 / dur));
    }, vol));
    this.play(b);
  }

  /** A bullet passing close by: a sharp crack for supersonic rounds, a whistling whiz for slow ones. */
  nearMiss(position, supersonic) {
    if (!this.ensure()) return;
    const b = supersonic
      ? this.buffer('crack', (ctx) => synth(ctx, 0.07, (t, rnd, st) => { st.lp = st.lp * 0.2 + rnd() * 0.8; return (st.lp * 2 - 1) * Math.exp(-t * 90) + Math.sin(2 * Math.PI * 2600 * t) * Math.exp(-t * 140) * 0.4; }, 0.75))
      : this.buffer('whiz', (ctx) => synth(ctx, 0.22, (t, rnd) => Math.sin(2 * Math.PI * (1900 - t * 3600) * t) * Math.sin(Math.PI * t / 0.22) * 0.5 + (rnd() - 0.5) * 0.15 * Math.sin(Math.PI * t / 0.22), 0.55));
    this.play(b, { volume: 0.9, rate: 0.9 + Math.random() * 0.2, position, maxDistance: 12 });
  }

  hit(headshot) { this.tone(headshot ? 'hs' : 'hit', headshot ? 2300 : 1800, 0.06, 0.35); }
  kill() { this.tone('kill', 1150, 0.16, 0.45); }
  hurt() { this.tone('hurt', 140, 0.2, 0.5); }
  dryFire() { this.tone('dry', 2400, 0.04, 0.3, 'square'); }
  reload() { this.tone('reload', 900, 0.08, 0.4, 'square'); }
  reloadDone() { this.tone('reloadDone', 1400, 0.1, 0.45, 'square'); }
  capture() { this.tone('capture', 660, 0.35, 0.4); }
  click() { this.tone('click', 1200, 0.03, 0.2, 'square'); }
  announce() { this.tone('announce', 520, 0.25, 0.3); }
}

function synth(ctx, duration, fn, volume) {
  const rate = ctx.sampleRate;
  const length = Math.ceil(duration * rate);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const state = { lp: 0.5 };
  for (let i = 0; i < length; i++) data[i] = Math.max(-1, Math.min(1, fn(i / rate, rnd, state) * volume));
  return buffer;
}
