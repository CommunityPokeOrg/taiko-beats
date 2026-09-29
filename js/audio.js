/* Taiko Beats — WebAudio: synthesized taiko drums + playback scheduling.
   No external audio assets; everything is generated. */
"use strict";

const AudioEngine = {
  ctx: null,
  master: null,
  _noiseBuf: null,

  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
      // Shared white-noise buffer for hats / rim / attack noise
      const len = this.ctx.sampleRate * 1;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },

  now() { return this.ctx ? this.ctx.currentTime : 0; },

  _env(t, a, d, peak = 1) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(this.master);
    return g;
  },

  _noise(t, dur, filterType, freq, q, gain) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = this._env(t, 0.002, dur, gain);
    src.connect(f); f.connect(g);
    src.start(t); src.stop(t + dur + 0.05);
  },

  /* Big taiko "don": low membrane thump + skin slap */
  don(t, vol = 1) {
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.12);
    const g = this._env(t, 0.003, 0.32, 0.9 * vol);
    o.connect(g); o.start(t); o.stop(t + 0.4);
    this._noise(t, 0.04, "lowpass", 2400, 0.8, 0.25 * vol);
  },

  /* Rim shot "ka": woody high crack */
  ka(t, vol = 1) {
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(820, t);
    o.frequency.exponentialRampToValueAtTime(340, t + 0.05);
    const g = this._env(t, 0.001, 0.09, 0.55 * vol);
    o.connect(g); o.start(t); o.stop(t + 0.12);
    this._noise(t, 0.045, "bandpass", 3200, 2.5, 0.5 * vol);
  },

  /* Kick for the synth backing track */
  kick(t, vol = 1) {
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    const g = this._env(t, 0.002, 0.22, 0.8 * vol);
    o.connect(g); o.start(t); o.stop(t + 0.28);
  },

  /* Closed hi-hat tick */
  hat(t, vol = 1) { this._noise(t, 0.035, "highpass", 7800, 1, 0.16 * vol); },

  /* Snare-ish backbeat for backing track */
  snare(t, vol = 1) {
    this._noise(t, 0.09, "bandpass", 1900, 1.1, 0.5 * vol);
    const o = this.ctx.createOscillator();
    o.type = "triangle"; o.frequency.value = 195;
    const g = this._env(t, 0.002, 0.08, 0.28 * vol);
    o.connect(g); o.start(t); o.stop(t + 0.12);
  },

  /* UI tick */
  tick(t) { this.hat(t, 0.6); },

  play(inst, t, vol = 1) {
    this.ensure();
    (this[inst] || this.don).call(this, t, vol);
  },
};

/* Lookahead scheduler: feeds events [{t(ms), inst}] to the kit just ahead
   of the audio clock. Returns a handle with stop(). */
function createScheduler(events, t0, offsetSec) {
  const LOOKAHEAD_MS = 140, TICK_MS = 30;
  let i = 0, timer = null;
  const sorted = events.slice().sort((a, b) => a.t - b.t);
  function pump() {
    const nowMs = (AudioEngine.now() - t0) * 1000;
    const horizon = nowMs + LOOKAHEAD_MS;
    while (i < sorted.length && sorted[i].t <= horizon) {
      const ev = sorted[i++];
      const at = t0 + offsetSec + ev.t / 1000;
      AudioEngine.play(ev.inst, Math.max(at, AudioEngine.now() + 0.001), ev.vol ?? 1);
    }
    return i >= sorted.length;
  }
  timer = setInterval(() => { if (pump()) clearInterval(timer); }, TICK_MS);
  pump();
  return { stop() { if (timer) clearInterval(timer); timer = null; } };
}
