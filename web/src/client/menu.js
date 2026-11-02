// Main menu (Call of Duty-style): live 3D operator backdrop, top tabs, player card (level / XP / rank), playlists,
// Ranked, Online (host or join by code), Armory (camos, operators, loadout), Barracks (stats, skill, saves), Settings.
import { DIFFICULTY, GAME_TITLE, MAX_ONLINE_PLAYERS } from '../shared/constants.js';
import { CAMOS, OUTFITS, RARITY, rankForSr } from '../shared/cosmetics.js';
import { difficultyName } from '../shared/difficulty.js';
import { MAP_LIST } from '../shared/map.js';
import { MODE_LIST } from '../shared/modes.js';
import { PRIMARY_WEAPONS, WEAPONS } from '../shared/weapons.js';
import { camoSwatch } from './gfx/textures.js';
import { CODE_LENGTH, isEmbedded, normalizeCode, webrtcSupported } from './net.js';
import {
  adaptiveBotLevel, equip, experience, isCamoUnlocked, isOutfitUnlocked, levelProgress, profile, rankedBotLevel,
  replaceProfile, requirementText, resetProfile, saveProfile,
} from './profile.js';
import { saveSettings, settings } from './settings.js';
import { bindSettingsControls, renderSettingsSections, resetAllSettings } from './settingsui.js';
import { exportCode, importCode, storageStatus } from './storage.js';
import { levelBadge, rankEmblem } from './ui/emblems.js';

const camoName = (id) => (CAMOS.find((c) => c.id === id) || CAMOS[0]).name;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

/** True if this browser can create a WebGL 2 context (required by the renderer). */
export function detectWebGL2() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch {
    return false;
  }
}

const TABS = [['play', 'PLAY'], ['ranked', 'RANKED'], ['online', 'ONLINE'], ['armory', 'ARMORY'], ['barracks', 'BARRACKS'], ['settings', 'SETTINGS']];
const MODE_ART = { tdm: '⚔', dom: '⚑', ffa: '✦', gungame: '⬆', elim: '☠', horde: '⛨' };

export class MainMenu {
  constructor(root, { onStartOffline, onStartRanked, onHost, onJoin, audio, showcase }) {
    this.root = root;
    this.onStartOffline = onStartOffline;
    this.onStartRanked = onStartRanked;
    this.onHost = onHost;
    this.onJoin = onJoin;
    this.audio = audio;
    this.showcase = showcase;
    this.tab = 'play';
    this.armoryKind = 'camo';
    this.armorySel = null;
    this.status = '';
    this.busy = false;
    this.joinCode = '';
    this.webgl = detectWebGL2();
    this.render();
  }

  // ------------------------------------------------------------------------------------------------
  show(tab, status) {
    if (tab === 'offline') tab = 'play';
    if (tab) this.tab = tab;
    this.status = status || '';
    this.busy = false;
    this.root.style.display = 'flex';
    this.render();
    this.root.scrollTop = 0;
    if (this.showcase) this.showcase.start();
  }

  hide() {
    this.root.style.display = 'none';
    if (this.showcase) this.showcase.stop();
  }

  click() {
    this.audio.ensure();
    this.audio.click();
  }

  syncShowcase() {
    if (!this.showcase) return;
    let camo = profile.equipped.camo, outfit = profile.equipped.outfit;
    if (this.tab === 'armory' && this.armorySel) {
      if (this.armoryKind === 'camo') camo = this.armorySel;
      if (this.armoryKind === 'outfit') outfit = this.armorySel;
    }
    this.showcase.setLook({ camo, outfit, weapon: settings.primary });
    this.showcase.setFocus(this.tab === 'armory' && this.armoryKind === 'camo' ? 'weapon' : 'operator');
  }

  // ------------------------------------------------------------------------------------------------
  render() {
    const lp = levelProgress();
    const rank = rankForSr(profile.ranked.sr);
    this.root.innerHTML = `
      <div class="m-shade"></div>
      <div class="m-shell">
        <header class="m-top">
          <div class="m-brand">${GAME_TITLE}<small>TACTICAL OPERATIONS</small></div>
          <nav class="m-tabs">${TABS.map(([id, label]) => `<button class="m-tab ${this.tab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('')}</nav>
          <div class="m-card" data-tab="barracks" title="Your profile">
            ${levelBadge(lp.level, 44)}
            <div class="m-card-main">
              <b>${esc(settings.name)}</b>
              <div class="m-xp"><i style="width:${pct(lp.xp, lp.need)}%"></i></div>
              <small>LEVEL ${lp.level}${lp.need ? ` · ${lp.xp} / ${lp.need} XP` : ' · MAX'}</small>
            </div>
            <div class="m-card-rank">${rankEmblem(rank, 44)}<small style="color:${rank.color}">${rank.name.toUpperCase()}</small></div>
          </div>
        </header>
        ${this.renderBanner()}
        <main class="m-body">${this.renderTab()}</main>
        <footer class="m-foot"><span>${this.footerText()}</span><span class="m-ver">VANGUARD · ONE-FILE EDITION</span></footer>
      </div>`;
    this.root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      if (this.busy) return;
      this.click();
      this.tab = b.dataset.tab;
      this.status = '';
      this.armorySel = null;
      this.render();
    }));
    const binders = { play: () => this.bindPlay(), ranked: () => this.bindRanked(), online: () => this.bindOnline(), armory: () => this.bindArmory(), barracks: () => this.bindBarracks(), settings: () => this.bindSettings() };
    if (binders[this.tab]) binders[this.tab]();
    this.syncShowcase();
  }

  footerText() {
    const st = storageStatus();
    const save = st.cookies && st.local ? 'PROGRESS SAVED (COOKIES + BROWSER)' : st.cookies ? 'PROGRESS SAVED (COOKIES)' : st.local ? 'PROGRESS SAVED (BROWSER STORAGE)' : 'PROGRESS CANNOT BE SAVED IN THIS VIEWER';
    return save;
  }

  renderBanner() {
    if (!this.webgl) {
      return `<div class="m-banner"><b>3D graphics (WebGL 2) are turned off or unavailable in this browser, so matches can't start.</b>
        Turn on hardware acceleration (Chrome/Edge: Settings → System → <i>Use graphics acceleration when available</i>, then restart the browser),
        update your graphics driver, or open VANGUARD.html in another browser.</div>`;
    }
    if (this.status && this.tab !== 'online') return `<div class="m-banner">${esc(this.status)}</div>`;
    return '';
  }

  renderTab() {
    switch (this.tab) {
      case 'ranked': return this.renderRanked();
      case 'online': return this.renderOnline();
      case 'armory': return this.renderArmory();
      case 'barracks': return this.renderBarracks();
      case 'settings': return this.renderSettings();
      default: return this.renderPlay();
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Shared pieces
  // ------------------------------------------------------------------------------------------------
  difficultyField(prefix, value) {
    const adaptive = adaptiveBotLevel();
    const opts = [['adaptive', `ADAPTIVE · LV ${adaptive.toFixed(1)}`], ...Object.entries(DIFFICULTY).map(([k, d]) => [k, d.name.toUpperCase()])];
    return `<div class="m-field"><label>BOT DIFFICULTY</label><div class="m-seg">${opts.map(([k, l]) => `<button class="${value === k ? 'on' : ''}" data-${prefix}diff="${k}">${l}</button>`).join('')}</div>
      ${value === 'adaptive' ? `<p class="m-note">Bots match your skill: they are currently <b>${difficultyName(adaptive)}</b>. They get sharper as you get better and the more you play.</p>` : ''}</div>`;
  }

  mapField(prefix, value) {
    return `<div class="m-field"><label>MAP</label><div class="m-maps">${MAP_LIST.map((m) => `
      <button class="m-map ${value === m.id ? 'on' : ''} map-${m.id}" data-${prefix}map="${m.id}"><b>${m.name.toUpperCase()}</b><small>${m.size.toUpperCase()}</small></button>`).join('')}</div></div>`;
  }

  botsField(id, mode, value) {
    const max = mode === 'horde' ? 5 : 19;
    const v = Math.min(value, max);
    return `<div class="m-field"><label>${mode === 'horde' ? 'ALLIED BOTS' : 'BOTS'} <output>${v}</output></label><input type="range" min="0" max="${max}" value="${v}" id="${id}"></div>`;
  }

  weaponField() {
    return `<div class="m-field"><label>PRIMARY WEAPON</label><div class="m-chips">${PRIMARY_WEAPONS.map((id) => `<button class="${settings.primary === id ? 'on' : ''}" data-primary="${id}">${WEAPONS[id].name.toUpperCase()}</button>`).join('')}</div></div>`;
  }

  bindCommon(prefix, apply) {
    const root = this.root;
    root.querySelectorAll(`[data-${prefix}diff]`).forEach((b) => b.addEventListener('click', () => { this.click(); apply('difficulty', b.dataset[prefix + 'diff']); this.render(); }));
    root.querySelectorAll(`[data-${prefix}map]`).forEach((b) => b.addEventListener('click', () => { this.click(); apply('map', b.dataset[prefix + 'map']); this.render(); }));
    root.querySelectorAll('[data-primary]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ primary: b.dataset.primary }); this.render(); }));
  }

  // ------------------------------------------------------------------------------------------------
  // PLAY (offline vs bots)
  // ------------------------------------------------------------------------------------------------
  renderPlay() {
    const mode = MODE_LIST.find((m) => m.id === settings.mode) || MODE_LIST[0];
    return `
      <div class="m-split">
        <section class="m-list">
          <h2 class="m-h">QUICK PLAY <span>OFFLINE · VS BOTS</span></h2>
          ${MODE_LIST.map((m) => `<button class="m-row ${m.id === mode.id ? 'on' : ''}" data-omode="${m.id}">
            <i>${MODE_ART[m.id] || '•'}</i><b>${m.name.toUpperCase()}</b><small>${esc(m.description)}</small></button>`).join('')}
        </section>
        <section class="m-detail">
          <h1>${mode.name.toUpperCase()}</h1>
          <p class="m-desc">${esc(mode.description)}</p>
          ${this.mapField('o', settings.map)}
          ${this.botsField('obots', mode.id, settings.bots)}
          ${this.difficultyField('o', settings.difficulty)}
          ${this.weaponField()}
          <button class="m-start" id="start-offline" ${this.webgl ? '' : 'disabled'}><b>START MATCH</b><small>${mode.short} · ${(MAP_LIST.find((m) => m.id === settings.map) || MAP_LIST[0]).name.toUpperCase()}</small></button>
        </section>
      </div>`;
  }

  bindPlay() {
    const root = this.root;
    root.querySelectorAll('[data-omode]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ mode: b.dataset.omode }); this.render(); }));
    this.bindCommon('o', (k, v) => saveSettings({ [k]: v }));
    const bots = root.querySelector('#obots');
    bots.addEventListener('input', () => { bots.parentElement.querySelector('output').textContent = bots.value; saveSettings({ bots: parseInt(bots.value, 10) }); });
    root.querySelector('#start-offline').addEventListener('click', () => {
      this.click();
      this.onStartOffline({ mode: settings.mode, map: settings.map, bots: settings.mode === 'horde' ? Math.min(settings.bots, 5) : settings.bots, difficulty: settings.difficulty });
    });
  }

  // ------------------------------------------------------------------------------------------------
  // RANKED
  // ------------------------------------------------------------------------------------------------
  renderRanked() {
    const r = profile.ranked;
    const rank = rankForSr(r.sr);
    const peak = rankForSr(r.peak);
    const into = rank.next ? r.sr - rank.floor : 1, span = rank.next ? rank.next - rank.floor : 1;
    const level = rankedBotLevel();
    const nextCamos = CAMOS.filter((c) => c.unlock.t !== 'free' && !isCamoUnlocked(c.id))
      .map((c) => ({ c, req: requirementText(c.unlock) }))
      .sort((a, b) => b.req.have / b.req.need - a.req.have / a.req.need)
      .slice(0, 3);
    const unlocked = CAMOS.filter((c) => isCamoUnlocked(c.id)).length;
    const history = r.history.slice(0, 8);
    return `
      <div class="m-split">
        <section class="m-rank-hero">
          <div class="m-emblem">${rankEmblem(rank, 170)}</div>
          <h1 style="color:${rank.color}">${rank.name.toUpperCase()}</h1>
          <div class="m-sr"><b>${r.sr}</b> SR${rank.next ? ` · ${rank.next - r.sr} TO ${rankForSr(rank.next).name.toUpperCase()}` : ' · TOP RANK'}</div>
          <div class="m-bar"><i style="width:${pct(into, span)}%;background:${rank.color}"></i></div>
          <div class="m-stats">
            <div><b>${r.played}</b><small>PLAYED</small></div>
            <div><b>${r.wins}</b><small>WINS</small></div>
            <div><b>${r.played ? Math.round((r.wins / r.played) * 100) : 0}%</b><small>WIN RATE</small></div>
            <div><b>${r.bestStreak}</b><small>BEST STREAK</small></div>
            <div><b>${r.gradeS}</b><small>S GRADES</small></div>
            <div><b style="color:${peak.color}">${peak.name.toUpperCase()}</b><small>PEAK</small></div>
          </div>
          ${history.length ? `<h2 class="m-h">RECENT MATCHES</h2><div class="m-history">${history.map((h) => `
            <div class="m-hist ${h.w > 0 ? 'win' : h.w < 0 ? 'loss' : 'draw'}"><span class="m-grade g-${h.g}">${h.g}</span><b>${h.w > 0 ? 'WIN' : h.w < 0 ? 'LOSS' : 'DRAW'}</b>
              <small>${h.k}-${h.de}</small><em class="${h.d >= 0 ? 'up' : 'down'}">${h.d >= 0 ? '+' : ''}${h.d} SR</em></div>`).join('')}</div>` : ''}
        </section>
        <section class="m-detail">
          <h1>RANKED PLAY</h1>
          <p class="m-desc">Team Deathmatch, 5 vs 5, first team to 40 kills or 8 minutes. Random map. Your rank changes after every game based on the result <b>and how well you played</b>.</p>
          <ul class="m-rules">
            <li><b>BOTS</b> Adapt to you: currently <b>${difficultyName(level)}</b> (level ${level.toFixed(1)}). Higher ranks always face sharper bots.</li>
            <li><b>MATCH GRADE</b> S, A, B, C or D from your K/D, place in the lobby, kills per minute, win and accuracy.</li>
            <li><b>SR</b> Wins and high grades raise it, losses and low grades lower it, and your measured skill pulls it toward where you belong.</li>
            <li><b>CAMOS</b> ${unlocked} / ${CAMOS.length} weapon camos unlocked. Most are earned here.</li>
          </ul>
          ${nextCamos.length ? `<h2 class="m-h">NEXT REWARDS</h2><div class="m-rewards">${nextCamos.map(({ c, req }) => `
            <div class="m-reward"><span class="m-swatch" style="background-image:url(${camoSwatch(c.id)})"></span>
              <div><b style="color:${RARITY[c.rarity].color}">${c.name.toUpperCase()}</b><small>${esc(req.text)}</small>
              <div class="m-bar thin"><i style="width:${pct(req.have, req.need)}%"></i></div></div></div>`).join('')}</div>` : ''}
          <p class="m-note">Loadout: <b>${WEAPONS[settings.primary].name}</b> + ${WEAPONS.pistol.name} · camo <b>${esc(camoName(profile.equipped.camo))}</b>. Change them in the Armory.</p>
          <button class="m-start" id="start-ranked" ${this.webgl ? '' : 'disabled'}><b>PLAY RANKED</b><small>TEAM DEATHMATCH · 5V5</small></button>
        </section>
      </div>`;
  }

  bindRanked() {
    this.bindCommon('r', () => {});
    this.root.querySelector('#start-ranked').addEventListener('click', () => { this.click(); this.onStartRanked(); });
  }

  // ------------------------------------------------------------------------------------------------
  // ONLINE (peer-to-peer host / join)
  // ------------------------------------------------------------------------------------------------
  hostValues() {
    return { mode: settings.hostMode, map: settings.hostMap, bots: settings.hostBots, difficulty: settings.hostDifficulty };
  }

  renderOnline() {
    const v = this.hostValues();
    const mode = MODE_LIST.find((m) => m.id === v.mode) || MODE_LIST[0];
    const warn = !webrtcSupported()
      ? '<p class="m-note warn">This browser (or the page embedding this game) blocks peer-to-peer connections, so online play is unavailable here. Open VANGUARD.html directly in Chrome, Edge, Firefox or Safari.</p>'
      : isEmbedded() ? '<p class="m-note warn">This game is running inside another page or app viewer, which may block online play. If hosting or joining fails, download VANGUARD.html and open it directly in your browser.</p>' : '';
    return `
      <div class="m-split online-cols ${this.busy ? 'busy' : ''}">
        <section class="m-detail m-join">
          <h1>JOIN A MATCH</h1>
          <p class="m-desc">Enter the ${CODE_LENGTH}-character room code from the host.</p>
          <div class="join-row">
            <input id="join-code" maxlength="${CODE_LENGTH}" placeholder="CODE" autocomplete="off" spellcheck="false" value="${esc(this.joinCode)}">
            <button class="m-start small" id="join-match"><b>JOIN</b></button>
          </div>
          <p class="status" id="online-status">${esc(this.status)}</p>
          <p class="m-note">Everyone needs the same VANGUARD.html and an internet connection. Players connect directly to the host's browser; a free public matchmaking service is only used to find the host by code.</p>
          ${warn}
          ${this.weaponField()}
        </section>
        <section class="m-detail">
          <h1>HOST A MATCH</h1>
          <p class="m-desc">You get a room code to send to friends. Up to ${MAX_ONLINE_PLAYERS} players; bots fill the teams. The match runs in your browser, so keep the tab open. When you leave, it ends for everyone.</p>
          <div class="m-field"><label>MODE</label><div class="m-chips">${MODE_LIST.map((m) => `<button class="${v.mode === m.id ? 'on' : ''}" data-hmode="${m.id}">${m.name.toUpperCase()}</button>`).join('')}</div></div>
          ${this.mapField('h', v.map)}
          ${this.botsField('hbots', mode.id, v.bots)}
          ${this.difficultyField('h', v.difficulty)}
          <button class="m-start" id="host-match"><b>HOST MATCH</b><small>${mode.short} · ONLINE</small></button>
        </section>
      </div>`;
  }

  bindOnline() {
    const root = this.root;
    root.querySelectorAll('[data-hmode]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ hostMode: b.dataset.hmode }); this.render(); }));
    this.bindCommon('h', (k, val) => saveSettings({ ['host' + k[0].toUpperCase() + k.slice(1)]: val }));
    const bots = root.querySelector('#hbots');
    bots.addEventListener('input', () => { bots.parentElement.querySelector('output').textContent = bots.value; saveSettings({ hostBots: parseInt(bots.value, 10) }); });
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
  // ARMORY
  // ------------------------------------------------------------------------------------------------
  renderArmory() {
    const kind = this.armoryKind;
    const camoCount = CAMOS.filter((c) => isCamoUnlocked(c.id)).length;
    const outfitCount = OUTFITS.filter((o) => isOutfitUnlocked(o.id)).length;
    const sub = [['camo', `WEAPON CAMOS ${camoCount}/${CAMOS.length}`], ['outfit', `OPERATORS ${outfitCount}/${OUTFITS.length}`], ['loadout', 'LOADOUT']];
    let grid = '', detail = '';
    if (kind === 'loadout') {
      grid = `<div class="m-weapons">${PRIMARY_WEAPONS.map((id) => {
        const w = WEAPONS[id];
        const dps = Math.round((w.damage * w.pellets * w.rpm) / 60);
        return `<button class="m-weapon ${settings.primary === id ? 'on' : ''}" data-primary="${id}"><b>${w.name.toUpperCase()}</b>
          <div class="m-wstat"><span>DAMAGE</span><i style="width:${pct(w.damage * w.pellets, 100)}%"></i></div>
          <div class="m-wstat"><span>FIRE RATE</span><i style="width:${pct(w.rpm, 950)}%"></i></div>
          <div class="m-wstat"><span>RANGE</span><i style="width:${pct(w.falloff[1], 600)}%"></i></div>
          <small>${w.mode.toUpperCase()} · ${w.mag} RDS · ${dps} DPS</small></button>`;
      }).join('')}</div>`;
      detail = `<h1>${WEAPONS[settings.primary].name.toUpperCase()}</h1><p class="m-desc">Your primary weapon. The secondary is always the ${WEAPONS.pistol.name}. Gun Game overrides your loadout.</p>`;
    } else {
      const items = kind === 'camo' ? CAMOS : OUTFITS;
      const equipped = kind === 'camo' ? profile.equipped.camo : profile.equipped.outfit;
      const unlockedFn = kind === 'camo' ? isCamoUnlocked : isOutfitUnlocked;
      const sel = items.find((i) => i.id === this.armorySel) || items.find((i) => i.id === equipped) || items[0];
      grid = `<div class="m-grid ${kind}">${items.map((it) => {
        const open = unlockedFn(it.id);
        const rar = RARITY[it.rarity];
        const art = kind === 'camo' ? `<span class="m-swatch" style="background-image:url(${camoSwatch(it.id)})"></span>` : outfitArt(it);
        return `<button class="m-item ${open ? '' : 'locked'} ${sel.id === it.id ? 'sel' : ''}" data-item="${it.id}" style="--rar:${rar.color}">
          ${art}<b>${it.name.toUpperCase()}</b>${equipped === it.id ? '<em>EQUIPPED</em>' : ''}${open ? '' : '<span class="m-lock">🔒</span>'}</button>`;
      }).join('')}</div>`;
      const open = unlockedFn(sel.id);
      const req = requirementText(sel.unlock);
      const rar = RARITY[sel.rarity];
      detail = `
        <div class="m-rarity" style="color:${rar.color}">${rar.name.toUpperCase()} ${kind === 'camo' ? 'CAMO' : 'OPERATOR'}${sel.anim ? ' · ANIMATED' : ''}</div>
        <h1>${sel.name.toUpperCase()}</h1>
        <p class="m-desc">${sel.unlock.t === 'free' ? 'Free for everyone.' : open ? 'Unlocked: ' + esc(req.text) + '.' : 'How to unlock: ' + esc(req.text) + '.'}</p>
        ${!open ? `<div class="m-bar"><i style="width:${pct(req.have, req.need)}%"></i></div><p class="m-note">${req.have} / ${req.need}</p>` : ''}
        <button class="m-start" id="equip-item" ${open && equipped !== sel.id ? '' : 'disabled'}><b>${equipped === sel.id ? 'EQUIPPED' : open ? 'EQUIP' : 'LOCKED'}</b><small>${kind === 'camo' ? 'APPLIES TO ALL YOUR GUNS' : 'YOUR SOLDIER'}</small></button>`;
      this._armoryCurrent = sel.id;
    }
    return `
      <div class="m-split armory">
        <section class="m-list wide">
          <div class="m-subtabs">${sub.map(([id, label]) => `<button class="${kind === id ? 'on' : ''}" data-kind="${id}">${label}</button>`).join('')}</div>
          ${grid}
        </section>
        <section class="m-detail m-armory-detail">${detail}</section>
      </div>`;
  }

  bindArmory() {
    const root = this.root;
    root.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { this.click(); this.armoryKind = b.dataset.kind; this.armorySel = null; this.render(); }));
    root.querySelectorAll('[data-item]').forEach((b) => b.addEventListener('click', () => { this.click(); this.armorySel = b.dataset.item; this.render(); }));
    root.querySelectorAll('[data-primary]').forEach((b) => b.addEventListener('click', () => { this.click(); saveSettings({ primary: b.dataset.primary }); this.render(); }));
    const eq = root.querySelector('#equip-item');
    if (eq) eq.addEventListener('click', () => { this.click(); equip(this.armoryKind, this._armoryCurrent); this.render(); });
  }

  // ------------------------------------------------------------------------------------------------
  // BARRACKS
  // ------------------------------------------------------------------------------------------------
  renderBarracks() {
    const st = profile.stats;
    const kd = st.deaths ? (st.kills / st.deaths).toFixed(2) : st.kills.toFixed(2);
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
    const hours = st.seconds / 3600;
    const lp = levelProgress();
    const skill = profile.skill.rating;
    const exp = experience();
    const storage = storageStatus();
    const cards = [
      ['LEVEL', lp.level], ['MATCHES', st.matches], ['WINS', st.wins], ['K/D', kd], ['KILLS', st.kills], ['DEATHS', st.deaths],
      ['HEADSHOTS', st.headshots], ['ACCURACY', acc + '%'], ['BEST STREAK', st.bestStreak], ['MVPS', st.mvps],
      ['TIME PLAYED', hours >= 1 ? hours.toFixed(1) + ' H' : Math.round(st.seconds / 60) + ' MIN'], ['RANKED SR', profile.ranked.sr],
    ];
    return `
      <div class="m-split">
        <section class="m-list wide">
          <h2 class="m-h">CAREER</h2>
          <div class="m-statgrid">${cards.map(([l, v]) => `<div><b>${v}</b><small>${l}</small></div>`).join('')}</div>
          <h2 class="m-h">SKILL &amp; ADAPTIVE BOTS</h2>
          <div class="m-skill">
            <div><b>${skill.toFixed(2)}</b><small>SKILL RATING · ${difficultyName(skill).toUpperCase()}</small><div class="m-bar"><i style="width:${pct(skill, 4)}%"></i></div></div>
            <div><b>${Math.round(exp * 100)}%</b><small>EXPERIENCE (${hours.toFixed(1)} H PLAYED)</small><div class="m-bar"><i style="width:${exp * 100}%"></i></div></div>
            <div><b>${adaptiveBotLevel().toFixed(2)}</b><small>ADAPTIVE BOT LEVEL · ${difficultyName(adaptiveBotLevel()).toUpperCase()}</small><div class="m-bar"><i style="width:${pct(adaptiveBotLevel(), 4)}%"></i></div></div>
          </div>
          <p class="m-note">After every match your performance (K/D, place in the lobby, kills per minute, win and accuracy) is compared with what was expected against the bots you faced, and your skill rating moves up or down. Adaptive bots use your skill rating plus a little extra the more you play (Recruit 0 → Regular 1 → Veteran 2 → Elite 3 → Apex 4).</p>
        </section>
        <section class="m-detail">
          <h1>PROFILE</h1>
          <div class="m-field"><label>CALLSIGN</label><input id="m-name" maxlength="18" value="${esc(settings.name)}"></div>
          <h2 class="m-h">SAVE DATA</h2>
          <p class="m-note">Progress is saved automatically after every match: to <b>cookies</b> ${storage.cookies ? '✔' : '✖ (this browser blocks cookies for files opened from disk)'} and to <b>browser storage</b> ${storage.local ? '✔' : '✖'}.</p>
          <div class="m-field"><label>BACKUP CODE</label><textarea id="backup-code" rows="3" readonly></textarea>
            <div class="m-chips"><button id="backup-copy">COPY BACKUP CODE</button><button id="backup-load">LOAD A CODE</button><button id="backup-reset" class="danger">RESET PROGRESS</button></div>
            <p class="m-note" id="backup-status">Copy this code to move your progress to another browser or device.</p></div>
        </section>
      </div>`;
  }

  bindBarracks() {
    const root = this.root;
    root.querySelector('#m-name').addEventListener('change', (e) => { saveSettings({ name: e.target.value.trim().slice(0, 18) || settings.name }); this.render(); });
    const box = root.querySelector('#backup-code');
    const status = root.querySelector('#backup-status');
    box.value = exportCode(profile);
    root.querySelector('#backup-copy').addEventListener('click', async () => {
      this.click();
      box.removeAttribute('readonly');
      box.select();
      try { await navigator.clipboard.writeText(box.value); status.textContent = 'Copied. Paste it into LOAD A CODE on another device.'; } catch { status.textContent = 'Select the code above and copy it.'; }
      box.setAttribute('readonly', '');
    });
    root.querySelector('#backup-load').addEventListener('click', () => {
      this.click();
      if (box.hasAttribute('readonly')) {
        box.removeAttribute('readonly');
        box.value = '';
        box.focus();
        status.textContent = 'Paste a backup code into the box, then press LOAD A CODE again.';
        return;
      }
      try {
        replaceProfile(importCode(box.value));
        this.render();
      } catch (err) {
        status.textContent = err.message || 'That code could not be read.';
      }
    });
    root.querySelector('#backup-reset').addEventListener('click', () => {
      this.click();
      const btn = root.querySelector('#backup-reset');
      if (btn.dataset.confirm) { resetProfile(); saveProfile(); this.render(); return; }
      btn.dataset.confirm = '1';
      btn.textContent = 'TAP AGAIN TO ERASE EVERYTHING';
    });
  }

  // ------------------------------------------------------------------------------------------------
  // SETTINGS
  // ------------------------------------------------------------------------------------------------
  renderSettings() {
    return `
      <div class="settings-page">
        <div class="set-cards">${renderSettingsSections()}</div>
        <div class="set-actions"><button class="mini" id="reset-settings">RESET SETTINGS TO DEFAULTS</button>
          <span class="m-note">Your callsign, loadout, match setup and progress are kept.</span></div>
        ${CONTROLS_HTML}
      </div>`;
  }

  bindSettings() {
    bindSettingsControls(this.root);
    this.root.querySelector('#reset-settings').addEventListener('click', () => { this.click(); resetAllSettings(); this.render(); });
  }
}

/** Small flat portrait for an operator outfit (the 3D preview shows the real model). */
function outfitArt(o) {
  const l = o.look;
  const head = { helmet: '<path d="M22 20 Q32 6 42 20 Z" fill="#7d8a99"/>', cap: '<rect x="22" y="12" width="20" height="8" rx="3" fill="#7d8a99"/><rect x="18" y="18" width="14" height="3" fill="#7d8a99"/>',
    beret: '<ellipse cx="33" cy="15" rx="12" ry="5" fill="#7d8a99"/>', boonie: '<rect x="23" y="11" width="18" height="8" fill="#7d8a99"/><rect x="15" y="18" width="34" height="3" fill="#7d8a99"/>',
    hood: '<path d="M19 30 Q19 8 32 8 Q45 8 45 30 Z" fill="#7d8a99"/>' }[l.head] || '';
  return `<svg class="m-outfit" viewBox="0 0 64 64">
    <rect x="18" y="34" width="28" height="30" rx="5" fill="#5d6b79"/>
    <rect x="22" y="38" width="20" height="16" rx="3" fill="${l.vest}"/>
    ${l.pads ? `<rect x="12" y="34" width="10" height="6" rx="2" fill="${l.pads}"/><rect x="42" y="34" width="10" height="6" rx="2" fill="${l.pads}"/>` : ''}
    <circle cx="32" cy="23" r="9" fill="${l.mask || '#8a6a55'}"/>
    ${head}
    <rect x="25" y="${l.bigVisor ? 19 : 21}" width="14" height="${l.bigVisor ? 6 : 3}" rx="1.5" fill="${l.shades ? '#0c0c0e' : l.visor}"/>
    ${l.skull ? '<rect x="27" y="26" width="10" height="4" fill="#e6e2d8"/>' : ''}
    ${l.trim ? `<rect x="22" y="38" width="20" height="2" fill="${l.trim}"/>` : ''}
  </svg>`;
}

const CONTROLS_HTML = `
  <section class="set-card controls">
    <h3>CONTROLS</h3>
    <table>
      <tr><td>Move / sprint / jump / crouch</td><td>W A S D · Shift · Space · Ctrl or C</td></tr>
      <tr><td>Fire / aim down sights</td><td>Left mouse / right mouse</td></tr>
      <tr><td>Reload / switch weapon</td><td>R · 1 2, Q E or mouse wheel</td></tr>
      <tr><td>Scoreboard / chat / pause</td><td>Tab · T or Enter · Esc</td></tr>
      <tr><td>Touch: move / look</td><td>Drag on the left (push far forward to sprint) / drag on the right</td></tr>
      <tr><td>Touch: fire / aim</td><td>FIRE (drag to aim while shooting) · hold AIM (drag it to look around)</td></tr>
      <tr><td>Touch: other</td><td>JUMP · CROUCH · RELOAD · tap the ammo panel to switch weapon · ☰ scoreboard · II pause</td></tr>
    </table>
  </section>`;
