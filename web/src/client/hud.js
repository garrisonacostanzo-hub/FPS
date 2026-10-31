// DOM-based HUD: vitals, ammo, dynamic crosshair, hit markers, damage direction, kill feed, objectives per mode,
// minimap, scoreboard, death / end screens, pause & settings menu and chat.
import { TEAM, TEAM_COLORS, TEAM_NAMES } from '../shared/constants.js';
import { MODE_LIST } from '../shared/modes.js';
import { WEAPONS } from '../shared/weapons.js';
import { saveSettings, settings } from './settings.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor(root, { map, modeId, online, onLeave, onResume, onPlayAgain, onChat, onLoadout }) {
    this.root = root;
    this.map = map;
    this.modeId = modeId;
    this.mode = MODE_LIST.find((m) => m.id === modeId) || MODE_LIST[0];
    this.online = online;
    this.callbacks = { onLeave, onResume, onPlayAgain, onChat, onLoadout };
    this.root.innerHTML = TEMPLATE;
    this.root.classList.add('active');
    this.el = {
      hp: $('#hp-value', root), hpFill: $('#hp-fill', root), vignette: $('#vignette', root),
      mag: $('#ammo-mag', root), reserve: $('#ammo-reserve', root), weapon: $('#weapon-name', root), slots: $('#weapon-slots', root),
      reload: $('#reload-bar', root), reloadFill: $('#reload-fill', root),
      cross: $('#crosshair', root), hit: $('#hitmarker', root), dmg: $('#damage-ring', root),
      feed: $('#killfeed', root), ann: $('#announce', root), status: $('#status', root),
      death: $('#death', root), deathText: $('#death-text', root), deathTimer: $('#death-timer', root),
      board: $('#scoreboard', root), end: $('#endscreen', root), pause: $('#pause', root),
      minimap: $('#minimap', root), stats: $('#netstats', root), chat: $('#chat-log', root), chatInput: $('#chat-input', root),
      protect: $('#protect', root), area: $('#area', root), streak: $('#streak', root),
    };
    this.feed = [];
    this.hitTimer = null;
    this.reloadAnim = null;
    this.buildMinimap();
    this.buildPause();
    this.el.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.el.chatInput.value.trim();
        if (text && this.callbacks.onChat) this.callbacks.onChat(text);
        this.closeChat();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        this.closeChat();
      }
      e.stopPropagation();
    });
    this.applyCrosshairStyle();
  }

  destroy() {
    this.root.innerHTML = '';
    this.root.classList.remove('active');
  }

  // ------------------------------------------------------------------------------------------------
  // Vitals & weapon
  // ------------------------------------------------------------------------------------------------
  setHealth(hp, max = 100) {
    const f = Math.max(0, Math.min(1, hp / max));
    this.el.hp.textContent = Math.ceil(hp);
    this.el.hpFill.style.width = (f * 100).toFixed(1) + '%';
    this.el.hpFill.style.background = f > 0.5 ? '#5ef08c' : f > 0.25 ? '#ffd24a' : '#ff4a3d';
    this.el.vignette.style.opacity = hp > 0 ? Math.max(0, (0.45 - f) * 1.6).toFixed(2) : 0;
  }

  setAmmo(ws) {
    const slot = ws.slots[ws.active];
    if (!slot) return;
    const w = WEAPONS[slot.id];
    this.el.mag.textContent = slot.mag;
    this.el.mag.classList.toggle('low', slot.mag <= Math.ceil(w.mag * 0.25));
    this.el.reserve.textContent = slot.reserve;
    const mode = w.mode === 'auto' ? 'AUTO' : 'SEMI';
    const key = slot.id + ws.active;
    if (this._weaponKey !== key) {
      this._weaponKey = key;
      this.el.weapon.innerHTML = `${esc(w.name.toUpperCase())} <span class="accent">${mode}</span>`;
      this.el.slots.innerHTML = ws.slots.map((s, i) => `<span class="${i === ws.active ? 'on' : ''}">${i + 1} ${esc(WEAPONS[s.id].name.split(' ')[0])}</span>`).join('');
      this.applyCrosshairStyle(w);
    }
  }

  showReload(duration) {
    this.el.reload.classList.add('on');
    this.el.reloadFill.style.transition = 'none';
    this.el.reloadFill.style.width = '0%';
    void this.el.reloadFill.offsetWidth;
    this.el.reloadFill.style.transition = `width ${duration}s linear`;
    this.el.reloadFill.style.width = '100%';
    clearTimeout(this.reloadAnim);
    this.reloadAnim = setTimeout(() => this.el.reload.classList.remove('on'), duration * 1000);
  }

  hideReload() {
    this.el.reload.classList.remove('on');
  }

  applyCrosshairStyle(weapon) {
    const style = weapon ? (weapon.id === 'shotgun' ? 'circle' : weapon.id === 'sniper' ? 'dot' : weapon.id === 'smg' ? 'dotcross' : 'cross') : 'cross';
    this.el.cross.dataset.style = style;
    this.el.cross.style.setProperty('--xh-color', settings.crosshairColor);
    this.el.cross.style.setProperty('--xh-scale', settings.crosshairSize);
  }

  /** gapPx: spread converted to screen pixels; aim 0..1 hides the crosshair while aiming down sights. */
  setCrosshair(gapPx, aim, visible) {
    const gap = Math.max(3, gapPx);
    this.el.cross.style.setProperty('--gap', gap.toFixed(1) + 'px');
    this.el.cross.style.opacity = visible ? Math.max(0, 1 - aim * 1.4).toFixed(2) : 0;
  }

  hitmarker(headshot, kill) {
    const el = this.el.hit;
    el.className = 'hitmarker show' + (kill ? ' kill' : headshot ? ' head' : '');
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => { el.className = 'hitmarker'; }, kill ? 350 : 180);
  }

  damageIndicator(angle) {
    const arc = document.createElement('div');
    arc.className = 'dmg-arc';
    arc.style.transform = `rotate(${angle}rad)`;
    this.el.dmg.appendChild(arc);
    setTimeout(() => arc.remove(), 1200);
  }

  setProtected(on) {
    this.el.protect.style.display = on ? 'block' : 'none';
  }

  setArea(name) {
    if (this._area !== name) { this._area = name; this.el.area.textContent = name || ''; }
  }

  // ------------------------------------------------------------------------------------------------
  // Feed & announcements
  // ------------------------------------------------------------------------------------------------
  killfeed(killer, victim, weaponId, headshot, killerTeam, victimTeam, highlight) {
    const w = WEAPONS[weaponId];
    const row = document.createElement('div');
    row.className = 'feed-row' + (highlight ? ' me' : '');
    const kname = killer ? `<b style="color:${TEAM_COLORS[killerTeam]}">${esc(killer)}</b> ` : '';
    row.innerHTML = `${kname}<span class="weap">[${esc(w ? w.name : 'world')}]${headshot ? ' <span class="hs">HS</span>' : ''}</span> <b style="color:${TEAM_COLORS[victimTeam]}">${esc(victim)}</b>`;
    this.el.feed.prepend(row);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
    setTimeout(() => row.classList.add('fade'), 6000);
    setTimeout(() => row.remove(), 7000);
  }

  announce(text, team) {
    const el = this.el.ann;
    el.textContent = text;
    el.style.color = team === TEAM.A || team === TEAM.B ? TEAM_COLORS[team] : '#ffcf4a';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  streak(count) {
    if (count < 3) return;
    const names = { 3: 'KILLING SPREE', 5: 'RAMPAGE', 7: 'UNSTOPPABLE', 10: 'GODLIKE' };
    const label = names[count] || (count > 10 && count % 5 === 0 ? `${count} KILL STREAK` : null);
    if (!label) return;
    this.el.streak.textContent = label;
    this.el.streak.classList.remove('show');
    void this.el.streak.offsetWidth;
    this.el.streak.classList.add('show');
  }

  chatMessage(name, text, team) {
    const row = document.createElement('div');
    row.innerHTML = `<b style="color:${TEAM_COLORS[team] || '#ddd'}">${esc(name)}:</b> ${esc(text)}`;
    this.el.chat.appendChild(row);
    while (this.el.chat.children.length > 6) this.el.chat.firstChild.remove();
    setTimeout(() => row.classList.add('fade'), 9000);
  }

  openChat() {
    this.el.chatInput.style.display = 'block';
    this.el.chatInput.value = '';
    this.el.chatInput.focus();
    this.chatOpen = true;
  }

  closeChat() {
    this.el.chatInput.blur();
    this.el.chatInput.style.display = 'none';
    this.chatOpen = false;
    if (this.callbacks.onResume) this.callbacks.onResume();
  }

  // ------------------------------------------------------------------------------------------------
  // Mode status (top centre)
  // ------------------------------------------------------------------------------------------------
  setStatus(m, myTeam, myId, roster) {
    if (!m) return;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    let html = '';
    const phase = m.ph === 'warmup' ? `<div class="phase">MATCH STARTS IN ${Math.ceil(m.tl)}</div>` : '';
    const timer = m.ph === 'live' && m.tl < 9000 ? `<div class="timer">${fmt(m.tl)}</div>` : '';
    const teamScores = (s, lim, timerHtml = timer) => `
      <div class="scores">
        <div class="team a ${myTeam === TEAM.A ? 'mine' : ''}"><span>${s[0]}</span><div class="bar"><i style="width:${Math.min(100, (s[0] / lim) * 100)}%"></i></div></div>
        ${timerHtml || '<div class="timer"></div>'}
        <div class="team b ${myTeam === TEAM.B ? 'mine' : ''}"><div class="bar"><i style="width:${Math.min(100, (s[1] / lim) * 100)}%"></i></div><span>${s[1]}</span></div>
      </div>`;
    switch (this.modeId) {
      case 'dom':
        html = teamScores(m.s, m.lim) + `<div class="zones">${(m.z || []).map(([id, owner, progress, contested]) => {
          const capturing = owner === TEAM.NONE && Math.abs(progress) > 0.02 ? (progress < 0 ? TEAM.A : TEAM.B) : -1;
          const bg = owner !== TEAM.NONE ? TEAM_COLORS[owner] : 'rgba(255,255,255,0.12)';
          const fill = capturing >= 0 ? `<i style="height:${Math.abs(progress) * 100}%;background:${TEAM_COLORS[capturing]}"></i>` : '';
          return `<div class="zone ${contested ? 'contested' : ''}" style="background:${bg}">${fill}<span>${id}</span></div>`;
        }).join('')}</div>`;
        break;
      case 'ffa':
      case 'gungame': {
        const leader = m.ld ? `${esc(m.ld[1])} — ${m.ld[2]}` : '—';
        const me = roster.get(myId);
        const label = this.modeId === 'gungame' ? 'LADDER' : 'KILLS';
        const mine = this.modeId === 'gungame' && m.ladder && me ? ` · YOUR WEAPON: ${esc(WEAPONS[m.ladder[Math.min(me.tier || 0, m.ladder.length - 1)]].name)}` : '';
        html = `<div class="ffa">${timer}<div class="leader">LEADER: ${leader} <small>/ ${m.lim} ${label}</small>${mine}</div></div>`;
        break;
      }
      case 'elim': {
        const [round, t, aliveA, aliveB, live] = m.rd || [1, 0, 0, 0, 0];
        html = teamScores(m.s, m.lim, `<div class="timer">${fmt(t)}</div>`)
          + `<div class="round">ROUND ${round} · <span style="color:${TEAM_COLORS[0]}">${aliveA} alive</span> vs <span style="color:${TEAM_COLORS[1]}">${aliveB} alive</span>${live ? '' : ' · NEXT ROUND SOON'}</div>`;
        break;
      }
      case 'horde': {
        const [wave, remaining, live, next] = m.wv || [0, 0, 0, 0];
        html = `<div class="ffa"><div class="leader">WAVE ${wave} / ${m.lim} · ${live ? `${remaining} HOSTILES REMAINING` : `NEXT WAVE IN ${Math.ceil(next)}`}</div></div>`;
        break;
      }
      default:
        html = teamScores(m.s, m.lim);
    }
    this.el.status.innerHTML = `<div class="mode-name">${esc(this.mode.name)}</div>${phase}${html}`;
  }

  // ------------------------------------------------------------------------------------------------
  // Death / scoreboard / end
  // ------------------------------------------------------------------------------------------------
  showDeath(killerName, weaponId, respawnIn) {
    this.el.death.style.display = 'flex';
    const w = WEAPONS[weaponId];
    this.el.deathText.innerHTML = killerName ? `Killed by <b>${esc(killerName)}</b> <small>${esc(w ? w.name : '')}</small>` : 'You died';
    this.respawnAt = respawnIn >= 0 ? performance.now() + respawnIn * 1000 : -1;
    this.updateDeathTimer();
  }

  updateDeathTimer() {
    if (this.el.death.style.display !== 'flex') return;
    if (this.respawnAt < 0) {
      this.el.deathTimer.textContent = this.modeId === 'elim' ? 'Waiting for the next round…' : this.modeId === 'horde' ? 'You will respawn when the wave is cleared' : 'Spectating';
    } else {
      this.el.deathTimer.textContent = 'Respawning in ' + Math.max(0, (this.respawnAt - performance.now()) / 1000).toFixed(1) + 's';
    }
  }

  hideDeath() {
    this.el.death.style.display = 'none';
  }

  renderScoreboard(target, roster, scores, myId, teams) {
    const rows = [...roster.values()].map((r) => ({ ...r, ...(scores.get(r.id) || { kills: 0, deaths: 0, score: 0, tier: 0, ping: 0 }) }));
    const sortKey = this.modeId === 'gungame' ? (a, b) => b.tier - a.tier || b.kills - a.kills : (a, b) => b.score - a.score || b.kills - a.kills;
    const row = (r) => `<tr class="${r.id === myId ? 'me' : ''}"><td>${r.isBot ? '<span class="bot">BOT</span>' : ''}${esc(r.name)}</td>` +
      `<td>${r.kills}</td><td>${r.deaths}</td><td>${this.modeId === 'gungame' ? r.tier : r.score}</td><td>${r.isBot ? '—' : r.ping}</td></tr>`;
    const head = `<tr><th>NAME</th><th>K</th><th>D</th><th>${this.modeId === 'gungame' ? 'TIER' : 'SCORE'}</th><th>PING</th></tr>`;
    if (teams) {
      target.innerHTML = [TEAM.A, TEAM.B].map((t) => `<div class="board-team"><h3 style="color:${TEAM_COLORS[t]}">${TEAM_NAMES[t]}</h3>` +
        `<table>${head}${rows.filter((r) => r.team === t).sort(sortKey).map(row).join('')}</table></div>`).join('');
    } else {
      target.innerHTML = `<div class="board-team wide"><h3>PLAYERS</h3><table>${head}${rows.sort(sortKey).map(row).join('')}</table></div>`;
    }
  }

  showScoreboard(show, roster, scores, myId, teams) {
    this.el.board.style.display = show ? 'flex' : 'none';
    if (show) this.renderScoreboard(this.el.board, roster, scores, myId, teams);
  }

  showEnd(text, team, roster, scores, myId, teams, offline) {
    const el = this.el.end;
    el.style.display = 'flex';
    el.innerHTML = `<h1 style="color:${team === TEAM.A || team === TEAM.B ? TEAM_COLORS[team] : '#ffcf4a'}">${esc(text)}</h1><div class="end-board"></div>
      <div class="end-actions">${offline ? '<button data-act="again">PLAY AGAIN</button>' : '<span class="hint">Next match starts automatically…</span>'}<button data-act="leave">MAIN MENU</button></div>`;
    this.renderScoreboard($('.end-board', el), roster, scores, myId, teams);
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.act === 'again' && this.callbacks.onPlayAgain) this.callbacks.onPlayAgain();
      if (b.dataset.act === 'leave' && this.callbacks.onLeave) this.callbacks.onLeave();
    }));
  }

  hideEnd() {
    this.el.end.style.display = 'none';
  }

  // ------------------------------------------------------------------------------------------------
  // Pause / settings
  // ------------------------------------------------------------------------------------------------
  buildPause() {
    const el = this.el.pause;
    const primaryOptions = ['rifle', 'smg', 'shotgun', 'lmg', 'dmr', 'sniper'].map((id) => `<option value="${id}" ${settings.primary === id ? 'selected' : ''}>${WEAPONS[id].name}</option>`).join('');
    el.innerHTML = `
      <div class="panel">
        <h2>PAUSED</h2>
        <p class="sub">${this.online ? 'Online match — the game keeps running.' : 'Offline match — the game keeps running.'}</p>
        <label>Mouse sensitivity <input type="range" min="0.1" max="4" step="0.05" data-k="sensitivity" value="${settings.sensitivity}"><output></output></label>
        <label>Aim sensitivity <input type="range" min="0.2" max="1.5" step="0.05" data-k="adsSensitivity" value="${settings.adsSensitivity}"><output></output></label>
        <label>Field of view <input type="range" min="60" max="110" step="1" data-k="fov" value="${settings.fov}"><output></output></label>
        <label>Volume <input type="range" min="0" max="1" step="0.05" data-k="volume" value="${settings.volume}"><output></output></label>
        <label>Crosshair colour <input type="color" data-k="crosshairColor" value="${settings.crosshairColor}"></label>
        <label>Crosshair size <input type="range" min="0.6" max="1.8" step="0.1" data-k="crosshairSize" value="${settings.crosshairSize}"><output></output></label>
        <label>Primary weapon (next respawn) <select data-k="primary">${primaryOptions}</select></label>
        <label class="check"><input type="checkbox" data-k="invertY" ${settings.invertY ? 'checked' : ''}> Invert mouse Y</label>
        <label class="check"><input type="checkbox" data-k="toggleCrouch" ${settings.toggleCrouch ? 'checked' : ''}> Toggle crouch</label>
        <label class="check"><input type="checkbox" data-k="toggleAim" ${settings.toggleAim ? 'checked' : ''}> Toggle aim</label>
        <div class="row"><button data-act="resume" class="primary">RESUME</button><button data-act="leave" class="danger">LEAVE MATCH</button></div>
      </div>`;
    el.querySelectorAll('input, select').forEach((input) => {
      const out = input.parentElement.querySelector('output');
      const show = () => { if (out) out.textContent = input.value; };
      show();
      input.addEventListener('input', () => {
        const k = input.dataset.k;
        const value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? parseFloat(input.value) : input.value;
        saveSettings({ [k]: value });
        show();
        if (k.startsWith('crosshair')) this.applyCrosshairStyle();
        if (k === 'primary' && this.callbacks.onLoadout) this.callbacks.onLoadout(value);
      });
    });
    el.querySelector('[data-act="resume"]').addEventListener('click', () => this.callbacks.onResume && this.callbacks.onResume());
    el.querySelector('[data-act="leave"]').addEventListener('click', () => this.callbacks.onLeave && this.callbacks.onLeave());
  }

  showPause(show) {
    this.el.pause.style.display = show ? 'flex' : 'none';
  }

  setNetStats(text) {
    this.el.stats.textContent = text;
  }

  // ------------------------------------------------------------------------------------------------
  // Minimap
  // ------------------------------------------------------------------------------------------------
  buildMinimap() {
    const map = this.map;
    const scale = 3; // px per metre in the static layer
    const size = Math.ceil(map.half * 2 * scale);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#1b2026';
    g.fillRect(0, 0, size, size);
    const sorted = [...map.boxes].sort((a, b) => a.max[1] - b.max[1]);
    for (const b of sorted) {
      if (b.m === 'boundary') continue;
      const h = b.max[1];
      const shade = Math.min(1, 0.25 + h / 7);
      g.fillStyle = b.m === 'floor' ? 'rgba(120,125,135,0.35)' : `rgba(${Math.round(150 * shade + 40)},${Math.round(155 * shade + 40)},${Math.round(165 * shade + 45)},0.95)`;
      g.fillRect((b.min[0] + map.half) * scale, (b.min[2] + map.half) * scale, (b.max[0] - b.min[0]) * scale, (b.max[2] - b.min[2]) * scale);
    }
    this.miniStatic = c;
    this.miniScale = scale;
    this.miniCtx = this.el.minimap.getContext('2d');
  }

  drawMinimap(me, others, zones, myTeam, showZones) {
    const ctx = this.miniCtx;
    const W = this.el.minimap.width, H = this.el.minimap.height;
    const range = 45; // metres shown from centre to edge
    const k = W / 2 / range;
    const s = this.miniScale;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#11151a';
    ctx.fillRect(0, 0, W, H);
    // Rotate so the player's view direction is up.
    ctx.translate(W / 2, H / 2);
    ctx.rotate(me.yaw);
    ctx.scale(k / s, k / s);
    ctx.drawImage(this.miniStatic, -(me.x + this.map.half) * s, -(me.z + this.map.half) * s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const project = (x, z) => {
      const dx = (x - me.x) * k, dz = (z - me.z) * k;
      const c = Math.cos(me.yaw), sn = Math.sin(me.yaw);
      return [W / 2 + dx * c - dz * sn, H / 2 + dx * sn + dz * c];
    };
    if (showZones) {
      for (const [id, owner] of zones) {
        const z = this.map.zones.find((q) => q.id === id);
        if (!z) continue;
        const [px, py] = project(z.x, z.z);
        ctx.fillStyle = owner === TEAM.NONE ? 'rgba(255,255,255,0.8)' : TEAM_COLORS[owner];
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(id, px, py + 4);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.beginPath(); ctx.arc(px, py, z.r * k, 0, Math.PI * 2); ctx.stroke();
      }
    }
    for (const o of others) {
      const [px, py] = project(o.x, o.z);
      ctx.fillStyle = o.ally ? '#5ef08c' : '#ff3b30';
      ctx.beginPath();
      ctx.arc(px, py, o.ally ? 3.5 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Player arrow (always pointing up).
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(W / 2, H / 2 - 7);
    ctx.lineTo(W / 2 - 5, H / 2 + 5);
    ctx.lineTo(W / 2 + 5, H / 2 + 5);
    ctx.closePath();
    ctx.fill();
  }
}

const TEMPLATE = `
  <div id="vignette"></div>
  <div id="damage-ring"></div>
  <canvas id="minimap" width="180" height="180"></canvas>
  <div id="area"></div>
  <div id="status"></div>
  <div id="killfeed"></div>
  <div id="announce"></div>
  <div id="streak"></div>
  <div id="crosshair" data-style="cross"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="dot"></i><i class="ring"></i></div>
  <div id="hitmarker" class="hitmarker"><i></i><i></i><i></i><i></i></div>
  <div id="protect">SPAWN PROTECTION</div>
  <div id="vitals"><div class="label">HEALTH</div><div id="hp-value">100</div><div class="bar"><div id="hp-fill"></div></div></div>
  <div id="ammo"><div id="weapon-name"></div><div class="count"><span id="ammo-mag">30</span><span class="sep">/</span><span id="ammo-reserve">120</span></div><div id="weapon-slots"></div></div>
  <div id="reload-bar"><div id="reload-fill"></div><span>RELOADING</span></div>
  <div id="death"><div id="death-text"></div><div id="death-timer"></div></div>
  <div id="scoreboard"></div>
  <div id="endscreen"></div>
  <div id="pause"></div>
  <div id="chat-log"></div>
  <input id="chat-input" maxlength="120" placeholder="Say something… (Enter to send)">
  <div id="netstats"></div>
`;
