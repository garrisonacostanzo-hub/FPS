// Transports: LocalTransport runs the authoritative GameHost inside the browser (offline single-player);
// WsTransport talks to the Node.js server (online multiplayer, lobby + rooms).
import { OFFLINE_SNAPSHOT_RATE, PROTOCOL_VERSION } from '../shared/constants.js';
import { GameHost } from '../shared/host.js';

export class LocalTransport {
  constructor(config, name, loadout) {
    this.offline = true;
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
    this.host.join('local', this.name, this.loadout);
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

export class WsTransport {
  constructor(url) {
    this.offline = false;
    this.url = url;
    this.onMessage = null;
    this.onClose = null;
    this.inbox = [];
    this.ws = null;
  }

  static defaultUrl() {
    const loc = window.location;
    if (loc.protocol === 'http:' || loc.protocol === 'https:') {
      return (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host + '/ws';
    }
    return 'ws://localhost:8080/ws';
  }

  connect(name) {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.ws = new WebSocket(this.url);
      } catch (err) {
        reject(err);
        return;
      }
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('Connection timed out')); this.ws.close(); } }, 6000);
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({ type: 'hello', name, v: PROTOCOL_VERSION }));
      };
      this.ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (!settled && msg.type === 'lobby') { settled = true; clearTimeout(timer); resolve(msg); }
        if (!settled && msg.type === 'error') { settled = true; clearTimeout(timer); reject(new Error(msg.message)); }
        if (this.onMessage) this.onMessage(msg);
        else this.inbox.push(msg);
      };
      this.ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Could not connect to ' + this.url)); } };
      this.ws.onclose = () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Connection closed')); }
        if (this.onClose) this.onClose();
      };
    });
  }

  setHandler(fn) {
    this.onMessage = fn;
    const queued = this.inbox.splice(0);
    for (const msg of queued) fn(msg);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  update() {}

  close() {
    this.onMessage = null;
    this.onClose = null;
    if (this.ws) this.ws.close();
  }
}
