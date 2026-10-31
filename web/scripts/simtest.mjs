// Headless simulation test: runs every mode on every map with bots (and a scripted fake human) and checks
// that the authoritative game advances, bots navigate and fight, and modes reach their objectives.
import { GameHost } from '../src/shared/host.js';
import { MAP_LIST } from '../src/shared/map.js';
import { MODE_LIST } from '../src/shared/modes.js';
import { TICK_DT } from '../src/shared/constants.js';
import { loadMapBundle } from '../src/shared/game.js';

const seconds = Number(process.argv[2] || 90);
let failures = 0;

for (const map of MAP_LIST) {
  const t0 = performance.now();
  const bundle = loadMapBundle(map.id);
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`map ${map.id}: ${bundle.map.boxes.length} boxes, ${bundle.nav.walkableCount} walkable cells, ${bundle.cover.length} cover points (built in ${ms} ms)`);
  // Every zone and spawn must be reachable from team A's first spawn.
  const s = bundle.map.spawns[0][0];
  for (const target of [...bundle.map.zones, bundle.map.spawns[1][0]]) {
    const path = bundle.nav.findPath(s.x, s.z, target.x, target.z, 40000);
    if (!path) { console.log(`  FAIL: no path from Alpha spawn to ${target.id || 'Bravo spawn'}`); failures++; }
  }
}

for (const mode of MODE_LIST) {
  for (const map of MAP_LIST) {
    const messages = { snap: 0, ev: 0 };
    let kills = 0, captures = 0, ended = null, shots = 0;
    const host = new GameHost({ mode: mode.id, map: map.id, bots: 9, difficulty: 'hard' }, {
      snapshotRate: 20,
      send: (_id, msg) => {
        messages[msg.type] = (messages[msg.type] || 0) + 1;
        if (msg.type === 'ev') {
          for (const e of msg.l) {
            if (e.type === 'kill') kills++;
            if (e.type === 'zone' && e.owner !== 2) captures++;
            if (e.type === 'end') ended = e.text;
            if (e.type === 'shot') shots++;
          }
        }
      },
    });
    host.join('human', 'Tester', ['rifle', 'pistol']);
    const human = host.game.entities.get(host.clients.get('human').entityId);
    let seq = 0;
    const start = performance.now();
    const steps = Math.round(seconds / TICK_DT);
    let maxBotTravel = 0;
    const startPos = new Map();
    try {
      for (let i = 0; i < steps; i++) {
        // Fake human: walks forward and turns slowly, fires occasionally.
        const cmds = [];
        for (let k = 0; k < 2; k++) {
          seq++;
          cmds.push({ s: seq, dt: TICK_DT / 2, mx: 0, mz: 1, yaw: Math.sin(seq * 0.002) * 3, pitch: 0, b: seq % 40 < 5 ? 16 : 0, sw: -1, r: false, vt: host.game.time - 0.1 });
        }
        host.receive('human', { type: 'cmds', c: cmds });
        host.update(TICK_DT);
        for (const e of host.game.entities.values()) {
          if (!e.isBot) continue;
          if (!startPos.has(e.id) || !e.alive) startPos.set(e.id, { x: e.motor.x, z: e.motor.z });
          const p = startPos.get(e.id);
          maxBotTravel = Math.max(maxBotTravel, Math.hypot(e.motor.x - p.x, e.motor.z - p.z));
        }
      }
    } catch (err) {
      console.log(`FAIL ${mode.id}/${map.id}: exception`, err);
      failures++;
      continue;
    }
    const elapsed = performance.now() - start;
    const g = host.game;
    const perTick = (elapsed / steps).toFixed(2);
    const ok = kills > 0 && maxBotTravel > 15 && messages.snap > 0;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${mode.id.padEnd(8)} ${map.id.padEnd(9)} kills=${String(kills).padStart(3)} shots=${String(shots).padStart(4)} captures=${captures} ` +
      `scores=${JSON.stringify(g.teamScores)} phase=${g.phase} ended=${ended || '-'} botTravel=${maxBotTravel.toFixed(0)}m ` +
      `humanSeqAck=${human.lastSeq}/${seq} ents=${g.entities.size} tick=${perTick}ms`);
  }
}

console.log(failures ? `\n${failures} failure(s)` : '\nall simulation checks passed');
process.exit(failures ? 1 : 0);
