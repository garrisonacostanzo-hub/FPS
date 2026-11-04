// Connection check for online play and friends. It tests each piece separately and explains in plain words what a
// network or managed device (school / work Chromebook) is blocking:
//   1. WebRTC: whether this browser allows peer-to-peer connections at all (administrators can turn it off).
//   2. Matchmaking: whether the PeerJS matchmaking service can be reached (used to find hosts and friends).
//   3. Direct: whether a public address can be discovered (STUN), which direct peer-to-peer connections need.
//   4. Relay: whether the TURN relay can be reached, the fallback when direct connections are blocked.
import { ICE_SERVERS, createPeer, isEmbedded, signalingHost, watchPolicy, webrtcSupported } from './net.js';

const SIGNAL_TIMEOUT = 10000;
const ICE_TIMEOUT = 8000;

function testSignaling() {
  return new Promise((resolve) => {
    let peer = null;
    let done = false;
    const finish = (ok, why) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unwatch();
      try { if (peer && !peer.destroyed) peer.destroy(); } catch { /* ignore */ }
      resolve({ ok, why });
    };
    const unwatch = watchPolicy(() => finish(false, 'policy'));
    const timer = setTimeout(() => finish(false, 'timeout'), SIGNAL_TIMEOUT);
    try {
      peer = createPeer('vanguard-fps-check-' + Math.random().toString(36).slice(2, 12));
    } catch {
      finish(false, 'error');
      return;
    }
    peer.on('open', () => finish(true));
    peer.on('error', (err) => finish(false, (err && err.type) || 'error'));
  });
}

function testIce() {
  return new Promise((resolve) => {
    const found = { host: false, srflx: false, relay: false };
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    } catch {
      resolve({ ...found, error: true });
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { pc.close(); } catch { /* ignore */ }
      resolve(found);
    };
    const timer = setTimeout(finish, ICE_TIMEOUT);
    pc.onicecandidate = (e) => {
      if (!e.candidate) { finish(); return; }
      const m = / typ (host|srflx|prflx|relay)/.exec(e.candidate.candidate || '');
      const type = e.candidate.type || (m && m[1]);
      if (type === 'host') found.host = true;
      else if (type === 'srflx' || type === 'prflx') found.srflx = true;
      else if (type === 'relay') found.relay = true;
      if (found.srflx && found.relay) finish();
    };
    try {
      pc.createDataChannel('check');
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(finish);
    } catch {
      finish();
    }
  });
}

/**
 * Runs the check. Resolves with { webrtc, embedded, signaling: {ok, why}, ice: {host, srflx, relay}, verdict, lines }
 * where verdict is 'ok' | 'relay' | 'no-webrtc' | 'no-signaling' | 'no-p2p' and lines are plain-language results.
 */
export async function checkConnection() {
  const result = { webrtc: webrtcSupported(), embedded: isEmbedded(), signaling: null, ice: null, verdict: '', lines: [] };
  if (!result.webrtc) {
    result.verdict = 'no-webrtc';
    result.lines.push(['bad', 'Peer-to-peer connections (WebRTC) are turned off in this browser. On school or work Chromebooks the administrator can turn them off.']);
    return result;
  }
  const [signaling, ice] = await Promise.all([testSignaling(), testIce()]);
  result.signaling = signaling;
  result.ice = ice;
  const host = signalingHost();
  result.lines.push(signaling.ok
    ? ['ok', `Matchmaking service (${host}): reachable.`]
    : ['bad', signaling.why === 'policy'
      ? 'Matchmaking service: blocked by the page this game is open in. Open the downloaded VANGUARD.html directly.'
      : `Matchmaking service (${host}): blocked or unreachable on this network.`]);
  result.lines.push(ice.srflx
    ? ['ok', 'Direct peer-to-peer connections over the internet: allowed.']
    : ['bad', 'Direct peer-to-peer connections over the internet: blocked on this network or device.']);
  result.lines.push(ice.relay
    ? ['ok', 'Relay fallback: reachable.']
    : ['bad', 'Relay fallback: blocked on this network or device.']);
  if (!signaling.ok) result.verdict = 'no-signaling';
  else if (!ice.srflx && !ice.relay) result.verdict = 'no-p2p';
  else if (!ice.srflx) result.verdict = 'relay';
  else result.verdict = 'ok';
  return result;
}

/** One-paragraph explanation of a result. */
export function verdictText(r) {
  const managed = 'School and work networks (and school Chromebooks) are set up by their IT staff, and many block online games. '
    + 'Online play works on a home network, and offline play works everywhere. To use it at school, ask your school\'s IT staff '
    + 'whether they will allow it: the game needs access to 0.peerjs.com and peer-to-peer (WebRTC) connections.';
  switch (r.verdict) {
    case 'ok': return 'Everything online play and friends need works on this network.';
    case 'relay': return 'Direct connections are blocked here, but the relay works, so online play should still work (with a little more lag).';
    case 'no-webrtc': return managed;
    case 'no-signaling': return (r.embedded ? 'This page may be inside a viewer that blocks connections: open the downloaded file directly. ' : '') + managed;
    case 'no-p2p': return 'The matchmaking service works, but this network or device blocks the peer-to-peer connections the game uses. ' + managed;
    default: return '';
  }
}
