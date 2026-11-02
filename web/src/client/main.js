// Entry point: wires the main menu to offline matches (in-browser host), hosted online matches
// (in-browser host + peer-to-peer players) and joined online matches (room code).
import { MAP_LIST } from '../shared/map.js';
import { AudioEngine } from './audio.js';
import { MenuShowcase } from './gfx/showcase.js';
import { MainMenu } from './menu.js';
import { HostTransport, JoinTransport, LocalTransport } from './net.js';
import { adaptiveBotLevel, profile, rankedBotLevel } from './profile.js';
import { touchControlsWanted } from './touch.js';
import { ClientSession } from './session.js';
import { settings } from './settings.js';

const canvas = document.getElementById('game');
const hudRoot = document.getElementById('hud');
const menuRoot = document.getElementById('menu');
const audio = new AudioEngine();
let session = null;

const loadout = () => [settings.primary, 'pistol'];
const cosmetics = () => ({ camo: profile.equipped.camo, outfit: profile.equipped.outfit });
// "Adaptive" difficulty becomes the player's current bot level (skill rating + experience, see profile.js).
const resolveDifficulty = (config) => ({ ...config, difficulty: config.difficulty === 'adaptive' ? adaptiveBotLevel() : config.difficulty });

let showcase = null;
try { showcase = new MenuShowcase(document.getElementById('menu-bg')); } catch (err) { console.warn('Menu backdrop unavailable', err); }
if (showcase && !showcase.available) showcase = null;

// Ranked: Team Deathmatch 5v5 to 40 kills (8 minutes) on a random map; bots adapt and rise with your rank.
function startRanked() {
  startOffline({
    mode: 'tdm', map: MAP_LIST[Math.floor(Math.random() * MAP_LIST.length)].id, bots: 9,
    difficulty: rankedBotLevel(), ranked: true, scoreLimit: 40, timeLimit: 480,
  });
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

function startOffline(config) {
  lockEarly();
  const transport = new LocalTransport(config, settings.name, loadout(), cosmetics());
  transport.start();
  startSession(transport, transport.inbox.find((m) => m.type === 'welcome'), true);
}

const menu = new MainMenu(menuRoot, {
  audio,
  showcase,
  onStartOffline: (config) => startOffline(resolveDifficulty(config)),
  onStartRanked: () => startRanked(),
  onHost: async (config) => {
    const transport = new HostTransport(resolveDifficulty(config), settings.name, loadout(), cosmetics());
    await transport.open();
    transport.start();
    startSession(transport, transport.inbox.find((m) => m.type === 'welcome'), false);
  },
  onJoin: async (code) => {
    const transport = new JoinTransport();
    const welcome = await transport.connect(code, settings.name, loadout(), cosmetics());
    startSession(transport, welcome, false);
  },
});

function startSession(transport, welcome, fromGesture) {
  if (!welcome) return;
  canvas.style.display = 'block';
  try {
    session = new ClientSession({
      transport,
      welcome,
      canvas,
      hudRoot,
      audio,
      requeueRanked: () => startRanked(),
      onExit: (t, reason) => {
        const wasRanked = !!(t.host && t.host.game && t.host.game.config.ranked);
        session = null;
        canvas.style.display = 'none';
        menu.show(t.offline ? (wasRanked ? 'ranked' : 'play') : 'online', reason || '');
      },
    });
  } catch (err) {
    // Typically WebGL being unavailable. Return to the menu with an explanation instead of a blank screen.
    console.error(err);
    session = null;
    canvas.style.display = 'none';
    hudRoot.innerHTML = '';
    hudRoot.classList.remove('active');
    try { transport.close(); } catch { /* ignore */ }
    const text = String((err && err.message) || err);
    menu.show(transport.offline ? 'offline' : 'online', /webgl/i.test(text)
      ? 'The match could not start because this browser could not create 3D graphics (WebGL). Turn on hardware acceleration in your browser settings, update your graphics driver, or try another browser.'
      : 'The match could not start: ' + text);
    return;
  }
  menu.hide();
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

menu.show('play');
