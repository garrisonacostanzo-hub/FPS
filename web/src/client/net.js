// Transports. Every match runs the same authoritative GameHost; only where it runs differs:
//  - LocalTransport: offline single-player, GameHost inside this tab.
//  - HostTransport:  online host, GameHost inside this tab, friends connect peer-to-peer (WebRTC).
//  - JoinTransport:  online client, connected to a host's browser by room code.
// The free public PeerJS service is used only to find the host by its room code (signaling); all game
// traffic then flows directly between browsers over WebRTC data channels.
import { Peer } from 'peerjs';
import { MAX_ONLINE_PLAYERS, OFFLINE_SNAPSHOT_RATE, ONLINE_SNAPSHOT_RATE, PROTOCOL_VERSION } from '../shared/constants.js';
import { GameHost } from '../shared/host.js';

export const ID_PREFIX = 'vanguard-fps-';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;
const SNAP_CHANNEL_ID = 7;          // negotiated unreliable channel for snapshots
const CLIENT_TIMEOUT = 20;          // host drops a silent client after this many seconds
const HOST_TIMEOUT = 15;            // client gives up on a silent host after this many seconds
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

// ------------------------------------------------------------------------------------------------
// Offline
// ------------------------------------------------------------------------------------------------
export class LocalTransport {
  constructor(config, name, loadout, cosmetics) {
    this.offline = true;
    this.cosmetics = cosmetics;
    this.isHost = true;
    this.onMessage = null;
    this.name = name;
    this.loadout = loadout;
    this.inbox = [];
    this.host = new GameHost(config, {
      snapshotRate: OFFLINE_SNAPSHOT_RATE,
      name: 'Offline match',
      send: (_clientId, msg) => this.deliver(msg),
    });
  }

  deliver(msg) {
    if (this.onMessage) this.onMessage(msg);
    else this.inbox.push(msg);
  }

  /** Joins the local match; the welcome message is delivered synchronously. */
  start() {
    this.host.join('local', this.name, this.loadout, this.cosmetics);
  }

  setHandler(fn) {
    this.onMessage = fn;
    const queued = this.inbox.splice(0);
    for (const msg of queued) fn(msg);
  }

  send(msg) {
    this.host.receive('local', msg);
  }

  /** Advances the local authoritative simulation (called from the render loop). */
  update(dt) {
    this.host.update(dt);
  }

  restart() {
    this.host.game.startMatch();
    this.deliver({ type: 'restart' });
    this.host.flushEvents();
  }

  close() {
    this.onMessage = null;
  }
}

// ------------------------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------------------------
export function webrtcSupported() {
  return typeof window.RTCPeerConnection === 'function';
}

export function normalizeCode(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

function randomCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

/** Signaling server: the free PeerJS cloud by default; "?signal=host:port" or a ws(s):// URL overrides it. */
export function signalingOptions() {
  const options = { debug: 1, config: { iceServers: ICE_SERVERS } };
  let override = null;
  try { override = new URLSearchParams(window.location.search).get('signal'); } catch { /* ignore */ }
  if (override) {
    try {
      const url = new URL(override.includes('://') ? override : 'ws://' + override);
      const secure = url.protocol === 'wss:' || url.protocol === 'https:';
      options.host = url.hostname;
      options.port = Number(url.port) || (secure ? 443 : 80);
      options.secure = secure;
      options.path = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
    } catch { /* ignore malformed override */ }
  }
  return options;
}

/** The matchmaking server's host name, for messages (the public PeerJS cloud unless ?signal= overrides it). */
export function signalingHost() {
  return signalingOptions().host || '0.peerjs.com';
}

export function createPeer(id) {
  return new Peer(id, signalingOptions());
}

/** True when this page runs inside another page (e.g. an app's preview/viewer frame). */
export function isEmbedded() {
  try { return window.self !== window.top; } catch { return true; }
}

const POLICY_BLOCKED = 'This page is open inside a viewer that blocks online connections (for example Claude\'s artifact viewer). '
  + 'Offline play works here; for online play, download VANGUARD.html and open it in your web browser.';

/** Calls fail(message) if the page's security policy blocks the connection to the matchmaking service. */
export function watchPolicy(fail) {
  const onViolation = (e) => {
    const directive = String(e.effectiveDirective || e.violatedDirective || '');
    if (/connect-src|default-src/.test(directive)) fail(POLICY_BLOCKED);
  };
  document.addEventListener('securitypolicyviolation', onViolation);
  return () => document.removeEventListener('securitypolicyviolation', onViolation);
}

function peerErrorMessage(err) {
  switch (err && err.type) {
    case 'browser-incompatible': return 'This browser does not support peer-to-peer connections (WebRTC).';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Could not reach the matchmaking service. Check your internet connection. On a school or work network or Chromebook, online play may be blocked: press CHECK CONNECTION to see what is blocked.';
    case 'ssl-unavailable': return 'Secure connection to the matchmaking service failed.';
    default: return (err && err.message) || 'Connection error.';
  }
}

/** Opens the extra unreliable, unordered data channel used for snapshots (both sides create it). */
function openSnapChannel(conn) {
  try {
    const pc = conn.peerConnection;
    if (!pc) return null;
    return pc.createDataChannel('vg-snap', { negotiated: true, id: SNAP_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
  } catch {
    return null;
  }
}

/** Calls onDead when the WebRTC link fails, or stays disconnected for 5 s (closed tab, lost network). */
function watchLink(conn, onDead) {
  const pc = conn.peerConnection;
  if (!pc || !pc.addEventListener) return;
  let timer = null;
  const state = () => pc.connectionState || pc.iceConnectionState;
  const check = () => {
    const st = state();
    if (st === 'failed' || st === 'closed') {
      clearTimeout(timer);
      onDead();
    } else if (st === 'disconnected') {
      if (!timer) timer = setTimeout(() => { timer = null; if (state() !== 'connected' && state() !== 'completed') onDead(); }, 5000);
    } else if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  pc.addEventListener('connectionstatechange', check);
  pc.addEventListener('iceconnectionstatechange', check);
}

/** Calls fn ~60x per second, also while the tab is in the background (worker timers are not throttled). */
function startTicker(fn) {
  let timer = null;
  let worker = null;
  const fallback = () => { if (!timer) timer = setInterval(fn, 1000 / 60); };
  try {
    const src = 'let t=null;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)};';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = fn;
    worker.onerror = () => { worker.terminate(); worker = null; fallback(); };
    worker.postMessage(1000 / 60);
  } catch {
    worker = null;
    fallback();
  }
  return () => {
    if (worker) { worker.postMessage(0); worker.terminate(); worker = null; }
    if (timer) { clearInterval(timer); timer = null; }
  };
}

// ------------------------------------------------------------------------------------------------
// Online host: runs the match in this tab and accepts players by room code
// ------------------------------------------------------------------------------------------------
export class HostTransport {
  constructor(config, name, loadout, cosmetics) {
    this.cosmetics = cosmetics;
    this.offline = false;
    this.isHost = true;
    this.code = '';
    this.onMessage = null;
    this.inbox = [];
    this.name = name;
    this.loadout = loadout;
    this.peer = null;
    this.remotes = new Map(); // clientId -> { conn, snap, joined, lastHeard }
    this.nextClient = 1;
    this.closed = false;
    this.reconnectDelay = 2000;
    this.host = new GameHost(config, {
      snapshotRate: ONLINE_SNAPSHOT_RATE,
      name: `${name || 'Host'}'s match`,
      send: (clientId, msg) => this.route(clientId, msg),
    });
  }

  /** Registers the room code with the matchmaking service. Resolves with the code. */
  open() {
    return new Promise((resolve, reject) => {
      if (!webrtcSupported()) { reject(new Error(peerErrorMessage({ type: 'browser-incompatible' }))); return; }
      let attempts = 0;
      const attempt = () => {
        attempts++;
        const code = randomCode();
        let settled = false;
        let peer;
        const unwatch = watchPolicy((message) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unwatch();
          if (peer) peer.destroy();
          reject(new Error(message));
        });
        try {
          peer = createPeer(ID_PREFIX + code);
        } catch (err) {
          settled = true;
          unwatch();
          reject(new Error(peerErrorMessage(err)));
          return;
        }
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          unwatch();
          peer.destroy();
          reject(new Error('The matchmaking service did not answer. On a school or work network or Chromebook, online play may be blocked: press CHECK CONNECTION to see what is blocked.'));
        }, 15000);
        peer.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unwatch();
          this.peer = peer;
          this.code = code;
          this.bindPeer(peer);
          resolve(code);
        });
        peer.on('error', (err) => {
          if (settled) return; // later errors (network blips, unknown peers) are handled by 'disconnected'/connections
          settled = true;
          clearTimeout(timer);
          unwatch();
          peer.destroy();
          if (err.type === 'unavailable-id' && attempts < 4) attempt();
          else reject(new Error(peerErrorMessage(err)));
        });
      };
      attempt();
    });
  }

  bindPeer(peer) {
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      // Lost the matchmaking service: running games are unaffected, but new players cannot join until we reconnect.
      if (this.closed) return;
      setTimeout(() => { if (!this.closed && peer.disconnected && !peer.destroyed) peer.reconnect(); }, this.reconnectDelay);
      this.reconnectDelay = Math.min(30000, this.reconnectDelay * 2);
    });
    peer.on('open', () => { this.reconnectDelay = 2000; });
  }

  /** Joins the host's own player; the welcome message is delivered synchronously into the inbox. */
  start() {
    this.host.join('host', this.name, this.loadout, this.cosmetics);
    this.lastTick = performance.now();
    this.stopTicker = startTicker(() => this.tick());
  }

  tick() {
    if (this.closed) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    try {
      this.host.update(dt);
    } catch (err) {
      console.error('Match crashed', err);
      const handler = this.onMessage;
      this.close('The match crashed on the host.');
      if (handler) handler({ type: 'roomClosed', reason: 'The match crashed. Sorry!' });
      return;
    }
    const t = now / 1000;
    for (const [clientId, remote] of this.remotes) {
      if (t - remote.lastHeard > CLIENT_TIMEOUT) this.drop(clientId, 'Timed out.');
    }
  }

  accept(conn) {
    if (this.closed) { conn.close(); return; }
    const clientId = 'p' + this.nextClient++;
    const remote = { conn, snap: null, joined: false, lastHeard: performance.now() / 1000 };
    this.remotes.set(clientId, remote);
    conn.on('open', () => {
      remote.snap = openSnapChannel(conn);
      if (remote.snap) remote.snap.onmessage = () => { remote.lastHeard = performance.now() / 1000; };
      watchLink(conn, () => this.drop(clientId));
    });
    conn.on('data', (data) => this.receive(clientId, remote, data));
    conn.on('close', () => this.drop(clientId));
    conn.on('error', () => this.drop(clientId));
  }

  receive(clientId, remote, data) {
    remote.lastHeard = performance.now() / 1000;
    let msg;
    try { msg = typeof data === 'string' ? JSON.parse(data) : data; } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (!remote.joined) {
      if (msg.type !== 'hello') return;
      if (msg.v !== PROTOCOL_VERSION) {
        this.refuse(remote, 'Version mismatch: you and the host have different copies of VANGUARD.html. Both of you need the same file.');
        return;
      }
      if (this.host.playerCount >= MAX_ONLINE_PLAYERS) {
        this.refuse(remote, `This match is full (${MAX_ONLINE_PLAYERS} players).`);
        return;
      }
      remote.joined = true;
      const loadout = Array.isArray(msg.loadout) ? msg.loadout.slice(0, 2).map(String) : ['rifle', 'pistol'];
      const look = msg.cosmetics && typeof msg.cosmetics === 'object' ? { camo: String(msg.cosmetics.camo || ''), outfit: String(msg.cosmetics.outfit || '') } : null;
      this.host.join(clientId, msg.name, loadout, look);
      return;
    }
    if (msg.type === 'leave') { this.drop(clientId); return; }
    if (msg.type === 'keepalive') return;
    this.host.receive(clientId, msg);
  }

  refuse(remote, message) {
    try { remote.conn.send(JSON.stringify({ type: 'error', message })); } catch { /* ignore */ }
    setTimeout(() => remote.conn.close(), 400);
  }

  drop(clientId) {
    const remote = this.remotes.get(clientId);
    if (!remote) return;
    this.remotes.delete(clientId);
    if (remote.joined) this.host.leave(clientId);
    try { remote.conn.close(); } catch { /* ignore */ }
  }

  /** GameHost output: to the local player or over the data channel to a remote player. */
  route(clientId, msg) {
    if (clientId === 'host') { this.deliver(msg); return; }
    const remote = this.remotes.get(clientId);
    if (!remote || !remote.conn.open) return;
    const text = JSON.stringify(msg);
    try {
      if (msg.type === 'snap' && remote.snap && remote.snap.readyState === 'open') {
        if (remote.snap.bufferedAmount < 256 * 1024) remote.snap.send(text); // drop stale snapshots under congestion
      } else {
        remote.conn.send(text);
      }
    } catch { /* channel closing */ }
  }

  deliver(msg) {
    if (this.onMessage) this.onMessage(msg);
    else this.inbox.push(msg);
  }

  setHandler(fn) {
    this.onMessage = fn;
    const queued = this.inbox.splice(0);
    for (const msg of queued) fn(msg);
  }

  send(msg) {
    this.host.receive('host', msg);
  }

  update() { /* the ticker drives the host so the match keeps running in a background tab */ }

  get playerCount() { return this.host.playerCount; }

  /** Ends the match for everyone. */
  close(reason = 'The host ended the match.') {
    if (this.closed) return;
    this.closed = true;
    this.onMessage = null;
    if (this.stopTicker) this.stopTicker();
    const bye = JSON.stringify({ type: 'roomClosed', reason });
    for (const remote of this.remotes.values()) {
      try { if (remote.conn.open) remote.conn.send(bye); } catch { /* ignore */ }
    }
    const remotes = [...this.remotes.values()];
    this.remotes.clear();
    const peer = this.peer;
    setTimeout(() => {
      for (const remote of remotes) { try { remote.conn.close(); } catch { /* ignore */ } }
      if (peer && !peer.destroyed) peer.destroy();
    }, 300);
  }
}

// ------------------------------------------------------------------------------------------------
// Online client: connects to a host's browser by room code
// ------------------------------------------------------------------------------------------------
export class JoinTransport {
  constructor() {
    this.offline = false;
    this.isHost = false;
    this.code = '';
    this.onMessage = null;
    this.inbox = [];
    this.peer = null;
    this.conn = null;
    this.snap = null;
    this.closed = false;
    this.lastHeard = 0;
    this.watchdog = null;
  }

  /** Connects to the match with the given code. Resolves with the host's welcome message. */
  connect(code, name, loadout, cosmetics) {
    this.code = code;
    return new Promise((resolve, reject) => {
      if (!webrtcSupported()) { reject(new Error(peerErrorMessage({ type: 'browser-incompatible' }))); return; }
      let settled = false;
      const fail = (message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unwatch();
        this.shutdown();
        reject(new Error(message));
      };
      const unwatch = watchPolicy(fail);
      const timer = setTimeout(() => fail(this.conn && !this.conn.open
        ? 'Found the match but could not connect to the host. A school, work or other strict network may be blocking peer-to-peer connections: press CHECK CONNECTION to see what is blocked.'
        : 'Could not reach the matchmaking service. On a school or work network or Chromebook, online play may be blocked: press CHECK CONNECTION to see what is blocked.'), 20000);

      let peer;
      try {
        peer = createPeer(ID_PREFIX + 'c-' + randomCode() + randomCode());
      } catch (err) {
        fail(peerErrorMessage(err));
        return;
      }
      this.peer = peer;
      peer.on('error', (err) => {
        if (settled) return;
        if (err.type === 'peer-unavailable') fail(`No match found with code ${code}. Check the code and make sure the host is still in the match.`);
        else fail(peerErrorMessage(err));
      });
      peer.on('open', () => {
        const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'raw' });
        if (!conn) { fail('Could not start the connection.'); return; }
        this.conn = conn;
        conn.on('open', () => {
          watchLink(conn, () => { if (!settled) fail('Lost the connection to the host while joining.'); else this.lost('Lost connection to the host.'); });
          this.snap = openSnapChannel(conn);
          if (this.snap) this.snap.onmessage = (e) => this.receive(e.data);
          conn.send(JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name, loadout, cosmetics }));
        });
        conn.on('data', (data) => {
          let msg;
          try { msg = typeof data === 'string' ? JSON.parse(data) : data; } catch { return; }
          if (!settled) {
            if (msg.type === 'welcome') {
              settled = true;
              clearTimeout(timer);
              unwatch();
              this.startWatchdog();
              resolve(msg);
            } else if (msg.type === 'error') {
              fail(msg.message || 'The host refused the connection.');
            }
            return;
          }
          this.receive(msg);
        });
        conn.on('close', () => {
          if (!settled) fail('The host closed the connection.');
          else this.lost('Lost connection to the host.');
        });
        conn.on('error', () => {
          if (!settled) fail('Could not connect to the host.');
          else this.lost('Lost connection to the host.');
        });
      });
      // Once connected the matchmaking service is no longer needed; ignore its outages.
      peer.on('disconnected', () => {});
    });
  }

  receive(data) {
    this.lastHeard = performance.now() / 1000;
    let msg = data;
    if (typeof data === 'string') {
      try { msg = JSON.parse(data); } catch { return; }
    }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'roomClosed') this.closed = true;
    if (this.onMessage) this.onMessage(msg);
    else this.inbox.push(msg);
  }

  startWatchdog() {
    this.lastHeard = performance.now() / 1000;
    this.watchdog = setInterval(() => {
      if (this.closed) return;
      if (performance.now() / 1000 - this.lastHeard > HOST_TIMEOUT) this.lost('Lost connection to the host.');
      else this.sendRaw({ type: 'keepalive' }); // keeps the host from timing us out while this tab is hidden
    }, 1000);
  }

  lost(reason) {
    if (this.closed) return;
    this.closed = true;
    const msg = { type: 'roomClosed', reason };
    if (this.onMessage) this.onMessage(msg);
    else this.inbox.push(msg);
  }

  setHandler(fn) {
    this.onMessage = fn;
    const queued = this.inbox.splice(0);
    for (const msg of queued) fn(msg);
  }

  sendRaw(msg) {
    try { if (this.conn && this.conn.open) this.conn.send(JSON.stringify(msg)); } catch { /* ignore */ }
  }

  send(msg) {
    this.sendRaw(msg);
  }

  update() {}

  close() {
    this.onMessage = null;
    if (!this.closed) this.sendRaw({ type: 'leave' });
    this.closed = true;
    const conn = this.conn;
    const peer = this.peer;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    setTimeout(() => {
      try { if (conn) conn.close(); } catch { /* ignore */ }
      if (peer && !peer.destroyed) peer.destroy();
    }, 200);
  }

  shutdown() {
    this.closed = true;
    if (this.watchdog) clearInterval(this.watchdog);
    try { if (this.conn) this.conn.close(); } catch { /* ignore */ }
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
  }
}
