// SVG emblems: Ranked tier badges (shield with tier colour and division pips) and level badges.
import { rankForSr } from '../../shared/cosmetics.js';

const ROMAN = ['', 'I', 'II', 'III'];

/** Ranked emblem for an SR value (or a rank object from rankForSr). */
export function rankEmblem(srOrRank, size = 64) {
  const r = typeof srOrRank === 'number' ? rankForSr(srOrRank) : srOrRank;
  const c = r.color;
  const id = 'g' + Math.random().toString(36).slice(2, 8);
  const tier = r.tierIndex;
  const wings = tier >= 4 ? `<path d="M6 30 L-6 18 L4 44 Z M58 30 L70 18 L60 44 Z" fill="${c}" opacity="0.85"/>` : '';
  const crown = tier >= 5 ? `<path d="M20 8 L26 16 L32 6 L38 16 L44 8 L42 20 L22 20 Z" fill="${c}"/>` : '';
  const star = tier === 6
    ? '<path d="M32 26 L36 36 L47 36 L38 42 L41 53 L32 46 L23 53 L26 42 L17 36 L28 36 Z" fill="#fff"/>'
    : `<text x="32" y="47" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="700" font-size="20" fill="#0c0d10">${ROMAN[r.division]}</text>`;
  return `<svg class="emblem" width="${size}" height="${size}" viewBox="-8 0 80 72" aria-label="${r.name}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity="0.55"/></linearGradient></defs>
    ${wings}${crown}
    <path d="M32 14 L56 22 L54 46 Q50 60 32 68 Q14 60 10 46 L8 22 Z" fill="url(#${id})" stroke="#0c0d10" stroke-width="3"/>
    <path d="M32 19 L51 25 L49.5 45 Q46 56 32 62.5 Q18 56 14.5 45 L13 25 Z" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.5"/>
    ${star}
  </svg>`;
}

/** Hexagonal level badge. */
export function levelBadge(level, size = 40) {
  const tierColor = level >= 75 ? '#ff4fd8' : level >= 50 ? '#ffb02e' : level >= 25 ? '#b363ff' : level >= 10 ? '#3d9bff' : '#aab4c2';
  return `<svg class="lvl-badge" width="${size}" height="${size}" viewBox="0 0 40 40" aria-label="Level ${level}">
    <path d="M20 2 L36 11 L36 29 L20 38 L4 29 L4 11 Z" fill="#0c0d10" stroke="${tierColor}" stroke-width="2.5"/>
    <text x="20" y="26" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="700" font-size="15" fill="#fff">${level}</text>
  </svg>`;
}
