// Game mode rule sets. Each mode plugs hooks into the authoritative Game (scoring, respawn rules, loadouts,
// win conditions, bot objectives and the HUD payload replicated to clients).
import { TEAM, TEAM_NAMES } from './constants.js';
import { GUNGAME_LADDER, WEAPONS } from './weapons.js';
import { dist2 } from './math.js';

export const MODE_LIST = [
  { id: 'tdm', name: 'Team Deathmatch', short: 'TDM', description: 'Two teams. First team to the kill limit wins.', teams: true },
  { id: 'dom', name: 'Domination', short: 'DOM', description: 'Capture and hold zones A, B and C to earn points.', teams: true },
  { id: 'ffa', name: 'Free-for-All', short: 'FFA', description: 'Everyone for themselves. First to the kill limit wins.', teams: false },
  { id: 'gungame', name: 'Gun Game', short: 'GG', description: 'Every kill upgrades your weapon. Finish the ladder to win.', teams: false },
  { id: 'elim', name: 'Elimination', short: 'ELIM', description: 'Round based, no respawns. Wipe the enemy team to win a round.', teams: true },
  { id: 'horde', name: 'Horde (Co-op)', short: 'HORDE', description: 'Survive escalating waves of enemy bots with your squad.', teams: true, coop: true },
  // Only reachable by challenging a friend (Friends tab), so it is hidden from the playlists.
  { id: 'duel', name: '1v1 Duel', short: '1V1', description: 'You against one friend. First to 10 kills, or most kills after 6 minutes.', teams: false, hidden: true },
];

/** Players per team when a squad plays a mode together (the squad can be at most this big). */
export const SQUAD_TEAM_SIZE = { ranked: 5, tdm: 6, dom: 6, elim: 4, horde: 4 };

class BaseMode {
  constructor(game) {
    this.game = game;
    this.cfg = game.config;
  }

  get teams() { return true; }
  get respawns() { return true; }
  get managesEnemyBots() { return false; }
  get timeLimit() { return this.cfg.timeLimit || 600; }
  get scoreLimit() { return this.cfg.scoreLimit || 50; }

  setup() {}
  update() {}
  onKill() {}
  onCapture() {}
  respawnDelay() { return 3.5; }
  canRespawn() { return this.respawns; }
  loadoutFor() { return null; }
  isHostile(a, b) { return a !== b && (a.team !== b.team || a.team === TEAM.NONE); }
  usesZones() { return false; }

  /** Assigns a team to a new combatant. */
  assignTeam(entity) {
    if (!this.teams) return TEAM.NONE;
    if (!entity.isBot && this.cfg.party) return TEAM.A; // a squad always plays together
    const counts = this.game.teamCounts();
    if (!entity.isBot) {
      const humansA = counts.humans[0], humansB = counts.humans[1];
      if (humansA !== humansB) return humansA < humansB ? TEAM.A : TEAM.B;
    }
    return counts.total[0] <= counts.total[1] ? TEAM.A : TEAM.B;
  }

  /** Where a bot should go when it has nothing better to do. */
  botGoal(bot, rng) {
    const game = this.game;
    const intel = game.freshestIntel(bot);
    if (intel && rng() < 0.6) return { x: intel.x, z: intel.z, reason: 'intel' };
    const points = game.map.patrol;
    const p = points[Math.floor(rng() * points.length)];
    return { x: p.x, z: p.z, reason: 'patrol' };
  }

  checkTimeLimit() {
    if (this.game.phase === 'live' && this.game.time >= this.game.phaseEnd) this.onTimeUp();
  }

  onTimeUp() {
    const [a, b] = this.game.teamScores;
    this.game.finish(a === b ? { team: TEAM.NONE, text: 'DRAW' } : { team: a > b ? TEAM.A : TEAM.B, text: (a > b ? 'ALPHA' : 'BRAVO') + ' WINS' });
  }

  hud() {
    return { s: this.game.teamScores, lim: this.scoreLimit };
  }
}

// ------------------------------------------------------------------------------------------------
class TeamDeathmatch extends BaseMode {
  get scoreLimit() { return this.cfg.scoreLimit || 50; }

  onKill(killer, victim) {
    if (killer && killer !== victim && killer.team !== victim.team) {
      this.game.teamScores[killer.team]++;
      if (this.game.teamScores[killer.team] >= this.scoreLimit) {
        this.game.finish({ team: killer.team, text: TEAM_NAMES[killer.team] + ' WINS' });
      }
    }
  }

  update() { this.checkTimeLimit(); }
}

// ------------------------------------------------------------------------------------------------
class Domination extends BaseMode {
  get scoreLimit() { return this.cfg.scoreLimit || 250; }
  usesZones() { return true; }

  setup() {
    this.tickTimer = 0;
    for (const z of this.game.zones) { z.owner = TEAM.NONE; z.progress = 0; z.contested = false; }
  }

  update(dt) {
    const game = this.game;
    if (game.phase !== 'live') return;
    const captureTime = 8;
    for (const zone of game.zones) {
      let a = 0, b = 0;
      for (const e of game.entities.values()) {
        if (!e.alive) continue;
        if (Math.abs(e.motor.y - zone.y) > 4) continue;
        if (dist2(e.motor.x, e.motor.z, zone.x, zone.z) > zone.r) continue;
        if (e.team === TEAM.A) a++; else if (e.team === TEAM.B) b++;
      }
      zone.contested = a > 0 && b > 0;
      if (zone.contested) continue;
      if (a > 0 || b > 0) {
        const team = a > 0 ? TEAM.A : TEAM.B;
        const dir = team === TEAM.A ? -1 : 1;
        const speed = (1 / captureTime) * Math.min(2.5, 1 + 0.5 * (Math.max(a, b) - 1));
        const before = zone.progress;
        zone.progress = Math.max(-1, Math.min(1, zone.progress + dir * speed * dt));
        if (zone.owner !== TEAM.NONE && zone.owner !== team && Math.sign(before) !== Math.sign(zone.progress) && before !== 0) {
          zone.owner = TEAM.NONE;
          game.event({ type: 'zone', id: zone.id, owner: TEAM.NONE });
        }
        if (Math.abs(zone.progress) >= 1 && zone.owner !== team) {
          zone.owner = team;
          game.teamScores[team] += 5;
          game.announce(`${TEAM_NAMES[team]} captured ${zone.id}`, team);
          game.event({ type: 'zone', id: zone.id, owner: team });
          for (const e of game.entities.values()) {
            if (e.alive && e.team === team && dist2(e.motor.x, e.motor.z, zone.x, zone.z) <= zone.r) e.score += 10;
          }
        }
      } else {
        const rest = zone.owner === TEAM.A ? -1 : zone.owner === TEAM.B ? 1 : 0;
        const d = rest - zone.progress;
        zone.progress += Math.sign(d) * Math.min(Math.abs(d), dt * 0.05);
      }
    }

    this.tickTimer += dt;
    if (this.tickTimer >= 1) {
      this.tickTimer -= 1;
      for (const zone of game.zones) if (zone.owner !== TEAM.NONE) game.teamScores[zone.owner] += 1;
      for (const team of [TEAM.A, TEAM.B]) {
        if (game.teamScores[team] >= this.scoreLimit) {
          game.finish({ team, text: TEAM_NAMES[team] + ' WINS' });
          return;
        }
      }
    }
    this.checkTimeLimit();
  }

  onKill(killer, victim) {
    if (killer && killer !== victim && killer.team !== victim.team) this.game.teamScores[killer.team] += 1;
  }

  botGoal(bot, rng) {
    const zones = this.game.zones;
    // Priority: contested own zone > enemy zone > neutral zone > random own zone; distribute by bot id.
    const scored = zones.map((z) => {
      let p = z.owner === bot.team ? (z.contested ? 4 : 0.5) : z.owner === TEAM.NONE ? 2.5 : 3;
      p -= dist2(bot.motor.x, bot.motor.z, z.x, z.z) / 120;
      p += ((bot.id * 7 + zones.indexOf(z) * 3) % 5) * 0.25;
      return { z, p };
    }).sort((a, b) => b.p - a.p);
    const pick = scored[0].z;
    const r = pick.r * 0.7;
    return { x: pick.x + (rng() - 0.5) * r * 2, z: pick.z + (rng() - 0.5) * r * 2, reason: 'zone', zone: pick.id };
  }

  hud() {
    return { s: this.game.teamScores, lim: this.scoreLimit, z: this.game.zones.map((z) => [z.id, z.owner, Math.round(z.progress * 100) / 100, z.contested ? 1 : 0]) };
  }
}

// ------------------------------------------------------------------------------------------------
class FreeForAll extends BaseMode {
  get teams() { return false; }
  get scoreLimit() { return this.cfg.scoreLimit || 25; }

  onKill(killer, victim) {
    if (killer && killer !== victim && killer.kills >= this.scoreLimit) {
      this.game.finish({ team: TEAM.NONE, winner: killer.id, text: killer.name + ' WINS' });
    }
  }

  update() { this.checkTimeLimit(); }

  onTimeUp() {
    const best = this.game.leader();
    this.game.finish({ team: TEAM.NONE, winner: best ? best.id : -1, text: best ? best.name + ' WINS' : 'DRAW' });
  }

  hud() {
    const leader = this.game.leader();
    return { lim: this.scoreLimit, ld: leader ? [leader.id, leader.name, leader.kills] : null };
  }
}

// ------------------------------------------------------------------------------------------------
class GunGame extends FreeForAll {
  get scoreLimit() { return GUNGAME_LADDER.length; }

  setup() {
    for (const e of this.game.entities.values()) e.tier = 0;
  }

  loadoutFor(entity) {
    const tier = Math.min(entity.tier || 0, GUNGAME_LADDER.length - 1);
    return [GUNGAME_LADDER[tier]];
  }

  onKill(killer, victim) {
    if (!killer || killer === victim) {
      if (victim) victim.tier = Math.max(0, (victim.tier || 0) - 1);
      return;
    }
    killer.tier = (killer.tier || 0) + 1;
    killer.score = killer.tier;
    if (killer.tier >= GUNGAME_LADDER.length) {
      this.game.finish({ team: TEAM.NONE, winner: killer.id, text: killer.name + ' WINS' });
      return;
    }
    this.game.setEntityLoadout(killer, this.loadoutFor(killer));
    if (!killer.isBot) this.game.eventTo(killer, { type: 'ann', text: 'UPGRADE: ' + WEAPONS[GUNGAME_LADDER[killer.tier]].name });
  }

  onTimeUp() {
    let best = null;
    for (const e of this.game.entities.values()) if (!best || (e.tier || 0) > (best.tier || 0)) best = e;
    this.game.finish({ team: TEAM.NONE, winner: best ? best.id : -1, text: best ? best.name + ' WINS' : 'DRAW' });
  }

  hud() {
    let best = null;
    for (const e of this.game.entities.values()) if (!best || (e.tier || 0) > (best.tier || 0)) best = e;
    return { lim: GUNGAME_LADDER.length, ld: best ? [best.id, best.name, best.tier || 0] : null, ladder: GUNGAME_LADDER };
  }
}

// ------------------------------------------------------------------------------------------------
class Elimination extends BaseMode {
  get respawns() { return false; }
  get scoreLimit() { return this.cfg.scoreLimit || 4; }
  get roundTime() { return 120; }

  setup() {
    this.round = 0;
    this.wins = [0, 0];
    this.startRound();
  }

  startRound() {
    const game = this.game;
    this.round++;
    this.roundState = 'live';
    this.roundEnd = game.time + this.roundTime;
    game.respawnAll();
    game.announce(`ROUND ${this.round}`, TEAM.NONE);
  }

  canRespawn() { return false; }

  update() {
    const game = this.game;
    if (game.phase !== 'live') return;
    if (this.roundState === 'intermission') {
      if (game.time >= this.nextRoundAt) this.startRound();
      return;
    }

    const aliveA = game.aliveCount(TEAM.A), aliveB = game.aliveCount(TEAM.B);
    let winner = -1;
    if (aliveA === 0 && aliveB === 0) winner = TEAM.NONE;
    else if (aliveA === 0) winner = TEAM.B;
    else if (aliveB === 0) winner = TEAM.A;
    else if (game.time >= this.roundEnd) winner = aliveA === aliveB ? TEAM.NONE : aliveA > aliveB ? TEAM.A : TEAM.B;
    if (winner === -1) return;

    if (winner !== TEAM.NONE) {
      this.wins[winner]++;
      game.teamScores[winner] = this.wins[winner];
    }

    if (winner !== TEAM.NONE && this.wins[winner] >= this.scoreLimit) {
      game.finish({ team: winner, text: TEAM_NAMES[winner] + ' WINS THE MATCH' });
      return;
    }

    game.announce(winner === TEAM.NONE ? 'ROUND DRAW' : `${TEAM_NAMES[winner]} WINS ROUND ${this.round}`, winner);
    this.roundState = 'intermission';
    this.nextRoundAt = game.time + 5;
  }

  hud() {
    const game = this.game;
    return {
      s: this.wins || [0, 0], lim: this.scoreLimit,
      // Before the first round (warmup) there is no round state yet.
      rd: this.round
        ? [this.round, this.roundState === 'live' ? Math.max(0, this.roundEnd - game.time) : Math.max(0, (this.nextRoundAt || game.time) - game.time), game.aliveCount(TEAM.A), game.aliveCount(TEAM.B), this.roundState === 'live' ? 1 : 0]
        : [1, this.roundTime, game.aliveCount(TEAM.A), game.aliveCount(TEAM.B), 0],
    };
  }
}

// ------------------------------------------------------------------------------------------------
class Horde extends BaseMode {
  get managesEnemyBots() { return true; }
  get timeLimit() { return 99999; }
  get scoreLimit() { return this.cfg.scoreLimit || 12; }

  assignTeam() { return TEAM.A; }

  setup() {
    this.wave = 0;
    this.state = 'intermission';
    this.nextWaveAt = this.game.time + 6;
    this.game.announce('HORDE: SURVIVE THE WAVES', TEAM.A);
  }

  canRespawn(entity) { return entity.team === TEAM.A && entity.isBot; }
  respawnDelay(entity) { return entity.isBot ? 12 : 999; }

  waveDifficulty() {
    const base = this.game.config.difficulty;
    if (typeof base === 'number') return Math.max(0, Math.min(4, base - 1.2 + this.wave * 0.22)); // adaptive
    if (this.wave >= 9) return 'elite';
    if (this.wave >= 6) return 'hard';
    if (this.wave >= 3) return 'normal';
    return 'easy';
  }

  startWave() {
    const game = this.game;
    this.wave++;
    this.state = 'live';
    const humans = Math.max(1, game.humanCount());
    const count = Math.min(24, 3 + this.wave * 2 + (humans - 1) * 2);
    this.toSpawn = count;
    this.spawnTimer = 0;
    game.announce(`WAVE ${this.wave}`, TEAM.B);
  }

  update(dt) {
    const game = this.game;
    if (game.phase !== 'live') return;
    if (this.state === 'intermission') {
      if (game.time >= this.nextWaveAt) this.startWave();
      return;
    }

    // Trickle enemies in, a few at a time.
    this.spawnTimer -= dt;
    if (this.toSpawn > 0 && this.spawnTimer <= 0 && game.aliveCount(TEAM.B) < 12) {
      const bot = game.spawnBot(TEAM.B, this.waveDifficulty(), { horde: true });
      if (bot) this.toSpawn--;
      this.spawnTimer = 1.2;
    }

    // Defeat: every human is dead.
    const humansAlive = [...game.entities.values()].filter((e) => !e.isBot && e.alive).length;
    if (game.humanCount() > 0 && humansAlive === 0) {
      game.finish({ team: TEAM.B, text: `OVERRUN ON WAVE ${this.wave}` });
      return;
    }

    if (this.toSpawn <= 0 && game.aliveCount(TEAM.B) === 0) {
      game.teamScores[TEAM.A] = this.wave;
      if (this.wave >= this.scoreLimit) {
        game.finish({ team: TEAM.A, text: `SURVIVED ${this.wave} WAVES` });
        return;
      }

      game.announce(`WAVE ${this.wave} CLEARED`, TEAM.A);
      game.removeBots(TEAM.B);
      for (const e of game.entities.values()) {
        if (e.team === TEAM.A && !e.alive) game.respawnEntity(e);
        else if (e.team === TEAM.A) { e.hp = e.maxHp; game.refill(e); }
      }
      this.state = 'intermission';
      this.nextWaveAt = game.time + 8;
    }
  }

  botGoal(bot, rng) {
    if (bot.team === TEAM.B) {
      // Hunt the closest living human.
      let best = null, bestD = Infinity;
      for (const e of this.game.entities.values()) {
        if (!e.alive || e.team !== TEAM.A) continue;
        const d = dist2(bot.motor.x, bot.motor.z, e.motor.x, e.motor.z);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) return { x: best.motor.x + (rng() - 0.5) * 10, z: best.motor.z + (rng() - 0.5) * 10, reason: 'hunt' };
    } else {
      // Allies stay near humans.
      for (const e of this.game.entities.values()) {
        if (!e.isBot && e.alive) return { x: e.motor.x + (rng() - 0.5) * 12, z: e.motor.z + (rng() - 0.5) * 12, reason: 'escort' };
      }
    }
    return super.botGoal(bot, rng);
  }

  hud() {
    return { s: this.game.teamScores, lim: this.scoreLimit, wv: [this.wave, this.state === 'live' ? (this.toSpawn + this.game.aliveCount(TEAM.B)) : 0, this.state === 'live' ? 1 : 0, this.state === 'intermission' ? Math.max(0, this.nextWaveAt - this.game.time) : 0] };
  }
}

// ------------------------------------------------------------------------------------------------
class Duel extends FreeForAll {
  get scoreLimit() { return this.cfg.scoreLimit || 10; }
  get timeLimit() { return this.cfg.timeLimit || 360; }
  respawnDelay() { return 2.5; }

  onTimeUp() {
    const players = [...this.game.entities.values()].filter((e) => !e.isBot).sort((a, b) => b.kills - a.kills);
    const [a, b] = players;
    if (!a || (b && a.kills === b.kills)) this.game.finish({ team: TEAM.NONE, winner: -1, text: 'DRAW' });
    else this.game.finish({ team: TEAM.NONE, winner: a.id, text: a.name + ' WINS' });
  }
}

const MODES = { tdm: TeamDeathmatch, dom: Domination, ffa: FreeForAll, gungame: GunGame, elim: Elimination, horde: Horde, duel: Duel };

export function createMode(id, game) {
  const Mode = MODES[id] || TeamDeathmatch;
  const mode = new Mode(game);
  mode.id = MODES[id] ? id : 'tdm';
  return mode;
}
