// Persistent player settings (localStorage).
const KEY = 'vanguard.settings.v1';

const DEFAULTS = {
  name: '',
  sensitivity: 1.0,
  adsSensitivity: 0.8,
  fov: 80,
  invertY: false,
  volume: 0.7,
  crosshairColor: '#ffffff',
  crosshairSize: 1,
  showFps: false,
  quality: 'high',
  primary: 'rifle',
  toggleCrouch: false,
  toggleAim: false,
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

export const settings = load();

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    const merged = { ...DEFAULTS, ...stored };
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

export function onSettingsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
