'use strict';
/* Procedural sound effects and music (WebAudio). Nothing is loaded from files. */
const SFX = (() => {
  let ctx = null, master, sfxBus, musicBus, noiseBuf;
  let muted = false;
  try { muted = localStorage.getItem('shuttlesticks.muted') === '1'; } catch (e) { /* storage blocked */ }

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.24;
    musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function noise(t, dur, filterType, freq, q, peak, a = 0.005, out = sfxBus) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, a, peak, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + a + dur + 0.05);
    return f;
  }
  function tone(t, type, f0, f1, dur, peak, a = 0.004, out = sfxBus) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    env(g, t, a, peak, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + a + dur + 0.05);
    return o;
  }

  const sounds = {
    hit(power = 1400) {
      const t = ctx.currentTime;
      const k = Math.min(1.4, Math.max(0.5, power / 1500));
      noise(t, 0.04, 'bandpass', 2600, 1.2, 0.5 * k);
      tone(t, 'triangle', 1400 * k, 380, 0.07, 0.35 * k);
      tone(t, 'square', 520, 260, 0.03, 0.06 * k);
    },
    whoosh() {
      const t = ctx.currentTime;
      const f = noise(t, 0.16, 'bandpass', 500, 1.6, 0.28, 0.05);
      f.frequency.exponentialRampToValueAtTime(2400, t + 0.18);
    },
    ding() {
      const t = ctx.currentTime;
      tone(t, 'sine', 1568, 1568, 0.9, 0.3);
      tone(t, 'sine', 2349, 2349, 0.6, 0.12);
      tone(t, 'triangle', 3136, 3136, 0.25, 0.05);
    },
    cheer() {
      const t = ctx.currentTime;
      for (let i = 0; i < 14; i++) {
        const s = t + Math.random() * 1.2;
        noise(s, 0.4 + Math.random() * 0.6, 'bandpass', 900 + Math.random() * 1400, 1.5, 0.08 + Math.random() * 0.08, 0.08);
      }
      tone(t + 0.2, 'sine', 1800, 2600, 0.35, 0.08, 0.05);
      tone(t + 0.7, 'sine', 2000, 2900, 0.3, 0.06, 0.05);
      tone(t + 0.1, 'sine', 523, 523, 0.25, 0.12);
      tone(t + 0.25, 'sine', 659, 659, 0.25, 0.12);
      tone(t + 0.4, 'sine', 784, 784, 0.5, 0.14);
    },
    sigh() {
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(260, t);
      o.frequency.exponentialRampToValueAtTime(130, t + 0.9);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 800;
      const g = ctx.createGain();
      env(g, t, 0.12, 0.16, 0.9);
      o.connect(f).connect(g).connect(sfxBus);
      o.start(t);
      o.stop(t + 1.2);
      noise(t, 0.8, 'lowpass', 700, 0.5, 0.05, 0.15);
    },
    pop() {
      const t = ctx.currentTime;
      tone(t, 'sine', 900, 140, 0.12, 0.45);
      noise(t, 0.02, 'highpass', 3000, 0.7, 0.3);
    },
    thud() {
      const t = ctx.currentTime;
      tone(t, 'sine', 140, 38, 0.3, 0.6);
      noise(t, 0.15, 'lowpass', 500, 0.7, 0.3);
    },
    click() {
      const t = ctx.currentTime;
      tone(t, 'square', 880, 660, 0.04, 0.08);
    },
  };

  /* ---------------- music (js/music.js) ---------------- */
  let engine = null, timer = null;
  function pump() {
    if (!ctx || !engine) return;
    // background tabs throttle timers to ~1 s, so schedule further ahead while hidden
    engine.scheduleUntil(ctx.currentTime + (document.hidden ? 1.5 : 0.15));
  }

  return {
    unlock,
    play(name, arg) {
      if (!ctx || muted) return;
      const f = sounds[name];
      if (f) f(arg);
    },
    music(name) {
      if (!init()) return;
      if (!engine) engine = MUSIC.create(ctx, musicBus);
      engine.play(name);
      pump();
      if (!timer) timer = setInterval(pump, 25);
    },
    stopMusic() { if (engine) engine.play(null); },
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('shuttlesticks.muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.02);
      return muted;
    },
  };
})();
window.SFX = SFX;
