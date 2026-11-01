// Entry point: wires the main menu to offline matches (in-browser host), hosted online matches
// (in-browser host + peer-to-peer players) and joined online matches (room code).
import { AudioEngine } from './audio.js';
import { MainMenu } from './menu.js';
import { HostTransport, JoinTransport, LocalTransport } from './net.js';
import { ClientSession } from './session.js';
import { settings } from './settings.js';

const canvas = document.getElementById('game');
const hudRoot = document.getElementById('hud');
const menuRoot = document.getElementById('menu');
const audio = new AudioEngine();
let session = null;

const loadout = () => [settings.primary, 'pistol'];

const menu = new MainMenu(menuRoot, {
  audio,
  onStartOffline: (config) => {
    const transport = new LocalTransport(config, settings.name, loadout());
    transport.start();
    startSession(transport, transport.inbox.find((m) => m.type === 'welcome'), true);
  },
  onHost: async (config) => {
    const transport = new HostTransport(config, settings.name, loadout());
    await transport.open();
    transport.start();
    startSession(transport, transport.inbox.find((m) => m.type === 'welcome'), false);
  },
  onJoin: async (code) => {
    const transport = new JoinTransport();
    const welcome = await transport.connect(code, settings.name, loadout());
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
      onExit: (t, reason) => {
        session = null;
        canvas.style.display = 'none';
        menu.show(t.offline ? 'offline' : 'online', reason || '');
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
  if (fromGesture) session.resume();
}

// Closing the tab: a host ends the match for everyone; a guest leaves it.
const closeOnline = () => { if (session && !session.offline) session.transport.close(); };
window.addEventListener('beforeunload', closeOnline);
window.addEventListener('pagehide', closeOnline);

// iOS Safari: stop pinch-zoom gestures from scaling the game.
document.addEventListener('gesturestart', (e) => e.preventDefault());

window.__vanguardBooted = true;
