// DOM-based HUD: vitals, ammo, dynamic crosshair, hit markers, damage direction, kill feed, objectives per mode,
// minimap, scoreboard, death / end screens, pause & settings menu and chat.
import { TEAM, TEAM_NAMES } from '../shared/constants.js';
import { MODE_LIST } from '../shared/modes.js';
import { WEAPONS } from '../shared/weapons.js';
import { saveSettings, settings } from './settings.js';
import { RARITY } from '../shared/cosmetics.js';
import { difficultyName } from '../shared/difficulty.js';
import { camoSwatch } from './gfx/textures.js';
import { adaptiveBotLevel, rankedBotLevel, xpForLevel } from './profile.js';
import { bindSettingsControls, renderSettingsSections, touchSettingsRelevant } from './settingsui.js';
import { levelBadge, rankEmblem, showdownEmblem } from './ui/emblems.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor(root, { map, modeId, online, isHost, roomCode, palette, onLeave, onResume, onPlayAgain, onChat, onLoadout }) {
    this.root = root;
    this.map = map;
    this.modeId = modeId;
    this.mode = MODE_LIST.find((m) => m.id === modeId) || MODE_LIST[0];
    this.online = online;
    this.isHost = !!isHost;
    this.palette = palette;
    this.crossTarget = null;
    this.roomCode = roomCode || '';
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
      allyTag: $('#ally-tag', root), teamBadge: $('#team-badge', root), vitals: $('#vitals', root),
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
    this.applySettings();
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
    if (weapon) this.crosshairWeapon = weapon;
    const w = this.crosshairWeapon;
    const perWeapon = w ? (w.id === 'shotgun' ? 'circle' : w.id === 'sniper' ? 'dot' : w.id === 'smg' ? 'dotcross' : 'cross') : 'cross';
    const style = settings.crosshairStyle && settings.crosshairStyle !== 'auto' ? settings.crosshairStyle : perWeapon;
    this.el.cross.dataset.style = style;
    const targetColor = this.crossTarget === 'enemy' ? this.palette.colors.enemy : this.crossTarget === 'ally' ? this.palette.colors.ally : null;
    this.el.cross.style.setProperty('--xh-color', targetColor || settings.crosshairColor);
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
  killfeed(killer, victim, weaponId, headshot, killerColor, victimColor, highlight) {
    const w = WEAPONS[weaponId];
    const row = document.createElement('div');
    row.className = 'feed-row' + (highlight ? ' me' : '');
    const kname = killer ? `<b style="color:${killerColor}">${esc(killer)}</b> ` : '';
    row.innerHTML = `${kname}<span class="weap">[${esc(w ? w.name : 'world')}]${headshot ? ' <span class="hs">HS</span>' : ''}</span> <b style="color:${victimColor}">${esc(victim)}</b>`;
    this.el.feed.prepend(row);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
    setTimeout(() => row.classList.add('fade'), 6000);
    setTimeout(() => row.remove(), 7000);
  }

  announce(text, team) {
    const el = this.el.ann;
    el.textContent = text;
    el.style.color = team === TEAM.A || team === TEAM.B ? this.palette.team(team) : '#ffcf4a';
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
    row.innerHTML = `<b style="color:${team === TEAM.A || team === TEAM.B ? this.palette.team(team) : '#ddd'}">${esc(name)}:</b> ${esc(text)}`;
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
    const ca = this.palette.team(TEAM.A), cb = this.palette.team(TEAM.B);
    if (this._ca !== ca || this._cb !== cb) {
      this._ca = ca; this._cb = cb;
      this.root.style.setProperty('--alpha', ca);
      this.root.style.setProperty('--bravo', cb);
    }
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    let html = '';
    const phase = m.ph !== 'warmup' ? '' : m.wf
      ? `<div class="phase">WAITING FOR PLAYERS ${m.wf[0]} / ${m.wf[1]}</div>`
      : `<div class="phase">MATCH STARTS IN ${Math.ceil(m.tl)}</div>`;
    const timer = m.ph === 'live' && m.tl < 9000 ? `<div class="timer">${fmt(m.tl)}</div>` : '';
    const teamScores = (s = [0, 0], lim = 1, timerHtml = timer) => `
      <div class="scores">
        <div class="team a ${myTeam === TEAM.A ? 'mine' : ''}"><span>${s[0]}</span><div class="bar"><i style="width:${Math.min(100, (s[0] / lim) * 100)}%"></i></div></div>
        ${timerHtml || '<div class="timer"></div>'}
        <div class="team b ${myTeam === TEAM.B ? 'mine' : ''}"><div class="bar"><i style="width:${Math.min(100, (s[1] / lim) * 100)}%"></i></div><span>${s[1]}</span></div>
      </div>`;
    switch (this.modeId) {
      case 'dom':
        html = teamScores(m.s, m.lim) + `<div class="zones">${(m.z || []).map(([id, owner, progress, contested]) => {
          const capturing = owner === TEAM.NONE && Math.abs(progress) > 0.02 ? (progress < 0 ? TEAM.A : TEAM.B) : -1;
          const bg = owner !== TEAM.NONE ? this.palette.team(owner) : 'rgba(255,255,255,0.12)';
          const fill = capturing >= 0 ? `<i style="height:${Math.abs(progress) * 100}%;background:${this.palette.team(capturing)}"></i>` : '';
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
          + `<div class="round">ROUND ${round} · <span style="color:${ca}">${aliveA} alive</span> vs <span style="color:${cb}">${aliveB} alive</span>${live ? '' : ' · NEXT ROUND SOON'}</div>`;
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
      target.innerHTML = [TEAM.A, TEAM.B].map((t) => `<div class="board-team" style="border-top: 4px solid ${this.palette.team(t)}"><h3 style="color:${this.palette.team(t)}">${this.palette.teamLabel(t)}</h3>` +
        `<table>${head}${rows.filter((r) => r.team === t).sort(sortKey).map(row).join('')}</table></div>`).join('');
    } else {
      target.innerHTML = `<div class="board-team wide"><h3>PLAYERS</h3><table>${head}${rows.sort(sortKey).map(row).join('')}</table></div>`;
    }
  }

  showScoreboard(show, roster, scores, myId, teams) {
    this.el.board.style.display = show ? 'flex' : 'none';
    if (show) this.renderScoreboard(this.el.board, roster, scores, myId, teams);
  }

  /** After-action report: result, scoreboard, match grade, XP / level, Ranked SR and new unlocks. */
  showEnd(text, team, roster, scores, myId, teams, offline, report, ranked, actions = {}) {
    const el = this.el.end;
    el.style.display = 'flex';
    const result = report ? report.result : null;
    const head = result === 'win' ? 'VICTORY' : result === 'loss' ? 'DEFEAT' : result === 'draw' ? 'DRAW' : 'MATCH OVER';
    const color = team === TEAM.A || team === TEAM.B ? this.palette.team(team) : '#ffcf4a';
    el.innerHTML = `
      <div class="aar">
        <div class="aar-head ${result || ''}"><h1>${head}</h1><p style="color:${color}">${esc(text)}${ranked ? ' · RANKED' : ''}${report && report.duel ? (report.duel.kind === 'showdown' ? ' · SHOWDOWN' : ' · FRIENDLY 1V1') : ''}</p></div>
        <div class="aar-body">
          <div class="end-board"></div>
          ${report ? this.renderProgress(report, ranked) : ''}
        </div>
        <div class="end-actions">${actions.again ? `<button data-act="again">${esc(actions.again)}</button>` : ''}${actions.hint ? `<span class="hint">${esc(actions.hint)}</span>` : ''}<button data-act="leave">${esc(actions.leave || 'MAIN MENU')}</button></div>
      </div>`;
    this.renderScoreboard($('.end-board', el), roster, scores, myId, teams);
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.act === 'again' && this.callbacks.onPlayAgain) this.callbacks.onPlayAgain();
      if (b.dataset.act === 'leave' && this.callbacks.onLeave) this.callbacks.onLeave();
    }));
    // Animate the bars from their old values to the new ones.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.querySelectorAll('[data-to]').forEach((bar) => { bar.style.width = bar.dataset.to + '%'; });
    }));
  }

  renderProgress(r, ranked) {
    const need = (lvl) => xpForLevel(lvl);
    const fromPct = r.levelUps ? 0 : (r.xpBefore / need(r.levelBefore)) * 100;
    const toPct = (r.xpAfter / need(r.levelAfter)) * 100;
    let rankedHtml = '';
    if (r.ranked) {
      const rk = r.ranked;
      const span = rk.rankAfter.next ? rk.rankAfter.next - rk.rankAfter.floor : 1;
      const from = rk.rankBefore.step === rk.rankAfter.step ? ((rk.before - rk.rankAfter.floor) / span) * 100 : rk.promoted ? 0 : 100;
      const to = rk.rankAfter.next ? ((rk.after - rk.rankAfter.floor) / span) * 100 : 100;
      rankedHtml = `
        <div class="aar-rank">
          ${rankEmblem(rk.rankAfter, 76)}
          <div>
            ${rk.promoted ? '<div class="aar-flag up">PROMOTED</div>' : rk.demoted ? '<div class="aar-flag down">DEMOTED</div>' : ''}
            <b style="color:${rk.rankAfter.color}">${rk.rankAfter.name.toUpperCase()}</b>
            <span class="aar-sr ${rk.delta >= 0 ? 'up' : 'down'}">${rk.delta >= 0 ? '+' : ''}${rk.delta} SR</span>
            <div class="aar-bar"><i style="width:${Math.max(0, Math.min(100, from))}%;background:${rk.rankAfter.color}" data-to="${Math.max(0, Math.min(100, to)).toFixed(1)}"></i></div>
            <small>${rk.after} SR${rk.rankAfter.next ? ` · ${rk.rankAfter.next - rk.after} to next division` : ''}</small>
          </div>
        </div>`;
    }
    if (r.duel && r.duel.kind === 'showdown') {
      const dd = r.duel;
      rankedHtml += `
        <div class="aar-rank">
          ${showdownEmblem(dd.after, 76)}
          <div>
            ${dd.title.index > dd.titleBefore.index ? '<div class="aar-flag up">NEW TITLE</div>' : dd.title.index < dd.titleBefore.index ? '<div class="aar-flag down">TITLE LOST</div>' : ''}
            <b style="color:${dd.title.color}">${esc(dd.title.name.toUpperCase())}</b>
            <span class="aar-sr ${dd.delta >= 0 ? 'up' : 'down'}">${dd.delta >= 0 ? '+' : ''}${dd.delta} SHOWDOWN</span>
            <small>Showdown rating ${dd.after}${dd.title.next ? ` · ${dd.title.next - dd.after} to the next title` : ''} · vs ${esc(dd.opp)}</small>
          </div>
        </div>`;
    } else if (r.duel) {
      rankedHtml += `<div class="aar-skill">FRIENDLY 1V1 VS ${esc(String(r.duel.opp).toUpperCase())} · NO SHOWDOWN RATING CHANGE</div>`;
    }
    const unlocks = r.unlocks.length ? `
      <div class="aar-unlocks"><h3>UNLOCKED</h3>${r.unlocks.map((u) => `
        <div class="aar-unlock" style="--rar:${RARITY[u.item.rarity].color}">
          ${u.kind === 'camo' ? `<span class="aar-swatch" style="background-image:url(${camoSwatch(u.item.id)})"></span>` : '<span class="aar-swatch op">OP</span>'}
          <div><b>${esc(u.item.name.toUpperCase())}</b><small>${u.kind === 'camo' ? 'WEAPON CAMO' : 'OPERATOR'} · ${RARITY[u.item.rarity].name.toUpperCase()}</small></div>
        </div>`).join('')}</div>` : '';
    const next = ranked ? rankedBotLevel() : adaptiveBotLevel();
    const dSkill = r.skill.after - r.skill.before;
    return `
      <div class="aar-side">
        <div class="aar-grade-row"><span class="m-grade big g-${r.grade}">${r.grade}</span>
          <div><b>MATCH GRADE</b><small>PERFORMANCE ${Math.round(r.p * 100)}%${r.abandoned ? ' · LEFT EARLY' : ''}</small></div></div>
        ${rankedHtml}
        <div class="aar-xp">
          ${levelBadge(r.levelAfter, 46)}
          <div>
            ${r.levelUps ? `<div class="aar-flag up">LEVEL UP</div>` : ''}
            <b>LEVEL ${r.levelAfter}</b> <span class="aar-sr up">+${r.xp} XP</span>
            <div class="aar-bar"><i style="width:${fromPct.toFixed(1)}%" data-to="${toPct.toFixed(1)}"></i></div>
          </div>
        </div>
        <div class="aar-skill">SKILL ${r.skill.after.toFixed(2)} <em class="${dSkill >= 0 ? 'up' : 'down'}">${dSkill >= 0 ? '▲' : '▼'} ${Math.abs(dSkill).toFixed(2)}</em> · NEXT BOTS: ${difficultyName(next).toUpperCase()} (LV ${next.toFixed(1)})</div>
        ${unlocks}
      </div>`;
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
        <div class="row"><button data-act="resume" class="primary">RESUME</button><button data-act="leave" class="danger">${this.isHost ? 'END MATCH FOR ALL' : 'LEAVE MATCH'}</button></div>
        ${this.online ? `
        <div class="room-code">
          <span>ROOM CODE</span><b>${this.roomCode}</b><button data-act="copy">COPY</button>
        </div>
        <p class="sub">${this.isHost
          ? 'You are hosting: friends open VANGUARD.html, choose ONLINE and enter this code. Keep this tab open — the match runs in your browser.'
          : 'Online match — the game keeps running while paused.'}</p>`
          : '<p class="sub">Offline match — the game keeps running.</p>'}
        <label class="set"><span>Primary weapon (next respawn)</span><select data-k="primary" data-type="select">${primaryOptions}</select></label>
        ${renderSettingsSections({ inGame: true, open: [touchSettingsRelevant() ? 'touch' : 'mouse'] })}
      </div>`;
    bindSettingsControls(el, (k, value) => {
      if (k.startsWith('crosshair')) this.applyCrosshairStyle();
      if (k === 'showMinimap' || k === 'showFps') this.applySettings();
      if (k === 'primary' && this.callbacks.onLoadout) this.callbacks.onLoadout(value);
    });
    el.querySelector('[data-act="resume"]').addEventListener('click', () => this.callbacks.onResume && this.callbacks.onResume());
    el.querySelector('[data-act="leave"]').addEventListener('click', () => this.callbacks.onLeave && this.callbacks.onLeave());
    const copy = el.querySelector('[data-act="copy"]');
    if (copy) {
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(this.roomCode);
          copy.textContent = 'COPIED';
        } catch {
          copy.textContent = 'SELECT & COPY';
          const range = document.createRange();
          range.selectNodeContents(el.querySelector('.room-code b'));
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
        setTimeout(() => { copy.textContent = 'COPY'; }, 1500);
      });
    }
  }

  showPause(show) {
    this.el.pause.style.display = show ? 'flex' : 'none';
  }

  setNetStats(text) {
    this.el.stats.textContent = text;
  }

  /** Crosshair turns the enemy colour over an enemy, the team colour over a teammate (with their name). */
  setCrosshairTarget(kind, allyName) {
    const tagText = kind === 'ally' && allyName ? `TEAMMATE · ${allyName}` : '';
    if (kind !== this.crossTarget) {
      this.crossTarget = kind;
      this.el.cross.classList.toggle('on-enemy', kind === 'enemy');
      this.applyCrosshairStyle();
    }
    if (tagText !== this._allyTag) {
      this._allyTag = tagText;
      this.el.allyTag.textContent = tagText;
      this.el.allyTag.style.color = this.palette.colors.ally;
      this.el.allyTag.style.display = tagText ? 'block' : 'none';
    }
  }

  /** Health panel shows which team you are on, in your team colour. */
  setTeamBadge(team, teamsMode, modeId) {
    const key = team + ':' + teamsMode + ':' + this.palette.team(team) + ':' + modeId;
    if (key === this._badgeKey) return;
    this._badgeKey = key;
    const color = teamsMode ? this.palette.team(team) : this.palette.colors.ally;
    const text = !teamsMode ? 'NO TEAMS · ALL ENEMIES'
      : modeId === 'horde' ? 'YOUR SQUAD · CO-OP' : `${TEAM_NAMES[team] || ''} · YOUR TEAM`;
    this.el.teamBadge.textContent = text;
    this.el.teamBadge.style.color = color;
    this.el.vitals.style.borderLeft = `5px solid ${color}`;
  }

  /** Breath meter while aiming a scoped weapon (null hides it). */
  setBreath(state) {
    if (!this.el.breath) this.el.breath = this.root.querySelector('#breath');
    const el = this.el.breath;
    if (!state) { if (this._breathOn) { el.style.display = 'none'; this._breathOn = false; } return; }
    if (!this._breathOn) { el.style.display = 'block'; this._breathOn = true; }
    el.querySelector('i').style.width = (state.breath * 100).toFixed(0) + '%';
    el.classList.toggle('holding', state.holding);
    el.classList.toggle('recovering', state.recovering);
    el.querySelector('span').textContent = state.recovering ? 'OUT OF BREATH' : state.holding ? 'HOLDING BREATH' : 'HOLD SHIFT TO STEADY';
  }

  /** Scope view while aimed with a scoped gun: kind 'sniper' | 'dmr' | null, amount 0..1 fades it in. */
  setScope(kind, amount = 1) {
    if (!this.el.scope) this.el.scope = this.root.querySelector('#scope');
    const on = !!kind && amount > 0.01;
    const key = on ? kind + ':' + amount.toFixed(2) : '';
    if (key === this._scope) return;
    this._scope = key;
    const el = this.el.scope;
    el.style.display = on ? 'block' : 'none';
    if (!on) return;
    el.className = kind;
    el.style.opacity = amount.toFixed(2);
    // The lens opens up from slightly smaller as the eye settles behind the scope.
    el.style.setProperty('--lens-k', (0.86 + 0.14 * amount).toFixed(3));
  }

  /** Shows or hides optional HUD parts according to the settings. */
  applySettings() {
    this.el.minimap.style.display = settings.showMinimap ? '' : 'none';
    this.el.area.style.display = settings.showMinimap ? '' : 'none';
    this.el.stats.style.display = settings.showFps ? '' : 'none';
    this.applyCrosshairStyle();
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
        ctx.fillStyle = owner === TEAM.NONE ? 'rgba(255,255,255,0.8)' : this.palette.team(owner);
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(id, px, py + 4);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.beginPath(); ctx.arc(px, py, z.r * k, 0, Math.PI * 2); ctx.stroke();
      }
    }
    for (const o of others) {
      const [px, py] = project(o.x, o.z);
      ctx.fillStyle = o.color || (o.ally ? '#1e90ff' : '#ff2020');
      ctx.beginPath();
      ctx.arc(px, py, o.ally ? 4 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.stroke();
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
  <div id="ally-tag"></div>
  <div id="scope">
    <div class="lens"></div>
    <svg class="ret ret-sniper" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g fill="#050505">
        <rect x="-100" y="-0.45" width="200" height="0.9"/><rect x="-0.45" y="-100" width="0.9" height="200"/>
        <rect x="-100" y="-1.6" width="62" height="3.2"/><rect x="38" y="-1.6" width="62" height="3.2"/>
        <rect x="-1.6" y="38" width="3.2" height="62"/><rect x="-1.6" y="-100" width="3.2" height="62"/>
        ${[-30, -20, -10, 10, 20, 30].map((v) => `<circle cx="${v}" cy="0" r="1.1"/><circle cx="0" cy="${v}" r="1.1"/>`).join('')}
      </g>
      <circle cx="0" cy="0" r="0.9" fill="#ff2a1a"/>
    </svg>
    <svg class="ret ret-dmr" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g fill="none" stroke="#ff3020" stroke-width="1.6" stroke-linejoin="miter">
        <path d="M-7 8 L0 0 L7 8"/>
      </g>
      <g fill="#ff3020"><rect x="-0.6" y="9" width="1.2" height="36"/>
        ${[16, 24, 32, 40].map((y, i) => `<rect x="${-(8 - i * 1.6)}" y="${y}" width="${2 * (8 - i * 1.6)}" height="1"/>`).join('')}
      </g>
      <g fill="#050505"><rect x="-100" y="-0.5" width="72" height="1"/><rect x="28" y="-0.5" width="72" height="1"/><rect x="-0.5" y="-100" width="1" height="72"/></g>
    </svg>
  </div>
  <div id="breath"><span>HOLD SHIFT TO STEADY</span><div class="bar"><i></i></div></div>
  <div id="protect">SPAWN PROTECTION</div>
  <div id="vitals"><div id="team-badge" class="label"></div><div class="label">HEALTH</div><div id="hp-value">100</div><div class="bar"><div id="hp-fill"></div></div></div>
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
