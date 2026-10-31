// Main menu: offline match setup, online host/join by room code, settings and controls.
import { DIFFICULTY, GAME_TITLE, MAX_ONLINE_PLAYERS } from '../shared/constants.js';
import { MAP_LIST } from '../shared/map.js';
import { MODE_LIST } from '../shared/modes.js';
import { PRIMARY_WEAPONS, WEAPONS } from '../shared/weapons.js';
import { CODE_LENGTH, normalizeCode, webrtcSupported } from './net.js';
import { saveSettings, settings } from './settings.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class MainMenu {
  constructor(root, { onStartOffline, onHost, onJoin, audio }) {
    this.root = root;
    this.onStartOffline = onStartOffline;
    this.onHost = onHost;
    this.onJoin = onJoin;
    this.audio = audio;
    this.tab = 'offline';
    this.status = '';
    this.busy = false;
    this.joinCode = '';
    this.render();
  }

  show(tab, status) {
    if (tab) this.tab = tab;
    this.status = status || '';
    this.busy = false;
    this.root.style.display = 'flex';
    this.render();
  }

  hide() {
    this.root.style.display = 'none';
  }

  click() {
    this.audio.ensure();
    this.audio.click();
  }

  render() {
    const tabs = [['offline', 'PLAY OFFLINE'], ['online', 'PLAY ONLINE'], ['settings', 'SETTINGS'], ['controls', 'CONTROLS']];
    this.root.innerHTML = `
      <div class="menu-shell">
        <header>
          <div class="logo">${GAME_TITLE}<span>TACTICAL FPS</span></div>
          <nav>${tabs.map(([id, label]) => `<button class="tab ${this.tab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('')}</nav>
          <label class="name">CALLSIGN <input id="m-name" maxlength="18" value="${esc(settings.name)}"></label>
        </header>
        <main>${this.renderTab()}</main>
        <footer>One file, no install: offline matches run in your browser · online matches are hosted by a player's browser and joined with a room code</footer>
      </div>`;
    this.root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { if (this.busy) return; this.click(); this.tab = b.dataset.tab; this.status = ''; this.render(); }));
    this.root.querySelector('#m-name').addEventListener('change', (e) => saveSettings({ name: e.target.value.trim().slice(0, 18) || settings.name }));
    if (this.tab === 'offline') this.bindOffline();
    if (this.tab === 'online') this.bindOnline();
    if (this.tab === 'settings') this.bindSettings();
  }

  renderTab() {
    switch (this.tab) {
      case 'offline': return this.renderOffline();
      case 'online': return this.renderOnline();
      case 'settings': return this.renderSettings();
      default: return CONTROLS_HTML;
    }
  }

  // ------------------------------------------------------------------------------------------------
  renderMatchSetup(prefix, values) {
    return `
      <section class="setup">
        <h3>GAME MODE</h3>
        <div class="cards">${MODE_LIST.map((m) => `
          <button class="card ${values.mode === m.id ? 'on' : ''}" data-${prefix}mode="${m.id}">
            <b>${m.name}</b><small>${m.description}</small><i>${m.short}</i>
          </button>`).join('')}</div>
        <h3>MAP</h3>
        <div class="cards maps">${MAP_LIST.map((m) => `
          <button class="card ${values.map === m.id ? 'on' : ''}" data-${prefix}map="${m.id}">
            <b>${m.name}</b><small>${m.description}</small><i>${m.size}</i>
          </button>`).join('')}</div>
        <div class="row3">
          <label>${values.mode === 'horde' ? 'ALLIED BOTS' : 'BOTS'} <input type="range" min="0" max="${values.mode === 'horde' ? 5 : 19}" value="${Math.min(values.bots, values.mode === 'horde' ? 5 : 19)}" id="${prefix}bots"><output>${Math.min(values.bots, values.mode === 'horde' ? 5 : 19)}</output></label>
          <label>BOT DIFFICULTY <div class="seg">${Object.entries(DIFFICULTY).map(([k, d]) => `<button class="${values.difficulty === k ? 'on' : ''}" data-${prefix}diff="${k}">${d.name}</button>`).join('')}</div></label>
        </div>
      </section>`;
  }

  renderOffline() {
    return `
      <div class="two-col">
        ${this.renderMatchSetup('o', settings)}
        <aside>
          ${this.renderLoadout()}
          <button class="start" id="start-offline">DEPLOY</button>
        </aside>
      </div>`;
  }

  renderLoadout() {
    return `
      <h3>LOADOUT</h3>
      <div class="weapons">${PRIMARY_WEAPONS.map((id) => {
        const w = WEAPONS[id];
        return `<button class="weapon ${settings.primary === id ? 'on' : ''}" data-primary="${id}"><b>${w.name}</b>
          <span class="stats"><i style="width:${Math.min(100, w.damage * w.pellets / 1.0)}%"></i></span><small>DMG ${w.damage}${w.pellets > 1 ? '×' + w.pellets : ''} · ${w.rpm} RPM · ${w.mag} RDS</small></button>`;
      }).join('')}</div>
      <p class="note">Secondary: ${WEAPONS.pistol.name}. Gun Game overrides your loadout.</p>`;
  }

  bindLoadout() {
    this.root.querySelectorAll('[data-primary]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ primary: b.dataset.primary }); this.render(); }));
  }

  bindOffline() {
    const root = this.root;
    root.querySelectorAll('[data-omode]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ mode: b.dataset.omode }); this.render(); }));
    root.querySelectorAll('[data-omap]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ map: b.dataset.omap }); this.render(); }));
    root.querySelectorAll('[data-odiff]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ difficulty: b.dataset.odiff }); this.render(); }));
    this.bindLoadout();
    const bots = root.querySelector('#obots');
    bots.addEventListener('input', () => { bots.nextElementSibling.textContent = bots.value; saveSettings({ bots: parseInt(bots.value, 10) }); });
    root.querySelector('#start-offline').addEventListener('click', () => {
      this.click();
      this.onStartOffline({ mode: settings.mode, map: settings.map, bots: settings.mode === 'horde' ? Math.min(settings.bots, 5) : settings.bots, difficulty: settings.difficulty });
    });
  }

  // ------------------------------------------------------------------------------------------------
  hostValues() {
    return { mode: settings.hostMode, map: settings.hostMap, bots: settings.hostBots, difficulty: settings.hostDifficulty };
  }

  renderOnline() {
    const unsupported = !webrtcSupported()
      ? '<p class="note warn">This browser (or the page embedding this game) blocks peer-to-peer connections, so online play is unavailable here. Open VANGUARD.html directly in Chrome, Edge, Firefox or Safari.</p>'
      : '';
    return `
      <div class="two-col ${this.busy ? 'busy' : ''}">
        <div>
          <h3>HOST A MATCH</h3>
          ${unsupported}
          <div class="host-row">
            <button class="start" id="host-match">HOST MATCH</button>
            <p class="note">You get a ${CODE_LENGTH}-character room code to send to friends. Up to ${MAX_ONLINE_PLAYERS} players; bots fill the teams.
            The match runs in your browser, so keep your tab open — when you leave, the match ends for everyone.</p>
          </div>
          ${this.renderMatchSetup('h', this.hostValues())}
        </div>
        <aside>
          <h3>JOIN A MATCH</h3>
          <div class="join-row">
            <input id="join-code" maxlength="${CODE_LENGTH}" placeholder="CODE" autocomplete="off" spellcheck="false" value="${esc(this.joinCode)}">
            <button class="start small" id="join-match">JOIN</button>
          </div>
          <p class="status" id="online-status">${esc(this.status)}</p>
          ${this.renderLoadout()}
          <p class="note">Everyone needs the same VANGUARD.html and an internet connection. Players connect directly to the host's browser;
          a free public matchmaking service is used only to find the host by code.</p>
        </aside>
      </div>`;
  }

  bindOnline() {
    const root = this.root;
    root.querySelectorAll('[data-hmode]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ hostMode: b.dataset.hmode }); this.render(); }));
    root.querySelectorAll('[data-hmap]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ hostMap: b.dataset.hmap }); this.render(); }));
    root.querySelectorAll('[data-hdiff]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ hostDifficulty: b.dataset.hdiff }); this.render(); }));
    const bots = root.querySelector('#hbots');
    bots.addEventListener('input', () => { bots.nextElementSibling.textContent = bots.value; saveSettings({ hostBots: parseInt(bots.value, 10) }); });
    this.bindLoadout();

    const codeInput = root.querySelector('#join-code');
    codeInput.addEventListener('input', () => {
      const clean = normalizeCode(codeInput.value);
      if (clean !== codeInput.value) codeInput.value = clean;
      this.joinCode = clean;
    });
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') root.querySelector('#join-match').click(); });

    root.querySelector('#host-match').addEventListener('click', async () => {
      if (this.busy) return;
      this.click();
      const v = this.hostValues();
      this.setBusy(true, 'Creating match…');
      try {
        await this.onHost({ mode: v.mode, map: v.map, bots: v.mode === 'horde' ? Math.min(v.bots, 5) : v.bots, difficulty: v.difficulty });
      } catch (err) {
        this.setBusy(false, err.message || String(err));
      }
    });
    root.querySelector('#join-match').addEventListener('click', async () => {
      if (this.busy) return;
      this.click();
      const code = normalizeCode(codeInput.value);
      if (code.length !== CODE_LENGTH) { this.setStatus(`Enter the ${CODE_LENGTH}-character room code from the host.`); return; }
      this.joinCode = code;
      this.setBusy(true, `Joining ${code}…`);
      try {
        await this.onJoin(code);
      } catch (err) {
        this.setBusy(false, err.message || String(err));
      }
    });
  }

  setBusy(busy, status) {
    this.busy = busy;
    this.status = status;
    if (this.root.style.display !== 'none') this.render();
  }

  setStatus(text) {
    this.status = text;
    const el = this.root.querySelector('#online-status');
    if (el) el.textContent = text;
  }

  // ------------------------------------------------------------------------------------------------
  renderSettings() {
    const range = (k, label, min, max, step) => `<label>${label} <input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${settings[k]}"><output>${settings[k]}</output></label>`;
    const check = (k, label) => `<label class="check"><input type="checkbox" data-k="${k}" ${settings[k] ? 'checked' : ''}> ${label}</label>`;
    return `
      <section class="settings">
        ${range('sensitivity', 'MOUSE SENSITIVITY', 0.1, 4, 0.05)}
        ${range('adsSensitivity', 'AIM SENSITIVITY', 0.2, 1.5, 0.05)}
        ${range('fov', 'FIELD OF VIEW', 60, 110, 1)}
        ${range('volume', 'VOLUME', 0, 1, 0.05)}
        ${range('crosshairSize', 'CROSSHAIR SIZE', 0.6, 1.8, 0.1)}
        <label>CROSSHAIR COLOUR <input type="color" data-k="crosshairColor" value="${settings.crosshairColor}"></label>
        <label>GRAPHICS QUALITY <select data-k="quality">${['low', 'medium', 'high'].map((q) => `<option ${settings.quality === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
        ${check('invertY', 'Invert mouse Y')}
        ${check('toggleCrouch', 'Toggle crouch')}
        ${check('toggleAim', 'Toggle aim down sights')}
      </section>`;
  }

  bindSettings() {
    this.root.querySelectorAll('[data-k]').forEach((input) => {
      input.addEventListener('input', () => {
        const value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? parseFloat(input.value) : input.value;
        saveSettings({ [input.dataset.k]: value });
        const out = input.parentElement.querySelector('output');
        if (out) out.textContent = input.value;
      });
    });
  }
}

const CONTROLS_HTML = `
  <section class="controls">
    <table>
      <tr><td>Move</td><td>W A S D</td></tr>
      <tr><td>Look</td><td>Mouse</td></tr>
      <tr><td>Fire / Aim down sights</td><td>Left mouse / Right mouse</td></tr>
      <tr><td>Sprint</td><td>Shift (forward only)</td></tr>
      <tr><td>Jump</td><td>Space</td></tr>
      <tr><td>Crouch</td><td>Ctrl or C</td></tr>
      <tr><td>Reload</td><td>R</td></tr>
      <tr><td>Switch weapon</td><td>1 / 2, Q / E, mouse wheel</td></tr>
      <tr><td>Scoreboard</td><td>Tab (hold)</td></tr>
      <tr><td>Chat</td><td>T or Enter</td></tr>
      <tr><td>Pause / settings</td><td>Esc</td></tr>
    </table>
    <p class="note">Tips: sprinting blocks firing; crouching and aiming tighten your spread; bots hear footsteps and gunfire,
    flank in squads and retreat to cover when suppressed. Hold zones in Domination, upgrade your gun in Gun Game, and survive escalating waves in Horde.</p>
  </section>`;
