// On-screen controls for phones and tablets. They feed the same Input object as the keyboard and mouse:
//  - left half:  floating move stick (push it past the ring, forward, to sprint) + a second fire button
//  - right half: drag anywhere to look; FIRE (also drags to look), AIM, JUMP, CROUCH, RELOAD
//  - weapon panel: tap to switch weapons; top-right: scoreboard and pause
import { settings } from './settings.js';

/** True when the device's main pointer is a finger (phones, tablets). */
export function isTouchDevice() {
  try {
    return window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

/** Should the on-screen controls be used right now? */
export function touchControlsWanted() {
  if (settings.touchControls === 'on') return true;
  if (settings.touchControls === 'off') return false;
  return isTouchDevice();
}

const STICK_RADIUS = 58;      // px (scaled by --u)
const STICK_DEADZONE = 0.12;
const SPRINT_PULL = 1.35;     // finger this far past the ring, roughly forward, sprints
const LOOK_FACTOR = 1;        // touch look deltas are in CSS px; the session converts them to radians

const BUTTONS = [
  // id, label, extra class
  ['fire', 'FIRE', 'big'],
  ['fire2', 'FIRE', 'fire2'],
  ['aim', 'AIM', ''],
  ['jump', 'JUMP', ''],
  ['crouch', 'CROUCH', ''],
  ['reload', 'RELOAD', 'small'],
  ['swap', '⇄', 'swap'],
  ['score', '☰', 'top score'],
  ['pause', 'II', 'top pause'],
];

export class TouchControls {
  /**
   * @param {HTMLElement} hudRoot
   * @param {import('./input.js').Input} input
   * @param {{ onPause: Function, onScoreboard: (show: boolean) => void }} callbacks
   */
  constructor(hudRoot, input, callbacks) {
    this.hudRoot = hudRoot;
    this.input = input;
    this.callbacks = callbacks;
    this.pointers = new Map(); // pointerId -> { role, x, y, ox, oy }
    this.stickId = null;
    this.enabled = false;

    const el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = `
      <div class="stick idle"><div class="knob"></div><span>SPRINT</span></div>
      ${BUTTONS.map(([id, label, cls]) => `<div class="tbtn ${cls}" data-b="${id}">${label}</div>`).join('')}
      <div class="rotate-hint">Turn your phone sideways for the best view</div>`;
    // Insert below overlays (death, scoreboard, end screen, pause) so menus stay on top.
    hudRoot.insertBefore(el, hudRoot.querySelector('#death'));
    this.el = el;
    this.stick = el.querySelector('.stick');
    this.knob = el.querySelector('.knob');
    this.btn = {};
    for (const b of el.querySelectorAll('[data-b]')) this.btn[b.dataset.b] = b;

    this._down = (e) => this.onDown(e);
    this._move = (e) => this.onMove(e);
    this._up = (e) => this.onUp(e);
    this._resize = () => this.layout();
    this._block = (e) => { if (this.enabled && e.cancelable) e.preventDefault(); };
    el.addEventListener('pointerdown', this._down);
    el.addEventListener('pointermove', this._move);
    el.addEventListener('pointerup', this._up);
    el.addEventListener('pointercancel', this._up);
    el.addEventListener('lostpointercapture', this._up);
    el.addEventListener('touchstart', this._block, { passive: false });
    el.addEventListener('touchmove', this._block, { passive: false });
    el.addEventListener('contextmenu', this._block);
    window.addEventListener('resize', this._resize);
    window.addEventListener('orientationchange', this._resize);
    this.layout();
  }

  dispose() {
    window.removeEventListener('resize', this._resize);
    window.removeEventListener('orientationchange', this._resize);
    this.releaseAll();
    this.el.remove();
  }

  setEnabled(on) {
    if (this.enabled === on) return;
    this.enabled = on;
    this.hudRoot.classList.toggle('touch', on);
    this.input.setTouchMode(on);
    if (!on) this.releaseAll();
  }

  layout() {
    const vmin = Math.min(window.innerWidth, window.innerHeight);
    const u = Math.max(0.75, Math.min(1.4, vmin / 400));
    this.scale = u;
    this.el.style.setProperty('--u', u.toFixed(3));
    this.el.classList.toggle('portrait', window.innerHeight > window.innerWidth * 1.05);
  }

  /** Called every frame: reflects toggle states on the buttons. */
  update(state) {
    const t = this.input.touch;
    this.btn.aim.classList.toggle('on', t.aim);
    this.btn.crouch.classList.toggle('on', t.crouch);
    this.btn.score.classList.toggle('on', t.scoreboard);
    this.btn.fire.classList.toggle('auto', !!state.autoFiring);
  }

  // ------------------------------------------------------------------------------------------------
  onDown(e) {
    if (!this.enabled || e.pointerType === 'mouse') return;
    e.preventDefault();
    const t = this.input.touch;
    const target = e.target.closest ? e.target.closest('[data-b]') : null;
    const id = target ? target.dataset.b : null;
    let role = null;
    switch (id) {
      case 'fire': role = 'fire'; t.fire++; break;           // fire + drag to look
      case 'fire2': role = 'fire2'; t.fire++; break;         // fire only
      case 'aim': t.aim = !t.aim; break;
      case 'jump': this.input.latched.jump = true; role = 'look'; break; // keep looking after a jump tap
      case 'crouch': t.crouch = !t.crouch; break;
      case 'reload': this.input.latched.reload = true; break;
      case 'swap': this.input.latched.cycle = 1; break;
      case 'score': t.scoreboard = !t.scoreboard; this.callbacks.onScoreboard(t.scoreboard); break;
      case 'pause': this.callbacks.onPause(); break;
      default:
        if (e.clientX < window.innerWidth * 0.42 && this.stickId === null) {
          role = 'stick';
          this.stickId = e.pointerId;
          this.stickX = e.clientX;
          this.stickY = e.clientY;
          this.stick.classList.remove('idle');
          this.stick.style.left = e.clientX + 'px';
          this.stick.style.top = e.clientY + 'px';
          this.stick.style.bottom = 'auto';
          this.setStick(0, 0, false);
        } else {
          role = 'look';
        }
    }
    if (target) target.classList.add('down');
    this.pointers.set(e.pointerId, { role, x: e.clientX, y: e.clientY, button: target });
    try { this.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (p.role === 'look' || p.role === 'fire') {
      this.input.touch.lookX += dx * LOOK_FACTOR;
      this.input.touch.lookY += dy * LOOK_FACTOR;
    } else if (p.role === 'stick') {
      const r = STICK_RADIUS * this.scale;
      const ox = e.clientX - this.stickX;
      const oy = e.clientY - this.stickY;
      const dist = Math.hypot(ox, oy);
      const forward = dist > 0 ? -oy / dist : 0;
      const sprint = dist > r * SPRINT_PULL && forward > 0.8;
      const k = Math.min(1, dist / r);
      const nx = dist > 0 ? (ox / dist) * k : 0;
      const ny = dist > 0 ? (oy / dist) * k : 0;
      this.setStick(nx, ny, sprint);
    }
  }

  onUp(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.button) p.button.classList.remove('down');
    if (p.role === 'fire' || p.role === 'fire2') this.input.touch.fire = Math.max(0, this.input.touch.fire - 1);
    if (p.role === 'stick') {
      this.stickId = null;
      this.setStick(0, 0, false);
      this.stick.classList.add('idle');
      this.stick.style.left = '';
      this.stick.style.top = '';
      this.stick.style.bottom = '';
    }
  }

  setStick(nx, ny, sprint) {
    const t = this.input.touch;
    const len = Math.hypot(nx, ny);
    if (len < STICK_DEADZONE) { t.mx = 0; t.mz = 0; } else { t.mx = nx; t.mz = -ny; }
    t.sprint = sprint;
    const r = STICK_RADIUS * this.scale;
    this.knob.style.transform = `translate(${(nx * r).toFixed(1)}px, ${(ny * r).toFixed(1)}px)`;
    this.stick.classList.toggle('sprint', sprint);
  }

  /** Lifts every finger (pause, death, mode switch) so nothing stays pressed. */
  releaseAll() {
    for (const id of [...this.pointers.keys()]) this.onUp({ pointerId: id });
    const t = this.input.touch;
    t.fire = 0; t.mx = 0; t.mz = 0; t.sprint = false; t.lookX = 0; t.lookY = 0;
    if (t.scoreboard) { t.scoreboard = false; this.callbacks.onScoreboard(false); }
  }
}

/** Fullscreen + landscape lock where the browser allows it (Android); silently ignored elsewhere. */
export function enterMobileFullscreen() {
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request || document.fullscreenElement || document.webkitFullscreenElement) return;
  try {
    const result = request.call(el, { navigationUI: 'hide' });
    const lock = () => {
      try {
        const o = window.screen.orientation;
        if (o && o.lock) o.lock('landscape').catch(() => {});
      } catch { /* ignore */ }
    };
    if (result && result.then) result.then(lock).catch(() => {});
    else lock();
  } catch { /* ignore */ }
}
