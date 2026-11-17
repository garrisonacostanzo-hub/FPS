// Sound design: every sound effect is synthesised here into a Float32Array (no audio files), using small DSP
// building blocks (seeded noise, RBJ biquad filters, decaying resonators, soft clipping). audio.js turns these into
// AudioBuffers and plays them through 3D panning, distance filtering and a convolution reverb.
//
// A gunshot is built the way real ones are heard: an ultra-short broadband CRACK (the muzzle blast front), a low
// BOOM (filtered noise) with a pitch-falling THUMP, a mid BARK, the gun's MECHANICAL clack (bolt / slide, close up
// only) and a short room-ish TAIL. Each weapon has its own recipe and three random variants.

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
}

/** RBJ cookbook biquad as a per-sample function. */
export function biquad(type, freq, q, rate) {
  const w = (2 * Math.PI * Math.min(freq, rate * 0.45)) / rate;
  const cs = Math.cos(w), sn = Math.sin(w), a = sn / (2 * q);
  let b0, b1, b2;
  const a0 = 1 + a, a1 = -2 * cs, a2 = 1 - a;
  if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
  else if (type === 'bandpass') { b0 = a; b1 = 0; b2 = -a; }
  else { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
  const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = a1 / a0, A2 = a2 / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = B0 * x + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

const exp = Math.exp;

function finish(out, drive = 1.6, peak = 0.95) {
  // Fade the first samples in (no click), soft-clip for punch, then normalise.
  const fade = Math.min(out.length, 24);
  for (let i = 0; i < fade; i++) out[i] *= i / fade;
  let max = 0;
  for (let i = 0; i < out.length; i++) { out[i] = Math.tanh(out[i] * drive); max = Math.max(max, Math.abs(out[i])); }
  const g = max > 0 ? peak / max : 1;
  for (let i = 0; i < out.length; i++) out[i] *= g;
  // Fade the last 5 ms out.
  const tail = Math.min(out.length, 240);
  for (let i = 0; i < tail; i++) out[out.length - 1 - i] *= i / tail;
  return out;
}

/** Adds a bank of decaying sine resonators (metal parts ringing) starting at time t0. */
function ring(out, rate, t0, freqs, decay, gain, r) {
  const i0 = Math.floor(t0 * rate);
  const n = Math.min(out.length - i0, Math.ceil(decay * 6 * rate));
  const phases = freqs.map(() => Math.random() * 6.28);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let s = 0;
    for (let k = 0; k < freqs.length; k++) s += Math.sin(phases[k] + 2 * Math.PI * freqs[k] * t) * exp(-t / (decay * (1 - k * 0.18)));
    out[i0 + i] += (s / freqs.length) * gain * (1 + 0.15 * r());
  }
}

/** Adds a filtered noise burst starting at t0. */
function burst(out, rate, t0, { type = 'lowpass', freq = 1000, q = 0.7, decay = 0.02, gain = 1, attack = 0.0005, seed = 1, dur }) {
  const i0 = Math.floor(t0 * rate);
  const n = Math.min(out.length - i0, Math.ceil((dur || decay * 7) * rate));
  const f = biquad(type, freq, q, rate);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i0 + i] += f(r()) * Math.min(1, t / attack) * exp(-t / decay) * gain;
  }
}

/** Adds a sine whose pitch glides from f0 to f1. */
function thump(out, rate, t0, f0, f1, glide, decay, gain) {
  const i0 = Math.floor(t0 * rate);
  const n = Math.min(out.length - i0, Math.ceil(decay * 7 * rate));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = f1 + (f0 - f1) * exp(-t / glide);
    ph += (2 * Math.PI * f) / rate;
    out[i0 + i] += Math.sin(ph) * Math.min(1, t / 0.0015) * exp(-t / decay) * gain;
  }
}

// ------------------------------------------------------------------------------------------------
// Weapons
// ------------------------------------------------------------------------------------------------
export const GUN = {
  //        crack  boom lp  boom decay  thump f0/f1  thump decay  bark   mech Hz  tail   drive
  pistol: { crack: 0.9, lp: 2200, decay: 0.032, t0: 170, t1: 72, td: 0.045, bark: 1100, mech: 3300, tail: 0.16, drive: 1.8, slide: true },
  smg: { crack: 0.8, lp: 2000, decay: 0.028, t0: 160, t1: 68, td: 0.04, bark: 950, mech: 3700, tail: 0.14, drive: 1.9 },
  rifle: { crack: 1.15, lp: 1500, decay: 0.05, t0: 140, t1: 56, td: 0.06, bark: 720, mech: 2900, tail: 0.26, drive: 2.1 },
  shotgun: { crack: 0.9, lp: 950, decay: 0.09, t0: 110, t1: 44, td: 0.11, bark: 480, mech: 2100, tail: 0.38, drive: 2.3 },
  lmg: { crack: 1.15, lp: 1300, decay: 0.058, t0: 125, t1: 50, td: 0.07, bark: 600, mech: 2600, tail: 0.3, drive: 2.2 },
  dmr: { crack: 1.25, lp: 1350, decay: 0.07, t0: 118, t1: 47, td: 0.085, bark: 640, mech: 2700, tail: 0.36, drive: 2.3 },
  sniper: { crack: 1.4, lp: 1100, decay: 0.1, t0: 100, t1: 40, td: 0.13, bark: 520, mech: 2400, tail: 0.52, drive: 2.5 },
};

/** One gunshot. close = heard by the shooter (adds the gun's mechanical clack and more crack). */
export function gunshot(rate, id, seed, close) {
  const p = GUN[id] || GUN.rifle;
  const dur = 0.06 + p.tail * 4.5;
  const out = new Float32Array(Math.ceil(dur * rate));
  const r = rng(seed);
  const hp = biquad('highpass', 2400, 0.7, rate);
  const lp1 = biquad('lowpass', p.lp, 0.9, rate), lp2 = biquad('lowpass', p.lp * 0.7, 0.7, rate);
  const bp = biquad('bandpass', p.bark, 1.1, rate);
  const lpT = biquad('lowpass', 1100, 0.7, rate), lpT2 = biquad('lowpass', 700, 0.7, rate);
  const crackGain = p.crack * (close ? 3.2 : 2.2);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const n = r();
    const crack = hp(n) * exp(-t / 0.0014) * crackGain;
    const boom = lp2(lp1(n)) * exp(-t / p.decay) * 5.5;
    const bark = bp(n) * exp(-t / (p.decay * 0.45)) * 3.2;
    const tail = lpT2(lpT(n)) * (1 - exp(-t / 0.012)) * exp(-t / p.tail) * 1.6;
    out[i] = crack + boom + bark + tail;
  }
  thump(out, rate, 0, p.t0, p.t1, 0.025, p.td, 1.1);
  if (close) {
    // The action cycling: a sharp metallic clack a few milliseconds after the blast, plus a lighter return click.
    const m = p.mech * (1 + 0.04 * r());
    ring(out, rate, 0.008, [m, m * 1.46, m * 2.27, m * 3.1], 0.007, 0.55, r);
    burst(out, rate, 0.008, { type: 'highpass', freq: 3500, decay: 0.002, gain: 0.5, seed: seed + 7 });
    ring(out, rate, p.slide ? 0.05 : 0.035, [m * 1.2, m * 1.9], 0.004, 0.25, r);
  }
  return finish(out, p.drive);
}

/** Bolt cycle (sniper) or pump (shotgun) after a shot, close up. */
export function action(rate, kind, seed) {
  const out = new Float32Array(Math.ceil(0.5 * rate));
  const r = rng(seed);
  if (kind === 'pump') {
    burst(out, rate, 0, { type: 'bandpass', freq: 1800, q: 0.8, decay: 0.05, gain: 0.5, attack: 0.02, seed, dur: 0.09 });
    ring(out, rate, 0.08, [1400, 2300, 3700], 0.012, 0.9, r);
    burst(out, rate, 0.08, { type: 'highpass', freq: 2500, decay: 0.003, gain: 0.8, seed: seed + 1 });
    burst(out, rate, 0.17, { type: 'bandpass', freq: 2000, q: 0.8, decay: 0.04, gain: 0.45, attack: 0.015, seed: seed + 2, dur: 0.07 });
    ring(out, rate, 0.24, [1600, 2600, 4100], 0.014, 1.0, r);
    burst(out, rate, 0.24, { type: 'highpass', freq: 2500, decay: 0.003, gain: 0.9, seed: seed + 3 });
  } else {
    // Bolt: lift (click), pull (scrape), push (scrape), close (clack).
    ring(out, rate, 0, [2600, 4100], 0.006, 0.6, r);
    burst(out, rate, 0.04, { type: 'bandpass', freq: 3200, q: 1.2, decay: 0.05, gain: 0.35, attack: 0.02, seed, dur: 0.1 });
    ring(out, rate, 0.15, [2100, 3400, 5200], 0.01, 0.8, r);
    burst(out, rate, 0.24, { type: 'bandpass', freq: 2800, q: 1.2, decay: 0.05, gain: 0.32, attack: 0.02, seed: seed + 1, dur: 0.09 });
    ring(out, rate, 0.34, [1800, 2900, 4600], 0.014, 1.0, r);
    burst(out, rate, 0.34, { type: 'highpass', freq: 3000, decay: 0.003, gain: 0.8, seed: seed + 2 });
  }
  return finish(out, 1.2, 0.8);
}

/** A spent casing hitting the ground and bouncing. */
export function casing(rate, seed, shell) {
  const out = new Float32Array(Math.ceil(0.4 * rate));
  const r = rng(seed);
  const base = shell ? 900 : 3800 + 900 * r();
  const bounces = [0, 0.085 + 0.02 * r(), 0.15 + 0.03 * r()];
  bounces.forEach((t, i) => {
    const g = [1, 0.5, 0.25][i];
    if (shell) burst(out, rate, t, { type: 'bandpass', freq: base, q: 1.2, decay: 0.012, gain: g, seed: seed + i });
    else ring(out, rate, t, [base, base * 1.53, base * 2.41], 0.03, g, r);
  });
  return finish(out, 1, 0.6);
}

/** Dry fire: just the hammer / striker falling. */
export function dryFire(rate, seed) {
  const out = new Float32Array(Math.ceil(0.08 * rate));
  ring(out, rate, 0, [2400, 3900, 6100], 0.006, 1, rng(seed));
  burst(out, rate, 0, { type: 'highpass', freq: 3000, decay: 0.002, gain: 0.7, seed });
  return finish(out, 1, 0.7);
}

// ------------------------------------------------------------------------------------------------
// Reloads (pieces scheduled across the reload time by audio.js)
// ------------------------------------------------------------------------------------------------
export function reloadPart(rate, part, seed) {
  const out = new Float32Array(Math.ceil(0.35 * rate));
  const r = rng(seed);
  switch (part) {
    case 'magOut':
      ring(out, rate, 0, [2200, 3500], 0.006, 0.5, r);
      burst(out, rate, 0.02, { type: 'bandpass', freq: 1700, q: 0.9, decay: 0.05, gain: 0.45, attack: 0.025, seed, dur: 0.12 });
      break;
    case 'magIn':
      burst(out, rate, 0, { type: 'bandpass', freq: 1500, q: 0.9, decay: 0.03, gain: 0.35, attack: 0.02, seed, dur: 0.06 });
      ring(out, rate, 0.055, [1700, 2800, 4300], 0.012, 1.0, r);
      burst(out, rate, 0.055, { type: 'highpass', freq: 2000, decay: 0.003, gain: 0.9, seed: seed + 1 });
      thump(out, rate, 0.055, 220, 120, 0.01, 0.02, 0.5);
      break;
    case 'bolt':
      burst(out, rate, 0, { type: 'bandpass', freq: 2900, q: 1.2, decay: 0.035, gain: 0.35, attack: 0.015, seed, dur: 0.07 });
      ring(out, rate, 0.07, [1900, 3100, 4800], 0.012, 1.0, r);
      burst(out, rate, 0.07, { type: 'highpass', freq: 2600, decay: 0.003, gain: 1, seed: seed + 1 });
      break;
    case 'shell':
      burst(out, rate, 0, { type: 'bandpass', freq: 1100, q: 1, decay: 0.02, gain: 0.6, seed });
      ring(out, rate, 0.03, [1300, 2100], 0.01, 0.6, r);
      break;
    default:
      break;
  }
  return finish(out, 1.1, 0.7);
}

// ------------------------------------------------------------------------------------------------
// Footsteps and landings by surface
// ------------------------------------------------------------------------------------------------
export function footstep(rate, surface, seed, land) {
  const out = new Float32Array(Math.ceil(0.22 * rate));
  const r = rng(seed);
  const heavy = land ? 1.8 : 1;
  const hits = land ? [0] : [0, 0.03 + 0.015 * r()];   // heel then toe
  hits.forEach((t0, k) => {
    const g = (k === 0 ? 1 : 0.55) * heavy;
    switch (surface) {
      case 'grass': {
        // Crunchy: sparse grains of high noise over a soft low thud.
        const bp = biquad('bandpass', 2600 + 600 * r(), 0.6, rate);
        const i0 = Math.floor(t0 * rate), n = Math.floor(0.07 * rate);
        for (let i = 0; i < n && i0 + i < out.length; i++) {
          const t = i / rate;
          const grain = Math.random() < 0.25 ? 1 : 0.2;
          out[i0 + i] += bp(r()) * grain * exp(-t / 0.022) * 1.4 * g;
        }
        thump(out, rate, t0, 140, 80, 0.01, 0.018, 0.5 * g);
        break;
      }
      case 'metal':
        burst(out, rate, t0, { type: 'highpass', freq: 1800, decay: 0.004, gain: 0.8 * g, seed: seed + k });
        ring(out, rate, t0, [380 + 40 * r(), 1150, 2300, 3900], 0.08, 0.5 * g, r);
        thump(out, rate, t0, 180, 90, 0.01, 0.025, 0.5 * g);
        break;
      case 'wood':
        burst(out, rate, t0, { type: 'bandpass', freq: 700, q: 1, decay: 0.03, gain: 1.1 * g, seed: seed + k });
        ring(out, rate, t0, [240, 510], 0.04, 0.4 * g, r);
        break;
      case 'sand':
        burst(out, rate, t0, { type: 'lowpass', freq: 1800, decay: 0.05, gain: 0.9 * g, attack: 0.008, seed: seed + k });
        break;
      default: // concrete / asphalt / rock
        burst(out, rate, t0, { type: 'highpass', freq: 2200, decay: 0.003, gain: 0.9 * g, seed: seed + k });
        burst(out, rate, t0, { type: 'bandpass', freq: 520, q: 0.8, decay: 0.018, gain: 1.1 * g, seed: seed + 9 + k });
        thump(out, rate, t0, 160, 90, 0.008, 0.016, 0.35 * g);
    }
  });
  return finish(out, 1.2, land ? 0.9 : 0.75);
}

// ------------------------------------------------------------------------------------------------
// Impacts, near misses, explosions
// ------------------------------------------------------------------------------------------------
export function impact(rate, kind, seed) {
  const out = new Float32Array(Math.ceil(0.35 * rate));
  const r = rng(seed);
  switch (kind) {
    case 'metal':
      burst(out, rate, 0, { type: 'highpass', freq: 3000, decay: 0.002, gain: 1, seed });
      ring(out, rate, 0, [1200 + 900 * Math.abs(r()), 2650 + 500 * r(), 4100 + 700 * r()], 0.06 + 0.04 * Math.abs(r()), 0.9, r);
      break;
    case 'wood':
      burst(out, rate, 0, { type: 'bandpass', freq: 850, q: 1.1, decay: 0.022, gain: 1.3, seed });
      ring(out, rate, 0, [300 + 60 * r(), 640], 0.03, 0.5, r);
      burst(out, rate, 0.004, { type: 'highpass', freq: 3000, decay: 0.01, gain: 0.3, seed: seed + 2 });
      break;
    case 'dirt':
      burst(out, rate, 0, { type: 'lowpass', freq: 700, decay: 0.03, gain: 1.4, seed });
      burst(out, rate, 0.01, { type: 'bandpass', freq: 2200, q: 0.6, decay: 0.05, gain: 0.25, attack: 0.01, seed: seed + 1 });
      break;
    case 'body':
      burst(out, rate, 0, { type: 'lowpass', freq: 1000, decay: 0.022, gain: 1.4, seed });
      thump(out, rate, 0, 140, 90, 0.01, 0.03, 0.8);
      break;
    default: { // concrete / brick / rock: sharp crack and gritty debris
      burst(out, rate, 0, { type: 'highpass', freq: 2500, decay: 0.0025, gain: 1.4, seed });
      burst(out, rate, 0, { type: 'bandpass', freq: 1200, q: 0.9, decay: 0.012, gain: 0.8, seed: seed + 1 });
      const bp = biquad('bandpass', 3500, 0.8, rate);
      for (let i = Math.floor(0.008 * rate); i < out.length; i++) {
        const t = i / rate;
        out[i] += (Math.random() < 0.06 ? bp(r()) * 3 : bp(r() * 0.2)) * exp(-t / 0.06) * 0.35;
      }
    }
  }
  return finish(out, 1.3, 0.8);
}

/** A bullet passing close: an N-wave crack (supersonic) or a falling whizz (subsonic). */
export function nearMiss(rate, supersonic, seed) {
  const out = new Float32Array(Math.ceil((supersonic ? 0.12 : 0.26) * rate));
  if (supersonic) {
    const half = Math.max(2, Math.round(0.00025 * rate));
    for (let i = 0; i < half * 2; i++) out[i] += i < half ? 1 - i / half : -(1 - (i - half) / half) * 0.9;
    burst(out, rate, 0, { type: 'highpass', freq: 3000, decay: 0.005, gain: 0.9, seed });
    burst(out, rate, 0.012, { type: 'highpass', freq: 2000, decay: 0.02, gain: 0.25, seed: seed + 1 }); // slap off the ground
  } else {
    const r = rng(seed);
    const n = out.length;
    let band = 0, low = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const f = 2600 - 1700 * k;
      // Resonant noise around a falling centre frequency (state-variable filter).
      const fc = 2 * Math.sin((Math.PI * f) / rate);
      const high = r() - low - 0.12 * band;
      band += fc * high;
      low += fc * band;
      out[i] = band * Math.sin(Math.PI * k) * 1.2;
    }
  }
  return finish(out, 1.2, 0.8);
}

export function explosion(rate, seed) {
  const out = new Float32Array(Math.ceil(2.2 * rate));
  const r = rng(seed);
  const lpA = biquad('lowpass', 900, 0.8, rate), lpB = biquad('lowpass', 500, 0.7, rate);
  const sub1 = biquad('lowpass', 110, 0.9, rate), sub2 = biquad('lowpass', 80, 0.7, rate);
  const hp = biquad('highpass', 1800, 0.7, rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const n = r();
    out[i] = hp(n) * exp(-t / 0.004) * 4
      + lpB(lpA(n)) * exp(-t / 0.22) * 9
      + sub2(sub1(n)) * (1 - exp(-t / 0.02)) * exp(-t / 0.8) * 26;
  }
  thump(out, rate, 0, 90, 32, 0.08, 0.35, 1.6);
  // Debris: scattered small hits falling back down.
  for (let k = 0; k < 26; k++) {
    const t0 = 0.25 + Math.abs(r()) * 1.3;
    burst(out, rate, t0, { type: 'bandpass', freq: 1500 + 2500 * Math.abs(r()), q: 1.2, decay: 0.008, gain: 0.25 * exp(-t0 / 0.9), seed: seed + 10 + k });
  }
  return finish(out, 1.6, 0.98);
}

// ------------------------------------------------------------------------------------------------
// Feedback sounds (hit markers, kill, damage) and UI
// ------------------------------------------------------------------------------------------------
export function hitMarker(rate, kind, seed) {
  const out = new Float32Array(Math.ceil((kind === 'kill' ? 0.5 : kind === 'head' ? 0.3 : 0.08) * rate));
  const r = rng(seed);
  burst(out, rate, 0, { type: 'highpass', freq: 3500, decay: 0.0025, gain: 1, seed });
  ring(out, rate, 0, [3100, 4700], 0.008, 0.6, r);
  if (kind === 'head') ring(out, rate, 0.004, [1850, 2930, 4410], 0.07, 0.8, r);          // helmet ping
  if (kind === 'kill') {
    thump(out, rate, 0, 130, 70, 0.02, 0.05, 0.9);
    ring(out, rate, 0.03, [880, 1320, 1760], 0.12, 0.45, r);                             // confirm chime
  }
  return finish(out, 1.1, kind === 'hit' ? 0.55 : 0.7);
}

export function hurt(rate, seed) {
  const out = new Float32Array(Math.ceil(0.25 * rate));
  burst(out, rate, 0, { type: 'lowpass', freq: 600, decay: 0.035, gain: 1.4, seed });
  thump(out, rate, 0, 110, 55, 0.02, 0.06, 1);
  return finish(out, 1.3, 0.8);
}

export function chime(rate, notes, step, decay, seed) {
  const out = new Float32Array(Math.ceil((notes.length * step + decay * 5) * rate));
  const r = rng(seed);
  notes.forEach((f, i) => ring(out, rate, i * step, [f, f * 2, f * 3.01], decay, 0.8, r));
  return finish(out, 1, 0.6);
}

export function uiClick(rate, seed) {
  const out = new Float32Array(Math.ceil(0.04 * rate));
  burst(out, rate, 0, { type: 'bandpass', freq: 2500, q: 1.5, decay: 0.004, gain: 1, seed });
  ring(out, rate, 0, [1700], 0.006, 0.4, rng(seed));
  return finish(out, 1, 0.45);
}

export function ammoRattle(rate, seed) {
  const out = new Float32Array(Math.ceil(0.35 * rate));
  const r = rng(seed);
  for (let k = 0; k < 6; k++) ring(out, rate, k * 0.035 + 0.01 * Math.abs(r()), [2400 + 900 * r(), 3800 + 700 * r()], 0.015, 0.7 - k * 0.08, r);
  burst(out, rate, 0, { type: 'lowpass', freq: 500, decay: 0.03, gain: 0.6, seed });
  return finish(out, 1, 0.65);
}

// ------------------------------------------------------------------------------------------------
// Environment reverb impulse responses (stereo)
// ------------------------------------------------------------------------------------------------
/** kind: 'open' (fields), 'industrial' (metal buildings), 'urban' (night city arena). */
export function impulseResponse(rate, kind) {
  const cfg = {
    open: { len: 1.4, decay: 0.32, refl: 5, reflGain: 0.35, tone: 3500 },
    industrial: { len: 2.2, decay: 0.6, refl: 12, reflGain: 0.5, tone: 4500 },
    urban: { len: 1.8, decay: 0.45, refl: 9, reflGain: 0.45, tone: 4000 },
  }[kind] || { len: 1.4, decay: 0.32, refl: 5, reflGain: 0.35, tone: 3500 };
  const n = Math.ceil(cfg.len * rate);
  const ch = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c++) {
    const r = rng(17 + c * 101);
    const lp = biquad('lowpass', cfg.tone, 0.7, rate);
    const lp2 = biquad('lowpass', cfg.tone * 0.35, 0.7, rate);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const d = Math.min(1, t / 0.6); // the tail darkens over time
      const v = lp(r());
      ch[c][i] = (v * (1 - d) + lp2(v) * d * 1.6) * exp(-t / cfg.decay) * Math.min(1, t / 0.01) * 0.35;
    }
    // Early reflections: discrete echoes off nearby walls (slap-back).
    for (let k = 0; k < cfg.refl; k++) {
      const t = 0.012 + Math.abs(r()) * 0.16;
      const i = Math.floor(t * rate);
      const g = cfg.reflGain * exp(-t / 0.12) * (0.5 + 0.5 * Math.abs(r()));
      for (let j = 0; j < 40 && i + j < n; j++) ch[c][i + j] += r() * g * exp(-j / 8);
    }
  }
  return ch;
}

// -------------------------------------------------------------------------------------------------
// Knives
// -------------------------------------------------------------------------------------------------
/**
 * The whoosh of a swing: noise through a band-pass that sweeps up then down as the blade passes, like air
 * cut by a moving edge. weight 0 (karambit) .. 1 (hatchet): heavier blades are lower, longer and fuller.
 */
export function knifeSwing(rate, weight, seed) {
  const dur = 0.16 + 0.22 * weight;
  const out = new Float32Array(Math.ceil((dur + 0.05) * rate));
  const r = rng(seed);
  const peak = 0.42 + 0.08 * r(); // where the blade is fastest (fraction of the swing)
  const fLow = 500 - 250 * weight, fHigh = 3400 - 1600 * weight;
  let low = 0, band = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate, x = t / dur;
    const env = x < peak ? Math.pow(x / peak, 2) : Math.max(0, 1 - (x - peak) / (1 - peak)) ** 1.6;
    const f = fLow + (fHigh - fLow) * env;
    const k = 2 * Math.sin(Math.PI * Math.min(0.24, f / rate));
    // State-variable filter (band-pass) with a little resonance for the "edge" tone.
    low += k * band;
    const high = r() - low - 0.55 * band;
    band += k * high;
    out[i] = band * env * (0.9 + 0.2 * weight);
  }
  return finish(out, 1.1, 0.7);
}

/** Blade hitting something: kind 'body' (cut + thud) or a map material (clink / chunk). */
export function knifeHit(rate, weight, kind, seed) {
  const out = new Float32Array(Math.ceil(0.4 * rate));
  const r = rng(seed);
  if (kind === 'body') {
    // Wet slice: a short bright tear, then the meaty thud of the hilt.
    burst(out, rate, 0, { type: 'bandpass', freq: 2600 - 900 * weight, q: 0.9, decay: 0.03, gain: 0.9, seed });
    burst(out, rate, 0.004, { type: 'lowpass', freq: 900, decay: 0.04 + 0.03 * weight, gain: 1.3, seed: seed + 1 });
    thump(out, rate, 0.006, 160 - 50 * weight, 70, 0.012, 0.05 + 0.04 * weight, 1 + 0.6 * weight);
  } else if (kind === 'metal' || kind === 'container' || kind === 'containerB' || kind === 'stairs') {
    burst(out, rate, 0, { type: 'highpass', freq: 3500, decay: 0.002, gain: 1, seed });
    ring(out, rate, 0, [2400 + 400 * r(), 3900 + 500 * r(), 6100 + 400 * r()], 0.09, 1, r); // steel on steel
    burst(out, rate, 0.01, { type: 'bandpass', freq: 5000, q: 2, decay: 0.05, gain: 0.25, seed: seed + 2 }); // scrape
  } else if (kind === 'crate' || kind === 'floor') {
    burst(out, rate, 0, { type: 'bandpass', freq: 700, q: 1, decay: 0.03, gain: 1.4, seed });
    ring(out, rate, 0, [260 + 40 * r(), 520], 0.04, 0.5, r);
    ring(out, rate, 0.002, [3100 + 300 * r()], 0.02, 0.25, r); // the blade's own ring
  } else {
    burst(out, rate, 0, { type: 'highpass', freq: 2800, decay: 0.003, gain: 1.2, seed });
    ring(out, rate, 0, [2900 + 500 * r(), 4700 + 400 * r()], 0.05, 0.6, r);
    burst(out, rate, 0.004, { type: 'bandpass', freq: 1300, q: 0.8, decay: 0.015, gain: 0.6, seed: seed + 1 });
  }
  return finish(out, 1.3, 0.85);
}

/** Pulling the knife out: a metallic "shing" as the blade slides past the sheath. */
export function knifeDraw(rate, seed) {
  const out = new Float32Array(Math.ceil(0.32 * rate));
  const r = rng(seed);
  const hp = biquad('highpass', 4000, 0.7, rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.08) * exp(-Math.max(0, t - 0.08) / 0.05);
    out[i] = hp(r()) * env * 0.5;
  }
  ring(out, rate, 0.1, [3300 + 200 * r(), 5200 + 300 * r(), 7400], 0.12, 0.5, r);
  return finish(out, 1.1, 0.6);
}
