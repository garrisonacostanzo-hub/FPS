// Keyboard / mouse input with pointer lock. Edge-triggered actions are latched until consumed.
// If the browser (or an embedding iframe) refuses pointer lock, input falls back to a free-cursor mode
// that still reads relative mouse motion; clicking in-game retries the real lock and Esc pauses.
import { BTN } from '../shared/constants.js';
import { settings } from './settings.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseButtons = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.latched = { jump: false, reload: false, slot: -1, cycle: 0, firePressed: false, scoreboard: false, chat: false };
    this.crouchToggled = false;
    this.aimToggled = false;
    this.enabled = true;
    this.locked = document.pointerLockElement === canvas; // the menu may already have captured the mouse
    this.fallback = false; // playing without pointer lock
    this.touchMode = false; // on-screen touch controls drive the game (see touch.js)
    this.touch = { mx: 0, mz: 0, sprint: false, fire: 0, autoFire: false, aim: false, aimHold: 0, crouch: false, scoreboard: false, lookX: 0, lookY: 0 };
    this.onLockChange = null;

    this._keydown = (e) => this.handleKey(e, true);
    this._keyup = (e) => this.handleKey(e, false);
    this._mousemove = (e) => {
      if (!this.locked || this.touchMode) return;
      this.lookX += e.movementX || 0;
      this.lookY += e.movementY || 0;
    };
    this._mousedown = (e) => {
      if (!this.locked || this.touchMode) return;
      if (this.fallback && e.target === this.canvas) this.tryLock(false);
      this.mouseButtons |= 1 << e.button;
      if (e.button === 0) this.latched.firePressed = true;
      if (e.button === 2 && settings.toggleAim) this.aimToggled = !this.aimToggled;
    };
    this._mouseup = (e) => { this.mouseButtons &= ~(1 << e.button); };
    this._wheel = (e) => {
      if (!this.locked || this.touchMode) return;
      this.latched.cycle = e.deltaY > 0 ? 1 : -1;
    };
    this._contextmenu = (e) => e.preventDefault();
    this._lock = () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) this.fallback = false;
      else if (this.fallback) return; // still playing in free-cursor mode
      this.locked = locked;
      if (!this.locked) { this.keys.clear(); this.mouseButtons = 0; }
      if (this.onLockChange) this.onLockChange(this.locked);
    };
    this._lockError = () => { if (this.wantLock) this.enterFallback(); };

    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);
    window.addEventListener('mousemove', this._mousemove);
    window.addEventListener('mousedown', this._mousedown);
    window.addEventListener('mouseup', this._mouseup);
    window.addEventListener('wheel', this._wheel, { passive: true });
    window.addEventListener('contextmenu', this._contextmenu);
    document.addEventListener('pointerlockchange', this._lock);
    document.addEventListener('pointerlockerror', this._lockError);
  }

  dispose() {
    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);
    window.removeEventListener('mousemove', this._mousemove);
    window.removeEventListener('mousedown', this._mousedown);
    window.removeEventListener('mouseup', this._mouseup);
    window.removeEventListener('wheel', this._wheel);
    window.removeEventListener('contextmenu', this._contextmenu);
    document.removeEventListener('pointerlockchange', this._lock);
    document.removeEventListener('pointerlockerror', this._lockError);
    this.fallback = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Starts playing: pointer lock if the browser allows it, otherwise free-cursor fallback. */
  requestLock() {
    if (this.locked) {
      if (this.onLockChange) this.onLockChange(true);
      return;
    }
    if (this.touchMode) { this.enterFallback(); return; } // touch play never needs the mouse captured
    this.tryLock(true);
  }

  /** Switches between touch controls and keyboard/mouse without pausing the game. */
  setTouchMode(on) {
    this.touchMode = on;
    if (on && this.locked && !this.fallback && document.pointerLockElement) {
      this.fallback = true; // keep playing; the pointerlockchange handler ignores the release
      document.exitPointerLock();
    }
  }

  tryLock(fallbackOnFailure) {
    this.wantLock = fallbackOnFailure;
    const fail = () => { if (fallbackOnFailure) this.enterFallback(); };
    if (!this.canvas.requestPointerLock) { fail(); return; }
    const plain = () => {
      try {
        const r = this.canvas.requestPointerLock();
        if (r && r.catch) r.catch(fail);
      } catch { fail(); }
    };
    try {
      const result = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (result && result.catch) result.catch(plain); // raw input unsupported: retry without it
    } catch {
      plain();
    }
  }

  enterFallback() {
    this.wantLock = false;
    if (this.locked) return;
    this.fallback = true;
    this.locked = true;
    if (this.onLockChange) this.onLockChange(true);
  }

  releaseLock() {
    this.wantLock = false;
    if (this.fallback) {
      this.fallback = false;
      this.locked = false;
      this.keys.clear();
      this.mouseButtons = 0;
      if (this.onLockChange) this.onLockChange(false);
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  handleKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    const code = e.code;
    if (down) {
      if (code === 'Tab') { e.preventDefault(); }
      if (code === 'Escape' && this.fallback) { this.releaseLock(); return; }
      if (!this.locked && code !== 'Tab') return;
      if (!this.keys.has(code)) {
        if (code === 'Space') this.latched.jump = true;
        if (code === 'KeyR') this.latched.reload = true;
        if (code === 'Digit1') this.latched.slot = 0;
        if (code === 'Digit2') this.latched.slot = 1;
        if (code === 'KeyQ') this.latched.cycle = -1;
        if (code === 'KeyE') this.latched.cycle = 1;
        if ((code === 'ControlLeft' || code === 'KeyC') && settings.toggleCrouch) this.crouchToggled = !this.crouchToggled;
        if (code === 'KeyT' || code === 'Enter') this.latched.chat = true;
      }
      this.keys.add(code);
      if (['Space', 'ControlLeft', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(code)) e.preventDefault();
    } else {
      this.keys.delete(code);
    }
  }

  axis(neg, pos) {
    return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0);
  }

  get moveX() { return this.axis('KeyA', 'KeyD') || this.axis('ArrowLeft', 'ArrowRight') || this.touch.mx; }
  get moveZ() { return this.axis('KeyS', 'KeyW') || this.axis('ArrowDown', 'ArrowUp') || this.touch.mz; }
  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touch.sprint; }
  get crouch() { return this.touch.crouch || (settings.toggleCrouch ? this.crouchToggled : (this.keys.has('ControlLeft') || this.keys.has('KeyC'))); }
  get fire() { return (this.mouseButtons & 1) !== 0 || this.touch.fire > 0 || this.touch.autoFire; }
  get aim() { return this.touch.aim || this.touch.aimHold > 0 || (settings.toggleAim ? this.aimToggled : (this.mouseButtons & 4) !== 0); }
  get scoreboard() { return this.keys.has('Tab') || this.touch.scoreboard; }

  consumeLook() {
    const x = this.lookX, y = this.lookY;
    this.lookX = 0; this.lookY = 0;
    return { x, y };
  }

  /** Finger drag since the last call, in CSS pixels. */
  consumeTouchLook() {
    const x = this.touch.lookX, y = this.touch.lookY;
    this.touch.lookX = 0; this.touch.lookY = 0;
    return { x, y };
  }

  /** Builds the button mask for a command and clears one-shot latches. */
  buildButtons() {
    let b = 0;
    if (!this.locked) return 0;
    if (this.latched.jump) b |= BTN.JUMP;
    if (this.sprint && !this.fire) b |= BTN.SPRINT;
    if (this.crouch) b |= BTN.CROUCH;
    if (this.aim) b |= BTN.AIM;
    if (this.fire || this.latched.firePressed) b |= BTN.FIRE;
    this.latched.jump = false;
    this.latched.firePressed = false;
    return b;
  }

  consume(name) {
    const value = this.latched[name];
    this.latched[name] = name === 'slot' ? -1 : name === 'cycle' ? 0 : false;
    return value;
  }

  resetToggles() {
    this.crouchToggled = false;
    this.aimToggled = false;
    this.touch.aim = false;
    this.touch.crouch = false;
  }
}
