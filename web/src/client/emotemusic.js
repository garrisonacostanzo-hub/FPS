// Original music loops for the emote dances, synthesised in the browser (no audio files). A tiny step sequencer:
// 16 steps per bar, 2 bars per loop, drums + bass + chords + lead, rendered once into a mono AudioBuffer.
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const freq = (name) => {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!m) return 0;
  return 440 * Math.pow(2, (NOTE[m[1]] + (Number(m[2]) + 1) * 12 - 69) / 12);
};
/** "A2 . C3 ." -> one entry per step (frequencies, chords joined with +, 0 for rests). */
const seq = (text, steps) => {
  const t = text.trim().split(/\s+/).map((tok) => (tok === '.' || tok === '-' ? 0 : tok.split('+').map(freq)));
  const out = [];
  for (let i = 0; i < steps; i++) out.push(t[i % t.length]);
  return out;
};
const hits = (pattern, steps) => {
  const p = pattern.replace(/\s/g, '');
  return Array.from({ length: steps }, (_, i) => p[i % p.length] !== '.');
};

const SONGS = {
  robot: { bpm: 120, tracks: [
    { inst: 'kick', hits: 'x...x...x...x...' }, { inst: 'snare', hits: '....x.......x...' }, { inst: 'hat', hits: 'x.x.x.x.x.x.x.x.' },
    { inst: 'square', vol: 0.35, len: 1.6, notes: 'A1 . A2 . A1 . A2 . F1 . F2 . G1 . G2 .' },
    { inst: 'square', vol: 0.16, len: 1, notes: 'E5 . . . A5 . . . G5 . E5 . . . . . C5 . . . D5 . . . E5 . . . . . . .' },
  ] },
  disco: { bpm: 118, tracks: [
    { inst: 'kick', hits: 'x...x...x...x...' }, { inst: 'clap', hits: '....x.......x...' }, { inst: 'openhat', hits: '..x...x...x...x.' },
    { inst: 'saw', vol: 0.32, len: 0.9, notes: 'A1 A2 A1 A2 A1 A2 A1 A2 D2 D3 D2 D3 E2 E3 E2 E3' },
    { inst: 'chord', vol: 0.12, len: 1.4, notes: '. . A3+C4+E4 . . . A3+C4+E4 . . . D4+F4+A4 . . . E4+G#4+B4 .' },
  ] },
  guitar: { bpm: 140, tracks: [
    { inst: 'kick', hits: 'x.....x.x.......' }, { inst: 'snare', hits: '....x.......x...' }, { inst: 'hat', hits: 'x.x.x.x.x.x.x.x.' },
    { inst: 'dist', vol: 0.3, len: 1.8, notes: 'E2 . E2 . G2 . A2 . E2 . E2 . D2 . C2 . E2 . E2 . G2 . A2 . C3 . B2 . G2 . A2 .' },
  ] },
  chicken: { bpm: 150, tracks: [
    { inst: 'kick', hits: 'x.......x.......' }, { inst: 'snare', hits: '....x.......x...' },
    { inst: 'tri', vol: 0.4, len: 1.5, notes: 'C2 . . . G1 . . . C2 . . . G1 . . . F1 . . . C2 . . . G1 . . . G1 . . .' },
    { inst: 'pluck', vol: 0.14, len: 1, notes: '. . C4+E4+G4 . . . C4+E4+G4 . . . C4+E4+G4 . . . B3+D4+G4 . . . F4+A4+C5 . . . C4+E4+G4 . . . B3+D4+G4 . . . B3+D4+G4 .' },
    { inst: 'square', vol: 0.13, len: 0.9, notes: 'C5 . E5 . G5 . E5 . F5 . A5 . G5 . E5 . D5 . F5 . A5 . F5 . G5 . F5 . E5 . D5 .' },
  ] },
  spin: { bpm: 128, tracks: [
    { inst: 'kick', hits: 'x...x...x...x...' }, { inst: 'openhat', hits: '..x...x...x...x.' }, { inst: 'hat', hits: 'xxxxxxxxxxxxxxxx' },
    { inst: 'saw', vol: 0.3, len: 0.8, notes: 'A1 . A1 A2 . A1 . A2 A1 . A1 A2 . A1 . A2' },
    { inst: 'square', vol: 0.12, len: 0.7, notes: 'A4 C5 E5 A5 E5 C5 A4 C5 G4 B4 D5 G5 D5 B4 G4 B4' },
  ] },
  victory: { bpm: 110, tracks: [
    { inst: 'snare', hits: 'x.x.x.x.x...x...' }, { inst: 'kick', hits: 'x.......x.......' },
    { inst: 'chord', vol: 0.13, len: 7, notes: 'C4+E4+G4 . . . . . . . . . . . . . . . F4+A4+C5 . . . . . . . G4+B4+D5 . . . . . . .' },
    { inst: 'saw', vol: 0.2, len: 1.8, notes: 'G4 . C5 . E5 . G5 . . . E5 . G5 . . . A5 . G5 . F5 . E5 . D5 . . . . . . .' },
  ] },
  shuffle: { bpm: 124, tracks: [
    { inst: 'kick', hits: 'x...x...x...x...' }, { inst: 'clap', hits: '....x.......x...' }, { inst: 'openhat', hits: '..x...x...x...x.' }, { inst: 'hat', hits: 'x.xxx.xxx.xxx.xx' },
    { inst: 'sine', vol: 0.5, len: 1.5, notes: 'A1 . . A1 . . A2 . A1 . . A1 . . G1 .' },
    { inst: 'chord', vol: 0.1, len: 1.2, notes: '. . . A3+C4+E4+G4 . . . . . . . A3+C4+E4+G4 . . . . . . . F3+A3+C4+E4 . . . . . . . G3+B3+D4+F4 . . . .' },
  ] },
  wave: { bpm: 92, tracks: [
    { inst: 'kick', hits: 'x.....x...x.....' }, { inst: 'snare', hits: '....x.......x...' }, { inst: 'softhat', hits: 'x.x.x.x.x.x.x.x.' },
    { inst: 'sine', vol: 0.45, len: 7, notes: 'A1 . . . . . . . . . . . . . . . F1 . . . . . . . . . . . . . . .' },
    { inst: 'keys', vol: 0.12, len: 7.5, notes: 'A3+C4+E4+G4 . . . . . . . C4+E4+G4+B4 . . . . . . . F3+A3+C4+E4 . . . . . . . E3+G3+B3+D4 . . . . . . .' },
  ] },
  // Crew Groove: a funky four-on-the-floor loop with a call-and-response hook (the group dance).
  crew: { bpm: 116, tracks: [
    { inst: 'kick', hits: 'x...x...x...x...' }, { inst: 'clap', hits: '....x.......x...' }, { inst: 'openhat', hits: '..x...x...x...x.' }, { inst: 'hat', hits: 'x.xxx.xxx.xxx.xx' },
    { inst: 'saw', vol: 0.34, len: 0.8, notes: 'E2 . E3 E2 . . D3 . E2 . E2 G2 . A2 B2 . E2 . E3 E2 . . D3 . G2 . A2 . B2 . D3 .' },
    { inst: 'pluck', vol: 0.16, len: 0.8, notes: '. . E4+G4+B4 . . . E4+G4+B4 . . . D4+F#4+A4 . . . E4+G4+B4 . . . E4+G4+B4 . . . E4+G4+B4 . . . A3+C4+E4 . . . B3+D4+F#4 .' },
    { inst: 'square', vol: 0.12, len: 0.9, notes: 'B4 . D5 . E5 . . . D5 . B4 . G4 . A4 . B4 . D5 . E5 . G5 . F#5 . E5 . D5 . . .' },
  ] },
};

function renderSong(ctx, song) {
  const rate = ctx.sampleRate;
  const steps = 32;
  const stepLen = 60 / song.bpm / 4;
  const total = Math.ceil(steps * stepLen * rate);
  const out = new Float32Array(total);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  // Adds fn(t) for dur seconds starting at sample i0 (wrapping, so tails continue at the loop start).
  const add = (i0, dur, fn) => {
    const n = Math.ceil(dur * rate);
    for (let i = 0; i < n; i++) out[(i0 + i) % total] += fn(i / rate);
  };
  const wave = (type, f, t) => {
    const ph = (f * t) % 1;
    switch (type) {
      case 'square': return ph < 0.5 ? 0.6 : -0.6;
      case 'saw': return (ph * 2 - 1) * 0.7;
      case 'tri': return (1 - 4 * Math.abs(ph - 0.5));
      default: return Math.sin(2 * Math.PI * f * t);
    }
  };
  for (const tr of song.tracks) {
    if (tr.hits) {
      const on = hits(tr.hits, steps);
      for (let s = 0; s < steps; s++) {
        if (!on[s]) continue;
        const i0 = Math.round(s * stepLen * rate);
        switch (tr.inst) {
          case 'kick': { let ph = 0; let last = 0; add(i0, 0.32, (t) => { const f = 48 + 110 * Math.exp(-t * 28); ph += 2 * Math.PI * f * (t - last); last = t; return Math.sin(ph) * Math.exp(-t * 8) * 0.95; }); break; }
          case 'snare': add(i0, 0.2, (t) => rnd() * Math.exp(-t * 20) * 0.45 + Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 28) * 0.35); break;
          case 'clap': add(i0, 0.18, (t) => rnd() * (Math.exp(-t * 35) + (t > 0.012 ? Math.exp(-(t - 0.012) * 35) : 0) + (t > 0.024 ? Math.exp(-(t - 0.024) * 22) : 0)) * 0.22); break;
          case 'hat': { let p = 0; add(i0, 0.05, (t) => { const n = rnd(); const v = n - p; p = n; return v * Math.exp(-t * 80) * 0.13; }); break; }
          case 'softhat': { let p = 0; add(i0, 0.04, (t) => { const n = rnd(); const v = n - p; p = n; return v * Math.exp(-t * 90) * 0.07; }); break; }
          case 'openhat': { let p = 0; add(i0, 0.22, (t) => { const n = rnd(); const v = n - p; p = n; return v * Math.exp(-t * 16) * 0.12; }); break; }
          default: break;
        }
      }
      continue;
    }
    const notes = seq(tr.notes, steps);
    for (let s = 0; s < steps; s++) {
      const chord = notes[s];
      if (!chord) continue;
      const i0 = Math.round(s * stepLen * rate);
      const dur = stepLen * (tr.len || 1);
      const vol = tr.vol || 0.3;
      for (const f of chord) {
        if (!f) continue;
        switch (tr.inst) {
          case 'dist': {
            // Power chord: root + fifth + octave through a soft clipper.
            add(i0, dur + 0.05, (t) => {
              const env = Math.min(1, t / 0.005) * (t < dur ? 1 : Math.exp(-(t - dur) * 40)) * Math.exp(-t * 1.2);
              const x = wave('saw', f, t) + wave('saw', f * 1.5, t) + wave('saw', f * 2, t);
              return Math.tanh(x * 2.5) * env * vol;
            });
            break;
          }
          case 'pluck': add(i0, dur, (t) => wave('square', f, t) * Math.exp(-t * 14) * vol / chord.length * 2); break;
          case 'keys': add(i0, dur, (t) => (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * Math.min(1, t / 0.02) * Math.exp(-t * 0.6) * vol / chord.length * 2); break;
          case 'chord': {
            let lp = 0;
            add(i0, dur, (t) => { const x = wave('saw', f, t); lp += (x - lp) * 0.18; return lp * Math.min(1, t / 0.01) * Math.exp(-t * (2 / Math.max(0.2, dur))) * vol / chord.length * 2; });
            break;
          }
          default: {
            const type = tr.inst === 'tri' ? 'tri' : tr.inst === 'sine' ? 'sine' : tr.inst;
            let lp = 0;
            add(i0, dur, (t) => {
              const x = wave(type, f, t);
              lp += (x - lp) * (type === 'saw' || type === 'square' ? 0.3 : 1);
              return lp * Math.min(1, t / 0.006) * Math.exp(-t * (3 / Math.max(0.15, dur))) * vol;
            });
          }
        }
      }
    }
  }
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = peak > 0 ? 0.8 / peak : 1;
  const buffer = ctx.createBuffer(1, total, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < total; i++) data[i] = out[i] * gain;
  return buffer;
}

const cache = new Map();

/** The looping music buffer for a dance (rendered on first use). */
export function danceMusic(ctx, id) {
  const key = id + ':' + ctx.sampleRate;
  if (!cache.has(key)) cache.set(key, renderSong(ctx, SONGS[id] || SONGS.robot));
  return cache.get(key);
}
