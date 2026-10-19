'use strict';
/*
 * Runtime core. Reproduces the timing model the original game ran on:
 *  - a 60 fps frame clock with integer-millisecond timestamps (dt alternates 16/17 ms)
 *  - one ordered update list that every moving thing registers into; entries removed while the
 *    list is being walked cause the next entry to be skipped for that frame (as in the original)
 *  - timeline clips that advance by elapsed time and fire scripts on specific frames
 *  - wall-clock timeouts that fire between frames
 *  - display positions stored in 1/20 px steps
 */
const G = (window.G = {});

G.W = 640;
G.H = 426;
G.FPS = 60;
G.GROUND = 400;      // floor line
G.WALL = 33;         // invisible side walls
G.NET_GAP = 50;      // closest a player may stand to the net post
G.SERVE_GAP = 125;   // service line distance from the net post
G.GRAVITY = 1200;
G.NET_X = 317.25;    // net post x (decides which side a point goes to)
G.LAYER_DX = -0.05;  // player + shuttle layers sit 1/20 px left of the stage origin

// Net collision boxes (stage px). "top" is the tape the shuttle can roll over.
G.NET_BODY = { x: 316.3, l: 316.3 - 10.5 * 1.5480957, r: 316.3 + 10.5 * 1.5480957, t: 377.05 - 10.5 * 5.463791, b: 377.05 + 10.5 * 5.463791 };
G.NET_TOP = { y: 323.75, l: 316.3 - 10.5 * 1.5865479, r: 316.3 + 10.5 * 1.5865479, t: 323.75 - 10.5 * 0.44877625, b: 323.75 + 10.5 * 0.44877625 };
G.inBox = (b, x, y) => x >= b.l && x <= b.r && y >= b.t && y <= b.b;

// Positions on display objects are stored in twips (1/20 px), truncated toward zero.
G.tw = (v) => Math.trunc(v * 20) / 20;
// Move x by d, dropping the fraction of a twip from the move itself. G.tw(x + d) drops it toward
// the stage's left edge, so a slow drift to the right falls short while the same drift to the
// left overshoots, which hands the left-hand side a small edge. Moves to the right come out
// exactly as G.tw(x + d); moves to the left mirror them.
G.twMove = (x, d) => (d >= 0 ? G.tw(x + d) : Math.ceil((x + d) * 20) / 20);

/* ---------- random / math helpers (same semantics as the original utility class) ---------- */
G.rand = (a, b, whole) => {
  if (!whole) return a + Math.random() * (b - a);
  const v = b >= a ? a + Math.random() * (b + 1 - a) : b + Math.random() * (a + 1 - b);
  return Math.floor(v);
};
G.chance = (pct) => Math.random() * 100 < pct;
G.sign = (v) => (v >= 0 ? 1 : -1);
G.pick = (arr) => arr[G.rand(0, arr.length - 1, true)];
// dir is in degrees, 0 = straight up, 90 = right
G.applyDir = (o) => {
  const r = ((o.dir - 90) / 180) * Math.PI;
  o.dx = Math.cos(r) * o.speed;
  o.dy = Math.sin(r) * o.speed;
};
G.calcDir = (o) => { o.dir = (Math.atan2(o.dy, o.dx) / Math.PI) * 180 + 90; };
G.calcSpeed = (o) => { o.speed = Math.sqrt(o.dx * o.dx + o.dy * o.dy); };

/* ---------- frame clock + update list ---------- */
G.clock = 0;          // getTimer() equivalent, integer ms
G.updates = [];
G.addUpdate = (fn) => { G.updates.push(fn); };
G.removeUpdate = (fn) => {
  const i = G.updates.indexOf(fn);
  if (i >= 0) G.updates.splice(i, 1);
};
G.paused = false;
G.pauseAllowed = false;
G.lastT = 0;
G.dt = 0;             // last frame's dt (debug readout)
G.enterFrame = (t) => {
  if (G.paused) return;
  const dt = (t - G.lastT) / 1000;
  G.lastT = t;
  G.dt = dt;
  for (let i = 0; i < G.updates.length; i++) G.updates[i](dt);
};
G.togglePause = () => {
  if (!G.paused && G.pauseAllowed) {
    G.paused = true;
  } else if (G.paused) {
    G.paused = false;
    G.lastT = G.clock;
  }
};

/* ---------- timeouts ---------- */
G.timers = [];
let timerSeq = 0;
G.setTimeout = (fn, ms) => {
  const t = { at: G.clock + ms, seq: ++timerSeq, fn };
  G.timers.push(t);
  return t;
};
G.clearTimers = () => { G.timers.length = 0; };
G.runTimers = () => {
  if (!G.timers.length) return;
  const due = G.timers.filter((t) => t.at <= G.clock).sort((a, b) => a.at - b.at || a.seq - b.seq);
  if (!due.length) return;
  G.timers = G.timers.filter((t) => t.at > G.clock);
  for (const t of due) t.fn();
};

/* ---------- timeline clip ---------- */
// A clip advances one frame per 1/60 s of elapsed time while playing and runs a script when it
// lands on a frame that has one. Frame 1 always stops the clip.
G.Clip = class Clip {
  constructor(total, scripts) {
    this.total = total;
    this.scripts = scripts || {};
    this.cur = 1;
    this.playing = false;
    this.spf = 1 / G.FPS;
    this.t = 0;
    this._tick = (dt) => this.tick(dt);
  }
  play() {
    if (!this.playing) {
      this.playing = true;
      G.addUpdate(this._tick);
    }
  }
  stop() {
    if (this.playing) {
      this.playing = false;
      G.removeUpdate(this._tick);
      this.t = this.cur * this.spf;
    }
  }
  gotoAndStop(f) {
    this.goto(f);
    this.t = this.cur * this.spf;
    this.stop();
  }
  goto(f) {
    if (f === this.cur) return;
    this.cur = f;
    if (f === 1) this.stop();
    const s = this.scripts[f];
    if (s) s();
  }
  tick(dt) {
    this.t += dt;
    const target = Math.floor(this.t / this.spf) + 1;
    const from = this.cur;
    const n = target - from;
    let i = 0;
    while (i < n && this.playing) {
      i++;
      this.goto(((from + i - 1) % this.total) + 1);
    }
  }
  // detach without running scripts (object removed from the stage)
  dispose() { this.stop(); }
};

/* ---------- input ---------- */
G.KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, SPACE: 32, ENTER: 13, ESC: 27, TAB: 9, W: 87, A: 65, S: 83, D: 68, P: 80, M: 77, T: 84, BACKQUOTE: 192 };
G.keys = [];
G.isDown = (code) => G.keys.indexOf(code) !== -1;
G.mouse = { x: NaN, y: NaN, inside: false };
G.codeFromEvent = (e) => {
  const c = e.code || '';
  if (c.startsWith('Key')) return c.charCodeAt(3);
  if (c.startsWith('Digit')) return 48 + Number(c[5]);
  switch (c) {
    case 'ArrowLeft': return 37;
    case 'ArrowUp': return 38;
    case 'ArrowRight': return 39;
    case 'ArrowDown': return 40;
    case 'Space': return 32;
    case 'Enter': case 'NumpadEnter': return 13;
    case 'Escape': return 27;
    case 'Backquote': return 192;
    default: return e.keyCode || 0;
  }
};

/* ---------- debug overlay switch (` key), remembered between visits ---------- */
G.debug = false;
try { G.debug = localStorage.getItem('shuttlesticks.debug') === '1'; } catch (e) { /* storage blocked */ }
G.toggleDebug = () => {
  G.debug = !G.debug;
  try { localStorage.setItem('shuttlesticks.debug', G.debug ? '1' : '0'); } catch (e) { /* storage blocked */ }
};
