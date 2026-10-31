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
  menu.hide();
  canvas.style.display = 'block';
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
  window.__vanguard = session;
  if (fromGesture) session.resume();
}

// Closing the tab: a host ends the match for everyone; a guest leaves it.
const closeOnline = () => { if (session && !session.offline) session.transport.close(); };
window.addEventListener('beforeunload', closeOnline);
window.addEventListener('pagehide', closeOnline);
