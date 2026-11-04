// FRIENDS tab and the squad bar in the menu header (mixed into MainMenu, see menu.js).
//   left:  your friend code, add a friend, your squad, invites and challenges, requests, friends list
//   right: the selected friend's profile: online status / last seen / last played, Ranked rank, Showdown rating,
//          career stats, head-to-head, equipped and unlocked skins, and squad invite / 1v1 buttons
import { CAMOS, OUTFITS, RARITY, camoById, outfitById, rankForSr, showdownTitle } from '../../shared/cosmetics.js';
import { MAP_LIST } from '../../shared/map.js';
import { SQUAD_TEAM_SIZE } from '../../shared/modes.js';
import { camoSwatch } from '../gfx/textures.js';
import { profile } from '../profile.js';
import { FRIEND_CODE_LENGTH, MAX_SQUAD, PLAYLIST_NAMES, formatFriendCode, normalizeFriendCode, social } from '../social.js';
import { outfitArt } from './art.js';
import { levelBadge, rankEmblem, showdownEmblem } from './emblems.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : new Date(ts).toLocaleDateString();
}

function statusLine(f) {
  if (f.online) {
    if (f.st && f.st.s === 'match') return `<span class="fr-on match">IN A MATCH${f.st.d ? ' · ' + esc(f.st.d.toUpperCase()) : ''}</span>`;
    return `<span class="fr-on">ONLINE${f.st && f.st.sq > 1 ? ` · IN A SQUAD (${f.st.sq})` : ' · IN MENU'}</span>`;
  }
  return `<span class="fr-off">OFFLINE · LAST SEEN ${esc(ago(f.lastSeen).toUpperCase())}</span>`;
}

const dot = (f) => `<i class="fr-dot ${f.online ? (f.st && f.st.s === 'match' ? 'match' : 'on') : ''}"></i>`;

export const friendsTab = {
  // ------------------------------------------------------------------------------------------------
  // Squad bar (header): you + squad members + empty "+" slots
  // ------------------------------------------------------------------------------------------------
  renderSquadBar() {
    const members = social.members();
    const cap = social.squadCap();
    const leader = social.party ? social.party.leader : social.code;
    const slots = members.map((m) => `
      <div class="sq-slot ${m.c === social.code ? 'me' : ''}" title="${esc(m.n)}${m.c === leader ? ' (squad leader)' : ''}">
        ${m.c === leader && members.length > 1 ? '<em>★</em>' : ''}${levelBadge(m.lv || 1, 30)}<b>${esc(m.n)}</b></div>`).join('');
    const free = social.isLeader ? Math.max(0, Math.min(cap, MAX_SQUAD) - members.length) : 0;
    const plus = Array.from({ length: Math.min(free, 4) }, () => '<button class="sq-slot add" data-squad-add title="Invite friends to your squad">+</button>').join('');
    const label = members.length > 1 ? `SQUAD ${members.length}/${cap}` : 'SQUAD';
    return `<div class="m-squad"><small>${label}</small><div class="sq-slots">${slots}${plus}</div></div>`;
  },

  bindSquadBar() {
    this.root.querySelectorAll('[data-squad-add]').forEach((b) => b.addEventListener('click', () => {
      this.click();
      this.tab = 'friends';
      this.status = '';
      this.render();
    }));
  },

  // ------------------------------------------------------------------------------------------------
  // Friends tab
  // ------------------------------------------------------------------------------------------------
  renderFriends() {
    const friends = social.friendList();
    if (this.friendSel && !friends.some((f) => f.code === this.friendSel)) this.friendSel = null;
    const sel = friends.find((f) => f.code === this.friendSel) || null;
    const { inc, out } = social.requests();
    const online = friends.filter((f) => f.online).length;
    const state = social.state;
    return `
      <div class="m-split friends">
        <section class="m-list wide fr-col">
          <div class="fr-code">
            <div><small>YOUR FRIEND CODE</small><b id="my-friend-code">${formatFriendCode(social.code)}</b></div>
            <button class="mini" id="copy-friend-code">COPY</button>
          </div>
          <p class="m-note fr-state ${state === 'online' ? 'ok' : state === 'connecting' ? '' : 'warn'}"><i class="fr-dot ${state === 'online' ? 'on' : ''}"></i>${esc(social.stateText())}</p>
          ${state === 'online' ? '' : this.renderNetCheck()}
          <div class="m-field"><label>ADD A FRIEND</label>
            <div class="join-row fr-add"><input id="friend-code-input" maxlength="${FRIEND_CODE_LENGTH + 1}" placeholder="ABCD-2345" autocomplete="off" spellcheck="false" value="${esc(this.friendInput || '')}">
              <button class="m-start small" id="friend-add"><b>SEND</b></button></div>
            <p class="status" id="friend-status">${esc(this.friendMsg || '')}</p>
          </div>
          ${this.renderSquadPanel()}
          ${this.renderInvites()}
          ${inc.length || out.length ? `<h2 class="m-h">FRIEND REQUESTS</h2>
            ${inc.map((r) => `<div class="fr-row req"><i class="fr-dot ${r.online ? 'on' : ''}"></i><div><b>${esc(r.name)}</b><small>WANTS TO BE FRIENDS · ${formatFriendCode(r.code)} · ${esc(ago(r.ts).toUpperCase())}</small></div>
              <span class="fr-btns"><button class="mini primary" data-req-accept="${r.code}">ACCEPT</button><button class="mini" data-req-decline="${r.code}">DECLINE</button></span></div>`).join('')}
            ${out.map((r) => `<div class="fr-row req"><i class="fr-dot ${r.online ? 'on' : ''}"></i><div><b>${esc(r.name || formatFriendCode(r.code))}</b><small>REQUEST SENT ${esc(ago(r.ts).toUpperCase())} · ${r.online ? 'WAITING FOR THEM TO ACCEPT' : 'DELIVERED WHEN YOU ARE BOTH ONLINE'}</small></div>
              <span class="fr-btns"><button class="mini" data-req-cancel="${r.code}">CANCEL</button></span></div>`).join('')}` : ''}
          <h2 class="m-h">FRIENDS <span>${online} ONLINE · ${friends.length} TOTAL</span></h2>
          ${friends.length ? friends.map((f) => this.renderFriendRow(f)).join('') : '<p class="m-note">No friends yet. Send your friend code to someone, or type theirs above. When they accept, you can see each other online, compare stats and skins, squad up and 1v1.</p>'}
        </section>
        <section class="m-detail fr-detail">${sel ? this.renderFriendProfile(sel) : this.renderFriendsHelp()}</section>
      </div>`;
  },

  renderFriendRow(f) {
    const c = f.card;
    const rank = c ? rankForSr(c.rk.sr) : null;
    const canInvite = f.online && social.isLeader && !(social.party && social.party.members.some((m) => m.c === f.code));
    const invited = social.sentInvites.has(f.code);
    return `<div class="fr-row ${this.friendSel === f.code ? 'on' : ''}" data-friend="${f.code}">
      ${dot(f)}
      <div><b>${esc(f.name)}</b><small>${statusLine(f)}</small></div>
      <span class="fr-btns">
        ${rank ? `<span class="fr-rank" title="${rank.name}">${rankEmblem(rank, 30)}</span>` : ''}
        ${c ? levelBadge(c.lv || 1, 28) : ''}
        ${canInvite ? `<button class="mini ${invited ? '' : 'primary'}" data-invite="${f.code}">${invited ? 'INVITED' : 'INVITE'}</button>` : ''}
      </span></div>`;
  },

  renderSquadPanel() {
    const p = social.party;
    const members = social.members();
    const cap = social.squadCap();
    const pl = p ? p.pl : social.playlist;
    const leader = social.isLeader;
    const rows = members.map((m) => {
      const isLeader = p ? m.c === p.leader : true;
      return `<div class="fr-row sq"><span class="sq-crown">${isLeader ? '★' : ''}</span>
        <div><b>${esc(m.n)}${m.c === social.code ? ' (YOU)' : ''}</b><small>LEVEL ${m.lv} · ${esc(rankForSr(m.sr).name.toUpperCase())} · SHOWDOWN ${m.sd || 1000}</small></div>
        <span class="fr-btns">${rankEmblem(rankForSr(m.sr), 28)}${leader && m.c !== social.code ? `<button class="mini" data-kick="${m.c}">REMOVE</button>` : ''}</span></div>`;
    }).join('');
    const inMatch = p && p.room && !this.inSession;
    return `
      <h2 class="m-h">YOUR SQUAD <span>${members.length} / ${cap} · ${esc((PLAYLIST_NAMES[pl] || '').toUpperCase())}</span></h2>
      <div class="fr-squad">
        ${rows}
        <p class="m-note">${members.length > 1
          ? (leader ? `You lead this squad. Pick <b>Ranked</b> or a team mode in PLAY and press start: everyone joins your match on your team, and bots are tuned to the squad's average skill.`
            : `<b>${esc((members.find((m) => m.c === p.leader) || {}).n || 'The leader')}</b> leads this squad and starts the matches. Your game joins automatically.`)
          : `Invite online friends with <b>INVITE</b>. A squad can be as big as one team of the mode (${Object.entries(SQUAD_TEAM_SIZE).map(([k, v]) => `${PLAYLIST_NAMES[k]} ${v}`).join(', ')}).`}</p>
        <div class="m-chips">
          ${inMatch && !leader ? '<button class="primary" id="join-squad-match">JOIN SQUAD MATCH</button>' : ''}
          ${members.length > 1 ? `<button id="leave-squad" class="danger">${leader ? 'DISBAND SQUAD' : 'LEAVE SQUAD'}</button>` : ''}
        </div>
        ${social.joining ? '<p class="status">Joining the squad…</p>' : ''}
      </div>`;
  },

  renderInvites() {
    const items = social.invites.map((inv) => {
      const text = inv.kind === 'squad'
        ? `<b>${esc(inv.name)}</b><small>SQUAD INVITE · ${esc((PLAYLIST_NAMES[inv.pl] || '').toUpperCase())} · ${inv.sz}/${inv.mx}</small>`
        : `<b>${esc(inv.name)}</b><small>${inv.dk === 'showdown' ? `SHOWDOWN 1V1 (RATED) · THEIR RATING ${Math.round(inv.sr)}` : 'FRIENDLY 1V1 (NO RATING)'}${inv.map ? ' · ' + esc((MAP_LIST.find((m) => m.id === inv.map) || { name: 'RANDOM MAP' }).name.toUpperCase()) : ''}</small>`;
      return `<div class="fr-row invite"><i class="fr-dot on"></i><div>${text}</div>
        <span class="fr-btns"><button class="mini primary" data-inv-accept="${inv.kind}:${inv.id}">${inv.kind === 'squad' ? 'JOIN' : 'ACCEPT'}</button><button class="mini" data-inv-decline="${inv.kind}:${inv.id}">DECLINE</button></span></div>`;
    }).join('');
    const ch = social.challenge;
    const sent = ch ? `<div class="fr-row invite"><i class="fr-dot on"></i><div><b>${esc(ch.name)}</b><small>${ch.kind === 'showdown' ? 'SHOWDOWN' : 'FRIENDLY 1V1'} CHALLENGE SENT · WAITING FOR THEM…</small></div>
      <span class="fr-btns"><button class="mini" id="cancel-challenge">CANCEL</button></span></div>` : '';
    const waiting = social.awaitingDuel ? `<p class="status">Waiting for ${esc(social.awaitingDuel.name)} to start the 1v1…</p>` : '';
    if (!items && !sent && !waiting) return '';
    return `<h2 class="m-h">INVITES &amp; CHALLENGES</h2>${items}${sent}${waiting}`;
  },

  renderFriendsHelp() {
    const sd = profile.duel;
    const t = showdownTitle(sd.rating);
    return `
      <h1>FRIENDS</h1>
      <p class="m-desc">Give someone your friend code. When they enter it and you accept (or the other way round), you are friends.</p>
      <ul class="m-rules">
        <li><b>ONLINE</b> See who is online right now, who is in a match, and when everyone last played.</li>
        <li><b>PROFILES</b> Select a friend to see their rank, Showdown rating, stats and every skin they own.</li>
        <li><b>SQUADS</b> Invite friends to your squad and play Ranked or any team mode together, on the same team.</li>
        <li><b>SHOWDOWN</b> Challenge a friend to a rated 1v1 (its own ladder and titles) or a friendly 1v1. Every result still trains your skill rating, so your normal bots keep adapting.</li>
      </ul>
      <div class="fr-ladder">${showdownEmblem(sd.rating, 72)}<div><small>YOUR SHOWDOWN RATING</small><b style="color:${t.color}">${sd.rating} · ${esc(t.name.toUpperCase())}</b>
        <small>${sd.played} PLAYED · ${sd.wins}W ${sd.losses}L ${sd.draws}D · PEAK ${sd.peak}${t.next ? ` · ${t.next - sd.rating} TO NEXT TITLE` : ''}</small></div></div>
      ${sd.history.length ? `<div class="m-history">${sd.history.slice(0, 5).map((h) => `
        <div class="m-hist ${h.w > 0 ? 'win' : h.w < 0 ? 'loss' : 'draw'}"><span class="m-grade">${h.w > 0 ? 'W' : h.w < 0 ? 'L' : 'D'}</span><b>${esc(h.o || '?')}</b>
          <small>${h.k}-${h.de}</small><em class="${h.d >= 0 ? 'up' : 'down'}">${h.d >= 0 ? '+' : ''}${h.d}</em></div>`).join('')}</div>` : ''}
      <p class="m-note">Friends, squads and 1v1s connect your browsers directly (the free PeerJS matchmaking service is only used to find each other). Both players need the same VANGUARD.html, opened from a download (not inside a viewer that blocks connections).</p>`;
  },

  renderFriendProfile(f) {
    const c = f.card;
    const name = esc(f.name);
    const synced = !f.online && f.synced ? `<p class="m-note">Offline: showing their profile as of ${esc(ago(f.synced))}. It updates when you are both online.</p>` : '';
    const header = `
      <div class="fr-head">
        ${c ? levelBadge(c.lv || 1, 50) : ''}
        <div><h1>${name}</h1><small>${formatFriendCode(f.code)} · FRIENDS SINCE ${esc(new Date(f.since || Date.now()).toLocaleDateString())}</small></div>
      </div>
      <p class="fr-status">${dot(f)}${statusLine(f)}</p>
      <p class="m-note">Last played: <b>${esc(c && c.lp ? ago(c.lp) : 'not yet')}</b>${f.online ? '' : ` · Last seen: <b>${esc(ago(f.lastSeen))}</b>`}</p>
      ${synced}`;
    const actions = this.renderFriendActions(f);
    if (!c) return `${header}<p class="m-desc">Their stats and skins appear after you have both been online at the same time.</p>${actions}`;
    const st = c.st;
    const kd = st.d ? (st.k / st.d).toFixed(2) : st.k.toFixed(2);
    const acc = st.sh ? Math.round((st.hi / st.sh) * 100) : 0;
    const hours = st.s / 3600;
    const rank = rankForSr(c.rk.sr), peak = rankForSr(c.rk.pk);
    const sdT = showdownTitle(c.sd.r);
    const h = f.h2h || { w: 0, l: 0, d: 0 };
    const camo = camoById(c.eq.camo), outfit = outfitById(c.eq.outfit);
    const ownedCamos = CAMOS.filter((x) => c.cm.includes(x.id));
    const ownedOutfits = OUTFITS.filter((x) => c.of.includes(x.id));
    const cards = [
      ['MATCHES', st.m], ['WINS', st.w], ['K/D', kd], ['KILLS', st.k], ['HEADSHOTS', st.hs], ['ACCURACY', acc + '%'],
      ['BEST STREAK', st.bs], ['MVPS', st.mv], ['TIME PLAYED', hours >= 1 ? hours.toFixed(1) + ' H' : Math.round(st.s / 60) + ' MIN'],
      ['RANKED GAMES', c.rk.p], ['RANKED WINS', c.rk.w], ['SKILL', c.sk.toFixed(2)],
    ];
    return `${header}
      <div class="fr-ranks">
        <div>${rankEmblem(rank, 64)}<div><small>RANKED</small><b style="color:${rank.color}">${esc(rank.name.toUpperCase())}</b><small>${c.rk.sr} SR · PEAK ${esc(peak.name.toUpperCase())}</small></div></div>
        <div>${showdownEmblem(c.sd.r, 64)}<div><small>SHOWDOWN</small><b style="color:${sdT.color}">${esc(sdT.name.toUpperCase())}</b><small>${c.sd.r} · ${c.sd.w}W ${c.sd.l}L${c.sd.dr ? ` ${c.sd.dr}D` : ''}</small></div></div>
      </div>
      ${h.w + h.l + h.d ? `<p class="fr-h2h">YOU VS ${name.toUpperCase()}: <b class="up">${h.w}W</b> <b class="down">${h.l}L</b>${h.d ? ` <b>${h.d}D</b>` : ''}</p>` : ''}
      <div class="m-statgrid">${cards.map(([l, v]) => `<div><b>${v}</b><small>${l}</small></div>`).join('')}</div>
      <h2 class="m-h">EQUIPPED</h2>
      <div class="fr-equip">
        <div style="--rar:${RARITY[camo.rarity].color}"><span class="m-swatch" style="background-image:url(${camoSwatch(camo.id)})"></span><div><small>WEAPON CAMO</small><b>${esc(camo.name.toUpperCase())}</b></div></div>
        <div style="--rar:${RARITY[outfit.rarity].color}">${outfitArt(outfit)}<div><small>OPERATOR</small><b>${esc(outfit.name.toUpperCase())}</b></div></div>
      </div>
      <h2 class="m-h">SKINS <span>${ownedCamos.length}/${CAMOS.length} CAMOS · ${ownedOutfits.length}/${OUTFITS.length} OPERATORS</span></h2>
      <div class="fr-skins">${ownedCamos.map((x) => `<span class="m-swatch" title="${esc(x.name)} (${RARITY[x.rarity].name})" style="background-image:url(${camoSwatch(x.id)});border-color:${RARITY[x.rarity].color}"></span>`).join('')}</div>
      <div class="fr-skins ops">${ownedOutfits.map((x) => `<span title="${esc(x.name)}" style="border-color:${RARITY[x.rarity].color}">${outfitArt(x)}</span>`).join('')}</div>
      ${actions}`;
  },

  renderFriendActions(f) {
    const inSquad = social.party && social.party.members.some((m) => m.c === f.code);
    const why = !f.online ? 'Squad invites and 1v1s need your friend to be online.' : !f.sameVersion ? 'Your friend has a different version of VANGUARD.html. You both need the same file to play together.' : '';
    const can = f.online && f.sameVersion;
    const mapSel = this.duelMap || '';
    return `
      <h2 class="m-h">PLAY TOGETHER</h2>
      ${why ? `<p class="m-note warn">${esc(why)}</p>` : ''}
      <div class="m-chips">
        <button class="primary" id="fr-invite" ${can && social.isLeader && !inSquad ? '' : 'disabled'}>${inSquad ? 'IN YOUR SQUAD' : social.sentInvites.has(f.code) ? 'INVITE AGAIN' : 'INVITE TO SQUAD'}</button>
      </div>
      <div class="m-field"><label>1V1 MAP</label><div class="m-chips">${[['', 'RANDOM'], ...MAP_LIST.map((m) => [m.id, m.name.toUpperCase()])].map(([id, n]) => `<button class="${mapSel === id ? 'on' : ''}" data-duel-map="${id}">${n}</button>`).join('')}</div></div>
      <div class="fr-duel">
        <button class="m-start" id="fr-showdown" ${can ? '' : 'disabled'}><b>SHOWDOWN 1V1</b><small>RATED · FIRST TO 10 KILLS</small></button>
        <button class="m-start alt" id="fr-friendly" ${can ? '' : 'disabled'}><b>FRIENDLY 1V1</b><small>NO RATING CHANGE</small></button>
      </div>
      <p class="m-note">Both kinds of 1v1 also count toward your skill rating (your friend's skill stands in for the bot level), so they shape how hard your normal bots are.</p>
      <div class="m-chips"><button class="danger" id="fr-remove">REMOVE FRIEND</button></div>`;
  },

  bindFriends() {
    const root = this.root;
    const input = root.querySelector('#friend-code-input');
    const msg = (text) => { this.friendMsg = text; const el = root.querySelector('#friend-status'); if (el) el.textContent = text; };
    input.addEventListener('input', () => {
      const clean = normalizeFriendCode(input.value);
      const pretty = clean.length > 4 ? clean.slice(0, 4) + '-' + clean.slice(4) : clean;
      if (pretty !== input.value) input.value = pretty;
      this.friendInput = pretty;
    });
    const add = () => {
      this.click();
      const res = social.addFriend(input.value);
      this.friendMsg = res.message;
      if (res.ok) this.friendInput = '';
      this.render();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    root.querySelector('#friend-add').addEventListener('click', add);
    root.querySelector('#copy-friend-code').addEventListener('click', async () => {
      this.click();
      const text = formatFriendCode(social.code);
      try { await navigator.clipboard.writeText(text); msg(`Copied ${text}. Send it to a friend.`); } catch { msg(`Your code is ${text}.`); }
    });
    root.querySelectorAll('[data-friend]').forEach((row) => row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      this.click();
      this.friendSel = row.dataset.friend;
      this.confirmRemove = false;
      this.friendMsg = '';
      this.render();
    }));
    const act = (sel, fn) => root.querySelectorAll(`[${sel}]`).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.click();
      fn(b.getAttribute(sel));
    }));
    act('data-req-accept', (code) => social.acceptRequest(code));
    act('data-req-decline', (code) => social.declineRequest(code));
    act('data-req-cancel', (code) => social.cancelRequest(code));
    act('data-invite', (code) => { const r = social.inviteToSquad(code); msg(r.message); });
    act('data-kick', (code) => social.kick(code));
    const findInv = (key) => { const [kind, id] = key.split(':'); return social.invites.find((i) => i.kind === kind && i.id === id); };
    act('data-inv-accept', (key) => { const inv = findInv(key); if (inv) social.acceptInvite(inv); });
    act('data-inv-decline', (key) => { const inv = findInv(key); if (inv) social.declineInvite(inv); });
    const on = (id, fn) => { const el = root.querySelector('#' + id); if (el) el.addEventListener('click', () => { this.click(); fn(el); }); };
    on('leave-squad', () => social.leaveSquad());
    on('join-squad-match', () => this.onJoinSquadMatch && this.onJoinSquadMatch());
    on('cancel-challenge', () => social.cancelChallenge());
    const sel = this.friendSel;
    on('fr-invite', () => { const r = social.inviteToSquad(sel); msg(r.message); });
    on('fr-showdown', () => { const r = social.challengeFriend(sel, 'showdown', this.duelMap || ''); msg(r.message); });
    on('fr-friendly', () => { const r = social.challengeFriend(sel, 'friendly', this.duelMap || ''); msg(r.message); });
    root.querySelectorAll('[data-duel-map]').forEach((b) => b.addEventListener('click', () => { this.click(); this.duelMap = b.dataset.duelMap; this.render(); }));
    on('fr-remove', (el) => {
      if (!this.confirmRemove) { this.confirmRemove = true; el.textContent = 'TAP AGAIN TO REMOVE'; return; }
      this.confirmRemove = false;
      social.removeFriend(sel);
      this.friendSel = null;
      this.render();
    });
  },
};
