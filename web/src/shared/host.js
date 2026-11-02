// Transport-agnostic game host: binds connected clients to entities, runs the fixed-rate simulation,
// and emits snapshots/events. Runs in the browser: offline (in-memory) or as an online host (WebRTC peers).
import { PROTOCOL_VERSION, TICK_DT } from './constants.js';
import { Game } from './game.js';

export class GameHost {
  /**
   * @param {object} config game config (mode, map, bots, difficulty, ...)
   * @param {object} options { snapshotRate, send(clientId, message), name }
   */
  constructor(config, options) {
    this.config = config;
    this.send = options.send;
    this.snapshotInterval = 1 / (options.snapshotRate || 20);
    this.name = options.name || 'Match';
    this.game = new Game(config);
    this.clients = new Map(); // clientId -> { entityId, name }
    this.accumulator = 0;
    this.snapshotTimer = 0;
    this.scoreTimer = 0;
  }

  get playerCount() { return this.clients.size; }

  join(clientId, name, loadout, cosmetics) {
    const entity = this.game.addHuman(clientId, sanitizeName(name), loadout, cosmetics);
    this.clients.set(clientId, { entityId: entity.id, name: entity.name });
    this.send(clientId, {
      type: 'welcome',
      v: PROTOCOL_VERSION,
      id: entity.id,
      cfg: this.game.config,
      mode: this.game.mode.id,
      map: this.game.map.id,
      roster: this.game.roster(),
      t: this.game.time,
      name: this.name,
    });
    this.game.announce(`${entity.name} joined`, entity.team);
    return entity;
  }

  leave(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;
    const entity = this.game.entities.get(client.entityId);
    this.clients.delete(clientId);
    this.game.removeHuman(client.entityId);
    if (entity) this.game.announce(`${entity.name} left`, entity.team);
  }

  receive(clientId, msg) {
    const client = this.clients.get(clientId);
    if (!client || !msg || typeof msg !== 'object') return;
    const entity = this.game.entities.get(client.entityId);
    if (!entity) return;
    switch (msg.type) {
      case 'cmds':
        this.game.queueCommands(entity, msg.c);
        break;
      case 'loadout':
        this.game.setPreferredPrimary(entity, msg.primary);
        break;
      case 'ping':
        this.send(clientId, { type: 'pong', t: msg.t, st: this.game.time });
        if (typeof msg.rtt === 'number') entity.ping = Math.max(0, Math.min(999, msg.rtt));
        break;
      case 'chat': {
        const text = String(msg.text || '').slice(0, 120).replace(/[<>]/g, '');
        if (text) this.broadcast({ type: 'ev', l: [{ type: 'chat', id: entity.id, text }] });
        break;
      }
      default:
        break;
    }
  }

  broadcast(msg) {
    for (const clientId of this.clients.keys()) this.send(clientId, msg);
  }

  /** Advances real time; runs fixed simulation ticks and emits network traffic. */
  update(realDt) {
    this.accumulator = Math.min(this.accumulator + realDt, 0.25);
    let ticked = false;
    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      this.game.step(TICK_DT);
      ticked = true;
      this.flushEvents();
      if (this.game.restartPending) {
        this.game.restartPending = false;
        this.game.startMatch();
        this.broadcast({ type: 'restart' });
        this.flushEvents();
      }
    }
    this.snapshotTimer += realDt;
    this.scoreTimer += realDt;
    if (!ticked) return;

    if (this.game.rosterDirty) {
      this.game.rosterDirty = false;
      this.broadcast({ type: 'roster', l: this.game.roster() });
    }

    if (this.snapshotTimer >= this.snapshotInterval) {
      this.snapshotTimer %= this.snapshotInterval;
      for (const [clientId, client] of this.clients) {
        const entity = this.game.entities.get(client.entityId);
        this.send(clientId, this.game.snapshot(entity));
      }
    }

    if (this.scoreTimer >= 1) {
      this.scoreTimer = 0;
      this.broadcast({ type: 'scores', l: this.game.scores() });
    }
  }

  flushEvents() {
    const game = this.game;
    if (game.events.length === 0 && game.direct.size === 0) return;
    for (const [clientId, client] of this.clients) {
      const list = [];
      for (const ev of game.events) {
        if (ev._except === client.entityId) continue;
        list.push(ev);
      }
      const direct = game.direct.get(client.entityId);
      if (direct) list.push(...direct);
      if (list.length) this.send(clientId, { type: 'ev', l: list });
    }
    game.events.length = 0;
    game.direct.clear();
  }

  info(id) {
    const counts = this.game.teamCounts();
    return {
      id,
      name: this.name,
      mode: this.game.mode.id,
      map: this.game.map.id,
      players: this.clients.size,
      bots: counts.bots[0] + counts.bots[1] + counts.bots[2],
      phase: this.game.phase,
      difficulty: this.game.config.difficulty,
    };
  }
}

export function sanitizeName(name) {
  const clean = String(name || '').replace(/[^\w \-]/g, '').trim().slice(0, 18);
  return clean || 'Player' + Math.floor(100 + Math.random() * 900);
}
