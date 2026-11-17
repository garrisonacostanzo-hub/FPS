// Special abilities: each player picks one (like a weapon set) and uses it with F (⚡ on touch), then waits for its
// cooldown. The trigger runs in the shared command step (sim.js), so prediction, the host and bots all follow the
// same rules; the host applies the effects (game.js).
export const ABILITIES = [
  { id: 'dash', name: 'Dash', icon: '💨', cooldown: 7, blurb: 'Burst about 4 m in the direction you are moving (forward if standing still). Works in the air.' },
  { id: 'stim', name: 'Stim', icon: '💉', cooldown: 18, blurb: 'Heal 50 health at once and start regenerating straight away.' },
  { id: 'frag', name: 'Frag Grenade', icon: '💣', cooldown: 14, blurb: 'Throw a grenade that bounces and explodes after 1.5 s: up to 110 damage within 6 m (half to yourself, none to teammates).' },
  { id: 'smoke', name: 'Smoke Grenade', icon: '☁️', cooldown: 20, blurb: 'Throw a smoke grenade: a thick 5 m cloud for 10 s that blocks sight, for bots too.' },
  { id: 'pulse', name: 'Recon Pulse', icon: '📡', cooldown: 22, blurb: 'Reveal every enemy within 40 m to your team for 4 s, through walls. They are warned.' },
  { id: 'cloak', name: 'Cloak', icon: '👻', cooldown: 24, blurb: 'Turn nearly invisible for 5 s. Bots only spot you up close. Shooting ends it.' },
];
export const ABILITY_IDS = ABILITIES.map((a) => a.id);
export const DEFAULT_ABILITY = 'dash';

export function abilityById(id) {
  return ABILITIES.find((a) => a.id === id) || ABILITIES[0];
}

export const DASH = { speed: 17, time: 0.2 };
export const GRENADE = {
  speed: 16, up: 4, gravity: 12, restitution: 0.35,
  fuse: 1.5, radius: 6, damage: 110, selfMul: 0.5,
  smokeFuse: 1.1, smokeRadius: 5, smokeTime: 10,
};
export const PULSE = { range: 40, time: 4 };
export const CLOAK = { time: 5, spotDistance: 6 };
export const STIM_HEAL = 50;
