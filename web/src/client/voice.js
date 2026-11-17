// Voice chat for online matches. Peer-to-peer, like the rest of online play: every player in voice calls every other
// player directly (a small mesh, at most 8 people), through the same PeerJS peers the match already uses.
//
//   * Modes (Settings → Voice chat): 'off', 'ptt' (default: you hear everyone and talk while holding V or the 🎙
//     button) or 'open' (your microphone is always on).
//   * The browser asks for the microphone only when it is first needed (the first time you press V, or right away in
//     'open' mode). Until then, and if the microphone is refused, you join as a listener.
//   * The host keeps the list of who is in voice ({ type: 'voice', pid }) and sends it to everyone; of each pair, the
//     player with the smaller peer id places the call, so there is one call per pair.
//   * Each player can be muted locally (pause menu). Speaking indicators come from an analyser on each stream.
import { settings } from './settings.js';

const PID_RE = /^vanguard-fps-[A-Za-z0-9-]{1,48}$/;

export class VoiceChat {
  /**
   * @param {object} o { transport (HostTransport | JoinTransport), myId, onChange() }
   */
  constructor({ transport, myId, onChange }) {
    this.transport = transport;
    this.myId = myId;
    this.onChange = onChange || (() => {});
    this.peer = transport.peer;
    this.mode = 'off';
    this.roster = new Map();   // entity id -> peer id (players in voice, including me)
    this.calls = new Map();    // peer id -> { call, entityId, audio, analyser, data, level }
    this.muted = new Set();    // entity ids muted locally
    this.mic = null;           // microphone MediaStream once granted
    this.micState = 'none';    // none | asking | on | denied
    this.talking = false;
    this.ctx = null;
    this.silent = null;
    this._onCall = (call) => this.incoming(call);
    if (this.peer) this.peer.on('call', this._onCall);
  }

  get available() { return !!this.peer && typeof RTCPeerConnection === 'function'; }

  get myPid() { return this.peer ? this.peer.id : ''; }

  /** Applies the voice setting: joins, changes mode or leaves. */
  setMode(mode) {
    if (!this.available) return;
    const next = ['off', 'ptt', 'open'].includes(mode) ? mode : 'ptt';
    if (next === this.mode) return;
    const was = this.mode;
    this.mode = next;
    if (next === 'off') { this.leave(); this.onChange(); return; }
    if (was === 'off') this.transport.send({ type: 'voice', pid: this.myPid });
    if (next === 'open') this.enableMic();
    this.applyTalk();
    this.onChange();
  }

  audioContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** A silent outgoing stream for listeners (a call needs a stream; the microphone replaces it later). */
  silentStream() {
    if (!this.silent) {
      const ctx = this.audioContext();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createConstantSource ? ctx.createConstantSource() : ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(dest);
      osc.start();
      this.silent = dest.stream;
    }
    return this.silent;
  }

  outStream() { return this.mic || this.silentStream(); }

  /** The host's list of everyone in voice: [[entityId, peerId], ...]. */
  setRoster(list) {
    this.roster.clear();
    for (const row of Array.isArray(list) ? list : []) {
      const [id, pid] = row;
      if (Number.isInteger(id) && typeof pid === 'string' && PID_RE.test(pid)) this.roster.set(id, pid);
    }
    if (this.mode === 'off') return;
    const live = new Set(this.roster.values());
    for (const [pid, c] of this.calls) if (!live.has(pid)) { this.closeCall(pid, c); }
    for (const [id, pid] of this.roster) {
      if (id === this.myId || pid === this.myPid || this.calls.has(pid)) continue;
      if (this.myPid < pid) this.call(pid);
    }
    this.onChange();
  }

  call(pid) {
    let call;
    try { call = this.peer.call(pid, this.outStream()); } catch { return; }
    if (!call) return;
    this.bind(call, pid);
  }

  /** Only players in this match know our peer id (the host shares it), so any well-formed caller is accepted. */
  incoming(call) {
    const pid = call.peer;
    if (this.mode === 'off' || !PID_RE.test(pid || '') || this.calls.has(pid)) { try { call.close(); } catch { /* ignore */ } return; }
    call.answer(this.outStream());
    this.bind(call, pid);
  }

  entityFor(pid) {
    for (const [id, p] of this.roster) if (p === pid) return id;
    return -1;
  }

  bind(call, pid) {
    const voice = this;
    const c = { call, pid, get entityId() { return voice.entityFor(pid); }, audio: null, analyser: null, data: null, level: 0 };
    this.calls.set(pid, c);
    call.on('stream', (stream) => {
      if (c.audio) return;
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = stream;
      audio.volume = this.volumeFor(c.entityId);
      audio.play().catch(() => { /* resumes on the next user gesture */ });
      c.audio = audio;
      try {
        const ctx = this.audioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        c.analyser = analyser;
        c.data = new Uint8Array(analyser.fftSize);
      } catch { /* no speaking indicator */ }
      // If the microphone was granted after the call started, the sender may still carry the silent track.
      if (this.mic) this.replaceTrack(c);
      this.onChange();
    });
    const drop = () => { if (this.calls.get(pid) === c) this.closeCall(pid, c); };
    call.on('close', drop);
    call.on('error', drop);
  }

  closeCall(pid, c) {
    this.calls.delete(pid);
    try { c.call.close(); } catch { /* ignore */ }
    if (c.audio) { c.audio.pause(); c.audio.srcObject = null; }
    this.onChange();
  }

  volumeFor(entityId) {
    return this.muted.has(entityId) ? 0 : Math.max(0, Math.min(1, settings.voiceVolume ?? 0.9));
  }

  applyVolumes() {
    for (const c of this.calls.values()) if (c.audio) c.audio.volume = this.volumeFor(c.entityId);
  }

  toggleMute(entityId) {
    if (this.muted.has(entityId)) this.muted.delete(entityId); else this.muted.add(entityId);
    this.applyVolumes();
    this.onChange();
  }

  /** Asks for the microphone (once) and swaps it into every call. */
  async enableMic() {
    if (this.mic || this.micState === 'asking' || this.micState === 'denied') return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.micState = 'denied'; this.onChange(); return; }
    this.micState = 'asking';
    this.onChange();
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.micState = 'on';
      if (this.mode === 'off') { this.stopMic(); return; }
      for (const c of this.calls.values()) this.replaceTrack(c);
      this.applyTalk();
    } catch {
      this.micState = 'denied';
    }
    this.onChange();
  }

  replaceTrack(c) {
    const track = this.mic && this.mic.getAudioTracks()[0];
    const pc = c.call && c.call.peerConnection;
    if (!track || !pc || !pc.getSenders) return;
    for (const sender of pc.getSenders()) {
      if (sender.track && sender.track.kind === 'audio' && sender.track !== track) sender.replaceTrack(track).catch(() => {});
    }
  }

  stopMic() {
    if (this.mic) for (const t of this.mic.getTracks()) t.stop();
    this.mic = null;
    if (this.micState === 'on') this.micState = 'none';
  }

  /** Push-to-talk: called every frame with whether V / 🎙 is held. */
  setTalking(held) {
    if (this.mode === 'off') { this.talking = false; return; }
    const want = this.mode === 'open' || !!held;
    if (want && !this.mic && this.mode === 'ptt' && held) this.enableMic();
    if (want === this.talking) return;
    this.talking = want;
    this.applyTalk();
    this.onChange();
  }

  applyTalk() {
    if (!this.mic) return;
    const on = this.mode === 'open' || this.talking;
    for (const t of this.mic.getAudioTracks()) t.enabled = on;
  }

  /** True while your microphone is actually sending. */
  get transmitting() { return !!this.mic && this.mode !== 'off' && (this.mode === 'open' || this.talking); }

  /** Entity ids currently speaking (updated by sampling each stream's level). */
  speakers() {
    const out = [];
    for (const c of this.calls.values()) {
      if (!c.analyser) continue;
      c.analyser.getByteTimeDomainData(c.data);
      let sum = 0;
      for (let i = 0; i < c.data.length; i++) { const v = (c.data[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / c.data.length);
      c.level = Math.max(rms, c.level * 0.8);
      if (c.level > 0.02 && !this.muted.has(c.entityId)) out.push(c.entityId);
    }
    return out;
  }

  /** Players in voice besides you: [{ id, connected, muted }]. */
  members() {
    const out = [];
    for (const [id, pid] of this.roster) {
      if (id === this.myId) continue;
      const c = this.calls.get(pid);
      out.push({ id, connected: !!(c && c.audio), muted: this.muted.has(id) });
    }
    return out;
  }

  leave() {
    for (const [pid, c] of [...this.calls]) this.closeCall(pid, c);
    this.stopMic();
    this.talking = false;
    try { this.transport.send({ type: 'voice', pid: '' }); } catch { /* ignore */ }
  }

  dispose() {
    if (this.mode !== 'off') this.leave();
    this.mode = 'off';
    if (this.peer && this.peer.off) this.peer.off('call', this._onCall);
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
