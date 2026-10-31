// Main menu: offline match setup, online lobby (rooms), settings and controls.
import { DIFFICULTY, GAME_TITLE } from '../shared/constants.js';
import { MAP_LIST } from '../shared/map.js';
import { MODE_LIST } from '../shared/modes.js';
import { PRIMARY_WEAPONS, WEAPONS } from '../shared/weapons.js';
import { WsTransport } from './net.js';
import { saveSettings, settings } from './settings.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class MainMenu {
  constructor(root, { onStartOffline, onStartOnline, audio }) {
    this.root = root;
    this.onStartOffline = onStartOffline;
    this.onStartOnline = onStartOnline;
    this.audio = audio;
    this.tab = 'offline';
    this.transport = null;
    this.rooms = [];
    this.render();
  }

  show(tab) {
    if (tab) this.tab = tab;
    this.root.style.display = 'flex';
    this.render();
    if (this.tab === 'online' && this.transport) this.requestRooms();
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
        <footer>Offline matches run entirely in your browser · Online play needs the Vanguard server (<code>npm start</code>)</footer>
      </div>`;
    this.root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { this.click(); this.tab = b.dataset.tab; this.render(); if (this.tab === 'online' && this.transport) this.requestRooms(); }));
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
          <h3>LOADOUT</h3>
          <div class="weapons">${PRIMARY_WEAPONS.map((id) => {
            const w = WEAPONS[id];
            return `<button class="weapon ${settings.primary === id ? 'on' : ''}" data-primary="${id}"><b>${w.name}</b>
              <span class="stats"><i style="width:${Math.min(100, w.damage * w.pellets / 1.0)}%"></i></span><small>DMG ${w.damage}${w.pellets > 1 ? '×' + w.pellets : ''} · ${w.rpm} RPM · ${w.mag} RDS</small></button>`;
          }).join('')}</div>
          <p class="note">Secondary: ${WEAPONS.pistol.name}. Gun Game overrides your loadout.</p>
          <button class="start" id="start-offline">DEPLOY</button>
        </aside>
      </div>`;
  }

  bindOffline() {
    const root = this.root;
    root.querySelectorAll('[data-omode]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ mode: b.dataset.omode }); this.render(); }));
    root.querySelectorAll('[data-omap]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ map: b.dataset.omap }); this.render(); }));
    root.querySelectorAll('[data-odiff]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ difficulty: b.dataset.odiff }); this.render(); }));
    root.querySelectorAll('[data-primary]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ primary: b.dataset.primary }); this.render(); }));
    const bots = root.querySelector('#obots');
    bots.addEventListener('input', () => { bots.nextElementSibling.textContent = bots.value; saveSettings({ bots: parseInt(bots.value, 10) }); });
    root.querySelector('#start-offline').addEventListener('click', () => {
      this.click();
      this.onStartOffline({ mode: settings.mode, map: settings.map, bots: settings.mode === 'horde' ? Math.min(settings.bots, 5) : settings.bots, difficulty: settings.difficulty });
    });
  }

  // ------------------------------------------------------------------------------------------------
  renderOnline() {
    const connected = this.transport && this.transport.ws && this.transport.ws.readyState === WebSocket.OPEN;
    const fileNote = window.location.protocol === 'file:' ? '<p class="note warn">This page was opened from a file. Start the server with <code>npm start</code> and open <code>http://localhost:8080</code> (or enter a server address below).</p>' : '';
    if (!connected) {
      return `
        <section class="online">
          <h3>CONNECT TO SERVER</h3>
          ${fileNote}
          <div class="connect">
            <input id="server-url" value="${esc(settings.serverUrl || WsTransport.defaultUrl())}" placeholder="ws://host:8080/ws">
            <button class="start small" id="connect">CONNECT</button>
          </div>
          <p class="status" id="online-status">${esc(this.status || '')}</p>
          <p class="note">Host your own server: <code>cd web && npm install && npm run serve</code>, then friends open <code>http://YOUR-IP:8080</code>. Bots fill every room and step aside as humans join.</p>
        </section>`;
    }
    const createValues = this.createValues || { mode: 'tdm', map: 'outpost', bots: 9, difficulty: 'normal' };
    this.createValues = createValues;
    return `
      <div class="two-col">
        <section class="online">
          <h3>ROOMS <button class="mini" id="refresh">REFRESH</button> <button class="mini" id="disconnect">DISCONNECT</button></h3>
          <table class="rooms">
            <tr><th>ROOM</th><th>MODE</th><th>MAP</th><th>PLAYERS</th><th>BOTS</th><th></th></tr>
            ${this.rooms.length ? this.rooms.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc((MODE_LIST.find((m) => m.id === r.mode) || {}).name || r.mode)}</td><td>${esc(r.map)}</td><td>${r.players}/${r.max || 16}</td><td>${r.bots}</td>
              <td><button class="mini join" data-room="${esc(r.id)}">JOIN</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No rooms yet — create one.</td></tr>'}
          </table>
          <p class="status" id="online-status">${esc(this.status || '')}</p>
        </section>
        <aside>
          <h3>CREATE ROOM</h3>
          <label>ROOM NAME <input id="room-name" maxlength="24" value="${esc(settings.name)}'s room"></label>
          ${this.renderMatchSetup('c', createValues)}
          <button class="start" id="create-room">CREATE &amp; JOIN</button>
        </aside>
      </div>`;
  }

  bindOnline() {
    const root = this.root;
    const connect = root.querySelector('#connect');
    if (connect) {
      connect.addEventListener('click', async () => {
        this.click();
        const url = root.querySelector('#server-url').value.trim();
        saveSettings({ serverUrl: url });
        this.setStatus('Connecting…');
        const transport = new WsTransport(url);
        try {
          const lobby = await transport.connect(settings.name);
          this.transport = transport;
          this.rooms = lobby.rooms || [];
          this.status = 'Connected to ' + url;
          transport.onClose = () => { this.transport = null; this.status = 'Disconnected from server.'; if (this.root.style.display !== 'none') this.render(); };
          transport.setHandler((msg) => this.onLobbyMessage(msg));
          this.render();
        } catch (err) {
          this.setStatus(err.message || String(err));
        }
      });
      return;
    }
    root.querySelector('#refresh').addEventListener('click', () => { this.click(); this.requestRooms(); });
    root.querySelector('#disconnect').addEventListener('click', () => { this.click(); this.transport.close(); this.transport = null; this.status = ''; this.render(); });
    root.querySelectorAll('[data-room]').forEach((b) => b.addEventListener('click', () => {
      this.click();
      this.setStatus('Joining…');
      this.transport.send({ type: 'joinRoom', id: b.dataset.room, name: settings.name, loadout: [settings.primary, 'pistol'] });
    }));
    const cv = this.createValues;
    root.querySelectorAll('[data-cmode]').forEach((b) => b.addEventListener('click', () => { this.click(); cv.mode = b.dataset.cmode; this.render(); }));
    root.querySelectorAll('[data-cmap]').forEach((b) => b.addEventListener('click', () => { this.click(); cv.map = b.dataset.cmap; this.render(); }));
    root.querySelectorAll('[data-cdiff]').forEach((b) => b.addEventListener('click', () => { this.click(); cv.difficulty = b.dataset.cdiff; this.render(); }));
    const bots = root.querySelector('#cbots');
    bots.addEventListener('input', () => { bots.nextElementSibling.textContent = bots.value; cv.bots = parseInt(bots.value, 10); });
    root.querySelector('#create-room').addEventListener('click', () => {
      this.click();
      this.setStatus('Creating room…');
      this.transport.send({
        type: 'createRoom', name: root.querySelector('#room-name').value, mode: cv.mode, map: cv.map, bots: cv.bots, difficulty: cv.difficulty,
        playerName: settings.name, loadout: [settings.primary, 'pistol'],
      });
    });
  }

  requestRooms() {
    if (this.transport) this.transport.send({ type: 'listRooms' });
  }

  onLobbyMessage(msg) {
    if (msg.type === 'lobby' || msg.type === 'rooms') {
      this.rooms = msg.rooms || [];
      if (this.tab === 'online' && this.root.style.display !== 'none') this.render();
    } else if (msg.type === 'error') {
      this.setStatus(msg.message);
    } else if (msg.type === 'welcome') {
      this.status = '';
      this.onStartOnline(this.transport, msg);
    }
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
