// Bot difficulty as a continuous level: 0 Recruit, 1 Regular, 2 Veteran, 3 Elite, 4 Apex. Fractional levels blend
// the neighbouring presets, so adaptive matchmaking can pick exactly how sharp the bots are.
import { DIFFICULTY } from './constants.js';

export const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'elite', 'apex'];
export const MAX_BOT_LEVEL = DIFFICULTY_ORDER.length - 1;
const NAMES = DIFFICULTY_ORDER.map((k) => DIFFICULTY[k].name);

const clampLevel = (v) => Math.max(0, Math.min(MAX_BOT_LEVEL, v));
const cache = new Map();

/** Numeric level of a preset key or number. */
export function difficultyLevel(d) {
  if (typeof d === 'number' && Number.isFinite(d)) return clampLevel(d);
  const i = DIFFICULTY_ORDER.indexOf(d);
  return i >= 0 ? i : 1;
}

/** Display name: "Veteran", or "Veteran+" for a level part-way to the next preset. */
export function difficultyName(d) {
  const l = difficultyLevel(d);
  const i = Math.min(MAX_BOT_LEVEL, Math.floor(l + 1e-6));
  return NAMES[i] + (l - i >= 0.5 && i < MAX_BOT_LEVEL ? '+' : '');
}

/** Parameter table for a preset key or a numeric level. */
export function resolveDifficulty(d) {
  if (typeof d !== 'number' || !Number.isFinite(d)) return DIFFICULTY[d] || DIFFICULTY.normal;
  const l = Math.round(clampLevel(d) * 100) / 100;
  if (cache.has(l)) return cache.get(l);
  const i = Math.min(MAX_BOT_LEVEL - 1, Math.floor(l));
  const f = l - i;
  const a = DIFFICULTY[DIFFICULTY_ORDER[i]], b = DIFFICULTY[DIFFICULTY_ORDER[i + 1]];
  const out = { name: difficultyName(l), level: l };
  for (const k of Object.keys(a)) {
    if (typeof a[k] === 'number') out[k] = a[k] + (b[k] - a[k]) * f;
    else if (Array.isArray(a[k])) out[k] = a[k].map((v, j) => v + (b[k][j] - v) * f);
  }
  cache.set(l, out);
  return out;
}

/** Accepts preset keys and numeric levels; anything else becomes 'normal'. */
export function sanitizeDifficulty(d) {
  if (typeof d === 'number' && Number.isFinite(d)) return clampLevel(d);
  return DIFFICULTY[d] ? d : 'normal';
}
