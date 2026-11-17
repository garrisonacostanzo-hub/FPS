// WebAudio engine. Every sound is synthesised in sfx.js (no audio files) and played through:
//   * 3D panning (HRTF) with realistic distance falloff,
//   * distance filtering: far sounds lose their highs, and loud sounds (gunshots, explosions) arrive late,
//     because sound travels at 343 m/s,
//   * a convolution reverb whose impulse response matches the map (open field, industrial, urban),
//   * a master compressor so a firefight stays punchy instead of clipping.
// Buffers are rendered on first use, with a few random variants each so repeated sounds don't machine-gun.
import { settings, onSettingsChanged } from './settings.js';
import * as sfx from './sfx.js';

const SPEED_OF_SOUND = 343;
const VARIANTS = 3;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.listenerPos = { x: 0, y: 0, z: 0 };
    this.env = 'open';
    this.voices = 0;
    this.reloadSources = [];
    this.lastImpact = 0;
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
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.18;
    this.master = this.ctx.createGain();
    this.master.connect(this.comp).connect(this.ctx.destination);
    this.reverb = this.ctx.createConvolver();
    this.reverbIn = this.ctx.createGain();
    this.reverbIn.connect(this.reverb).connect(this.master);
    this.setEnvironment(this.env, true);
    this.applyVolume();
    return true;
  }

  applyVolume() {
    if (this.master) this.master.gain.value = settings.volume;
  }

  /** Reverb character from the map theme: 'open' (grass field), 'industrial' (dusk foundry), 'urban' (night). */
  setEnvironment(themeOrKind, force) {
    const kind = typeof themeOrKind === 'string' ? themeOrKind
      : themeOrKind && themeOrKind.timeOfDay === 'dusk' ? 'industrial' : themeOrKind && themeOrKind.timeOfDay === 'night' ? 'urban' : 'open';
    if (kind === this.env && !force) return;
    this.env = kind;
    if (!this.ctx) return;
    const ch = sfx.impulseResponse(this.ctx.sampleRate, kind);
    const ir = this.ctx.createBuffer(2, ch[0].length, this.ctx.sampleRate);
    ir.getChannelData(0).set(ch[0]);
    ir.getChannelData(1).set(ch[1]);
    this.reverb.buffer = ir;
  }

  buffer(key, build) {
    if (!this.buffers.has(key)) this.buffers.set(key, build(this.ctx));
    return this.buffers.get(key);
  }

  /** A rendered sfx (Float32Array) as an AudioBuffer, cached per key. */
  sample(key, render) {
    return this.buffer(key, (ctx) => {
      const data = render(ctx.sampleRate);
      const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.getChannelData(0).set(data);
      return b;
    });
  }

  /** One of a few cached variants of a sound. */
  variant(key, render) {
    const v = Math.floor(Math.random() * VARIANTS);
    return this.sample(`${key}#${v}`, (rate) => render(rate, 1000 + v * 7919 + hash(key)));
  }

  setListener(position, forward) {
    this.listenerPos = { x: position.x, y: position.y, z: position.z };
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

  distanceTo(p) {
    const l = this.listenerPos;
    return Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z);
  }

  /**
   * Plays a buffer.
   * @param {object} o volume, rate, position (null = in your head), maxDistance, reverb (0..1 send),
   *   delay (seconds, e.g. sound travel time), muffle (filter highs by distance)
   */
  play(buffer, { volume = 1, rate = 1, position = null, maxDistance = 120, reverb = 0.15, delay = 0, muffle = true } = {}) {
    if (!this.ctx || !buffer) return null;
    if (this.voices > 56 && volume < 0.6) return null; // don't drown in tiny sounds during a big firefight
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    let node = src;
    if (position) {
      const dist = this.distanceTo(position);
      if (dist > maxDistance) return null;
      if (muffle && dist > 6) {
        // Air absorbs high frequencies over distance.
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.max(700, 16000 * Math.exp(-dist / 70));
        lp.Q.value = 0.5;
        node.connect(lp);
        node = lp;
      }
      node.connect(gain);
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 3;
      panner.rolloffFactor = 1;
      panner.maxDistance = 10000;
      if (panner.positionX) { panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z; }
      else panner.setPosition(position.x, position.y, position.z);
      gain.connect(panner).connect(this.master);
      if (reverb > 0) {
        // Farther sounds are heard more through their echoes.
        const send = ctx.createGain();
        send.gain.value = Math.min(1, reverb * (0.6 + Math.min(1.6, dist / 40))) * Math.min(1, 6 / Math.max(3, dist) + 0.25);
        gain.connect(send).connect(this.reverbIn);
      }
    } else {
      node.connect(gain).connect(this.master);
      if (reverb > 0) {
        const send = ctx.createGain();
        send.gain.value = reverb;
        gain.connect(send).connect(this.reverbIn);
      }
    }
    src.start(ctx.currentTime + delay);
    this.voices++;
    src.onended = () => { this.voices--; };
    return src;
  }

  /** Loops a buffer (emote music) until stop(). offset (s) keeps several dancers' music on the same beat. */
  playLoop(buffer, { volume = 0.5, position = null, maxDistance = 45, offset = 0 } = {}) {
    if (!this.ensure() || !buffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    let panner = null;
    if (position) {
      panner = this.ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'linear';
      panner.refDistance = 3;
      panner.maxDistance = maxDistance;
      src.connect(gain).connect(panner).connect(this.master);
    } else {
      src.connect(gain).connect(this.master);
    }
    const setPosition = (p) => {
      if (!panner || !p) return;
      if (panner.positionX) { panner.positionX.value = p.x; panner.positionY.value = p.y; panner.positionZ.value = p.z; }
      else panner.setPosition(p.x, p.y, p.z);
    };
    setPosition(position);
    src.start(0, ((offset % buffer.duration) + buffer.duration) % buffer.duration);
    return {
      setPosition,
      stop: () => {
        try { gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08); src.stop(this.ctx.currentTime + 0.4); } catch { /* already stopped */ }
      },
    };
  }

  // ------------------------------------------------------------------------------------------------
  // Weapons
  // ------------------------------------------------------------------------------------------------
  /** Renders your guns' sounds ahead of the first shot (avoids a hitch on the first trigger pull). */
  preload(weaponIds) {
    if (!this.ensure()) return;
    for (const id of weaponIds) {
      for (let v = 0; v < VARIANTS; v++) {
        const key = `gun-close:${id}`;
        this.sample(`${key}#${v}`, (rate) => sfx.gunshot(rate, id, 1000 + v * 7919 + hash(key), true));
      }
    }
  }

  gunshot(weaponId, position, local) {
    if (!this.ensure()) return;
    if (local) {
      this.play(this.variant(`gun-close:${weaponId}`, (rate, seed) => sfx.gunshot(rate, weaponId, seed, true)), { volume: 0.85, rate: 0.97 + Math.random() * 0.06, reverb: 0.32 });
      return;
    }
    const dist = position ? this.distanceTo(position) : 0;
    const close = dist < 12;
    this.play(this.variant(close ? `gun-close:${weaponId}` : `gun-far:${weaponId}`, (rate, seed) => sfx.gunshot(rate, weaponId, seed, close)), {
      volume: 1, rate: 0.96 + Math.random() * 0.08, position, maxDistance: 600, reverb: 0.4, delay: Math.min(0.6, dist / SPEED_OF_SOUND),
    });
  }

  /** Sniper bolt / shotgun pump after your shot, and the casing hitting the ground. */
  afterShot(weaponId) {
    if (!this.ctx) return;
    if (weaponId === 'sniper' || weaponId === 'shotgun') {
      const kind = weaponId === 'sniper' ? 'bolt' : 'pump';
      this.play(this.variant(`action:${kind}`, (rate, seed) => sfx.action(rate, kind, seed)), { volume: 0.55, delay: weaponId === 'sniper' ? 0.42 : 0.28, reverb: 0.1 });
    }
    if (Math.random() < 0.7) {
      const shell = weaponId === 'shotgun';
      this.play(this.variant(`casing:${shell ? 's' : 'b'}`, (rate, seed) => sfx.casing(rate, seed, shell)), { volume: 0.18, delay: 0.32 + Math.random() * 0.25, reverb: 0.05 });
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Knives (weight: karambit light ... hatchet heavy)
  // ------------------------------------------------------------------------------------------------
  knifeSwing(weaponId, position) {
    if (!this.ensure()) return;
    const weight = knifeWeight(weaponId);
    this.play(this.variant(`kswing:${weight}`, (rate, seed) => sfx.knifeSwing(rate, weight, seed)), {
      volume: position ? 0.6 : 0.5, rate: 0.94 + Math.random() * 0.12, position, maxDistance: 30, reverb: 0.08,
    });
  }

  /** kind: 'body' or a map material id. position null = your own swing. */
  knifeHit(weaponId, kind, position) {
    if (!this.ensure()) return;
    const weight = knifeWeight(weaponId);
    const k = kind === 'body' ? 'body' : impactKind(kind) === 'metal' ? 'metal' : impactKind(kind) === 'wood' ? 'crate' : 'concrete';
    this.play(this.variant(`khit:${k}:${weight}`, (rate, seed) => sfx.knifeHit(rate, weight, k, seed)), {
      volume: kind === 'body' ? 0.85 : 0.65, rate: 0.95 + Math.random() * 0.1, position, maxDistance: 40, reverb: 0.12,
    });
  }

  knifeDraw() {
    if (!this.ensure()) return;
    this.play(this.variant('kdraw', (rate, seed) => sfx.knifeDraw(rate, seed)), { volume: 0.45, reverb: 0.05 });
  }

  dryFire() {
    if (!this.ensure()) return;
    this.play(this.variant('dry', (rate, seed) => sfx.dryFire(rate, seed)), { volume: 0.5, reverb: 0 });
  }

  /** The reload, as separate parts timed across its duration. */
  reload(weaponId = 'rifle', duration = 2, empty = false) {
    if (!this.ensure()) return;
    this.cancelReload();
    const parts = weaponId === 'shotgun'
      ? [0.18, 0.36, 0.54, 0.72].map((f) => ['shell', f]).concat(empty ? [['bolt', 0.92]] : [])
      : weaponId === 'sniper' ? [['bolt', 0.08], ['magOut', 0.25], ['magIn', 0.6], ['bolt', 0.86]]
        : [['magOut', 0.12], ['magIn', 0.58]].concat(empty ? [['bolt', 0.84]] : []);
    for (const [part, f] of parts) {
      const src = this.play(this.variant(`reload:${part}`, (rate, seed) => sfx.reloadPart(rate, part, seed)), { volume: 0.5, delay: duration * f, reverb: 0.06 });
      if (src) this.reloadSources.push(src);
    }
  }

  /** Switching weapons mid-reload: stop the parts that haven't played yet. */
  cancelReload() {
    for (const s of this.reloadSources) { try { s.stop(); } catch { /* already played */ } }
    this.reloadSources = [];
  }

  reloadDone() { /* the last reload part already sounds the end of the reload */ }

  // ------------------------------------------------------------------------------------------------
  // World
  // ------------------------------------------------------------------------------------------------
  /** surface: grass | concrete | metal | wood | sand. position null = your own feet. */
  footstep(position, volume = 0.25, surface = 'concrete', land = false) {
    if (!this.ctx) return;
    const s = ['grass', 'metal', 'wood', 'sand'].includes(surface) ? surface : 'concrete';
    this.play(this.variant(`step:${s}:${land ? 1 : 0}`, (rate, seed) => sfx.footstep(rate, s, seed, land)), {
      volume: volume * 1.6, rate: 0.9 + Math.random() * 0.2, position, maxDistance: 45, reverb: 0.06,
    });
  }

  /** A bullet hitting something. material: map material id or 'ground'; body: hit a player. */
  impact(material, position, body) {
    if (!this.ctx || !position) return;
    const now = performance.now();
    if (now - this.lastImpact < 12) return; // shotgun pellets: a few impacts are enough
    this.lastImpact = now;
    const kind = body ? 'body' : impactKind(material);
    this.play(this.variant(`impact:${kind}`, (rate, seed) => sfx.impact(rate, kind, seed)), {
      volume: body ? 0.7 : 0.55, rate: 0.9 + Math.random() * 0.2, position, maxDistance: 70, reverb: 0.15,
    });
  }

  nearMiss(position, supersonic) {
    if (!this.ensure()) return;
    const k = supersonic ? 'crack' : 'whiz';
    this.play(this.variant(`miss:${k}`, (rate, seed) => sfx.nearMiss(rate, supersonic, seed)), { volume: supersonic ? 0.9 : 0.7, rate: 0.9 + Math.random() * 0.2, position, maxDistance: 15, reverb: 0.2, muffle: false });
  }

  /** Frag grenade explosion. */
  boom(position) {
    if (!this.ensure()) return;
    const dist = position ? this.distanceTo(position) : 0;
    this.play(this.variant('boom', (rate, seed) => sfx.explosion(rate, seed)), {
      volume: 1, position, maxDistance: 800, reverb: 0.6, delay: Math.min(0.8, dist / SPEED_OF_SOUND),
    });
  }

  // ------------------------------------------------------------------------------------------------
  // Feedback and UI
  // ------------------------------------------------------------------------------------------------
  hit(headshot) {
    if (!this.ensure()) return;
    const k = headshot ? 'head' : 'hit';
    this.play(this.variant(`marker:${k}`, (rate, seed) => sfx.hitMarker(rate, k, seed)), { volume: headshot ? 0.6 : 0.45, reverb: 0 });
  }

  kill() {
    if (!this.ensure()) return;
    this.play(this.variant('marker:kill', (rate, seed) => sfx.hitMarker(rate, 'kill', seed)), { volume: 0.6, reverb: 0.05 });
  }

  hurt() {
    if (!this.ensure()) return;
    this.play(this.variant('hurt', (rate, seed) => sfx.hurt(rate, seed)), { volume: 0.7, reverb: 0 });
  }

  pickup() {
    if (!this.ensure()) return;
    this.play(this.variant('ammo', (rate, seed) => sfx.ammoRattle(rate, seed)), { volume: 0.55, reverb: 0.05 });
  }

  capture() {
    if (!this.ensure()) return;
    this.play(this.sample('capture', (rate) => sfx.chime(rate, [587, 740, 880], 0.09, 0.18, 3)), { volume: 0.4, reverb: 0.1 });
  }

  announce() {
    if (!this.ensure()) return;
    this.play(this.sample('announce', (rate) => sfx.chime(rate, [523, 784], 0.12, 0.25, 5)), { volume: 0.32, reverb: 0.1 });
  }

  click() {
    if (!this.ensure()) return;
    this.play(this.variant('ui', (rate, seed) => sfx.uiClick(rate, seed)), { volume: 0.4, reverb: 0 });
  }

  /** Short cue for each special ability (yours, or someone else's nearby). */
  ability(kind, position) {
    if (!this.ensure()) return;
    const cues = {
      dash: [(t, rnd, st) => { st.lp += (rnd() * 2 - 1 - st.lp) * 0.25; return st.lp * Math.sin(Math.PI * Math.min(1, t / 0.25)) * 1.2; }, 0.25],
      stim: [(t) => Math.sin(2 * Math.PI * (600 + 900 * t) * t) * Math.exp(-t * 5) * 0.5, 0.45],
      frag: [(t, rnd) => (rnd() * 2 - 1) * Math.exp(-t * 40) * 0.6 + Math.sin(2 * Math.PI * 900 * t) * Math.exp(-t * 30) * 0.3, 0.12],
      smoke: [(t, rnd, st) => { st.lp += (rnd() * 2 - 1 - st.lp) * 0.5; return st.lp * Math.exp(-t * 0.9) * 0.5; }, 1.6],
      pulse: [(t) => Math.sin(2 * Math.PI * (300 + 700 * t) * t) * Math.exp(-t * 2.5) * 0.45, 0.8],
      cloak: [(t) => Math.sin(2 * Math.PI * (1400 - 1100 * t) * t) * Math.exp(-t * 4) * 0.35, 0.5],
    };
    const cue = cues[kind];
    if (!cue) return;
    const b = this.buffer('ab-' + kind, (ctx) => synth(ctx, cue[1], cue[0], 0.9));
    this.play(b, { volume: position ? 0.8 : 0.6, position, maxDistance: 60, reverb: 0.15 });
  }
}

/** Knife weight for its sounds, in three steps: light (karambit, stiletto), medium, heavy (machete, hatchet). */
function knifeWeight(weaponId) {
  return weaponId === 'karambit' || weaponId === 'stiletto' ? 0 : weaponId === 'machete' || weaponId === 'hatchet' ? 1 : 0.5;
}

/** Map material id -> impact sound family. */
function impactKind(material) {
  switch (material) {
    case 'metal': case 'container': case 'containerB': case 'stairs': return 'metal';
    case 'crate': case 'floor': return 'wood';
    case 'sand': case 'ground': return 'dirt';
    default: return 'concrete';
  }
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
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
