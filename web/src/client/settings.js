// Persistent player settings (localStorage).
const KEY = 'vanguard.settings.v1';

export const DEFAULTS = {
  name: '',
  sensitivity: 1.0,
  adsSensitivity: 0.8,
  fov: 80,
  invertY: false,
  volume: 0.7,
  crosshairColor: '#ffffff',
  crosshairSize: 1,
  crosshairStyle: 'auto', // 'auto' (per weapon) | 'cross' | 'dotcross' | 'dot' | 'circle'
  showFps: true,
  showMinimap: true,
  teamColors: 'standard',       // 'standard' (your team blue, enemies red) | 'colorblind' (blue / yellow) | 'classic'
  outlines: true,               // coloured outline around every player
  enemyMarkers: true,           // arrow over enemies you can see
  allyMarkers: true,            // teammate names + markers, visible through walls
  crosshairTargetColor: true,   // crosshair turns red on enemies, blue on teammates
  cameraBob: true,       // head bob and screen shake
  renderScale: 1,        // fraction of the quality preset's resolution
  quality: coarsePointer() ? 'medium' : 'high', // phones/tablets default to a lighter renderer
  primary: 'rifle',
  toggleCrouch: false,
  toggleAim: false,
  // Touch controls (phones/tablets).
  touchControls: 'auto', // 'auto' | 'on' | 'off'
  aimButton: 'hold',     // 'hold' (aim while held, drag to look) | 'toggle'
  autoFire: 'hip',       // 'off' | 'hip' (not while aiming) | 'always'
  aimAssist: true,
  touchSensitivity: 1.0,
  touchAdsSensitivity: 0.8,
  stickMode: 'floating', // 'floating' | 'fixed'
  autoSprint: false,     // sprint when the stick is pushed all the way forward
  buttonScale: 1,
  buttonOpacity: 0.85,
  showLeftFire: true,
  vibration: true,
  // Offline match setup.
  mode: 'tdm',
  map: 'outpost',
  bots: 9,
  difficulty: 'normal',
  // Online host setup.
  hostMode: 'tdm',
  hostMap: 'outpost',
  hostBots: 6,
  hostDifficulty: 'normal',
};

function coarsePointer() {
  try { return window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0; } catch { return false; }
}

export const settings = load();

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    const merged = { ...DEFAULTS, ...stored };
    if (typeof merged.autoFire === 'boolean') merged.autoFire = merged.autoFire ? 'hip' : 'off'; // older saves
    if (!merged.name) merged.name = 'Player' + Math.floor(100 + Math.random() * 900);
    return merged;
  } catch {
    return { ...DEFAULTS, name: 'Player' + Math.floor(100 + Math.random() * 900) };
  }
}

const listeners = new Set();

export function saveSettings(patch = {}) {
  Object.assign(settings, patch);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  for (const fn of listeners) fn(settings);
}

/** Restores the given keys to their defaults (keeps name, loadout and match setup). */
export function resetSettings(keys) {
  const patch = {};
  for (const k of keys) if (k in DEFAULTS) patch[k] = DEFAULTS[k];
  saveSettings(patch);
}

export function onSettingsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
