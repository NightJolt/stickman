'use strict';
/*
 * Music engine: a small multitrack synth (drums, bass, pads, plucks, lead, FM electric piano, bells)
 * feeding a shared reverb, a tempo-synced ping-pong delay, kick-driven ducking and a glue compressor.
 * Both tracks are original compositions written as data below; nothing is loaded from files.
 *
 *   MUSIC.create(audioContext, outputNode) -> { play(name|null), scheduleUntil(time), playing }
 */
const MUSIC = (() => {
  /* ------------------------------------------------------------ notation */
  const NOTE_RE = /^([A-G])([#b]?)(-?\d)$/;
  const midi = (name) => {
    const m = NOTE_RE.exec(name);
    const semi = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return semi + (Number(m[3]) + 1) * 12;
  };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const notes = (s) => s.split(' ').map(midi);
  // one bar of melody: "step:note:length ..." in 16th notes
  const phrase = (s) => s.trim().split(/\s+/).map((e) => {
    const [st, n, len] = e.split(':');
    return { s: Number(st), m: midi(n), len: Number(len) };
  });
  // arrangement: [[section, [chord per bar]], ...] -> flat bar list
  const arrange = (sections) => {
    const out = [];
    for (const [sec, chords] of sections) chords.forEach((chord, i) => out.push({ sec, chord, i, n: chords.length }));
    return out;
  };
  const pick = (bars, b) => bars[b.i % bars.length];

  /* ------------------------------------------------------------ "Feather Fever" (match theme) */
  // A minor, 128 bpm. Pumping offbeat bass, sidechained pads, plucked arps, a hooky lead.
  const GAME_CH = {
    Am: { root: midi('A1'), pad: notes('A3 C4 E4'), arp: notes('A4 C5 E5') },
    F:  { root: midi('F1'), pad: notes('F3 A3 C4'), arp: notes('F4 A4 C5') },
    C:  { root: midi('C2'), pad: notes('G3 C4 E4'), arp: notes('G4 C5 E5') },
    G:  { root: midi('G1'), pad: notes('G3 B3 D4'), arp: notes('G4 B4 D5') },
    E:  { root: midi('E1'), pad: notes('G#3 B3 E4'), arp: notes('G#4 B4 E5') },
    Em: { root: midi('E1'), pad: notes('G3 B3 E4'), arp: notes('G4 B4 E5') },
    Dm: { root: midi('D2'), pad: notes('F3 A3 D4'), arp: notes('F4 A4 D5') },
  };
  const VERSE = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'E'];
  const CHORUS = ['F', 'G', 'Em', 'Am', 'Dm', 'G', 'E', 'E'];
  const HOOK = [
    '0:A5:2 2:G5:1 3:E5:3 6:D5:1 7:E5:3 10:G5:2 12:E5:4',
    '0:C5:2 2:D5:1 3:E5:3 6:F5:2 8:E5:2 10:D5:2 12:C5:4',
    '0:G5:2 2:E5:1 3:C5:3 6:D5:1 7:E5:3 10:G5:2 12:C6:4',
    '0:B5:3 3:A5:1 4:G5:2 6:D5:2 8:B4:4 12:D5:2 14:G5:2',
    '0:A5:2 2:G5:1 3:E5:3 6:D5:1 7:E5:3 10:G5:2 12:E5:4',
    '0:C6:2 2:A5:1 3:F5:3 6:A5:2 8:G5:2 10:F5:2 12:E5:4',
    '0:E5:2 2:G5:1 3:C6:3 6:B5:1 7:C6:3 10:D6:2 12:E6:4',
    '0:B5:3 3:G#5:1 4:E5:4 8:F5:2 10:E5:2 12:D5:2 14:G#4:2',
  ].map(phrase);
  const ANTHEM = [
    '0:C6:6 6:A5:2 8:C6:4 12:D6:4',
    '0:B5:6 6:G5:2 8:B5:4 12:D6:4',
    '0:E6:6 6:D6:2 8:B5:4 12:G5:4',
    '0:A5:8 8:C6:2 10:B5:2 12:A5:2 14:G5:2',
    '0:F5:6 6:A5:2 8:D6:4 12:C6:4',
    '0:B5:4 4:D6:4 8:G5:4 12:B5:4',
    '0:G#5:6 6:B5:2 8:E6:4 12:D6:4',
    '0:B5:8 8:G#5:4 12:E5:4',
  ].map(phrase);
  // [step, semitones above root, length]
  const GAME_BASS = [[2, 0, 2], [6, 0, 2], [7, 12, 1], [10, 0, 2], [14, 0, 1], [15, 12, 1]];
  const ARP = [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 4, 3, 2, 1];

  const game = {
    bpm: 128,
    swing: 0,
    seq: arrange([['intro', ['Am', 'Am']], ['verse', VERSE], ['hook', VERSE], ['chorus', CHORUS], ['chorus2', CHORUS]]),
    loopFrom: 2,
    step(k, b, i, t, s16) {
      const c = GAME_CH[b.chord];
      const sec = b.sec;
      const chorus = sec === 'chorus' || sec === 'chorus2';
      // drums
      if (i % 4 === 0) k.kick(t, 1, true);
      if (sec !== 'intro' && sec !== 'verse' && (i === 4 || i === 12)) k.clap(t, 0.55);
      if (chorus) {
        if (i % 4 === 2) k.hat(t, 0.3, true);
        k.shaker(t, i % 2 ? 0.2 : 0.12);
      } else if (i % 4 === 2) k.hat(t, 0.4);
      else if (i % 2 === 1) k.hat(t, 0.13 + Math.random() * 0.06);
      if (i === 0 && b.i === 0 && sec !== 'intro') k.crash(t, 0.2);
      if (sec === 'chorus2' && b.i === b.n - 1 && i >= 8) k.snare(t, 0.18 + (i - 8) * 0.05);
      // bass
      for (const [st, off, len] of GAME_BASS) if (st === i) k.bass(t, c.root + 12 + off, len * s16 * 0.85, 0.32);
      if (sec === 'intro') return;
      // harmony
      if (i === 0) k.pad(t, c.pad, 16 * s16, chorus ? 0.028 : 0.024);
      if (sec !== 'chorus') {
        const tones = [c.arp[0], c.arp[1], c.arp[2], c.arp[0] + 12, c.arp[1] + 12];
        k.pluck(t, tones[ARP[i]], (sec === 'hook' ? 0.055 : 0.08) * (i % 4 === 0 ? 1.25 : 1), i % 2 ? 0.35 : -0.35);
      }
      // lead
      const line = sec === 'hook' ? pick(HOOK, b) : chorus ? pick(ANTHEM, b) : null;
      if (line) for (const n of line) if (n.s === i) k.lead(t, n.m - 12, n.len * s16 * 0.92, 0.115);
    },
  };

  /* ------------------------------------------------------------ "Sunday Rally" (menu theme) */
  // F major, 86 bpm swung. Electric piano chords, round bass, brushed boom-bap and a bell melody.
  const TITLE_CH = {
    Bbmaj7: { root: midi('Bb2'), keys: notes('D4 F4 A4 C5') },
    Am7:    { root: midi('A2'), keys: notes('C4 E4 G4 B4') },
    Gm7:    { root: midi('G2'), keys: notes('Bb3 D4 F4 A4') },
    C13:    { root: midi('C3'), keys: notes('Bb3 D4 E4 A4') },
    Fmaj7:  { root: midi('F2'), keys: notes('A3 C4 E4 G4') },
    Dm7:    { root: midi('D3'), keys: notes('F3 A3 C4 E4') },
    C9:     { root: midi('C3'), keys: notes('Bb3 D4 E4 G4') },
  };
  const TITLE_PROG = ['Bbmaj7', 'Am7', 'Gm7', 'C13', 'Fmaj7', 'Dm7', 'Gm7', 'C9'];
  const TUNE = [
    '0:D5:2 2:F5:2 4:A5:4 10:G5:2 12:F5:4',
    '0:E5:4 6:C5:2 8:E5:2 10:G5:4',
    '0:F5:2 2:D5:2 4:Bb4:4 10:C5:2 12:D5:4',
    '0:E5:6 8:G5:2 10:Bb5:2 12:A5:2 14:G5:2',
    '0:A5:4 4:C6:2 6:A5:2 8:G5:4 12:E5:4',
    '0:F5:4 6:A5:2 8:D5:4 12:C5:2 14:D5:2',
    '0:Bb5:3 3:A5:3 6:G5:2 8:F5:4 12:D5:4',
    '0:E5:4 4:G5:4 8:C5:8',
  ].map(phrase);
  const COMP_A = [[0, 7, 1], [7, 3, 0.62], [10, 6, 0.8]];
  const COMP_B = [[0, 10, 1], [10, 6, 0.75]];

  const title = {
    bpm: 86,
    swing: 0.2,
    tone: 9000,
    gain: 1.45, // sparser arrangement; matches the match theme's loudness
    seq: arrange([['intro', TITLE_PROG.slice(0, 4)], ['groove', TITLE_PROG], ['tune', TITLE_PROG]]),
    loopFrom: 4,
    begin(k, t) { k.hiss(t); },
    step(k, b, i, t, s16, next) {
      const c = TITLE_CH[b.chord];
      for (const [st, len, v] of b.sec === 'tune' ? COMP_B : COMP_A) if (st === i) k.ep(t, c.keys, len * s16, 0.085 * v);
      k.crackle(t, s16);
      if (b.sec === 'intro') return;
      // drums
      if (i === 0 || i === 10 || (i === 7 && b.i % 2 === 1)) k.kick(t, i === 7 ? 0.57 : 0.9, false, true);
      if (i === 4 || i === 12) k.rim(t, 0.4);
      if (i % 2 === 0) k.hat(t, i % 4 === 0 ? 0.22 : 0.14, false, true);
      // bass, with a walk-up into the next chord
      const nr = TITLE_CH[next.chord].root;
      if (i === 0) k.softBass(t, c.root, 5 * s16, 0.13);
      if (i === 10) k.softBass(t, c.root + 7, 3 * s16, 0.11);
      if (i === 14) k.softBass(t, nr === c.root ? c.root + 12 : nr + (nr > c.root ? -1 : 1), 1.6 * s16, 0.1);
      // melody
      if (b.sec === 'tune') for (const n of pick(TUNE, b)) if (n.s === i) k.bell(t, n.m, n.len * s16, 0.13);
    },
  };

  const SONGS = { game, title };

  /* ------------------------------------------------------------ engine */
  function impulse(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const pre = Math.floor(rate * 0.012);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const k = i / len;
        lp += (Math.random() * 2 - 1 - lp) * (0.6 - 0.45 * k); // darker as the tail decays
        d[i] = lp * Math.pow(1 - k, decay);
      }
    }
    return buf;
  }

  /* ------------------------------------------------------------ one-shot synthesis */
  // Drums and plucks are rendered once into sample buffers, so each hit is a single cheap playback
  // node instead of a stack of oscillators and filters (the hats alone were 6 oscillators per hit).
  function biquad(d, sr, type, f, q = 1.12) {
    const w = (2 * Math.PI * f) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < d.length; i++) {
      const x = d[i];
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      d[i] = y;
    }
    return d;
  }
  // exponential attack from silence, then exponential decay (same curve as WebAudio's ramps)
  const env = (t, a, dec) => (t < 0 ? 0 : t < a ? 1e-4 * Math.pow(1e4, t / a) : t < a + dec ? Math.pow(1e-4, (t - a) / dec) : 0);
  const whiteNoise = (n) => { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return d; };
  const tri = (ph) => 1 - 4 * Math.abs(ph - 0.5);
  function polyblep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }
  const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];
  function metal(sr, n, base) {
    const d = new Float32Array(n);
    const ph = HAT_RATIOS.map(() => Math.random());
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let k = 0; k < 6; k++) {
        ph[k] += (base * HAT_RATIOS[k]) / sr;
        if (ph[k] >= 1) ph[k] -= 1;
        v += ph[k] < 0.5 ? 1 : -1;
      }
      d[i] = v;
    }
    return d;
  }
  const SHOT = {
    kick(sr, soft) {
      const n = Math.floor(sr * 0.5), d = new Float32Array(n);
      const f0 = soft ? 120 : 155, f1 = soft ? 48 : 44, sweep = soft ? 0.09 : 0.12, dec = soft ? 0.3 : 0.42;
      const click = biquad(whiteNoise(n), sr, 'highpass', soft ? 1500 : 2500);
      // a little saturation adds the harmonics that let a kick read on small speakers
      const drive = soft ? 1.4 : 2, norm = Math.tanh(drive);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += (t < sweep ? f0 * Math.pow(f1 / f0, t / sweep) : f1) / sr;
        const body = Math.tanh(Math.sin(2 * Math.PI * ph) * env(t, 0.002, dec) * drive) / norm;
        d[i] = body + click[i] * env(t, 0.001, 0.012) * (soft ? 0.12 : 0.3);
      }
      return d;
    },
    clap(sr) {
      const n = Math.floor(sr * 0.25);
      const d = biquad(biquad(whiteNoise(n), sr, 'bandpass', 1400, 0.8), sr, 'highpass', 600);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let a;
        if (t < 0.033) { const o = t < 0.011 ? 0 : t < 0.022 ? 0.011 : 0.022; a = t - o < 0.009 ? Math.pow(0.12, (t - o) / 0.009) : 0.12; }
        else a = 0.75 * Math.pow(1e-4 / 0.75, Math.min(1, (t - 0.033) / 0.167));
        d[i] *= a;
      }
      return d;
    },
    snare(sr) {
      const n = Math.floor(sr * 0.2);
      const d = biquad(whiteNoise(n), sr, 'bandpass', 1900, 0.7);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph = (ph + (t < 0.07 ? 220 * Math.pow(160 / 220, t / 0.07) : 160) / sr) % 1;
        d[i] = d[i] * env(t, 0.001, 0.14) + tri(ph) * env(t, 0.001, 0.07) * 0.8;
      }
      return d;
    },
    hat(sr, decay, band) {
      const n = Math.floor(sr * (decay + 0.05));
      const d = biquad(biquad(metal(sr, n, 40), sr, 'bandpass', band, 0.7), sr, 'highpass', 7000);
      const air = biquad(whiteNoise(n), sr, 'highpass', 9000);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = d[i] * env(t, 0.001, decay) + air[i] * env(t, 0.001, decay * 0.8) * 0.5;
      }
      return d;
    },
    shaker(sr) {
      const n = Math.floor(sr * 0.1);
      const d = biquad(whiteNoise(n), sr, 'bandpass', 6500, 1.4);
      for (let i = 0; i < n; i++) d[i] *= env(i / sr, 0.012, 0.05);
      return d;
    },
    crash(sr) {
      const n = Math.floor(sr * 2);
      const d = biquad(whiteNoise(n), sr, 'highpass', 4500);
      const m = biquad(metal(sr, n, 90), sr, 'bandpass', 9000, 0.6);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = d[i] * env(t, 0.002, 1.8) + m[i] * env(t, 0.002, 1.2) * 0.6;
      }
      return d;
    },
    rim(sr) {
      const n = Math.floor(sr * 0.15);
      const d = biquad(whiteNoise(n), sr, 'bandpass', 2300, 0.9);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = d[i] * env(t, 0.002, 0.11) + tri(((420 * i) / sr) % 1) * env(t, 0.001, 0.03) * 0.5;
      }
      return d;
    },
    // saw + detuned square through a resonant lowpass that snaps shut
    pluck(sr, m) {
      const n = Math.floor(sr * 0.4), d = new Float32Array(n);
      const f = hz(m), dt1 = f / sr, dt2 = (f * Math.pow(2, 7 / 1200)) / sr;
      let p1 = 0.5, p2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0; // same starting phases as the WebAudio oscillators
      let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        if (i % 8 === 0) {
          const fc = 550 + 4650 * Math.exp(-Math.max(0, t - 0.002) / 0.045);
          const w = (2 * Math.PI * fc) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * 1.6), a0 = 1 + al;
          b0 = (1 - cs) / 2 / a0; b1 = (1 - cs) / a0; b2 = b0; a1 = (-2 * cs) / a0; a2 = (1 - al) / a0;
        }
        const x = 2 * p1 - 1 - polyblep(p1, dt1) + (p2 < 0.5 ? 1 : -1) + polyblep(p2, dt2) - polyblep((p2 + 0.5) % 1, dt2);
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        d[i] = y * env(t, 0.002, 0.28);
        p1 += dt1; if (p1 >= 1) p1 -= 1;
        p2 += dt2; if (p2 >= 1) p2 -= 1;
      }
      return d;
    },
  };
  // loudness of each pre-rendered sound relative to the oscillator versions it replaced
  const LEVEL = { kick: 1, kickSoft: 1, clap: 1.04, snare: 1.07, hat: 0.88, hatOpen: 0.98, hatSoft: 0.97, shaker: 0.95, crash: 1, rim: 1.1, pluck: 0.9 };

  function create(ctx, out) {
    const hasPan = typeof ctx.createStereoPanner === 'function';
    function filter(type, f, q) {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      if (q != null) n.Q.value = q;
      return n;
    }

    // master chain: everything musical -> glue compressor -> out
    const input = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    input.connect(comp).connect(out);

    // shared reverb
    const verbIn = ctx.createGain();
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 2.8, 3.2);
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.8;
    verbIn.connect(filter('highpass', 300)).connect(verb).connect(verbOut).connect(input);

    // shared ping-pong delay (dotted 8th of the current song)
    const dlyIn = ctx.createGain();
    const dl = ctx.createDelay(2), dr = ctx.createDelay(2);
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const merge = ctx.createChannelMerger(2);
    const dlyOut = ctx.createGain();
    dlyOut.gain.value = 0.5;
    dlyIn.connect(dl);
    dl.connect(merge, 0, 0);
    dl.connect(dr);
    dr.connect(merge, 0, 1);
    dr.connect(filter('lowpass', 3000)).connect(fb).connect(dl);
    merge.connect(dlyOut).connect(input);

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const sr = ctx.sampleRate;
    const toBuf = (d, level) => {
      const b = ctx.createBuffer(1, d.length, sr);
      if (level !== 1) for (let i = 0; i < d.length; i++) d[i] *= level;
      b.getChannelData(0).set(d);
      return b;
    };
    const variants = (k, fn) => Array.from({ length: k }, fn);
    const BUF = {
      kick: [toBuf(SHOT.kick(sr, false), LEVEL.kick)],
      kickSoft: [toBuf(SHOT.kick(sr, true), LEVEL.kickSoft)],
      clap: variants(2, () => toBuf(SHOT.clap(sr), LEVEL.clap)),
      snare: variants(2, () => toBuf(SHOT.snare(sr), LEVEL.snare)),
      hat: variants(3, () => toBuf(SHOT.hat(sr, 0.04, 10000), LEVEL.hat)),
      hatOpen: variants(2, () => toBuf(SHOT.hat(sr, 0.26, 10000), LEVEL.hatOpen)),
      hatSoft: variants(3, () => toBuf(SHOT.hat(sr, 0.05, 8000), LEVEL.hatSoft)),
      shaker: variants(2, () => toBuf(SHOT.shaker(sr), LEVEL.shaker)),
      crash: [toBuf(SHOT.crash(sr), LEVEL.crash)],
      rim: variants(2, () => toBuf(SHOT.rim(sr), LEVEL.rim)),
    };
    const plucks = {};
    const pluckBuf = (m) => plucks[m] || (plucks[m] = toBuf(SHOT.pluck(sr, m), LEVEL.pluck));

    let B = null; // current song's dry bus
    let D = null; // current song's ducked bus (pumped by the kick)

    /* ---- voice helpers ---- */
    function route(node, dest, pan, verbAmt, dlyAmt) {
      let n = node;
      if (pan && hasPan) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        n.connect(p);
        n = p;
      }
      n.connect(dest);
      if (verbAmt) { const g = ctx.createGain(); g.gain.value = verbAmt; n.connect(g).connect(verbIn); }
      if (dlyAmt) { const g = ctx.createGain(); g.gain.value = dlyAmt; n.connect(g).connect(dlyIn); }
    }
    // play a pre-rendered buffer (or a random pick from a list of variants)
    function shot(buf, t, v, dest, pan, verbAmt, dlyAmt) {
      const s = ctx.createBufferSource();
      s.buffer = Array.isArray(buf) ? buf[Math.floor(Math.random() * buf.length)] : buf;
      const g = ctx.createGain();
      g.gain.value = v;
      s.connect(g);
      s.start(t);
      route(g, dest, pan, verbAmt, dlyAmt);
    }
    function osc(type, f, t, end, detune = 0) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (detune) o.detune.value = detune;
      o.start(t);
      o.stop(end);
      return o;
    }
    function noise(t, end) {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      s.start(t, Math.random() * 1.5);
      s.stop(end);
      return s;
    }
    function panned(node, pan) {
      if (!hasPan || !pan) return node;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      return p;
    }
    // percussive envelope
    function perc(t, peak, decay, attack = 0.001) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      return g;
    }
    // held envelope: attack, hold until dur, release
    function held(t, peak, attack, dur, rel) {
      const g = ctx.createGain();
      const h = Math.max(attack, dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.setValueAtTime(peak, t + h);
      g.gain.setTargetAtTime(0, t + h, rel / 3);
      return g;
    }

    /* ---- instruments ---- */
    const kit = {
      kick(t, v, duck, soft) {
        shot(soft ? BUF.kickSoft : BUF.kick, t, v, B);
        if (duck && D) {
          D.gain.setTargetAtTime(0.32, t, 0.004);
          D.gain.setTargetAtTime(1, t + 0.05, 0.075);
        }
      },
      clap(t, v) { shot(BUF.clap, t, v, B, 0, 0.3); },
      snare(t, v) { shot(BUF.snare, t, v, B, 0, 0.25); },
      hat(t, v, open, soft) { shot(open ? BUF.hatOpen : soft ? BUF.hatSoft : BUF.hat, t, v, B, open ? 0.15 : 0.1, soft ? 0.1 : 0); },
      shaker(t, v) { shot(BUF.shaker, t, v, B, -0.2); },
      crash(t, v) { shot(BUF.crash, t, v, B, 0.25, 0.35); },
      // plucky saw bass with a sine sub, sits on the ducked bus
      bass(t, m, dur, v) {
        const f = hz(m);
        const end = t + dur + 0.15;
        const lp = filter('lowpass', 0, 5);
        lp.frequency.setValueAtTime(f * 2 + 1500 * v, t);
        lp.frequency.setTargetAtTime(f * 1.6 + 140, t + 0.005, 0.06);
        osc('sawtooth', f, t, end, -6).connect(lp);
        osc('sawtooth', f, t, end, 6).connect(lp);
        const g = held(t, v * 0.42, 0.004, dur, 0.05);
        lp.connect(g);
        osc('sine', f / 2, t, end).connect(g);
        route(g, D);
      },
      // wide detuned-saw pad, swelling filter
      pad(t, chord, dur, v) {
        const end = t + dur + 0.8;
        const lp = filter('lowpass', 700, 0.6);
        lp.frequency.setValueAtTime(700, t);
        lp.frequency.linearRampToValueAtTime(2100, t + dur * 0.6);
        lp.frequency.linearRampToValueAtTime(1400, t + dur);
        const det = [[-11, -0.6], [0, 0], [11, 0.6]];
        for (const m of chord) for (const [cents, pan] of det) panned(osc('sawtooth', hz(m), t, end, cents), pan).connect(lp);
        const g = held(t, v, 0.18, dur, 0.5);
        lp.connect(g);
        route(g, D, 0, 0.35);
      },
      pluck(t, m, v, pan) { shot(pluckBuf(m), t, v, D, pan, 0.15, 0.32); },
      // two detuned saws spread wide + a square an octave down, light vibrato on held notes
      lead(t, m, dur, v) {
        const f = hz(m);
        const end = t + dur + 0.3;
        const lp = filter('lowpass', 0, 1.2);
        lp.frequency.setValueAtTime(4800, t);
        lp.frequency.setTargetAtTime(2600, t + 0.01, 0.12);
        const voices = [osc('sawtooth', f, t, end, -8), osc('sawtooth', f, t, end, 8), osc('square', f / 2, t, end)];
        panned(voices[0], -0.3).connect(lp);
        panned(voices[1], 0.3).connect(lp);
        const sq = ctx.createGain();
        sq.gain.value = 0.45;
        voices[2].connect(sq).connect(lp);
        if (dur > 0.3) {
          const lfo = osc('sine', 5.6, t, end);
          const depth = ctx.createGain();
          depth.gain.setValueAtTime(0, t);
          depth.gain.setValueAtTime(0, t + 0.16);
          depth.gain.linearRampToValueAtTime(18, t + 0.4); // cents
          lfo.connect(depth);
          for (const o of voices) depth.connect(o.detune);
        }
        const g = held(t, v, 0.012, dur, 0.12);
        lp.connect(g);
        route(g, B, 0, 0.25, 0.22);
      },
      // two-operator FM electric piano: soft bark on the attack, warm sustain
      ep(t, chord, dur, v) {
        chord.forEach((m, n) => {
          const f = hz(m);
          const end = t + dur + 1;
          const car = osc('sine', f, t, end);
          const mod = osc('sine', f, t, end);
          const idx = ctx.createGain();
          idx.gain.setValueAtTime(f * 1.4, t);
          idx.gain.setTargetAtTime(f * 0.2, t, 0.25);
          mod.connect(idx).connect(car.frequency);
          const tine = osc('sine', f * 14, t, t + 0.2);
          const tIdx = ctx.createGain();
          tIdx.gain.setValueAtTime(f * 0.5, t);
          tIdx.gain.exponentialRampToValueAtTime(1, t + 0.12);
          tine.connect(tIdx).connect(car.frequency);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(v, t + 0.004);
          g.gain.setTargetAtTime(v * 0.25, t + 0.004, 0.6);
          g.gain.setTargetAtTime(0, t + dur, 0.09);
          car.connect(g);
          route(g, B, (n - (chord.length - 1) / 2) * 0.18, 0.3);
        });
      },
      bell(t, m, dur, v) {
        const f = hz(m);
        const end = t + Math.max(dur, 0.2) + 1.6;
        const car = osc('sine', f, t, end);
        const mod = osc('sine', f * 3.5, t, end);
        const idx = ctx.createGain();
        idx.gain.setValueAtTime(f * 1.1, t);
        idx.gain.setTargetAtTime(f * 0.08, t, 0.18);
        mod.connect(idx).connect(car.frequency);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(v, t + 0.003);
        g.gain.setTargetAtTime(v * 0.3, t + 0.003, 0.35);
        g.gain.setTargetAtTime(0, t + Math.max(dur, 0.2), 0.25);
        car.connect(g);
        route(g, B, 0.12, 0.35, 0.25);
      },
      softBass(t, m, dur, v) {
        const f = hz(m);
        const end = t + dur + 0.3;
        const lp = filter('lowpass', 520, 0.7);
        osc('triangle', f, t, end).connect(lp);
        const g = held(t, v, 0.012, dur, 0.09);
        lp.connect(g);
        osc('sine', f, t, end).connect(g);
        route(g, B);
      },
      rim(t, v) { shot(BUF.rim, t, v, B, 0.1, 0.3); },
      // vinyl: sparse random clicks...
      crackle(t, s16) {
        if (Math.random() > 0.4) return;
        const at = t + Math.random() * s16;
        const g = perc(at, 0.015 + Math.random() * 0.04, 0.003);
        noise(at, at + 0.02).connect(filter('highpass', 2500)).connect(g);
        route(g, B, Math.random() * 1.6 - 0.8);
      },
      // ...over a faint looped hiss for the whole song
      hiss(t) {
        const s = ctx.createBufferSource();
        s.buffer = noiseBuf;
        s.loop = true;
        s.start(t);
        const g = ctx.createGain();
        g.gain.value = 0.003;
        s.connect(filter('lowpass', 6000)).connect(filter('highpass', 1200)).connect(g).connect(B);
        cur.extras.push(s);
      },
    };

    /* ---- sequencer ---- */
    let cur = null;
    function play(name) {
      if ((cur ? cur.name : null) === (name || null)) return;
      const now = ctx.currentTime;
      if (cur) {
        const old = cur;
        old.bus.gain.cancelScheduledValues(now);
        old.bus.gain.setTargetAtTime(0, now, 0.15);
        for (const s of old.extras) s.stop(now + 1.2);
        setTimeout(() => old.bus.disconnect(), 2500);
      }
      cur = null;
      const song = SONGS[name];
      if (!song) return;
      const bus = ctx.createGain();
      bus.gain.value = song.gain || 1;
      if (song.tone) bus.connect(filter('lowpass', song.tone, 0.5)).connect(input);
      else bus.connect(input);
      const duck = ctx.createGain();
      duck.connect(bus);
      cur = { name, song, bus, duck, bar: 0, step: 0, next: now + 0.08, extras: [] };
      const beat = 60 / song.bpm;
      dl.delayTime.setValueAtTime(beat * 0.75, now);
      dr.delayTime.setValueAtTime(beat * 0.75, now);
      B = bus;
      D = duck;
      if (song.begin) song.begin(kit, cur.next);
    }
    function scheduleUntil(tEnd) {
      while (cur && cur.next < tEnd) {
        const c = cur, s = c.song;
        const s16 = 60 / s.bpm / 4;
        const b = s.seq[c.bar];
        const nb = s.seq[c.bar + 1 < s.seq.length ? c.bar + 1 : s.loopFrom];
        const t = c.next + (c.step % 2 ? s.swing * s16 : 0);
        B = c.bus;
        D = c.duck;
        s.step(kit, b, c.step, t, s16, nb);
        c.next += s16;
        if (++c.step === 16) {
          c.step = 0;
          c.bar = c.bar + 1 < s.seq.length ? c.bar + 1 : s.loopFrom;
        }
      }
    }
    // kit is exposed so tests can solo or mute instruments
    return { play, scheduleUntil, kit, get playing() { return cur ? cur.name : null; } };
  }

  return { create, songs: Object.keys(SONGS) };
})();
window.MUSIC = MUSIC;
