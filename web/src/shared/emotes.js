// The emote wheel (press B). The set and order are fixed: everyone has the same eight emotes.
export const EMOTES = [
  { id: 'wave', label: 'WAVE', icon: '👋' },
  { id: 'gg', label: 'GG', icon: '🤝' },
  { id: 'nice', label: 'NICE', icon: '👍' },
  { id: 'lol', label: 'LOL', icon: '😂' },
  { id: 'cheer', label: 'CHEER', icon: '🎉' },
  { id: 'cool', label: 'TOO EASY', icon: '😎' },
  { id: 'oops', label: 'OOPS', icon: '😅' },
  { id: 'flex', label: 'FLEX', icon: '💪' },
];

export const EMOTE_IDS = EMOTES.map((e) => e.id);
export const EMOTE_COOLDOWN = 1.2; // seconds between emotes per player (enforced by the host)

export function emoteById(id) {
  return EMOTES.find((e) => e.id === id) || null;
}
