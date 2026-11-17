// Emotes: full-body dances with their own music, played from the emote wheel (B). Original moves and tunes.
// While dancing the camera goes third-person; moving, jumping, shooting, aiming or using an ability stops it.
// Crew Groove is a group dance: players near you get "Press Q to join" and dance it with you, in sync.
export const DANCES = [
  { id: 'robot', name: 'Robot', icon: '🤖', bpm: 120 },
  { id: 'disco', name: 'Disco Fever', icon: '🕺', bpm: 118 },
  { id: 'guitar', name: 'Air Guitar', icon: '🎸', bpm: 140 },
  { id: 'chicken', name: 'Chicken Strut', icon: '🐔', bpm: 150 },
  { id: 'spin', name: 'Spin Cycle', icon: '🌀', bpm: 128 },
  { id: 'victory', name: 'Victory Hops', icon: '🏆', bpm: 110 },
  { id: 'shuffle', name: 'Shuffle', icon: '👟', bpm: 124 },
  { id: 'wave', name: 'Arm Wave', icon: '🌊', bpm: 92 },
  // Group dance: anyone within JOIN_RADIUS presses Q to join in, perfectly in step and on the same beat.
  { id: 'crew', name: 'Crew Groove', icon: '👯', bpm: 116, group: true },
];
export const DANCE_IDS = DANCES.map((d) => d.id);

export function danceById(id) {
  return DANCES.find((d) => d.id === id) || null;
}

/** Index sent in snapshots (0 = not dancing). */
export const danceIndex = (id) => DANCE_IDS.indexOf(id) + 1;
export const danceAt = (index) => (index > 0 ? DANCE_IDS[index - 1] || null : null);

/** How close (metres) you must be to join someone's group dance. */
export const JOIN_RADIUS = 10;
export const isGroupDance = (id) => !!(danceById(id) || {}).group;
