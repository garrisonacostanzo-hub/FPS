// Player profile: level/XP, lifetime stats, Ranked (SR, tiers, grades), the skill rating that drives adaptive bots,
// and unlocked / equipped cosmetics. Saved to cookies + localStorage (see storage.js) after every match.
//
// ADAPTIVE DIFFICULTY ALGORITHM
//   1. Every match produces a performance score P in 0..1 from K/D, finishing place in the lobby, kills per minute,
//      win/loss and accuracy (see performanceOf()).
//   2. The skill rating R (in bot-level units: 0 Recruit .. 4 Apex) is updated Elo-style. The expected performance
//      against bots of level L is E = 0.5 + 0.3*tanh(1.2*(R - L)); then R += K * 2.5 * (P - E). K starts large so new
//      players are placed quickly, and shrinks as matches are played (K = max(0.06, 0.55 / sqrt(1 + matches/3))).
//   3. How much someone plays is the experience X = 1 - exp(-hours/8) (0 for new players, ~1 after a couple of dozen
//      hours). Adaptive bots are set to level = R + 0.3*X, so regulars face slightly sharper bots than their raw skill.
//   4. Ranked uses max(adaptive level, a floor for the current rank tier), so climbing ranks always gets harder.
//   5. Ranked SR = per-game result and grade, plus a pull toward 1500 SR per point of skill rating (see below).
import {
  CAMOS, OUTFITS, RANK_TIERS, SHOWDOWN_START, camoById, outfitById, rankForSr, sanitizeCamo, sanitizeOutfit, showdownTitle,
} from '../shared/cosmetics.js';
import { MAX_BOT_LEVEL } from '../shared/difficulty.js';
import { loadData, saveData } from './storage.js';

const KEY = 'vg_profile';
export const MAX_LEVEL = 100;

function defaults() {
  return {
    v: 1, ts: 0,
    xp: 0, level: 1,
    stats: { matches: 0, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, headshots: 0, shots: 0, hits: 0, seconds: 0, bestStreak: 0, mvps: 0 },
    skill: { rating: 1.0, matches: 0 },
    ranked: { sr: 0, peak: 0, played: 0, wins: 0, losses: 0, kills: 0, headshots: 0, gradeA: 0, gradeS: 0, streak: 0, bestStreak: 0, mvp: 0, history: [] },
    // Showdown (rated 1v1 vs friends) and friendly 1v1s.
    duel: { rating: SHOWDOWN_START, peak: SHOWDOWN_START, played: 0, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, friendly: 0, friendlyWins: 0, history: [] },
    lastPlayed: 0,
    equipped: { camo: 'default', outfit: 'rifleman' },
    seen: [],   // unlock ids already announced
  };
}

function merge(base, data) {
  if (!data || typeof data !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (!(k in data)) continue;
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merge(base[k], data[k]);
    else base[k] = data[k];
  }
  return base;
}

export const profile = merge(defaults(), loadData(KEY));
profile.equipped.camo = sanitizeCamo(profile.equipped.camo);
profile.equipped.outfit = sanitizeOutfit(profile.equipped.outfit);

const listeners = new Set();
export function onProfileChanged(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function saveProfile() {
  profile.ts = Date.now();
  saveData(KEY, profile);
  for (const fn of listeners) fn(profile);
}

export function replaceProfile(data) {
  const fresh = merge(defaults(), data);
  for (const k of Object.keys(profile)) delete profile[k];
  Object.assign(profile, fresh);
  saveProfile();
}

export function resetProfile() { replaceProfile(defaults()); }

// ------------------------------------------------------------------------------------------------
// Levels
// ------------------------------------------------------------------------------------------------
export const xpForLevel = (level) => 900 + 140 * (level - 1);   // XP needed to go from `level` to `level + 1`

export function levelProgress() {
  return { level: profile.level, xp: profile.xp, need: profile.level >= MAX_LEVEL ? 0 : xpForLevel(profile.level) };
}

function addXp(amount) {
  profile.xp += amount;
  let ups = 0;
  while (profile.level < MAX_LEVEL && profile.xp >= xpForLevel(profile.level)) {
    profile.xp -= xpForLevel(profile.level);
    profile.level++;
    ups++;
  }
  if (profile.level >= MAX_LEVEL) profile.xp = 0;
  return ups;
}

// ------------------------------------------------------------------------------------------------
// Skill & adaptive bots
// ------------------------------------------------------------------------------------------------
export function experience() {
  return 1 - Math.exp(-(profile.stats.seconds / 3600) / 8);
}

/** Bot level for "Adaptive" difficulty. */
export function adaptiveBotLevel() {
  return clamp(profile.skill.rating + 0.3 * experience(), 0, MAX_BOT_LEVEL);
}

/** Bot level for Ranked: adaptive, but never below a floor that rises with your rank tier. */
export function rankedBotLevel() {
  const rank = rankForSr(profile.ranked.sr);
  const floor = 0.6 + 0.45 * rank.tierIndex + 0.1 * Math.max(0, rank.division - 1);
  return clamp(Math.max(adaptiveBotLevel(), floor), 0, MAX_BOT_LEVEL);
}

/** Performance score 0..1 for one match (see header). */
export function performanceOf(m) {
  const kd = (m.kills + 1) / (m.deaths + 1);
  const kdScore = 1 / (1 + Math.exp(-1.2 * Math.log(kd)));                        // 0.5 at K/D 1
  const placeScore = m.players > 1 ? 1 - (m.place - 1) / (m.players - 1) : 0.5;
  const minutes = Math.max(0.5, m.seconds / 60);
  const kpm = clamp(m.kills / minutes / 2.2, 0, 1);
  const win = m.result === 'win' ? 1 : m.result === 'draw' ? 0.5 : 0;
  const acc = m.shots > 5 ? clamp((m.hits / m.shots) / 0.45, 0, 1) : 0.5;
  return clamp(0.32 * kdScore + 0.25 * placeScore + 0.15 * kpm + 0.18 * win + 0.10 * acc, 0, 1);
}

export function gradeOf(p) {
  return p >= 0.8 ? 'S' : p >= 0.65 ? 'A' : p >= 0.5 ? 'B' : p >= 0.35 ? 'C' : 'D';
}

function updateSkill(p, botLevel) {
  const s = profile.skill;
  const expected = 0.5 + 0.3 * Math.tanh(1.2 * (s.rating - botLevel));
  const k = Math.max(0.06, 0.55 / Math.sqrt(1 + s.matches / 3));
  const before = s.rating;
  s.rating = clamp(s.rating + k * 2.5 * (p - expected), 0, MAX_BOT_LEVEL);
  s.matches++;
  return { before, after: s.rating, expected };
}

// ------------------------------------------------------------------------------------------------
// Ranked SR
// ------------------------------------------------------------------------------------------------
// SR moves with each game's result and performance, plus a pull toward the SR your skill rating deserves
// (1500 SR per bot level: Regular-level skill ~ Silver, Veteran ~ Platinum, Elite ~ Master, Apex-beaters ~ Legend).
// Bots adapt to you, so wins alone would hover around 50%; the pull is what lets better players climb.
export const srTargetFor = (rating) => 1500 * rating;

function rankedSrChange(m, p) {
  if (m.abandoned) return -60;
  const r = profile.ranked;
  const base = m.result === 'win' ? 35 : m.result === 'draw' ? 5 : -25;
  const perf = (p - 0.5) * 120;
  const mvp = m.place === 1 ? 10 : 0;
  const pull = clamp((srTargetFor(profile.skill.rating) - r.sr) * 0.12, -45, 90);
  return Math.round(clamp(base + perf + mvp + pull, -75, 130));
}

// ------------------------------------------------------------------------------------------------
// Unlocks
// ------------------------------------------------------------------------------------------------
function requirementMet(u) {
  const r = profile.ranked, st = profile.stats;
  switch (u.t) {
    case 'free': return true;
    case 'played': return r.played >= u.n;
    case 'wins': return r.wins >= u.n;
    case 'gradeA': return r.gradeA + r.gradeS >= u.n;
    case 'gradeS': return r.gradeS >= u.n;
    case 'rank': return rankForSr(r.peak).step >= u.n;
    case 'kills': return r.kills >= u.n;
    case 'headshots': return r.headshots >= u.n;
    case 'streak': return r.bestStreak >= u.n;
    case 'mvp': return r.mvp >= u.n;
    case 'level': return profile.level >= u.n;
    case 'hs': return st.headshots >= u.n;
    case 'rankedWins': return r.wins >= u.n;
    default: return false;
  }
}

/** Text for how to unlock, and progress toward it. */
export function requirementText(u) {
  const r = profile.ranked, st = profile.stats;
  const step = (n) => { const t = RANK_TIERS[Math.min(6, Math.floor(n / 3))]; return n >= 18 ? 'Legend' : `${t.name} ${['I', 'II', 'III'][n % 3]}`; };
  switch (u.t) {
    case 'free': return { text: 'Free', have: 1, need: 1 };
    case 'played': return { text: `Play ${u.n} ranked game${u.n > 1 ? 's' : ''}`, have: r.played, need: u.n };
    case 'wins': return { text: `Win ${u.n} ranked game${u.n > 1 ? 's' : ''}`, have: r.wins, need: u.n };
    case 'gradeA': return { text: `Get an A grade or better in ${u.n} ranked game${u.n > 1 ? 's' : ''}`, have: r.gradeA + r.gradeS, need: u.n };
    case 'gradeS': return { text: `Get an S grade in ${u.n} ranked game${u.n > 1 ? 's' : ''}`, have: r.gradeS, need: u.n };
    case 'rank': return { text: `Reach ${step(u.n)} in Ranked`, have: Math.min(rankForSr(r.peak).step, u.n), need: u.n };
    case 'kills': return { text: `Get ${u.n} kills in Ranked`, have: r.kills, need: u.n };
    case 'headshots': return { text: `Get ${u.n} headshot kills in Ranked`, have: r.headshots, need: u.n };
    case 'streak': return { text: `Win ${u.n} ranked games in a row`, have: r.bestStreak, need: u.n };
    case 'mvp': return { text: `Finish top of the lobby in ${u.n} ranked game${u.n > 1 ? 's' : ''}`, have: r.mvp, need: u.n };
    case 'level': return { text: `Reach level ${u.n}`, have: profile.level, need: u.n };
    case 'hs': return { text: `Get ${u.n} headshot kills (any mode)`, have: st.headshots, need: u.n };
    case 'rankedWins': return { text: `Win ${u.n} ranked games`, have: r.wins, need: u.n };
    default: return { text: '', have: 0, need: 1 };
  }
}

export const isCamoUnlocked = (id) => requirementMet(camoById(id).unlock);
export const isOutfitUnlocked = (id) => requirementMet(outfitById(id).unlock);

function newUnlocks() {
  const fresh = [];
  for (const c of CAMOS) if (c.unlock.t !== 'free' && !profile.seen.includes(c.id) && requirementMet(c.unlock)) { profile.seen.push(c.id); fresh.push({ kind: 'camo', item: c }); }
  for (const o of OUTFITS) if (o.unlock.t !== 'free' && !profile.seen.includes('o:' + o.id) && requirementMet(o.unlock)) { profile.seen.push('o:' + o.id); fresh.push({ kind: 'outfit', item: o }); }
  return fresh;
}

export function equip(kind, id) {
  if (kind === 'camo' && isCamoUnlocked(id)) profile.equipped.camo = id;
  if (kind === 'outfit' && isOutfitUnlocked(id)) profile.equipped.outfit = id;
  saveProfile();
}

// ------------------------------------------------------------------------------------------------
// Match recording
// ------------------------------------------------------------------------------------------------
/**
 * Records a finished (or abandoned) match and returns a report for the end screen.
 * @param {object} m { ranked, mode, kills, deaths, headshots, shots, hits, score, seconds, result ('win'|'loss'|'draw'),
 *                    place, players, botLevel, bestStreak, abandoned }
 */
export function recordMatch(m) {
  const p = performanceOf(m);
  const grade = gradeOf(p);
  const levelBefore = profile.level, xpBefore = profile.xp;
  const st = profile.stats;
  st.matches++;
  if (m.result === 'win') st.wins++; else if (m.result === 'loss') st.losses++; else st.draws++;
  st.kills += m.kills; st.deaths += m.deaths; st.headshots += m.headshots;
  st.shots += m.shots; st.hits += Math.min(m.hits, m.shots);
  st.seconds += Math.round(m.seconds);
  st.bestStreak = Math.max(st.bestStreak, m.bestStreak || 0);
  if (m.place === 1 && m.players > 1) st.mvps++;

  // Skill rating learns from every real match (not abandoned ones under a minute). In a 1v1 the opponent's own skill
  // rating takes the place of the bot level, so beating friends makes your normal adaptive bots harder too.
  const opponentLevel = m.duel ? clamp(Number(m.duel.oppSkill) || 1, 0, MAX_BOT_LEVEL) : m.botLevel ?? 1;
  const skill = !m.abandoned || m.seconds > 60 ? updateSkill(p, opponentLevel) : { before: profile.skill.rating, after: profile.skill.rating };
  profile.lastPlayed = Date.now();

  // XP: score, kills, result, performance; Ranked gives a bonus.
  const xp = Math.round((m.score * 1.0 + m.kills * 50 + m.headshots * 25 + (m.result === 'win' ? 500 : m.result === 'draw' ? 250 : 150)
    + p * 400) * (m.ranked ? 1.25 : 1) * (m.abandoned ? 0.25 : 1));
  const levelUps = addXp(xp);

  let ranked = null;
  if (m.ranked) {
    const r = profile.ranked;
    const before = r.sr;
    const rankBefore = rankForSr(before);
    const delta = rankedSrChange(m, p);
    r.sr = Math.max(0, r.sr + delta);
    r.peak = Math.max(r.peak, r.sr);
    r.played++;
    if (m.result === 'win') { r.wins++; r.streak++; } else { if (m.result === 'loss') r.losses++; r.streak = 0; }
    r.bestStreak = Math.max(r.bestStreak, r.streak);
    r.kills += m.kills; r.headshots += m.headshots;
    if (!m.abandoned) { if (grade === 'S') r.gradeS++; else if (grade === 'A') r.gradeA++; }
    if (m.place === 1 && m.players > 1 && !m.abandoned) r.mvp++;
    r.history.unshift({ d: delta, g: m.abandoned ? '—' : grade, k: m.kills, de: m.deaths, w: m.result === 'win' ? 1 : m.result === 'draw' ? 0 : -1, sr: r.sr, t: Date.now() });
    r.history.length = Math.min(r.history.length, 15);
    const rankAfter = rankForSr(r.sr);
    ranked = { before, after: r.sr, delta, rankBefore, rankAfter, promoted: rankAfter.step > rankBefore.step, demoted: rankAfter.step < rankBefore.step };
  }

  const duel = m.duel ? recordDuel(m) : null;

  const unlocks = newUnlocks();
  saveProfile();
  return { p, grade, xp, levelBefore, levelAfter: profile.level, levelUps, xpBefore, xpAfter: profile.xp, skill, ranked, duel, unlocks, result: m.result, abandoned: !!m.abandoned };
}

// ------------------------------------------------------------------------------------------------
// Showdown (1v1 vs friends)
// ------------------------------------------------------------------------------------------------
// Elo: expected = 1 / (1 + 10^((opponent - you) / 400)); change = K * (score - expected), score 1 / 0.5 / 0.
// K is 40 for your first 10 Showdowns (fast placement), then 24. Each player's game updates its own rating from the
// opponent's rating at the start of the match, so both sides move by the same amount.
export const showdownK = (played) => (played < 10 ? 40 : 24);

function recordDuel(m) {
  const d = profile.duel;
  const kind = m.duel.kind === 'showdown' ? 'showdown' : 'friendly';
  const score = m.result === 'win' ? 1 : m.result === 'draw' ? 0.5 : 0;
  if (kind === 'friendly') {
    d.friendly++;
    if (score === 1) d.friendlyWins++;
    return { kind, before: d.rating, after: d.rating, delta: 0, title: showdownTitle(d.rating), titleBefore: showdownTitle(d.rating), opp: m.duel.oppName || '' };
  }
  const before = d.rating;
  const opp = Number.isFinite(Number(m.duel.oppRating)) ? Number(m.duel.oppRating) : SHOWDOWN_START;
  const expected = 1 / (1 + Math.pow(10, (opp - before) / 400));
  const delta = Math.round(showdownK(d.played) * (score - expected));
  d.rating = Math.max(100, before + delta);
  d.peak = Math.max(d.peak, d.rating);
  d.played++;
  if (score === 1) { d.wins++; d.streak++; } else { if (score === 0) d.losses++; else d.draws++; d.streak = 0; }
  d.bestStreak = Math.max(d.bestStreak, d.streak);
  d.history.unshift({ d: delta, w: score === 1 ? 1 : score === 0 ? -1 : 0, o: String(m.duel.oppName || '').slice(0, 18), k: m.kills, de: m.deaths, r: d.rating, t: Date.now() });
  d.history.length = Math.min(d.history.length, 15);
  return { kind, before, after: d.rating, delta, title: showdownTitle(d.rating), titleBefore: showdownTitle(before), opp: m.duel.oppName || '' };
}

// ------------------------------------------------------------------------------------------------
// Profile card: the summary friends see (sent peer-to-peer, see social.js)
// ------------------------------------------------------------------------------------------------
export function profileCard() {
  const st = profile.stats, r = profile.ranked, d = profile.duel;
  return {
    lv: profile.level,
    st: { m: st.matches, w: st.wins, l: st.losses, k: st.kills, d: st.deaths, hs: st.headshots, sh: st.shots, hi: st.hits, s: st.seconds, bs: st.bestStreak, mv: st.mvps },
    rk: { sr: r.sr, pk: r.peak, p: r.played, w: r.wins, l: r.losses },
    sd: { r: d.rating, pk: d.peak, p: d.played, w: d.wins, l: d.losses, dr: d.draws },
    sk: Math.round(profile.skill.rating * 100) / 100,
    al: Math.round(adaptiveBotLevel() * 100) / 100,
    rl: Math.round(rankedBotLevel() * 100) / 100,
    eq: { camo: profile.equipped.camo, outfit: profile.equipped.outfit },
    cm: CAMOS.filter((c) => isCamoUnlocked(c.id)).map((c) => c.id),
    of: OUTFITS.filter((o) => isOutfitUnlocked(o.id)).map((o) => o.id),
    lp: profile.lastPlayed,
  };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
