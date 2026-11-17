// Emotes: full-body dances with their own music, played from the emote wheel (B). Original moves and tunes.
// While dancing the camera goes third-person; moving, jumping, shooting, aiming or using an ability stops it.
export const DANCES = [
  { id: 'robot', name: 'Robot', icon: '🤖', bpm: 120 },
  { id: 'disco', name: 'Disco Fever', icon: '🕺', bpm: 118 },
  { id: 'guitar', name: 'Air Guitar', icon: '🎸', bpm: 140 },
  { id: 'chicken', name: 'Chicken Strut', icon: '🐔', bpm: 150 },
  { id: 'spin', name: 'Spin Cycle', icon: '🌀', bpm: 128 },
  { id: 'victory', name: 'Victory Hops', icon: '🏆', bpm: 110 },
  { id: 'shuffle', name: 'Shuffle', icon: '👟', bpm: 124 },
  { id: 'wave', name: 'Arm Wave', icon: '🌊', bpm: 92 },
];
export const DANCE_IDS = DANCES.map((d) => d.id);

export function danceById(id) {
  return DANCES.find((d) => d.id === id) || null;
}

/** Index sent in snapshots (0 = not dancing). */
export const danceIndex = (id) => DANCE_IDS.indexOf(id) + 1;
export const danceAt = (index) => (index > 0 ? DANCE_IDS[index - 1] || null : null);
