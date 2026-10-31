// Entry point: wires the main menu to offline (in-browser host) and online (WebSocket) sessions.
import { AudioEngine } from './audio.js';
import { MainMenu } from './menu.js';
import { LocalTransport } from './net.js';
import { ClientSession } from './session.js';
import { settings } from './settings.js';

const canvas = document.getElementById('game');
const hudRoot = document.getElementById('hud');
const menuRoot = document.getElementById('menu');
const audio = new AudioEngine();
let session = null;

const menu = new MainMenu(menuRoot, {
  audio,
  onStartOffline: (config) => {
    const transport = new LocalTransport(config, settings.name, [settings.primary, 'pistol']);
    transport.start();
    const welcome = transport.inbox.find((m) => m.type === 'welcome');
    startSession(transport, welcome, true);
  },
  onStartOnline: (transport, welcome) => startSession(transport, welcome, false),
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
    onExit: (t) => {
      session = null;
      canvas.style.display = 'none';
      if (t.offline) {
        menu.show('offline');
      } else {
        t.setHandler((msg) => menu.onLobbyMessage(msg));
        menu.show('online');
      }
    },
  });
  window.__vanguard = session;
  if (fromGesture) session.resume();
}

window.addEventListener('beforeunload', () => {
  if (session && !session.offline) session.transport.close();
});
