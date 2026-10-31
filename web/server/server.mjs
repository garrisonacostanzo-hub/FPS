// VANGUARD online server: serves the game page over HTTP and hosts authoritative multiplayer rooms over
// WebSocket. Every room runs the same GameHost/Game simulation used offline, with bots filling empty slots.
//
//   PORT=8080 node server/server.mjs
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { DIFFICULTY, ONLINE_SNAPSHOT_RATE, PROTOCOL_VERSION } from '../src/shared/constants.js';
import { GameHost, sanitizeName } from '../src/shared/host.js';
import { MAP_LIST } from '../src/shared/map.js';
import { MODE_LIST } from '../src/shared/modes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 20);
const MAX_PLAYERS_PER_ROOM = Number(process.env.MAX_PLAYERS || 12);
const indexPath = join(root, 'dist', 'index.html');

// ------------------------------------------------------------------------------------------------
// HTTP: the single-file client
// ------------------------------------------------------------------------------------------------
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clients.size }));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    if (!existsSync(indexPath)) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('dist/index.html is missing. Run "npm run build" first.');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(readFileSync(indexPath));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
});

// ------------------------------------------------------------------------------------------------
// Rooms
// ------------------------------------------------------------------------------------------------
const rooms = new Map();   // roomId -> { id, host, emptySince }
const clients = new Map(); // clientId -> { ws, name, roomId, alive }
let nextClientId = 1;
let nextRoomId = 1;

function send(clientId, msg) {
  const client = clients.get(clientId);
  if (client && client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(msg));
}

function roomList() {
  return [...rooms.values()].map((r) => ({ ...r.host.info(r.id), max: MAX_PLAYERS_PER_ROOM }));
}

function createRoom(options) {
  const mode = MODE_LIST.some((m) => m.id === options.mode) ? options.mode : 'tdm';
  const map = MAP_LIST.some((m) => m.id === options.map) ? options.map : 'outpost';
  const difficulty = DIFFICULTY[options.difficulty] ? options.difficulty : 'normal';
  const bots = Math.max(0, Math.min(mode === 'horde' ? 5 : 19, Number(options.bots) || 0));
  const id = 'r' + nextRoomId++;
  const name = String(options.name || 'Room ' + id).replace(/[<>]/g, '').slice(0, 24) || 'Room ' + id;
  const host = new GameHost({ mode, map, bots, difficulty }, { snapshotRate: ONLINE_SNAPSHOT_RATE, send, name });
  const room = { id, host, emptySince: Date.now() };
  rooms.set(id, room);
  console.log(`[room ${id}] created "${name}" ${mode} on ${map} (${bots} bots, ${difficulty})`);
  return room;
}

function joinRoom(clientId, roomId, loadout) {
  const client = clients.get(clientId);
  const room = rooms.get(roomId);
  if (!client || !room) return send(clientId, { type: 'error', message: 'Room not found.' });
  if (room.host.playerCount >= MAX_PLAYERS_PER_ROOM) return send(clientId, { type: 'error', message: 'Room is full.' });
  leaveRoom(clientId);
  client.roomId = roomId;
  room.emptySince = 0;
  room.host.join(clientId, client.name, Array.isArray(loadout) ? loadout.map(String) : ['rifle', 'pistol']);
  broadcastLobby();
  return undefined;
}

function leaveRoom(clientId) {
  const client = clients.get(clientId);
  if (!client || !client.roomId) return;
  const room = rooms.get(client.roomId);
  client.roomId = null;
  if (room) {
    room.host.leave(clientId);
    if (room.host.playerCount === 0) room.emptySince = Date.now();
  }
  broadcastLobby();
}

function broadcastLobby() {
  const list = roomList();
  for (const [id, c] of clients) if (!c.roomId) send(id, { type: 'rooms', rooms: list });
}

// ------------------------------------------------------------------------------------------------
// WebSocket protocol
// ------------------------------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  const clientId = 'c' + nextClientId++;
  const client = { ws, name: 'Player', roomId: null, alive: true, helloed: false };
  clients.set(clientId, client);
  console.log(`[client ${clientId}] connected from ${req.socket.remoteAddress}`);

  ws.on('pong', () => { client.alive = true; });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (!client.helloed) {
      if (msg.type !== 'hello') return;
      if (msg.v !== PROTOCOL_VERSION) {
        send(clientId, { type: 'error', message: `Version mismatch (server ${PROTOCOL_VERSION}, client ${msg.v}). Reload the page.` });
        ws.close();
        return;
      }
      client.helloed = true;
      client.name = sanitizeName(msg.name);
      send(clientId, { type: 'lobby', rooms: roomList(), maps: MAP_LIST, modes: MODE_LIST });
      return;
    }

    switch (msg.type) {
      case 'listRooms':
        send(clientId, { type: 'rooms', rooms: roomList() });
        break;
      case 'createRoom': {
        if (rooms.size >= MAX_ROOMS) { send(clientId, { type: 'error', message: 'Server is at its room limit.' }); break; }
        if (msg.playerName) client.name = sanitizeName(msg.playerName);
        const room = createRoom(msg);
        joinRoom(clientId, room.id, msg.loadout);
        break;
      }
      case 'joinRoom':
        if (msg.name) client.name = sanitizeName(msg.name);
        joinRoom(clientId, String(msg.id), msg.loadout);
        break;
      case 'leaveRoom':
        leaveRoom(clientId);
        send(clientId, { type: 'lobby', rooms: roomList() });
        break;
      default:
        if (client.roomId) {
          const room = rooms.get(client.roomId);
          if (room) room.host.receive(clientId, msg);
        }
    }
  });

  ws.on('close', () => {
    leaveRoom(clientId);
    clients.delete(clientId);
    console.log(`[client ${clientId}] disconnected`);
  });
});

// Keep-alive pings: drop dead connections.
setInterval(() => {
  for (const [id, c] of clients) {
    if (!c.alive) { c.ws.terminate(); clients.delete(id); leaveRoom(id); continue; }
    c.alive = false;
    try { c.ws.ping(); } catch { /* ignore */ }
  }
}, 15000);

// ------------------------------------------------------------------------------------------------
// Simulation loop (fixed timestep inside each GameHost)
// ------------------------------------------------------------------------------------------------
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const [id, room] of rooms) {
    try {
      room.host.update(dt);
    } catch (err) {
      console.error(`[room ${id}] crashed`, err);
      for (const clientId of room.host.clients.keys()) {
        send(clientId, { type: 'roomClosed' });
        const c = clients.get(clientId);
        if (c) c.roomId = null;
      }
      rooms.delete(id);
      continue;
    }
    if (room.host.playerCount === 0 && room.emptySince && Date.now() - room.emptySince > 30000) {
      rooms.delete(id);
      console.log(`[room ${id}] closed (empty)`);
      broadcastLobby();
    }
  }
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`VANGUARD server listening on http://localhost:${PORT}  (WebSocket: ws://localhost:${PORT}/ws)`);
  if (!existsSync(indexPath)) console.log('Note: run "npm run build" to generate dist/index.html');
});
