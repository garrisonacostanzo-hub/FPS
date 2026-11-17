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
  dynamicResolution: true, // lower the resolution automatically while the frame rate is low
  quality: coarsePointer() ? 'medium' : 'high', // phones/tablets default to a lighter renderer
  primary: 'rifle',      // (older saves) replaced by weaponSet
  weaponSet: 'assault',  // fixed set of four guns, see WEAPON_SETS
  ability: 'dash',       // special ability (F / ⚡), see ABILITIES
  toggleCrouch: false,
  toggleAim: true,       // right mouse: click to scope in, click again to scope out (false = hold)
  // Voice chat in online matches.
  voiceChat: 'ptt',      // 'ptt' (hear everyone, hold V / 🎙 to talk) | 'open' (mic always on) | 'off'
  voiceVolume: 0.9,
  emoteMusic: true,      // music while you or others do an emote dance
  // Touch controls (phones/tablets).
  touchControls: 'auto', // 'auto' | 'on' | 'off'
  aimButton: 'toggle',   // 'toggle' (tap to scope in / out, drag to look) | 'hold' (aim while held, drag to look)
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
  difficulty: 'adaptive',
  // Online host setup.
  hostMode: 'tdm',
  hostMap: 'outpost',
  hostBots: 6,
  hostDifficulty: 'adaptive',
  aimV: 2,               // settings revision: 2 = toggle aim became the default
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
    // Weapon sets replaced the single primary-weapon choice: start older saves on the set led by their old gun.
    if (!stored.weaponSet && stored.primary) {
      const lead = { rifle: 'assault', smg: 'cqb', shotgun: 'breacher', lmg: 'heavy', dmr: 'marksman', sniper: 'recon' };
      merged.weaponSet = lead[stored.primary] || 'assault';
    }
    // Toggle aim became the default: switch older saves over once (the settings can still switch back to hold).
    if ((stored.aimV || 0) < 2) {
      merged.toggleAim = true;
      merged.aimButton = 'toggle';
      merged.aimV = 2;
      try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* storage unavailable */ }
    }
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
