// Shared tuning constants used by the authoritative simulation (server / offline host) and client prediction.

export const PROTOCOL_VERSION = 4;
export const MAX_ONLINE_PLAYERS = 8; // humans per peer-to-peer match (the host's upload carries everyone)
export const GAME_TITLE = 'VANGUARD';

export const TICK_RATE = 30;               // authoritative simulation steps per second
export const TICK_DT = 1 / TICK_RATE;
export const ONLINE_SNAPSHOT_RATE = 20;    // snapshots per second sent to remote clients
export const OFFLINE_SNAPSHOT_RATE = 30;   // local (in-memory) snapshots
export const MAX_REWIND = 0.3;             // lag compensation window in seconds
export const HISTORY_SECONDS = 1.0;

export const TEAM = { A: 0, B: 1, NONE: 2 };
export const TEAM_NAMES = ['ALPHA', 'BRAVO', 'NONE'];
export const TEAM_COLORS = ['#3d8bff', '#ff5a36', '#d0d0d0'];

export const BTN = {
  JUMP: 1,
  SPRINT: 2,
  CROUCH: 4,
  AIM: 8,
  FIRE: 16,
};

export const MOVE = {
  walkSpeed: 4.8,
  sprintSpeed: 7.4,
  crouchSpeed: 2.4,
  backMul: 0.85,
  groundAccel: 70,
  groundDecel: 55,
  airAccel: 14,
  gravity: 22,
  jumpVelocity: 7.0,
  standHeight: 1.8,
  crouchHeight: 1.15,
  radius: 0.32,
  standEye: 1.62,
  crouchEye: 1.0,
  stepHeight: 0.55,
  crouchRate: 8,
  coyoteTime: 0.12,
  jumpBuffer: 0.12,
  strideWalk: 1.05,
  strideSprint: 1.35,
  strideCrouch: 0.8,
  noiseWalk: 14,
  noiseSprint: 26,
  noiseCrouch: 3,
};

export const PLAYER = {
  maxHealth: 100,
  regenDelay: 5,
  regenRate: 18,
  respawnDelay: 3.5,
  spawnProtection: 1.5,
  headRadius: 0.2,
  bodyHalfWidth: 0.3,
};

export const DIFFICULTY = {
  easy: {
    name: 'Recruit', reaction: 0.85, accuracy: 0.25, tracking: 150, settle: 1.3, headshot: 0.03, detect: 45, fov: 95,
    detectTime: 1.3, hearing: 0.7, memory: 5, aggression: 0.35, flank: 0.1, retreatHp: 0.5, suppressTol: 0.35,
    strafe: 0.3, burst: [2, 5], pause: [0.35, 0.8], maxError: 9,
  },
  normal: {
    name: 'Regular', reaction: 0.5, accuracy: 0.55, tracking: 250, settle: 0.9, headshot: 0.12, detect: 70, fov: 110,
    detectTime: 0.85, hearing: 1.0, memory: 9, aggression: 0.5, flank: 0.3, retreatHp: 0.4, suppressTol: 0.45,
    strafe: 0.55, burst: [3, 7], pause: [0.2, 0.5], maxError: 8,
  },
  hard: {
    name: 'Veteran', reaction: 0.3, accuracy: 0.75, tracking: 380, settle: 0.6, headshot: 0.25, detect: 95, fov: 120,
    detectTime: 0.6, hearing: 1.3, memory: 12, aggression: 0.65, flank: 0.45, retreatHp: 0.35, suppressTol: 0.55,
    strafe: 0.7, burst: [4, 9], pause: [0.15, 0.35], maxError: 7,
  },
  elite: {
    name: 'Elite', reaction: 0.18, accuracy: 0.9, tracking: 600, settle: 0.35, headshot: 0.4, detect: 120, fov: 130,
    detectTime: 0.4, hearing: 1.6, memory: 15, aggression: 0.8, flank: 0.6, retreatHp: 0.3, suppressTol: 0.7,
    strafe: 0.85, burst: [5, 12], pause: [0.1, 0.25], maxError: 6,
  },
};

export const BOT_NAMES = [
  'Viper', 'Ghost', 'Raven', 'Hawk', 'Nomad', 'Sable', 'Onyx', 'Talon', 'Jinx', 'Atlas', 'Bishop', 'Cobalt',
  'Drift', 'Ember', 'Flint', 'Gunner', 'Havoc', 'Ion', 'Jackal', 'Kodiak', 'Lynx', 'Mako', 'Nova', 'Orbit',
  'Pike', 'Quill', 'Rogue', 'Saber', 'Torque', 'Umbra', 'Vandal', 'Wraith',
];
