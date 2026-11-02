// One description of every player setting, rendered by both the main menu's SETTINGS tab and the in-game
// pause menu, so the two always offer the same options.
import { resetSettings, saveSettings, settings } from './settings.js';
import { isTouchDevice } from './touch.js';

const pct = (v) => Math.round(v * 100) + '%';

export const SETTINGS_SECTIONS = [
  {
    id: 'touch',
    title: 'Touch controls',
    touch: true,
    items: [
      { k: 'touchControls', label: 'On-screen controls', type: 'select', options: [['auto', 'Auto'], ['on', 'Always on'], ['off', 'Off']], hint: 'Auto shows them as soon as you touch the screen.' },
      { k: 'aimButton', label: 'AIM button', type: 'select', options: [['hold', 'Hold'], ['toggle', 'Tap to toggle']], hint: 'Hold: aim while your thumb is on AIM, and drag it to look around. It never fires.' },
      { k: 'autoFire', label: 'Auto-fire', type: 'select', options: [['off', 'Off'], ['hip', 'Not while aiming'], ['always', 'Always']], hint: 'Shoots by itself when an enemy is in your crosshair.' },
      { k: 'aimAssist', label: 'Aim assist (slower look while on a target)', type: 'check' },
      { k: 'touchSensitivity', label: 'Look speed', type: 'range', min: 0.3, max: 3, step: 0.05 },
      { k: 'touchAdsSensitivity', label: 'Look speed while aiming', type: 'range', min: 0.2, max: 1.5, step: 0.05 },
      { k: 'stickMode', label: 'Move stick', type: 'select', options: [['floating', 'Floating'], ['fixed', 'Fixed']], hint: 'Floating appears wherever your thumb lands; fixed stays in the corner.' },
      { k: 'autoSprint', label: 'Sprint when the stick is pushed all the way forward', type: 'check' },
      { k: 'buttonScale', label: 'Button size', type: 'range', min: 0.7, max: 1.4, step: 0.05, fmt: pct },
      { k: 'buttonOpacity', label: 'Button opacity', type: 'range', min: 0.25, max: 1, step: 0.05, fmt: pct },
      { k: 'showLeftFire', label: 'Show the left FIRE button', type: 'check' },
      { k: 'vibration', label: 'Vibrate on hits and damage (Android)', type: 'check' },
    ],
  },
  {
    id: 'teams',
    title: 'Teams & visibility',
    items: [
      { k: 'teamColors', label: 'Team colours', type: 'select', options: [['standard', 'Blue vs red'], ['colorblind', 'Blue vs yellow'], ['classic', 'Classic']],
        hint: 'Your team is always blue and enemies red (or yellow, easier with red–green colour blindness). Classic: Alpha blue, Bravo orange.' },
      { k: 'outlines', label: 'Coloured outlines around players', type: 'check' },
      { k: 'enemyMarkers', label: 'Arrows over enemies you can see', type: 'check' },
      { k: 'allyMarkers', label: 'Teammate names and arrows (shown through walls)', type: 'check' },
      { k: 'crosshairTargetColor', label: 'Crosshair turns red on enemies and blue on teammates', type: 'check' },
    ],
  },
  {
    id: 'mouse',
    title: 'Mouse & keyboard',
    items: [
      { k: 'sensitivity', label: 'Mouse sensitivity', type: 'range', min: 0.1, max: 4, step: 0.05 },
      { k: 'adsSensitivity', label: 'Mouse sensitivity while aiming', type: 'range', min: 0.2, max: 1.5, step: 0.05 },
      { k: 'toggleAim', label: 'Right mouse toggles aim (instead of hold)', type: 'check' },
      { k: 'toggleCrouch', label: 'Crouch key toggles (instead of hold)', type: 'check' },
    ],
  },
  {
    id: 'view',
    title: 'View & HUD',
    items: [
      { k: 'fov', label: 'Field of view', type: 'range', min: 60, max: 110, step: 1, fmt: (v) => v + '°' },
      { k: 'invertY', label: 'Invert look up/down (mouse and touch)', type: 'check' },
      { k: 'cameraBob', label: 'Camera bob and screen shake', type: 'check' },
      { k: 'crosshairStyle', label: 'Crosshair', type: 'select', options: [['auto', 'Per weapon'], ['cross', 'Cross'], ['dotcross', 'Cross + dot'], ['dot', 'Dot'], ['circle', 'Circle']] },
      { k: 'crosshairSize', label: 'Crosshair size', type: 'range', min: 0.6, max: 1.8, step: 0.1, fmt: pct },
      { k: 'crosshairColor', label: 'Crosshair colour', type: 'color' },
      { k: 'showMinimap', label: 'Show minimap', type: 'check' },
      { k: 'showFps', label: 'Show FPS, ping and room code', type: 'check' },
    ],
  },
  {
    id: 'graphics',
    title: 'Graphics & audio',
    items: [
      { k: 'quality', label: 'Graphics quality', type: 'select', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], hint: 'Low is fastest (no shadows).', note: 'Takes effect in the next match.' },
      { k: 'renderScale', label: 'Resolution', type: 'range', min: 0.5, max: 1, step: 0.05, fmt: pct, hint: 'Lower it if the game stutters.' },
      { k: 'volume', label: 'Volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    ],
  },
];

/** Every key the settings screens manage (used by "Reset to defaults"). */
export const SETTING_KEYS = SETTINGS_SECTIONS.flatMap((s) => s.items.map((i) => i.k));

export function touchSettingsRelevant() {
  return isTouchDevice() || settings.touchControls === 'on';
}

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderItem(item, inGame) {
  const v = settings[item.k];
  const text = [item.hint, inGame ? item.note : ''].filter(Boolean).join(' ');
  const note = text ? `<small>${esc(text)}</small>` : '';
  switch (item.type) {
    case 'range':
      return `<label class="set range"><span>${esc(item.label)}${note}</span>
        <input type="range" data-k="${item.k}" data-type="range" min="${item.min}" max="${item.max}" step="${item.step}" value="${esc(v)}">
        <output>${esc(item.fmt ? item.fmt(v) : v)}</output></label>`;
    case 'check':
      return `<label class="set check"><input type="checkbox" data-k="${item.k}" data-type="check" ${v ? 'checked' : ''}><span>${esc(item.label)}</span></label>`;
    case 'color':
      return `<label class="set"><span>${esc(item.label)}</span><input type="color" data-k="${item.k}" data-type="color" value="${esc(v)}"></label>`;
    default:
      return `<label class="set"><span>${esc(item.label)}${note}</span><select data-k="${item.k}" data-type="select">${item.options
        .map(([value, label]) => `<option value="${esc(value)}" ${v === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`;
  }
}

/**
 * HTML for the settings sections.
 * @param {{ inGame?: boolean, open?: string[] }} options inGame renders collapsible groups; open lists the ids expanded.
 */
export function renderSettingsSections({ inGame = false, open = [] } = {}) {
  const showTouch = !inGame || touchSettingsRelevant();
  return SETTINGS_SECTIONS.filter((s) => showTouch || !s.touch).map((s) => {
    const items = s.items.map((i) => renderItem(i, inGame)).join('');
    if (inGame) return `<details class="set-group" ${open.includes(s.id) ? 'open' : ''}><summary>${esc(s.title)}</summary><div class="set-list">${items}</div></details>`;
    return `<section class="set-card"><h3>${esc(s.title.toUpperCase())}</h3><div class="set-list">${items}</div></section>`;
  }).join('');
}

/** Wires every [data-k] control inside root to the settings store. onChange(key, value) is optional. */
export function bindSettingsControls(root, onChange) {
  const items = new Map(SETTINGS_SECTIONS.flatMap((s) => s.items).map((i) => [i.k, i]));
  root.querySelectorAll('[data-k]').forEach((input) => {
    input.addEventListener('input', () => {
      const k = input.dataset.k;
      const type = input.dataset.type || (input.type === 'checkbox' ? 'check' : input.type === 'range' ? 'range' : 'text');
      const value = type === 'check' ? input.checked : type === 'range' ? parseFloat(input.value) : input.value;
      saveSettings({ [k]: value });
      const out = input.parentElement.querySelector('output');
      const item = items.get(k);
      if (out) out.textContent = item && item.fmt ? item.fmt(value) : input.value;
      if (onChange) onChange(k, value);
    });
  });
}

export function resetAllSettings() {
  resetSettings(SETTING_KEYS);
}
