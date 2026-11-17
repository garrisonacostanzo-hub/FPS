// QUICK CHAT (press Z, or the QUICK CHAT page of the wheel): eight fixed callouts. Each shows a bubble over the
// player's head with a small gesture and goes into the chat log. (Dance emotes are in dances.js.)
export const EMOTES = [
  { id: 'wave', label: 'HELLO!', icon: '👋' },
  { id: 'gg', label: 'GG!', icon: '🤝' },
  { id: 'nice', label: 'NICE SHOT!', icon: '👍' },
  { id: 'lol', label: 'LOL', icon: '😂' },
  { id: 'cheer', label: "LET'S GO!", icon: '🎉' },
  { id: 'cool', label: 'TOO EASY', icon: '😎' },
  { id: 'oops', label: 'OOPS', icon: '😅' },
  { id: 'flex', label: 'THANKS!', icon: '🙏' },
];

export const EMOTE_IDS = EMOTES.map((e) => e.id);
export const EMOTE_COOLDOWN = 1.2; // seconds between emotes per player (enforced by the host)

export function emoteById(id) {
  return EMOTES.find((e) => e.id === id) || null;
}
