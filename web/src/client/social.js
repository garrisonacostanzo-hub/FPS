// Friends, online presence, squads and 1v1 challenges. All peer-to-peer: there is no game server.
//
// FRIEND CODE. Every player gets a permanent 8-character code. While the game is open, the browser registers the id
// "vanguard-fps-u-<CODE>" with the free PeerJS matchmaking service, so friends' games can find it, then friends'
// browsers talk directly over a WebRTC data channel (a "link"). Over a link they exchange:
//   hi    relationship, name, profile card (level, rank, Showdown rating, stats, skins, last played) and status
//   card  an updated profile card (after every match)
//   st    status: in the menu or in a match (and which), squad size
// A friend is ONLINE while a link to them is open. When it closes their "last seen" time is stored, and the last card
// received stays cached (shown with a "last synced" time) until both are online again.
//
// FRIEND REQUESTS. Entering a code stores an outgoing request. It is delivered as soon as both players are online
// (the 'hi' says rel:'out'); the other player accepts (both become friends) or declines.
//
// SQUADS. The leader invites online friends; members join the leader. The squad can be as big as one team of the
// selected mode. The leader's browser hosts the squad's match (an ordinary online room) and sends the room code to
// the members, whose games join automatically. Everyone in the squad plays on the same team.
//
// 1V1. A challenge is either a SHOWDOWN (rated: its own ladder, see profile.js) or a FRIENDLY (no rating). When it is
// accepted the challenger hosts a 1v1 room and the other game joins it automatically.
import { PROTOCOL_VERSION } from '../shared/constants.js';
import { SHOWDOWN_START, sanitizeCamo, sanitizeOutfit } from '../shared/cosmetics.js';
import { SQUAD_TEAM_SIZE } from '../shared/modes.js';
import { ID_PREFIX, createPeer, watchPolicy, webrtcSupported } from './net.js';
import { onProfileChanged, profile, profileCard } from './profile.js';
import { settings } from './settings.js';
import { loadData, saveData } from './storage.js';

const KEY = 'vg_social';
const SOCIAL_VERSION = 1;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const FRIEND_CODE_LENGTH = 8;
const PRESENCE_PREFIX = ID_PREFIX + 'u-';
const TICK = 3000;
const PING_EVERY = 8000;            // keep-alive on each link
const STALE_AFTER = 26000;          // a link that stays silent this long is dead
const POLL_EVERY = 30000;           // look for offline friends coming online
const CONNECT_TIMEOUT = 20000;
const INVITE_TTL = 90000;           // squad invites and 1v1 challenges expire
const MAX_FRIENDS = 100;
export const MAX_SQUAD = Math.max(...Object.values(SQUAD_TEAM_SIZE));

export const PLAYLIST_NAMES = { ranked: 'Ranked TDM', tdm: 'Team Deathmatch', dom: 'Domination', elim: 'Elimination', horde: 'Horde (Co-op)' };

// ------------------------------------------------------------------------------------------------
// Codes and sanitising (everything received from another browser is treated as untrusted)
// ------------------------------------------------------------------------------------------------
export function normalizeFriendCode(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, FRIEND_CODE_LENGTH);
}

export function formatFriendCode(code) {
  return code ? code.slice(0, 4) + '-' + code.slice(4) : '';
}

const validCode = (c) => typeof c === 'string' && c.length === FRIEND_CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch));

function randomString(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

const cleanName = (n) => String(n || '').replace(/[^\w \-]/g, '').trim().slice(0, 18) || 'Player';
const num = (v, max = 1e9) => { const x = Number(v); return Number.isFinite(x) ? Math.max(0, Math.min(max, x)) : 0; };
const idList = (a, max) => (Array.isArray(a) ? a.slice(0, max).map((x) => String(x).slice(0, 24)) : []);

function sanitizeCard(c) {
  if (!c || typeof c !== 'object') return null;
  const st = c.st || {}, rk = c.rk || {}, sd = c.sd || {}, eq = c.eq || {};
  return {
    lv: num(c.lv, 100) | 0,
    st: { m: num(st.m), w: num(st.w), l: num(st.l), k: num(st.k), d: num(st.d), hs: num(st.hs), sh: num(st.sh), hi: num(st.hi), s: num(st.s), bs: num(st.bs), mv: num(st.mv) },
    rk: { sr: num(rk.sr, 1e6), pk: num(rk.pk, 1e6), p: num(rk.p), w: num(rk.w), l: num(rk.l) },
    sd: { r: num(sd.r, 1e5) || SHOWDOWN_START, pk: num(sd.pk, 1e5) || SHOWDOWN_START, p: num(sd.p), w: num(sd.w), l: num(sd.l), dr: num(sd.dr) },
    sk: num(c.sk, 4), al: num(c.al, 4), rl: num(c.rl, 4),
    eq: { camo: sanitizeCamo(eq.camo), outfit: sanitizeOutfit(eq.outfit) },
    cm: idList(c.cm, 80), of: idList(c.of, 40),
    lp: num(c.lp, 9e15),
  };
}

function sanitizeStatus(s) {
  if (!s || typeof s !== 'object') return { s: 'menu', d: '', sq: 1 };
  return { s: s.s === 'match' ? 'match' : 'menu', d: String(s.d || '').slice(0, 40), sq: Math.max(1, Math.min(8, s.sq | 0)) };
}

function sanitizeMember(m, code) {
  const x = m && typeof m === 'object' ? m : {};
  const eq = x.eq || {};
  return {
    c: code || (validCode(x.c) ? x.c : ''), n: cleanName(x.n), lv: num(x.lv, 100) | 0, sr: num(x.sr, 1e6) | 0, sd: num(x.sd, 1e5) | 0,
    al: num(x.al, 4), rl: num(x.rl, 4), eq: { camo: sanitizeCamo(eq.camo), outfit: sanitizeOutfit(eq.outfit) },
  };
}

// ------------------------------------------------------------------------------------------------
// Saved data
// ------------------------------------------------------------------------------------------------
function freshData() {
  return { v: 1, ts: 0, code: '', friends: {}, out: {}, inc: {}, declined: {} };
}

function loadSocialData() {
  const data = Object.assign(freshData(), loadData(KEY) || {});
  for (const k of ['friends', 'out', 'inc', 'declined']) if (!data[k] || typeof data[k] !== 'object' || Array.isArray(data[k])) data[k] = {};
  for (const [code, f] of Object.entries(data.friends)) {
    if (!validCode(code) || !f || typeof f !== 'object') { delete data.friends[code]; continue; }
    f.h2h = f.h2h && typeof f.h2h === 'object' ? f.h2h : { w: 0, l: 0, d: 0 };
  }
  if (!validCode(data.code)) data.code = randomString(FRIEND_CODE_LENGTH);
  return data;
}

// ------------------------------------------------------------------------------------------------
// The social hub
// ------------------------------------------------------------------------------------------------
class Social {
  constructor() {
    this.data = loadSocialData();
    if (!this.data.ts) this.save(true);
    this.peer = null;
    this.state = 'off';             // off | connecting | online | reconnecting | taken | blocked | unsupported | error
    this.retryAt = 0;
    this.retryDelay = 5000;
    this.nextPoll = 0;
    this.links = new Map();         // code -> link (open WebRTC data channel to that player)
    this.pending = new Map();       // code -> { conn, started } outgoing connection attempts
    this.party = null;              // null = solo; else { id, leader, members: [member], pl, room, label }
    this.joining = null;            // { pid, leader, since } while a squad join is in flight
    this.invites = [];              // received: { id, kind: 'squad' | 'duel', from, name, ..., expires }
    this.sentInvites = new Map();   // code -> time a squad invite was sent (UI shows "INVITED")
    this.challenge = null;          // sent 1v1 challenge { id, to, name, kind, map, expires }
    this.awaitingDuel = null;       // accepted challenge, waiting for the room: { id, from, name, kind, sr, sk }
    this.status = { s: 'menu', d: '' };
    this.playlist = 'ranked';       // squad leader's selected playlist (decides the squad size limit)
    this.listeners = new Set();
    this.handlers = {};             // set by main.js: toast(t), hostDuel(duel) -> Promise<room>, joinRoom(info), inMatch()
    this.saveTimer = null;
    this.cardTimer = null;
  }

  get code() { return this.data.code; }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  changed() { for (const fn of this.listeners) { try { fn(); } catch (err) { console.error(err); } } }

  toast(t) { if (this.handlers.toast) this.handlers.toast(t); }

  save(now) {
    clearTimeout(this.saveTimer);
    const write = () => { this.data.ts = Date.now(); saveData(KEY, this.data); };
    if (now) write(); else this.saveTimer = setTimeout(write, 400);
  }

  /** Data included in the profile backup code, so the friend code and list move with it. */
  exportData() { return { code: this.data.code, friends: this.data.friends, out: this.data.out }; }

  importData(d) {
    if (!d || typeof d !== 'object' || !validCode(d.code)) return;
    const fresh = Object.assign(freshData(), { code: d.code, friends: d.friends || {}, out: d.out || {} });
    this.data = fresh;
    this.save(true);
    this.restartPresence();
  }

  // ==============================================================================================
  // Presence (the always-on peer that friends connect to)
  // ==============================================================================================
  start() {
    if (this.started) return;
    this.started = true;
    if (!webrtcSupported()) { this.setState('unsupported'); return; }
    this.connectPresence();
    this.timer = setInterval(() => this.tick(), TICK);
    onProfileChanged(() => this.cardChanged());
    const bye = () => this.goodbye();
    window.addEventListener('pagehide', bye);
    window.addEventListener('beforeunload', bye);
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.changed();
  }

  /** Short explanation of the presence state for the Friends screen. */
  stateText() {
    switch (this.state) {
      case 'online': return 'Online: friends can see you and send you requests and invites.';
      case 'connecting': return 'Connecting to the matchmaking service…';
      case 'reconnecting': return 'Connection to the matchmaking service lost. Reconnecting… (friends already connected stay connected)';
      case 'taken': return 'Your friend code is already online in another tab or on another device. Close it to use friends here (retrying).';
      case 'blocked': return 'This page is open inside a viewer that blocks online connections. Download VANGUARD.html and open it in your browser to use friends.';
      case 'unsupported': return 'This browser does not support peer-to-peer connections (WebRTC), so friends are unavailable.';
      case 'error': return 'Could not reach the matchmaking service. Check your internet connection (retrying).';
      default: return 'Offline.';
    }
  }

  get online() { return this.state === 'online' || this.state === 'reconnecting'; }

  connectPresence() {
    if (this.state === 'blocked' || this.state === 'unsupported') return;
    if (this.peer && !this.peer.destroyed) return;
    this.setState('connecting');
    let peer = null;
    const unwatch = watchPolicy(() => {
      this.setState('blocked');
      this.retryAt = Infinity;
      if (peer && !peer.destroyed) peer.destroy();
    });
    try {
      peer = createPeer(PRESENCE_PREFIX + this.data.code);
    } catch {
      unwatch();
      this.setState('error');
      this.scheduleRetry();
      return;
    }
    this.peer = peer;
    peer.on('open', () => {
      if (this.peer !== peer) return;
      unwatch();
      this.retryDelay = 5000;
      this.setState('online');
      this.nextPoll = 0;
      this.tick();
    });
    peer.on('connection', (conn) => { if (this.peer === peer) this.incoming(conn); });
    peer.on('disconnected', () => {
      if (this.peer !== peer || peer.destroyed) return;
      if (this.state === 'online') this.setState('reconnecting');
      this.scheduleRetry();
    });
    peer.on('close', () => {
      if (this.peer !== peer) return;
      this.peer = null;
      if (this.state !== 'taken' && this.state !== 'blocked') { this.setState('error'); this.scheduleRetry(); }
    });
    peer.on('error', (err) => this.peerError(peer, err));
  }

  scheduleRetry(delay) {
    this.retryAt = Date.now() + (delay || this.retryDelay);
    this.retryDelay = Math.min(60000, this.retryDelay * 2);
  }

  peerError(peer, err) {
    if (this.peer !== peer) return;
    const type = err && err.type;
    if (type === 'peer-unavailable') {
      // "Could not connect to peer <id>": that player is offline.
      const m = /(\S+)\s*$/.exec(String((err && err.message) || ''));
      const id = m ? m[1] : '';
      if (id.startsWith(PRESENCE_PREFIX)) this.attemptFailed(id.slice(PRESENCE_PREFIX.length));
      return;
    }
    if (type === 'unavailable-id') {
      this.peer = null;
      this.setState('taken');
      try { peer.destroy(); } catch { /* ignore */ }
      this.retryAt = Date.now() + 30000;
      return;
    }
    if (peer.destroyed) {
      this.peer = null;
      if (this.state !== 'blocked') { this.setState('error'); this.scheduleRetry(); }
    }
  }

  restartPresence() {
    for (const link of [...this.links.values()]) this.dropLink(link);
    for (const att of this.pending.values()) { try { att.conn.close(); } catch { /* ignore */ } }
    this.pending.clear();
    if (this.peer && !this.peer.destroyed) { try { this.peer.destroy(); } catch { /* ignore */ } }
    this.peer = null;
    this.party = null;
    this.state = 'off';
    if (this.started) this.connectPresence();
    this.changed();
  }

  tick() {
    const now = Date.now();
    // Presence peer health: (re)connect with back-off.
    const p = this.peer;
    if (this.state !== 'blocked' && this.state !== 'unsupported' && now >= this.retryAt) {
      if (!p || p.destroyed) { this.peer = null; this.connectPresence(); }
      else if (p.disconnected) { this.scheduleRetry(); try { p.reconnect(); } catch { /* retried later */ } }
    }
    // Links: keep-alive and dead-link detection.
    for (const link of [...this.links.values()]) {
      if (now - link.lastHeard > STALE_AFTER) { this.dropLink(link); continue; }
      if (now - link.lastPing > PING_EVERY) { link.lastPing = now; this.send(link, { t: 'pi' }); }
    }
    for (const [code, att] of [...this.pending]) {
      if (now - att.started > CONNECT_TIMEOUT) { this.pending.delete(code); try { att.conn.close(); } catch { /* ignore */ } }
    }
    // Look for friends (and players we sent requests to) who are not connected yet.
    if (this.peer && this.peer.open && now >= this.nextPoll) {
      this.nextPoll = now + POLL_EVERY;
      for (const code of new Set([...Object.keys(this.data.friends), ...Object.keys(this.data.out)])) this.connectTo(code);
    }
    // Expire invites and challenges.
    const before = this.invites.length;
    this.invites = this.invites.filter((i) => i.expires > now);
    if (this.challenge && this.challenge.expires <= now) { this.challenge = null; this.changed(); }
    if (this.awaitingDuel && now - this.awaitingDuel.since > 45000) { this.awaitingDuel = null; this.changed(); }
    if (this.joining && now - this.joining.since > 20000) { this.joining = null; this.toast({ text: 'Could not join the squad: the leader did not answer.' }); this.changed(); }
    for (const [code, t] of this.sentInvites) if (now - t > INVITE_TTL) this.sentInvites.delete(code);
    if (this.invites.length !== before) this.changed();
  }

  goodbye() {
    if (this.party) this.leaveSquad(true);
    for (const link of this.links.values()) this.send(link, { t: 'bye' });
  }

  // ==============================================================================================
  // Links
  // ==============================================================================================
  connectTo(code) {
    if (!validCode(code) || code === this.data.code) return;
    if (!this.peer || !this.peer.open || this.links.has(code) || this.pending.has(code)) return;
    let conn;
    try {
      conn = this.peer.connect(PRESENCE_PREFIX + code, { reliable: true, serialization: 'json' });
    } catch {
      return;
    }
    if (!conn) return;
    this.pending.set(code, { conn, started: Date.now() });
    this.bindConn(conn, code, this.data.code);
  }

  attemptFailed(code) {
    const att = this.pending.get(code);
    if (!att) return;
    this.pending.delete(code);
    try { att.conn.close(); } catch { /* ignore */ }
  }

  incoming(conn) {
    const id = String(conn.peer || '');
    const code = id.startsWith(PRESENCE_PREFIX) ? id.slice(PRESENCE_PREFIX.length) : '';
    if (!validCode(code) || code === this.data.code) { try { conn.close(); } catch { /* ignore */ } return; }
    this.bindConn(conn, code, code);
  }

  bindConn(conn, code, initiator) {
    const now = Date.now();
    const link = { conn, code, initiator, open: false, ready: false, dead: false, lastHeard: now, lastPing: now, st: null, pv: 0, name: '' };
    conn.on('open', () => {
      const att = this.pending.get(code);
      if (att && att.conn === conn) this.pending.delete(code);
      link.open = true;
      link.lastHeard = Date.now();
      this.adopt(link);
      const pc = conn.peerConnection;
      if (pc && pc.addEventListener) {
        pc.addEventListener('connectionstatechange', () => {
          if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.linkClosed(link);
        });
      }
    });
    conn.on('data', (msg) => this.receive(link, msg));
    conn.on('close', () => this.linkClosed(link));
    conn.on('error', () => this.linkClosed(link));
  }

  /** Both players may connect to each other at once: keep the link started by the smaller code (both sides agree). */
  adopt(link) {
    const cur = this.links.get(link.code);
    if (cur && cur !== link) {
      const fresh = cur.open && !cur.dead && Date.now() - cur.lastHeard < 15000;
      const min = this.data.code < link.code ? this.data.code : link.code;
      const keepCur = fresh && (cur.initiator === min || link.initiator !== min);
      const drop = keepCur ? link : cur;
      drop.dead = true;
      try { drop.conn.close(); } catch { /* ignore */ }
      if (keepCur) return;
    }
    this.links.set(link.code, link);
    this.sendHi(link);
  }

  linkClosed(link) {
    if (link.dead) return;
    link.dead = true;
    if (this.links.get(link.code) !== link) return;
    this.links.delete(link.code);
    this.lostPlayer(link.code, link);
  }

  dropLink(link) {
    if (!link.dead) {
      link.dead = true;
      if (this.links.get(link.code) === link) { this.links.delete(link.code); this.lostPlayer(link.code, link); }
    }
    try { link.conn.close(); } catch { /* ignore */ }
  }

  /** A player went offline (or the link died): update last seen, squad and challenges. */
  lostPlayer(code, link) {
    const f = this.data.friends[code];
    if (f && link.ready) { f.lastSeen = Date.now(); this.save(); }
    if (this.party) {
      if (this.isLeader && this.party.members.some((m) => m.c === code)) {
        const m = this.party.members.find((x) => x.c === code);
        this.removeMember(code);
        this.toast({ text: `${m.n} disconnected from your squad.` });
      } else if (!this.isLeader && this.party.leader === code) {
        this.party = null;
        this.toast({ text: 'Lost the connection to your squad leader. You are now solo.' });
        this.statusChanged();
      }
    }
    if (this.challenge && this.challenge.to === code) this.challenge = null;
    if (this.awaitingDuel && this.awaitingDuel.from === code) this.awaitingDuel = null;
    this.invites = this.invites.filter((i) => i.from !== code);
    this.changed();
  }

  send(link, msg) {
    if (!link || link.dead || !link.open) return false;
    try { link.conn.send(msg); return true; } catch { return false; }
  }

  readyLink(code) {
    const link = this.links.get(code);
    return link && link.ready && !link.dead ? link : null;
  }

  isOnline(code) { return !!this.readyLink(code); }

  /** My relationship with a code: friend | out (I asked them) | inc (they asked me) | none. */
  relOf(code) {
    if (this.data.friends[code]) return 'friend';
    if (this.data.out[code]) return 'out';
    if (this.data.inc[code]) return 'inc';
    return 'none';
  }

  myName() { return cleanName(settings.name); }

  myCard() { return profileCard(); }

  sendHi(link) {
    const rel = this.relOf(link.code);
    const share = rel === 'friend' || rel === 'out';
    this.send(link, { t: 'hi', v: SOCIAL_VERSION, pv: PROTOCOL_VERSION, n: this.myName(), rel, card: share ? this.myCard() : null, st: this.statusMsg() });
  }

  // ==============================================================================================
  // Messages
  // ==============================================================================================
  receive(link, msg) {
    if (link.dead || !msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    link.lastHeard = Date.now();
    if (msg.t === 'hi') { this.onHi(link, msg); return; }
    if (msg.t === 'pi') return;
    if (msg.t === 'bye') { this.dropLink(link); return; }
    if (!link.ready) return;
    const code = link.code;
    const friend = this.data.friends[code];
    switch (msg.t) {
      case 'card':
        if (friend) { friend.card = sanitizeCard(msg.card); friend.synced = Date.now(); this.memberCardUpdated(code, friend); this.save(); this.changed(); }
        return;
      case 'st':
        link.st = sanitizeStatus(msg.st);
        this.changed();
        return;
      case 'acc': this.onAccepted(link, msg); return;
      case 'dec':
        if (this.data.out[code]) {
          delete this.data.out[code];
          this.save();
          this.toast({ text: `${link.name || formatFriendCode(code)} declined your friend request.` });
          this.closeIfStranger(link);
          this.changed();
        }
        return;
      case 'cx':
        if (this.data.inc[code]) { delete this.data.inc[code]; this.save(); this.closeIfStranger(link); this.changed(); }
        return;
      case 'rm':
        if (friend) { delete this.data.friends[code]; this.save(); this.closeIfStranger(link); this.changed(); }
        return;
      default:
        break;
    }
    if (!friend) return; // squads and challenges are for friends only
    switch (msg.t) {
      case 'pinv': this.onSquadInvite(link, msg); return;
      case 'pjoin': this.onSquadJoin(link, msg); return;
      case 'pno':
        this.sentInvites.delete(code);
        this.toast({ text: `${friend.name} declined your squad invite.` });
        this.changed();
        return;
      case 'pfull':
        if (this.joining && this.joining.pid === msg.pid) { this.joining = null; this.toast({ text: 'That squad is already full.' }); this.changed(); }
        return;
      case 'pgone':
        if (this.joining && this.joining.pid === msg.pid) { this.joining = null; this.toast({ text: 'That squad no longer exists.' }); this.changed(); }
        return;
      case 'pst': this.onSquadState(link, msg); return;
      case 'pleave': this.onSquadLeave(link, msg); return;
      case 'pkick':
        if (this.party && this.party.id === msg.pid && this.party.leader === code) {
          this.party = null;
          this.toast({ text: `${friend.name} removed you from the squad.` });
          this.statusChanged();
          this.changed();
        }
        return;
      case 'pend':
        if (this.party && this.party.id === msg.pid && this.party.leader === code) {
          this.party = null;
          this.toast({ text: `${friend.name} disbanded the squad.` });
          this.statusChanged();
          this.changed();
        }
        return;
      case 'pgo':
        if (this.party && this.party.id === msg.pid && this.party.leader === code && typeof msg.room === 'string') {
          this.party.room = msg.room.slice(0, 8);
          this.party.label = String(msg.label || '').slice(0, 40);
          this.changed();
          if (this.handlers.joinRoom) this.handlers.joinRoom({ room: this.party.room, squad: true, label: this.party.label, leader: friend.name });
        }
        return;
      case 'dinv': this.onChallenge(link, msg); return;
      case 'dacc': this.onChallengeAccepted(link, msg); return;
      case 'dno':
        if (this.challenge && this.challenge.id === msg.id) { this.challenge = null; this.toast({ text: `${friend.name} declined your 1v1 challenge.` }); this.changed(); }
        return;
      case 'dcan':
        this.invites = this.invites.filter((i) => !(i.kind === 'duel' && i.id === msg.id));
        if (this.awaitingDuel && this.awaitingDuel.id === msg.id) {
          this.awaitingDuel = null;
          this.toast({ text: msg.reason ? String(msg.reason).slice(0, 120) : `${friend.name} cancelled the 1v1.` });
        }
        this.changed();
        return;
      case 'dgo':
        if (this.awaitingDuel && this.awaitingDuel.id === msg.id && typeof msg.room === 'string') {
          const a = this.awaitingDuel;
          this.awaitingDuel = null;
          this.changed();
          if (this.handlers.joinRoom) {
            this.handlers.joinRoom({
              room: msg.room.slice(0, 8),
              duel: { kind: a.kind, host: false, opp: { code, name: friend.name, sr: a.sr, sk: a.sk } },
            });
          }
        }
        return;
      default:
        return;
    }
  }

  onHi(link, msg) {
    const code = link.code;
    const wasReady = link.ready;
    link.ready = true;
    link.pv = msg.pv | 0;
    link.name = cleanName(msg.n);
    link.st = sanitizeStatus(msg.st);
    const card = sanitizeCard(msg.card);
    const theirs = ['friend', 'out', 'inc', 'none'].includes(msg.rel) ? msg.rel : 'none';
    const mine = this.relOf(code);
    const now = Date.now();
    const d = this.data;
    const makeFriend = () => {
      delete d.out[code];
      const req = d.inc[code];
      delete d.inc[code];
      if (!d.friends[code]) d.friends[code] = { name: link.name, since: now, lastSeen: now, synced: 0, card: null, h2h: { w: 0, l: 0, d: 0 } };
      if (req && req.card && !card) d.friends[code].card = req.card;
    };
    let accepted = false;
    if (mine === 'friend') {
      if (theirs === 'none') {
        // They removed us while we were offline.
        delete d.friends[code];
      } else if (theirs === 'out' || theirs === 'inc') {
        this.send(link, { t: 'acc', n: this.myName(), card: this.myCard(), st: this.statusMsg() });
      }
    } else if (mine === 'out') {
      if (theirs === 'friend' || theirs === 'out') {
        makeFriend();
        accepted = true;
        if (theirs === 'out') this.send(link, { t: 'acc', n: this.myName(), card: this.myCard(), st: this.statusMsg() });
      }
    } else if (mine === 'inc') {
      if (theirs === 'friend') makeFriend();
      else if (theirs === 'none' || theirs === 'inc') delete d.inc[code];
      else d.inc[code] = { ...d.inc[code], name: link.name, card: card || d.inc[code].card, ts: d.inc[code].ts || now };
    } else if (theirs === 'out') {
      // A new friend request.
      const declinedAt = d.declined[code];
      if (declinedAt && now - declinedAt < 30 * 864e5) {
        this.send(link, { t: 'dec' });
      } else if (Object.keys(d.inc).length < 50) {
        d.inc[code] = { name: link.name, card, ts: now };
        this.toast({
          id: 'req-' + code, title: 'FRIEND REQUEST', text: `${link.name} (${formatFriendCode(code)}) wants to be friends.`, ttl: 30000,
          actions: [{ label: 'ACCEPT', primary: true, fn: () => this.acceptRequest(code) }, { label: 'DECLINE', fn: () => this.declineRequest(code) }],
        });
      }
    } else if (theirs === 'friend') {
      this.send(link, { t: 'rm' });
    }
    const f = d.friends[code];
    if (f) {
      f.name = link.name;
      f.lastSeen = now;
      if (card) { f.card = card; f.synced = now; this.memberCardUpdated(code, f); }
      if (accepted) this.toast({ text: `${link.name} accepted your friend request. You are now friends.` });
      // Our hi went out before the relationship settled: send the card now that we are friends.
      if (mine !== 'friend' && !wasReady) this.send(link, { t: 'card', card: this.myCard() });
    }
    this.save();
    this.closeIfStranger(link);
    this.changed();
  }

  onAccepted(link, msg) {
    const code = link.code;
    const d = this.data;
    if (!d.out[code] && !d.inc[code] && !d.friends[code]) return;
    const isNew = !d.friends[code];
    delete d.out[code];
    delete d.inc[code];
    const now = Date.now();
    const f = d.friends[code] || { since: now, h2h: { w: 0, l: 0, d: 0 } };
    f.name = cleanName(msg.n || link.name);
    f.lastSeen = now;
    const card = sanitizeCard(msg.card);
    if (card) { f.card = card; f.synced = now; }
    d.friends[code] = f;
    if (msg.st) link.st = sanitizeStatus(msg.st);
    if (isNew) {
      this.toast({ text: `${f.name} accepted your friend request. You are now friends.` });
      this.send(link, { t: 'card', card: this.myCard() });
    }
    this.save();
    this.changed();
  }

  closeIfStranger(link) {
    if (this.relOf(link.code) !== 'none') return;
    setTimeout(() => { if (this.relOf(link.code) === 'none') this.dropLink(link); }, 1500);
  }

  // ==============================================================================================
  // Friends
  // ==============================================================================================
  /** Sends a friend request to a code. Returns { ok, message }. */
  addFriend(text) {
    const code = normalizeFriendCode(text);
    const d = this.data;
    if (!validCode(code)) return { ok: false, message: `Friend codes are ${FRIEND_CODE_LENGTH} letters and numbers, like ${formatFriendCode('ABCD2345')}.` };
    if (code === d.code) return { ok: false, message: 'That is your own code. Give it to a friend so they can add you.' };
    if (d.friends[code]) return { ok: false, message: `${d.friends[code].name} is already your friend.` };
    if (d.inc[code]) { this.acceptRequest(code); return { ok: true, message: `${d.friends[code] ? d.friends[code].name : 'They'} had already asked you, so you are now friends.` }; }
    if (Object.keys(d.friends).length >= MAX_FRIENDS) return { ok: false, message: `Your friends list is full (${MAX_FRIENDS}).` };
    if (d.out[code]) return { ok: true, message: `Request to ${formatFriendCode(code)} is already pending.` };
    d.out[code] = { ts: Date.now() };
    delete d.declined[code];
    this.save();
    const link = this.readyLink(code);
    if (link) this.sendHi(link);
    else this.connectTo(code);
    this.changed();
    const where = this.online ? 'They will see it as soon as they are online.' : 'It will be sent once you are both online.';
    return { ok: true, message: `Friend request sent to ${formatFriendCode(code)}. ${where}` };
  }

  acceptRequest(code) {
    const d = this.data;
    const req = d.inc[code];
    if (!req) return;
    delete d.inc[code];
    const now = Date.now();
    const link = this.readyLink(code);
    d.friends[code] = { name: req.name || 'Player', since: now, lastSeen: link ? now : req.ts || now, synced: req.card ? req.ts || now : 0, card: req.card || null, h2h: { w: 0, l: 0, d: 0 } };
    this.save();
    if (link) this.send(link, { t: 'acc', n: this.myName(), card: this.myCard(), st: this.statusMsg() });
    else this.connectTo(code);
    this.changed();
  }

  declineRequest(code) {
    const d = this.data;
    if (!d.inc[code]) return;
    delete d.inc[code];
    d.declined[code] = Date.now();
    const keys = Object.keys(d.declined);
    if (keys.length > 60) for (const k of keys.sort((a, b) => d.declined[a] - d.declined[b]).slice(0, keys.length - 60)) delete d.declined[k];
    this.save();
    const link = this.readyLink(code);
    if (link) { this.send(link, { t: 'dec' }); this.closeIfStranger(link); }
    this.changed();
  }

  cancelRequest(code) {
    if (!this.data.out[code]) return;
    delete this.data.out[code];
    this.save();
    const link = this.readyLink(code);
    if (link) { this.send(link, { t: 'cx' }); this.closeIfStranger(link); }
    this.changed();
  }

  removeFriend(code) {
    if (!this.data.friends[code]) return;
    delete this.data.friends[code];
    this.save();
    const link = this.readyLink(code);
    if (link) { this.send(link, { t: 'rm' }); this.closeIfStranger(link); }
    if (this.party && this.isLeader && this.party.members.some((m) => m.c === code)) this.kick(code);
    this.changed();
  }

  /** Friends for the UI: online ones first (menu before in-match), then by last seen. */
  friendList() {
    const list = Object.entries(this.data.friends).map(([code, f]) => {
      const link = this.readyLink(code);
      return {
        code, name: f.name, card: f.card, since: f.since, lastSeen: link ? Date.now() : f.lastSeen || 0, synced: f.synced || 0, h2h: f.h2h || { w: 0, l: 0, d: 0 },
        online: !!link, st: link ? link.st : null, sameVersion: !!link && link.pv === PROTOCOL_VERSION,
      };
    });
    const rank = (f) => (f.online ? (f.st && f.st.s === 'match' ? 1 : 0) : 2);
    return list.sort((a, b) => rank(a) - rank(b) || b.lastSeen - a.lastSeen || a.name.localeCompare(b.name));
  }

  requests() {
    const inc = Object.entries(this.data.inc).map(([code, r]) => ({ code, name: r.name, ts: r.ts, card: r.card, online: this.isOnline(code) }));
    const out = Object.entries(this.data.out).map(([code, r]) => ({ code, ts: r.ts, online: this.isOnline(code), name: (this.links.get(code) || {}).name || '' }));
    return { inc, out };
  }

  /** Number shown on the FRIENDS tab badge. */
  attentionCount() {
    return Object.keys(this.data.inc).length + this.invites.length;
  }

  recordDuelResult(code, result) {
    const f = this.data.friends[code];
    if (!f) return;
    f.h2h = f.h2h || { w: 0, l: 0, d: 0 };
    if (result === 'win') f.h2h.w++; else if (result === 'loss') f.h2h.l++; else f.h2h.d++;
    this.save();
  }

  // ==============================================================================================
  // Status and cards
  // ==============================================================================================
  statusMsg() {
    return { s: this.status.s, d: this.status.d, sq: this.party ? this.party.members.length : 1 };
  }

  setStatus(s, d = '') {
    this.status = { s, d };
    this.statusChanged();
  }

  statusChanged() {
    const msg = { t: 'st', st: this.statusMsg() };
    for (const code of Object.keys(this.data.friends)) this.send(this.readyLink(code), msg);
  }

  cardChanged() {
    clearTimeout(this.cardTimer);
    this.cardTimer = setTimeout(() => {
      const msg = { t: 'card', card: this.myCard() };
      for (const code of Object.keys(this.data.friends)) this.send(this.readyLink(code), msg);
      if (this.party) {
        const me = this.party.members.find((m) => m.c === this.code);
        if (me) Object.assign(me, this.meEntry());
        if (this.isLeader) this.broadcastSquad();
      }
    }, 600);
  }

  // ==============================================================================================
  // Squads
  // ==============================================================================================
  get isLeader() { return !this.party || this.party.leader === this.code; }

  get squadSize() { return this.party ? this.party.members.length : 1; }

  meEntry() {
    const c = this.myCard();
    return { c: this.code, n: this.myName(), lv: c.lv, sr: c.rk.sr, sd: c.sd.r, al: c.al, rl: c.rl, eq: c.eq };
  }

  members() { return this.party ? this.party.members : [this.meEntry()]; }

  /** Squad size limit: one team of the leader's selected playlist. */
  squadCap(playlist) {
    const pl = playlist || (this.party ? this.party.pl : this.playlist);
    return SQUAD_TEAM_SIZE[pl] || MAX_SQUAD;
  }

  /** Leader: the playlist the squad will play (sets the size limit; members see it). */
  setPlaylist(pl) {
    if (!SQUAD_TEAM_SIZE[pl] || !this.isLeader) return;
    if (this.playlist === pl && (!this.party || this.party.pl === pl)) return;
    this.playlist = pl;
    if (this.party) { this.party.pl = pl; this.broadcastSquad(); }
  }

  inviteToSquad(code) {
    const f = this.data.friends[code];
    const link = this.readyLink(code);
    if (!f) return { ok: false, message: 'You can only invite friends.' };
    if (!link) return { ok: false, message: `${f.name} is offline.` };
    if (!this.isLeader) return { ok: false, message: 'Only the squad leader can invite.' };
    if (link.pv !== PROTOCOL_VERSION) return { ok: false, message: `${f.name} has a different version of VANGUARD.html. You both need the same file to play together.` };
    if (this.party && this.party.members.some((m) => m.c === code)) return { ok: false, message: `${f.name} is already in your squad.` };
    const cap = this.squadCap();
    if (this.squadSize >= cap) return { ok: false, message: `Your squad is full: ${PLAYLIST_NAMES[this.party ? this.party.pl : this.playlist]} allows ${cap} per team.` };
    if (!this.party) this.party = { id: randomString(10), leader: this.code, members: [this.meEntry()], pl: this.playlist, room: '', label: '' };
    this.sentInvites.set(code, Date.now());
    this.send(link, { t: 'pinv', pid: this.party.id, pl: this.party.pl, sz: this.squadSize, mx: cap, n: this.myName() });
    this.changed();
    return { ok: true, message: `Squad invite sent to ${f.name}.` };
  }

  onSquadInvite(link, msg) {
    const pid = String(msg.pid || '').slice(0, 16);
    if (!pid || (this.party && this.party.id === pid)) return;
    const pl = SQUAD_TEAM_SIZE[msg.pl] ? msg.pl : 'tdm';
    const name = this.data.friends[link.code].name;
    this.invites = this.invites.filter((i) => !(i.kind === 'squad' && i.from === link.code));
    const inv = { id: pid, kind: 'squad', from: link.code, name, pl, sz: msg.sz | 0, mx: msg.mx | 0, expires: Date.now() + INVITE_TTL };
    this.invites.push(inv);
    this.toast({
      id: 'inv-' + pid, title: 'SQUAD INVITE', text: `${name} invited you to their squad · ${PLAYLIST_NAMES[pl]}.`, ttl: INVITE_TTL, sticky: true,
      actions: [{ label: 'JOIN', primary: true, fn: () => this.acceptInvite(inv) }, { label: 'DECLINE', fn: () => this.declineInvite(inv) }],
    });
    this.changed();
  }

  acceptInvite(inv) {
    this.invites = this.invites.filter((i) => i !== inv);
    const link = this.readyLink(inv.from);
    if (!link) { this.toast({ text: `${inv.name} is no longer online.` }); this.changed(); return; }
    if (inv.kind === 'duel') {
      if (inv.expires <= Date.now()) { this.toast({ text: 'That challenge expired.' }); this.changed(); return; }
      this.awaitingDuel = { id: inv.id, from: inv.from, name: inv.name, kind: inv.dk, sr: inv.sr, sk: inv.sk, since: Date.now() };
      this.send(link, { t: 'dacc', id: inv.id, sr: profile.duel.rating, sk: profile.skill.rating });
      this.toast({ text: `Accepted. Waiting for ${inv.name} to start the 1v1…` });
      this.changed();
      return;
    }
    if (this.party && this.party.id === inv.id) return;
    if (this.party) this.leaveSquad(true);
    this.joining = { pid: inv.id, leader: inv.from, since: Date.now() };
    this.send(link, { t: 'pjoin', pid: inv.id, me: this.meEntry() });
    this.changed();
  }

  declineInvite(inv) {
    this.invites = this.invites.filter((i) => i !== inv);
    const link = this.readyLink(inv.from);
    if (link) this.send(link, inv.kind === 'duel' ? { t: 'dno', id: inv.id } : { t: 'pno', pid: inv.id });
    this.changed();
  }

  onSquadJoin(link, msg) {
    const code = link.code;
    if (!this.party || this.party.id !== msg.pid || !this.isLeader) { this.send(link, { t: 'pgone', pid: msg.pid }); return; }
    this.sentInvites.delete(code);
    if (!this.party.members.some((m) => m.c === code)) {
      if (this.squadSize >= this.squadCap()) { this.send(link, { t: 'pfull', pid: msg.pid }); return; }
      const member = sanitizeMember(msg.me, code);
      const f = this.data.friends[code];
      if (f && f.card) Object.assign(member, { al: f.card.al || member.al, rl: f.card.rl || member.rl });
      this.party.members.push(member);
      this.toast({ text: `${member.n} joined your squad.` });
    }
    this.broadcastSquad();
    this.statusChanged();
  }

  memberCardUpdated(code, f) {
    if (!this.party || !f.card) return;
    const m = this.party.members.find((x) => x.c === code);
    if (!m) return;
    Object.assign(m, { lv: f.card.lv, sr: f.card.rk.sr, sd: f.card.sd.r, al: f.card.al, rl: f.card.rl, eq: f.card.eq });
    if (this.isLeader) this.broadcastSquad();
  }

  broadcastSquad() {
    if (!this.party || !this.isLeader) return;
    const p = this.party;
    const me = p.members.find((m) => m.c === this.code);
    if (me) Object.assign(me, this.meEntry());
    const msg = { t: 'pst', pid: p.id, leader: p.leader, members: p.members, pl: p.pl, room: p.room, label: p.label, mx: this.squadCap() };
    for (const m of p.members) if (m.c !== this.code) this.send(this.readyLink(m.c), msg);
    this.changed();
  }

  onSquadState(link, msg) {
    if (msg.leader !== link.code) return;
    const pid = String(msg.pid || '');
    const current = (this.party && this.party.id === pid) || (this.joining && this.joining.pid === pid);
    if (!current) { this.send(link, { t: 'pleave', pid }); return; }
    const members = Array.isArray(msg.members) ? msg.members.slice(0, 8).map((m) => sanitizeMember(m)).filter((m) => m.c) : [];
    if (!members.some((m) => m.c === this.code)) {
      this.party = null;
      this.joining = null;
      this.statusChanged();
      this.changed();
      return;
    }
    const joined = !!this.joining;
    this.joining = null;
    this.party = {
      id: pid, leader: link.code, members, pl: SQUAD_TEAM_SIZE[msg.pl] ? msg.pl : 'tdm',
      room: typeof msg.room === 'string' ? msg.room.slice(0, 8) : '', label: String(msg.label || '').slice(0, 40), mx: msg.mx | 0,
    };
    if (joined) {
      this.toast({ text: `You joined ${this.data.friends[link.code].name}'s squad.` });
      this.statusChanged();
    }
    this.changed();
  }

  onSquadLeave(link, msg) {
    if (!this.party || this.party.id !== msg.pid || !this.isLeader) return;
    const m = this.party.members.find((x) => x.c === link.code);
    if (!m) return;
    this.removeMember(link.code);
    this.toast({ text: `${m.n} left your squad.` });
  }

  removeMember(code) {
    if (!this.party) return;
    this.party.members = this.party.members.filter((m) => m.c !== code);
    if (this.party.members.length <= 1 && !this.party.room) {
      // Back to solo (keep the playlist choice).
      this.party = null;
      this.changed();
    } else {
      this.broadcastSquad();
    }
    this.statusChanged();
  }

  kick(code) {
    if (!this.party || !this.isLeader || code === this.code) return;
    this.send(this.readyLink(code), { t: 'pkick', pid: this.party.id });
    this.removeMember(code);
  }

  leaveSquad(quiet) {
    const p = this.party;
    if (!p) return;
    if (this.isLeader) for (const m of p.members) { if (m.c !== this.code) this.send(this.readyLink(m.c), { t: 'pend', pid: p.id }); }
    else this.send(this.readyLink(p.leader), { t: 'pleave', pid: p.id });
    this.party = null;
    if (!quiet) this.statusChanged();
    this.changed();
  }

  /** Leader: bot level for a squad match = the squad's average (each member's adaptive or Ranked level). */
  squadBotLevel(ranked) {
    const ms = this.members();
    const levels = ms.map((m) => (m.c === this.code ? (ranked ? this.myCard().rl : this.myCard().al) : (ranked ? m.rl : m.al)));
    return levels.reduce((a, b) => a + b, 0) / Math.max(1, levels.length);
  }

  /** Leader: tell the squad a match is up so their games join it. */
  squadMatchStarted(room, label) {
    if (!this.party || !this.isLeader) return;
    this.party.room = room;
    this.party.label = label;
    for (const m of this.party.members) if (m.c !== this.code) this.send(this.readyLink(m.c), { t: 'pgo', pid: this.party.id, room, label });
    this.broadcastSquad();
  }

  squadMatchEnded() {
    if (!this.party || !this.isLeader || !this.party.room) return;
    this.party.room = '';
    this.party.label = '';
    if (this.party.members.length <= 1) { this.party = null; this.changed(); return; }
    this.broadcastSquad();
  }

  // ==============================================================================================
  // 1v1 challenges
  // ==============================================================================================
  challengeFriend(code, kind, map) {
    const f = this.data.friends[code];
    const link = this.readyLink(code);
    if (!f) return { ok: false, message: 'You can only challenge friends.' };
    if (!link) return { ok: false, message: `${f.name} is offline.` };
    if (link.pv !== PROTOCOL_VERSION) return { ok: false, message: `${f.name} has a different version of VANGUARD.html. You both need the same file to play together.` };
    if (this.challenge) this.cancelChallenge();
    const k = kind === 'showdown' ? 'showdown' : 'friendly';
    this.challenge = { id: randomString(10), to: code, name: f.name, kind: k, map: String(map || ''), expires: Date.now() + INVITE_TTL };
    this.send(link, { t: 'dinv', id: this.challenge.id, k, map: this.challenge.map, sr: profile.duel.rating, sk: profile.skill.rating });
    this.changed();
    return { ok: true, message: `${k === 'showdown' ? 'Showdown' : 'Friendly 1v1'} challenge sent to ${f.name}. Waiting for them to accept…` };
  }

  cancelChallenge() {
    const c = this.challenge;
    if (!c) return;
    this.challenge = null;
    this.send(this.readyLink(c.to), { t: 'dcan', id: c.id });
    this.changed();
  }

  onChallenge(link, msg) {
    const id = String(msg.id || '').slice(0, 16);
    if (!id) return;
    const name = this.data.friends[link.code].name;
    const dk = msg.k === 'showdown' ? 'showdown' : 'friendly';
    this.invites = this.invites.filter((i) => !(i.kind === 'duel' && i.from === link.code));
    const inv = {
      id, kind: 'duel', from: link.code, name, dk, map: String(msg.map || '').slice(0, 24),
      sr: num(msg.sr, 1e5) || SHOWDOWN_START, sk: num(msg.sk, 4), expires: Date.now() + INVITE_TTL,
    };
    this.invites.push(inv);
    this.toast({
      id: 'duel-' + id, title: dk === 'showdown' ? 'SHOWDOWN CHALLENGE' : '1V1 CHALLENGE',
      text: dk === 'showdown' ? `${name} challenges you to a rated Showdown 1v1 (rating ${Math.round(inv.sr)}).` : `${name} challenges you to a friendly 1v1 (no rating).`,
      ttl: INVITE_TTL, sticky: true,
      actions: [{ label: 'ACCEPT', primary: true, fn: () => this.acceptInvite(inv) }, { label: 'DECLINE', fn: () => this.declineInvite(inv) }],
    });
    this.changed();
  }

  async onChallengeAccepted(link, msg) {
    const c = this.challenge;
    if (!c || c.id !== msg.id || c.to !== link.code) return;
    this.challenge = null;
    this.changed();
    const duel = { id: c.id, kind: c.kind, map: c.map, host: true, opp: { code: link.code, name: this.data.friends[link.code].name, sr: num(msg.sr, 1e5) || SHOWDOWN_START, sk: num(msg.sk, 4) } };
    if (!this.handlers.hostDuel) return;
    try {
      const room = await this.handlers.hostDuel(duel);
      this.send(this.readyLink(link.code), { t: 'dgo', id: c.id, room });
    } catch (err) {
      this.send(this.readyLink(link.code), { t: 'dcan', id: c.id, reason: `${this.myName()} could not start the 1v1: ${(err && err.message) || err}` });
      this.toast({ text: 'Could not start the 1v1: ' + ((err && err.message) || err) });
    }
  }
}

export const social = new Social();
