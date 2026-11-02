// Entry point: wires the main menu to offline matches (in-browser host), hosted online matches
// (in-browser host + peer-to-peer players), joined online matches (room code), and the social layer: friends,
// squads (the leader hosts, members join automatically) and 1v1 challenges against friends.
import { MAP_LIST } from '../shared/map.js';
import { MODE_LIST, SQUAD_TEAM_SIZE } from '../shared/modes.js';
import { AudioEngine } from './audio.js';
import { MenuShowcase } from './gfx/showcase.js';
import { MainMenu } from './menu.js';
import { HostTransport, JoinTransport, LocalTransport } from './net.js';
import { adaptiveBotLevel, profile, rankedBotLevel } from './profile.js';
import { PLAYLIST_NAMES, social } from './social.js';
import { touchControlsWanted } from './touch.js';
import { ClientSession } from './session.js';
import { settings } from './settings.js';
import { Toasts } from './ui/toasts.js';

let canvas = document.getElementById('game');
const hudRoot = document.getElementById('hud');
const menuRoot = document.getElementById('menu');
const audio = new AudioEngine();
const toasts = new Toasts();
let session = null;
let joiningRoom = false;

const loadout = () => [settings.primary, 'pistol'];
const cosmetics = () => ({ camo: profile.equipped.camo, outfit: profile.equipped.outfit });
// "Adaptive" difficulty becomes the player's current bot level (skill rating + experience, see profile.js).
const resolveDifficulty = (config) => ({ ...config, difficulty: config.difficulty === 'adaptive' ? adaptiveBotLevel() : config.difficulty });
const randomMap = () => MAP_LIST[Math.floor(Math.random() * MAP_LIST.length)].id;
const modeName = (id) => (MODE_LIST.find((m) => m.id === id) || MODE_LIST[0]).name;

let showcase = null;
try { showcase = new MenuShowcase(document.getElementById('menu-bg')); } catch (err) { console.warn('Menu backdrop unavailable', err); }
if (showcase && !showcase.available) showcase = null;

// Ranked: Team Deathmatch 5v5 to 40 kills (8 minutes) on a random map; bots adapt and rise with your rank.
const RANKED_RULES = { mode: 'tdm', scoreLimit: 40, timeLimit: 480 };

function startRanked() {
  startOffline({ ...RANKED_RULES, map: randomMap(), bots: 9, difficulty: rankedBotLevel(), ranked: true }, { requeue: () => startRanked(), tab: 'ranked' });
}

// Ask for mouse capture right away, while the click still counts as a user gesture: building the match takes a
// moment and browsers only honour pointer-lock requests made soon after a click.
function lockEarly() {
  if (touchControlsWanted()) return;
  canvas.style.display = 'block';
  try {
    const r = canvas.requestPointerLock && canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  } catch { /* the session falls back to free-cursor look */ }
}

function startOffline(config, extra = {}) {
  lockEarly();
  const transport = new LocalTransport(config, settings.name, loadout(), cosmetics());
  transport.start();
  startSession(transport, transport.inbox.find((m) => m.type === 'welcome'), true, {
    tab: 'play', label: config.ranked ? 'Ranked TDM' : modeName(config.mode), ...extra,
  });
}

// ------------------------------------------------------------------------------------------------
// Squads: the leader's browser hosts; members' games join automatically. Everyone in the squad is on team A, bots
// fill the remaining slots of both teams, and bots are tuned to the squad's average level.
// ------------------------------------------------------------------------------------------------
async function startSquadMatch(playlist) {
  const ranked = playlist === 'ranked';
  const size = SQUAD_TEAM_SIZE[playlist];
  const n = social.squadSize;
  if (!size) throw new Error('Squads can only play team modes.');
  if (n > size) throw new Error(`Your squad has ${n} players, but ${PLAYLIST_NAMES[playlist]} allows ${size} per team.`);
  const mode = ranked ? 'tdm' : playlist;
  const difficulty = ranked || settings.difficulty === 'adaptive' ? social.squadBotLevel(ranked) : settings.difficulty;
  const config = {
    ...(ranked ? RANKED_RULES : { mode }),
    map: ranked ? randomMap() : settings.map,
    bots: mode === 'horde' ? Math.max(0, size - n) : Math.max(0, 2 * size - n),
    difficulty, ranked, party: true, expect: n,
  };
  const transport = new HostTransport(config, settings.name, loadout(), cosmetics());
  const room = await transport.open();
  transport.start();
  const label = PLAYLIST_NAMES[playlist];
  startSession(transport, transport.inbox.find((m) => m.type === 'welcome'), false, {
    tab: ranked ? 'ranked' : 'play', label: 'Squad · ' + label,
    squad: { leader: true, label },
    requeue: () => { startSquadMatch(playlist).catch((err) => menu.show(ranked ? 'ranked' : 'play', err.message || String(err))); },
  });
  social.squadMatchStarted(room, label);
}

// ------------------------------------------------------------------------------------------------
// 1v1 against a friend: the challenger hosts once the challenge is accepted.
// ------------------------------------------------------------------------------------------------
async function hostDuel(duel) {
  if (session) throw new Error('already in a match');
  const map = MAP_LIST.some((m) => m.id === duel.map) ? duel.map : randomMap();
  const config = { mode: 'duel', map, bots: 0, difficulty: 'normal', duel: duel.kind, expect: 2 };
  const transport = new HostTransport(config, settings.name, loadout(), cosmetics());
  const room = await transport.open();
  transport.start();
  startSession(transport, transport.inbox.find((m) => m.type === 'welcome'), false, {
    tab: 'friends', label: duel.kind === 'showdown' ? 'Showdown 1v1' : 'Friendly 1v1', duel,
    requeue: () => {
      const res = social.challengeFriend(duel.opp.code, duel.kind, duel.map);
      menu.show('friends', res.message);
    },
  });
  return room;
}

/** A squad match or accepted 1v1 is ready: join its room (members of a squad are pulled in automatically). */
async function joinFromSocial(info) {
  if (session) {
    const sameSquad = info.squad && session.squad && !session.squad.leader;
    if (!sameSquad) {
      toasts.show({
        id: 'squad-match', title: 'SQUAD MATCH', text: `${info.leader || 'Your squad'} started a match (${info.label || 'squad'}).`, ttl: 60000,
        actions: [{ label: 'JOIN', primary: true, fn: () => { if (session) session.leave(); joinFromSocial(info); } }],
      });
      return;
    }
    session.closeReason = undefined;
    session.leave();
  }
  if (joiningRoom) return;
  joiningRoom = true;
  const tab = info.duel ? 'friends' : menu.tab;
  menu.setBusy(true, info.duel ? `Joining the 1v1 with ${info.duel.opp.name}…` : `Joining ${info.leader || 'your squad leader'}'s match…`);
  try {
    const transport = new JoinTransport();
    const welcome = await transport.connect(info.room, settings.name, loadout(), cosmetics());
    if (info.duel) {
      startSession(transport, welcome, false, { tab: 'friends', label: info.duel.kind === 'showdown' ? 'Showdown 1v1' : 'Friendly 1v1', duel: info.duel });
    } else {
      startSession(transport, welcome, false, { tab: welcome.cfg && welcome.cfg.ranked ? 'ranked' : 'play', label: 'Squad · ' + (info.label || ''), squad: { leader: false, label: info.label } });
    }
  } catch (err) {
    menu.show(tab, err.message || String(err));
  } finally {
    joiningRoom = false;
  }
}

social.handlers.toast = (t) => toasts.show(t);
social.handlers.hostDuel = hostDuel;
social.handlers.joinRoom = (info) => { joinFromSocial(info); };

const menu = new MainMenu(menuRoot, {
  audio,
  showcase,
  onStartOffline: (config) => startOffline(resolveDifficulty(config)),
  onStartRanked: () => startRanked(),
  onStartSquad: (playlist) => startSquadMatch(playlist),
  onJoinSquadMatch: () => {
    const p = social.party;
    if (p && p.room) joinFromSocial({ room: p.room, squad: true, label: p.label, leader: (p.members.find((m) => m.c === p.leader) || {}).n });
  },
  onHost: async (config) => {
    const transport = new HostTransport(resolveDifficulty(config), settings.name, loadout(), cosmetics());
    await transport.open();
    transport.start();
    startSession(transport, transport.inbox.find((m) => m.type === 'welcome'), false, { tab: 'online', label: 'Online · ' + modeName(config.mode) });
  },
  onJoin: async (code) => {
    const transport = new JoinTransport();
    const welcome = await transport.connect(code, settings.name, loadout(), cosmetics());
    startSession(transport, welcome, false, { tab: 'online', label: 'Online · ' + modeName(welcome.mode) });
  },
});
toasts.onAction = () => audio.click && (audio.ensure(), audio.click());

// A finished match releases its WebGL context (renderer.dispose forces a context loss), and a lost context can't be
// reused, so every match after the first gets a fresh <canvas>.
function freshCanvas() {
  const next = canvas.cloneNode(false);
  next.style.display = 'none';
  canvas.replaceWith(next);
  canvas = next;
}

function startSession(transport, welcome, fromGesture, extra = {}) {
  if (!welcome) return;
  canvas.style.display = 'block';
  try {
    session = new ClientSession({
      transport,
      welcome,
      canvas,
      hudRoot,
      audio,
      requeue: extra.requeue,
      squad: extra.squad,
      duel: extra.duel,
      onRecorded: (report, s) => {
        if (s.duelInfo && report && !report.abandoned) social.recordDuelResult(s.duelInfo.opp.code, report.result);
      },
      onExit: (t, reason, s) => {
        session = null;
        freshCanvas();
        toasts.setHidden(false);
        social.setStatus('menu');
        if (extra.squad && extra.squad.leader && !s.requeued) social.squadMatchEnded();
        if (s.requeued) return; // the next match is starting
        menu.show(extra.tab || (t.offline ? 'play' : 'online'), reason || '');
      },
    });
  } catch (err) {
    // Typically WebGL being unavailable. Return to the menu with an explanation instead of a blank screen.
    console.error(err);
    session = null;
    freshCanvas();
    hudRoot.innerHTML = '';
    hudRoot.classList.remove('active');
    try { transport.close(); } catch { /* ignore */ }
    const text = String((err && err.message) || err);
    menu.show(extra.tab || (transport.offline ? 'play' : 'online'), /webgl/i.test(text)
      ? 'The match could not start because this browser could not create 3D graphics (WebGL). Turn on hardware acceleration in your browser settings, update your graphics driver, or try another browser.'
      : 'The match could not start: ' + text);
    return;
  }
  menu.hide();
  toasts.setHidden(true);
  social.setStatus('match', extra.label || '');
  window.__vanguard = session;
  window.__menu = menu;
  if (fromGesture) session.resume();
}

// Closing the tab: a host ends the match for everyone; a guest leaves it.
const closeOnline = () => { if (session && !session.offline) session.transport.close(); };
window.addEventListener('beforeunload', closeOnline);
window.addEventListener('pagehide', closeOnline);

// iOS Safari: stop pinch-zoom gestures from scaling the game.
document.addEventListener('gesturestart', (e) => e.preventDefault());

window.__vanguardBooted = true;
window.__social = social;
window.__menu = menu;

menu.show('play');
// Friends: register this player's friend code so friends can see them online (no-op where WebRTC is blocked).
setTimeout(() => social.start(), 300);
