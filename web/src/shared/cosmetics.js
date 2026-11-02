// Cosmetics catalogue: 50 weapon camos (most earned in Ranked) and 12 operator outfits (mostly free).
// Shared by the client (armory, rendering) and the match simulation (bots wear random free items, roster sync).

export const RARITY = {
  common: { name: 'Common', color: '#aab4c2' },
  rare: { name: 'Rare', color: '#3d9bff' },
  epic: { name: 'Epic', color: '#b363ff' },
  legendary: { name: 'Legendary', color: '#ffb02e' },
  mastery: { name: 'Mastery', color: '#ff4fd8' },
};

// Ranked tiers (300 SR per division; Legend above 5400).
export const RANK_TIERS = [
  { id: 'bronze', name: 'Bronze', color: '#c47b45' },
  { id: 'silver', name: 'Silver', color: '#c9d3dd' },
  { id: 'gold', name: 'Gold', color: '#ffc93c' },
  { id: 'platinum', name: 'Platinum', color: '#45e0cf' },
  { id: 'diamond', name: 'Diamond', color: '#6db8ff' },
  { id: 'master', name: 'Master', color: '#c35cff' },
  { id: 'legend', name: 'Legend', color: '#ff3b5c' },
];
export const SR_PER_DIVISION = 300;
export const LEGEND_SR = 6 * 3 * SR_PER_DIVISION;

/** Rank for a skill-rating value: { tier, division (1-3, 0 for Legend), name, step (0..18), floor, next, color }. */
export function rankForSr(sr) {
  const v = Math.max(0, Math.floor(sr || 0));
  if (v >= LEGEND_SR) return { tier: RANK_TIERS[6], tierIndex: 6, division: 0, name: 'Legend', step: 18, floor: LEGEND_SR, next: null, color: RANK_TIERS[6].color };
  const step = Math.floor(v / SR_PER_DIVISION);
  const tierIndex = Math.floor(step / 3);
  const division = (step % 3) + 1;
  const tier = RANK_TIERS[tierIndex];
  return { tier, tierIndex, division, name: `${tier.name} ${['I', 'II', 'III'][division - 1]}`, step, floor: step * SR_PER_DIVISION, next: (step + 1) * SR_PER_DIVISION, color: tier.color };
}

// SHOWDOWN: the 1v1 ladder against friends. Its own Elo-style rating (starts at 1000) and its own titles, separate
// from Ranked SR.
export const SHOWDOWN_START = 1000;
export const SHOWDOWN_TITLES = [
  { id: 'rookie', name: 'Rookie', min: 0, color: '#9aa5b1' },
  { id: 'contender', name: 'Contender', min: 900, color: '#7fd36b' },
  { id: 'gunslinger', name: 'Gunslinger', min: 1100, color: '#ffb547' },
  { id: 'duelist', name: 'Duelist', min: 1300, color: '#ff7a45' },
  { id: 'marksman', name: 'Marksman', min: 1500, color: '#ff4f8b' },
  { id: 'deadeye', name: 'Deadeye', min: 1700, color: '#b46bff' },
  { id: 'champion', name: 'Showdown Champion', min: 1900, color: '#ffe066' },
];

/** Showdown title for a rating: { ...title, index, next (rating of the next title or null) }. */
export function showdownTitle(rating) {
  const r = Math.round(rating ?? SHOWDOWN_START);
  let i = 0;
  while (i + 1 < SHOWDOWN_TITLES.length && r >= SHOWDOWN_TITLES[i + 1].min) i++;
  const t = SHOWDOWN_TITLES[i];
  return { ...t, index: i, next: i + 1 < SHOWDOWN_TITLES.length ? SHOWDOWN_TITLES[i + 1].min : null };
}

/** Step index for "reach this rank" requirements: tierIndex*3 + (division-1), Legend = 18. */
const step = (tierIndex, division) => (tierIndex >= 6 ? 18 : tierIndex * 3 + (division - 1));

// Camo patterns are drawn by the client's camo generator (pattern + colours; anim = animated mastery effect).
// unlock: { t: 'free' } or a ranked requirement: played | wins | gradeA | gradeS | rank | kills | headshots | streak | mvp
const C = (id, name, rarity, pattern, colors, unlock, extra = {}) => ({ id, name, rarity, pattern, colors, unlock, ...extra });
export const CAMOS = [
  // Free basics.
  C('default', 'Factory', 'common', 'solid', ['#2b2e33', '#3a3e45'], { t: 'free' }),
  C('desert', 'Desert Tan', 'common', 'solid', ['#a8875a', '#c2a173'], { t: 'free' }),
  C('olive', 'Olive Drab', 'common', 'solid', ['#4c5434', '#5f6a41'], { t: 'free' }),
  C('arctic', 'Arctic', 'common', 'woodland', ['#e9eef2', '#b7c2cc', '#8d99a6', '#ffffff'], { t: 'free' }),
  C('woodland', 'Woodland', 'common', 'woodland', ['#55603b', '#2f3a24', '#6b5034', '#1d211a'], { t: 'free' }),
  C('urban', 'Urban Digital', 'common', 'digital', ['#6d737a', '#4a4f55', '#9aa1a8', '#2e3236'], { t: 'free' }),
  C('navy', 'Navy Digital', 'common', 'digital', ['#28406a', '#1a2a47', '#3e5f94', '#101a2c'], { t: 'free' }),
  C('crimson', 'Crimson', 'common', 'solid', ['#6e1a1f', '#8c2228'], { t: 'free' }),
  // Ranked games played.
  C('splinter', 'Splinter', 'rare', 'splinter', ['#7c7f6a', '#4d5145', '#a3a58c', '#2f322a'], { t: 'played', n: 1 }),
  C('jungle', 'Jungle Tiger', 'rare', 'tiger', ['#3e5b2c', '#16200f', '#6c8a3f'], { t: 'played', n: 3 }),
  C('hexsteel', 'Steel Hex', 'rare', 'hex', ['#3b4047', '#5c636c', '#23272c'], { t: 'played', n: 5 }),
  C('carbon', 'Carbon Fiber', 'rare', 'carbon', ['#16181b', '#2c3035', '#0b0c0e'], { t: 'played', n: 10 }),
  C('topo', 'Topographic', 'epic', 'topo', ['#2f4a3b', '#9fd4b0', '#1c2c23'], { t: 'played', n: 25 }),
  C('marble', 'Marble', 'epic', 'marble', ['#e8e4dc', '#9b958a', '#5c574f'], { t: 'played', n: 50 }),
  // Ranked wins.
  C('dazzle', 'Dazzle', 'rare', 'dazzle', ['#f2f2f2', '#141414', '#7d7d7d'], { t: 'wins', n: 1 }),
  C('bengal', 'Bengal', 'rare', 'tiger', ['#e07a1f', '#1a1206', '#f3a64b'], { t: 'wins', n: 3 }),
  C('riptide', 'Riptide', 'rare', 'waves', ['#0f4c75', '#3282b8', '#bbe1fa'], { t: 'wins', n: 5 }),
  C('circuit', 'Circuit', 'epic', 'circuit', ['#0a1a12', '#22ff88', '#0f3b25'], { t: 'wins', n: 10 }, { glow: 0.6 }),
  C('hellfire', 'Hellfire', 'epic', 'flame', ['#1a0500', '#ff5a00', '#ffd000'], { t: 'wins', n: 20 }, { glow: 0.5 }),
  C('magma', 'Magma', 'legendary', 'cracked', ['#120604', '#ff4800', '#ffb000'], { t: 'wins', n: 35 }, { anim: 'pulse', glow: 1 }),
  C('aurora', 'Aurora', 'mastery', 'aurora', ['#06121f', '#29ffc6', '#7a5cff', '#ff4fd8'], { t: 'wins', n: 50 }, { anim: 'scroll', glow: 1 }),
  // Match grades.
  C('commend', 'Commendation', 'rare', 'stripes', ['#1b1b1b', '#d6b25e'], { t: 'gradeA', n: 1 }),
  C('valor', 'Valor', 'epic', 'stripes', ['#5a0d14', '#e8c56a', '#1b0306'], { t: 'gradeA', n: 3 }),
  C('ace', 'Ace', 'epic', 'dots', ['#101114', '#f2f2f2', '#c83a3a'], { t: 'gradeS', n: 1 }),
  C('spades', 'Ace of Spades', 'legendary', 'dazzle', ['#0b0b0d', '#c9a227', '#2a2a2e'], { t: 'gradeS', n: 3 }, { metal: 0.7 }),
  C('prism', 'Prism', 'mastery', 'prism', ['#ff3b5c', '#ffc93c', '#45e0cf', '#7a5cff'], { t: 'gradeS', n: 10 }, { anim: 'scroll', glow: 0.8 }),
  // Ranked tiers reached.
  C('bronze', 'Bronze Plate', 'rare', 'brushed', ['#8a5530', '#c47b45', '#5e391f'], { t: 'rank', n: step(0, 3) }, { metal: 0.8 }),
  C('silveredge', 'Silver Edge', 'rare', 'brushed', ['#8d969f', '#d5dde5', '#5b636b'], { t: 'rank', n: step(1, 1) }, { metal: 0.85 }),
  C('sterling', 'Sterling', 'epic', 'hex', ['#c9d3dd', '#ffffff', '#8b959f'], { t: 'rank', n: step(1, 3) }, { metal: 0.9 }),
  C('goldleaf', 'Gold Leaf', 'epic', 'marble', ['#ffd76a', '#b8860b', '#fff1b8'], { t: 'rank', n: step(2, 1) }, { metal: 0.9 }),
  C('gilded', 'Gilded', 'mastery', 'gold', ['#ffcf40', '#b8860b', '#fff4c2'], { t: 'rank', n: step(2, 3) }, { anim: 'shine', metal: 1 }),
  C('platline', 'Platinum Line', 'epic', 'stripes', ['#1b2b2a', '#45e0cf'], { t: 'rank', n: step(3, 1) }, { glow: 0.4 }),
  C('platflux', 'Platinum Flux', 'mastery', 'waves', ['#9ff5ea', '#45e0cf', '#e8fffb'], { t: 'rank', n: step(3, 3) }, { anim: 'scroll', metal: 0.9, glow: 0.3 }),
  C('icecrystal', 'Ice Crystal', 'legendary', 'facet', ['#bfe6ff', '#6db8ff', '#ffffff'], { t: 'rank', n: step(4, 1) }, { metal: 0.6 }),
  C('diamond', 'Diamond', 'mastery', 'facet', ['#e8f6ff', '#9fd6ff', '#ffffff'], { t: 'rank', n: step(4, 3) }, { anim: 'sparkle', metal: 0.7, glow: 0.4 }),
  C('obsidian', 'Obsidian', 'legendary', 'cracked', ['#07070a', '#7a5cff', '#1b1630'], { t: 'rank', n: step(5, 1) }, { glow: 0.6 }),
  C('darkplasma', 'Dark Plasma', 'mastery', 'plasma', ['#0a0614', '#c35cff', '#ff4fd8'], { t: 'rank', n: step(5, 3) }, { anim: 'scroll', glow: 1 }),
  C('singularity', 'Singularity', 'mastery', 'nebula', ['#030308', '#ff3b5c', '#7a5cff', '#ffffff'], { t: 'rank', n: 18 }, { anim: 'scroll', glow: 1 }),
  // Ranked kills.
  C('hunter', 'Hunter', 'rare', 'woodland', ['#3a2a1a', '#6b4a2a', '#1c140c', '#8c6a3f'], { t: 'kills', n: 50 }),
  C('predator', 'Predator', 'rare', 'tiger', ['#2a2d1c', '#0c0d08', '#55603b'], { t: 'kills', n: 150 }),
  C('reaper', 'Reaper', 'epic', 'cracked', ['#0e0e10', '#b8b8b8', '#2c2c30'], { t: 'kills', n: 300 }),
  C('warpath', 'Warpath', 'epic', 'splinter', ['#5a0d14', '#1b0306', '#8c2228', '#2e0a0d'], { t: 'kills', n: 600 }),
  C('thousand', 'Thousand Cuts', 'legendary', 'slash', ['#101114', '#ff3b3b', '#2a2c31'], { t: 'kills', n: 1000 }, { glow: 0.7 }),
  // Ranked headshots.
  C('crosshair', 'Crosshair', 'rare', 'dots', ['#20242a', '#ff5a36', '#3a4048'], { t: 'headshots', n: 25 }),
  C('deadeye', 'Deadeye', 'epic', 'rings', ['#121418', '#ffd000', '#2c3036'], { t: 'headshots', n: 100 }, { glow: 0.4 }),
  C('bullseye', 'Bullseye', 'legendary', 'rings', ['#f2f2f2', '#d62828', '#1a1a1a'], { t: 'headshots', n: 250 }),
  // Ranked win streaks.
  C('heatwave', 'Heatwave', 'rare', 'gradient', ['#ff8a00', '#ff2e63'], { t: 'streak', n: 3 }),
  C('wildfire', 'Wildfire', 'epic', 'flame', ['#2a0000', '#ff2e63', '#ff8a00'], { t: 'streak', n: 5 }, { anim: 'pulse', glow: 0.6 }),
  // Top of the lobby (MVP) in ranked.
  C('spotlight', 'Spotlight', 'rare', 'gradient', ['#141414', '#f5f5f5'], { t: 'mvp', n: 1 }),
  C('headliner', 'Headliner', 'epic', 'stripes', ['#ffd000', '#141414'], { t: 'mvp', n: 5 }),
];

// Operator outfits. Team colour always stays on the torso, arms and headgear so teams remain easy to read.
// unlock: free, or level / headshots (all modes) / rank / rankedWins.
const O = (id, name, rarity, look, unlock) => ({ id, name, rarity, look, unlock });
export const OUTFITS = [
  O('rifleman', 'Rifleman', 'common', { head: 'helmet', visor: '#ffd36b', vest: '#2a2d33', pack: true }, { t: 'free' }),
  O('recon', 'Recon', 'common', { head: 'cap', visor: '#7dff8a', vest: '#3b4231', pack: false, goggles: true }, { t: 'free' }),
  O('assault', 'Assault', 'common', { head: 'helmet', visor: '#ff8a3d', vest: '#1e2024', pack: true, mask: '#16181b' }, { t: 'free' }),
  O('urban', 'Urban Ops', 'common', { head: 'beret', visor: '#1c1c1c', vest: '#4a4f55', pack: false, shades: true }, { t: 'free' }),
  O('desert', 'Desert Patrol', 'common', { head: 'boonie', visor: '#2b2b2b', vest: '#a8875a', pack: true, shades: true }, { t: 'free' }),
  O('arctic', 'Arctic', 'rare', { head: 'hood', visor: '#9fd6ff', vest: '#dfe6ec', pack: true, mask: '#e9eef2' }, { t: 'free' }),
  O('pilot', 'Pilot', 'rare', { head: 'helmet', visor: '#4fe0ff', vest: '#2c3440', pack: false, bigVisor: true }, { t: 'free' }),
  O('heavy', 'Heavy', 'epic', { head: 'helmet', visor: '#ff3b3b', vest: '#191b1f', pack: true, pads: '#2a2d33', bulky: true }, { t: 'free' }),
  O('ghost', 'Ghost', 'epic', { head: 'hood', visor: '#ffffff', vest: '#121316', pack: true, mask: '#d9d9d9', skull: true }, { t: 'level', n: 10 }),
  O('marksman', 'Marksman', 'epic', { head: 'cap', visor: '#ff5a36', vest: '#2f3328', pack: false, goggles: true, scopeEye: true }, { t: 'hs', n: 100 }),
  O('eliteguard', 'Elite Guard', 'legendary', { head: 'helmet', visor: '#ffc93c', vest: '#14161a', pack: true, pads: '#c9a227', trim: '#ffc93c' }, { t: 'rank', n: step(4, 1) }),
  O('warlord', 'Warlord', 'legendary', { head: 'helmet', visor: '#ff1e3c', vest: '#0d0d0f', pack: true, pads: '#3a0a10', mask: '#0b0b0c', skull: true }, { t: 'rankedWins', n: 25 }),
];

export const CAMO_IDS = CAMOS.map((c) => c.id);
export const OUTFIT_IDS = OUTFITS.map((o) => o.id);
export const camoById = (id) => CAMOS.find((c) => c.id === id) || CAMOS[0];
export const outfitById = (id) => OUTFITS.find((o) => o.id === id) || OUTFITS[0];
export const sanitizeCamo = (id) => (CAMO_IDS.includes(id) ? id : 'default');
export const sanitizeOutfit = (id) => (OUTFIT_IDS.includes(id) ? id : 'rifleman');

const FREE_CAMOS = CAMOS.filter((c) => c.unlock.t === 'free').map((c) => c.id);
const FREE_OUTFITS = OUTFITS.filter((o) => o.unlock.t === 'free').map((o) => o.id);

/** Bots wear random free cosmetics (and now and then an earned camo, to show what is out there). */
export function botCosmetics(rng) {
  const camos = rng() < 0.2 ? CAMO_IDS : FREE_CAMOS;
  return { camo: camos[Math.floor(rng() * camos.length)], outfit: FREE_OUTFITS[Math.floor(rng() * FREE_OUTFITS.length)] };
}
