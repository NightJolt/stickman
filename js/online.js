'use strict';
/*
 * Online 1v1 sync, peer to peer: each screen runs the match and is in charge of its own player.
 * You move, jump and swing with no delay, and your own game decides whether your racket met the
 * shuttle. When it does, the launch (contact point, power, angle) goes to the other screen, which
 * launches the same shot from the same moment.
 *
 * One game at a time owns the shuttle: only that player's racket can hit it, and only that game
 * decides where it came down and who won the point, so the two screens never award different
 * points even when their flights differ by a pixel. A shot that's going over the net belongs to
 * the opponent from the moment it's hit, so they can return it without waiting. One that will
 * come down on the hitter's side (a mishit, a serve into the net) stays the hitter's, to hit
 * again. If the flight surprises us (a roll over the tape, a bounce back off the net), the owner
 * hands it over when it actually crosses.
 *
 * Time. The two games' clocks are synced (js/net.js), and every message says when it happened,
 * so this screen knows how old each piece of news is. Our half of the court is drawn as it is
 * now. Their figure is drawn a little in the past: far enough back that in 95% of recent frames
 * their news for that moment had already arrived, and on one of their frames (both games step on
 * the same 60 fps grid). So each frame of them is one their screen drew, with the position and
 * swing frame it had, at normal speed, not a guess; the rare frame ahead of the news is run on
 * from their held keys and a spring eases out the difference.
 *
 * The shuttle is drawn on our clock while it's ours to play and on theirs while it's theirs, and
 * moves between the two during each flight: after our hit it eases back onto their clock before
 * they could first reach it (and their return could get here), so when their hit arrives the
 * drawing is just reaching that moment and the shuttle turns at their racket; after theirs it
 * eases forward to now before we could first reach it. The time each change gets comes from the
 * flight, where the players stand and how fast they can run and jump; spread over that, the speed
 * change at its peak is under 10% at a 40 ms ping and about a quarter at 200 ms. When the delay
 * drifts enough to call for another of their frames, the figure and the shuttle ease onto it
 * together rather than skip. Only the drawing runs on their clock (Shuttle.ox/oy); the flight
 * itself is always where it really is, so our returns are judged on that. A hit that arrives later
 * than the drawing allowed for steps it back to the contact. Their hit's spark and sound, and
 * their points, wait for the drawing to get there.
 *
 * Movement goes over the direct channel that may drop or reorder messages; hits and points go
 * over the reliable one, and the server too (js/net.js).
 */
(() => {
  const STATES = ['normal', 'forward', 'backward', 'jump'];
  const CLIPS = ['over', 'under', 'serve'];
  const FRAME_MS = 1000 / 60;
  // their side is drawn back far enough that, in this share of recent frames, we already had
  // their news for that moment, plus a pad
  const LAG_QUANTILE = 0.95, LAG_PAD = 3, MAX_LAG = 300;
  // the drawn clock changes speed smoothly, and never runs slower or faster than this; a change
  // eases in over the first share EASE of its time and out over the last, steady in between
  const SLOWEST = 0.6, FASTEST = 1.8, EASE = 0.25;
  const SAFETY = 2 * FRAME_MS; // be on the right clock this long before anyone could reach it
  // a new choice of their frame to draw their figure on is eased into at this pace (ms per ms)
  const GRID_EASE = 0.06;
  // how far a racket reaches from its player's feet: sideways, and up (every rig, every frame)
  const REACH = 105, RACKET_TOP = 162;
  // their figure: past kept, furthest guess ahead, spring (rad/s) easing corrections, snap size
  const HISTORY = 1500, MAX_GUESS = 20 * FRAME_MS, SPRING = 22, SNAP = 60;
  // frames a landed shuttle waits for the other screen's verdict before this one calls it; the
  // host calls it first, so the two screens can't both call the same point
  const STUCK = [0, 240, 480];
  const r2 = (v) => Math.round(v * 100) / 100;

  class PeerSync {
    // opts.predict: false draws exactly what has arrived (the room's creator can choose that)
    constructor(m, opts = {}) {
      this.m = m;
      this.predict = opts.predict !== false;
      this.f = 0;           // our movement messages
      this.games = 0;       // rematches played, for telling rallies apart
      this.applying = false;
      this.ticks = 0;       // update() calls, to tell what news came in since the last one
      this.hist = [];       // their movement, oldest first: the messages, plus arr (our clock) and tick
      this.needs = [];      // how far back recent frames had to draw them to have their news
      this.L = 0;           // ms their side is drawn back while the shuttle is theirs
      this.Ls = 0;          // the same, changing gently (what the drawing actually follows)
      this.grid = 0;        // about Ls, but exactly on one of their frames: where their figure goes
      this.gk = null;       // which of their frames that was, last frame
      this.gridEase = 0;    // ms still being eased out after moving to another of their frames
      this.spare = 0;       // frames in a row it's been drawn back further than needed
      this.figLag = 0;      // ms their figure is drawn back right now
      this.stalled = 0;     // frames since anything new arrived from them
      this.lag = 0;         // ms their side is drawn behind now, at the moment
      this.slope = 0;       // how fast that's changing (ms per ms)
      this.ramp = null;     // { from, to, s0, vc, t0, dur, onGrid }: the lag moving between clocks
      this.was = null;      // last frame's owner, rally and shuttle, to spot changes
      this.replan = false;
      this.backTo = null;   // their hit just arrived: { t, fresh } to step the drawing back to
      this.later = [];      // their hits' sparks and sounds, and their points: { t, fn }, run when drawn
      this.theirServe = null; // the shuttle their serve brought in
      this.turnAt = null;   // their latest contact (our clock): the drawing stays on their frames to it
      this.fig = { x: 0, y: 0, vx: 0, vy: 0 }; // correction easing out of their figure
      this.lastCur = 1;
      this.shownCur = {};   // the swing frame we're showing of each of their clips
      this.side = 0;        // the half of the court the shuttle was in last frame
      this.waiting = 0;     // frames the shuttle has lain on their side without a verdict
      this.handSeq = 0;     // our hand-overs so far, and the last of theirs we took
      this.handed = 0;
      this.trace = [];      // where the shuttle has really been: { t, x, y, r }
      this.traced = null;   // which shuttle that is
      m.peer = this;
    }

    // which rally of which game: stale hits and points are recognised by it
    rally() { return this.games * 1000 + this.m.score1 + this.m.score2; }

    /* ---- time ---- */
    // when something stamped `ts` on their clock happened, on ours (arrival-based until synced)
    toLocal(ts, arr) {
      if (NET.synced && ts !== undefined) return ts - NET.offset;
      return arr - Math.min(MAX_LAG, (NET.rtt || 60) / 2 + FRAME_MS);
    }
    timeOf(msg) { return this.toLocal(msg.ts, msg.arr); }
    // how far back a frame had to draw their side to have real news for it (sampled every frame)
    needed(ms) {
      this.needs.push(ms);
      if (this.needs.length > 180) this.needs.shift();
    }
    // how far back to draw their side: what most recent frames needed
    targetLag() {
      if (!NET.synced || this.needs.length < 30) return Math.min(MAX_LAG, (NET.rtt || 60) / 2 + 2 * FRAME_MS);
      const d = this.needs.slice().sort((a, b) => a - b);
      return Math.max(0, Math.min(MAX_LAG, d[Math.floor(LAG_QUANTILE * (d.length - 1))] + LAG_PAD));
    }

    // How far back to draw their figure: about Ls, but landing exactly on one of their frames (both
    // games step on the same ideal 60 fps grid), so every frame we draw of them is one their screen
    // drew: the same spot, the same swing frame, the shuttle where it was. (How old their news is
    // comes in whole frames of theirs too, so Ls sits just past one of them: the pad.) It moves on
    // one of their frames per one of ours, and picks another only once Ls has moved off by a good
    // part of a frame: further back at once (their news needs it), forward once it has had a
    // second to settle and the shuttle isn't theirs (`keep`: that only gives up a little delay,
    // and their hit shouldn't be drawn in the middle of it), so it can't flip between two. It
    // eases over to the new frame (GRID_EASE) so their figure doesn't skip or repeat one; a clock
    // that jumped is followed straight away.
    gridLag(ms, keep) {
      if (!NET.synced) {
        this.gk = null;
        this.gridEase = 0;
        return this.Ls;
      }
      // their frame Ls ago (from the exact time of our frame, not its whole-ms stamp, whose
      // rounding would make the choice wobble)
      const now = (Math.round((G.clock * G.FPS) / 1000) * 1000) / G.FPS;
      const x = ((now - this.Ls + NET.offset) * G.FPS) / 1000;
      let k = this.gk === null ? Math.floor(x + 0.3) : this.gk + 1;
      this.spare = x - k > 0.6 ? this.spare + 1 : 0;
      if (x - k < -0.4 || x - k > 2 || (this.spare > G.FPS && !keep)) {
        const to = Math.floor(x + 0.3);
        this.gridEase = this.gk !== null && Math.abs(to - k) <= 2 ? this.gridEase + ((to - k) * 1000) / G.FPS : 0;
        this.spare = 0;
        k = to;
      }
      this.gk = k;
      this.gridEase -= Math.sign(this.gridEase) * Math.min(Math.abs(this.gridEase), GRID_EASE * ms);
      return G.clock - (Math.floor((k * 1000) / G.FPS) - NET.offset) + this.gridEase;
    }

    /* ---- hits and points ---- */
    // which player's half of the court x is in
    sideOf(x) { return x < G.NET_X ? 1 : 2; }

    // from Shuttle.hit: our racket met it (or we served). It's theirs if it's going over.
    hit(s, power, dir, kind) {
      if (this.applying) return;
      const m = this.m;
      m.owner = this.sideOf(s.landX) === m.me ? m.me : 3 - m.me;
      this.side = this.sideOf(s.x);
      NET.send({ t: 'hit', r: this.rally(), n: s.hits, ts: G.clock, x: s.x, y: s.y, power, dir, kind: kind || null, o: m.owner });
    }

    // when their contact happened, on our clock (never in the future, never too far back)
    contactAt(msg) {
      return Math.max(G.clock - MAX_LAG, Math.min(G.clock, this.toLocal(msg.ts, G.now())));
    }

    // their racket met it: the same launch here, from the moment it happened
    remoteHit(msg) {
      const m = this.m;
      if (msg.r !== this.rally()) return; // a rally that's already over here
      if (m.rallyDue) m.newRally();       // their serve beat our countdown
      if (!m.rallyLive) return;
      if (m.shuttle && msg.n <= m.shuttle.hits) return; // the second copy of a hit we have
      const tc = this.contactAt(msg);
      const fresh = msg.n === 1 || !m.shuttle;
      if (fresh) m.spawnShuttle(msg.x, msg.y);
      const s = m.shuttle;
      if (fresh) this.theirServe = s;
      m.lastHitter = m.remote;
      m.owner = msg.o || m.me;
      // A racket meets the shuttle where it stood at the end of their frame before (their player
      // moves before it does), and it flies off in the hit frame itself. A serve is thrown up after
      // the shuttle's move, so it sets off in the frame after.
      const served = msg.kind === 'serve' || msg.kind === 'pop';
      const at = served ? tc : this.frameBefore(msg.ts, tc);
      this.contactT = this.turnAt = at;
      this.rewind(s, at, () => {
        s.x = msg.x;
        s.y = msg.y;
        this.applying = true;
        s.hit(msg.power, msg.dir, msg.kind || undefined);
        this.applying = false;
      });
      s.hits = msg.n;
      if (msg.kind === 'pop') this.whenDrawn(() => m.sfx('pop')); // a floater's serve (Player.serveShuttle)
      // a hit later than our drawing of their side: step the drawing back so it doesn't miss the
      // turn (done in the next update, at that frame's time; by the hit's own stamp, which can
      // be after our last frame when it got here in less than one)
      if (this.predict) this.backTo = { t: this.toLocal(msg.ts, G.now()), fresh };
      this.replan = true;
    }

    // the time of their frame before the one stamped ts, on our clock
    frameBefore(ts, t) {
      if (!NET.synced || ts === undefined) return t - FRAME_MS;
      const k = Math.round((ts * G.FPS) / 1000);
      return Math.max(G.clock - MAX_LAG, Math.min(t, Math.floor(((k - 1) * 1000) / G.FPS) - NET.offset));
    }

    // from Shuttle.hit while applying their hit: its spark and sound, for when our drawing gets there
    whenDrawn(fn, t = this.contactT) {
      if (!this.predict) return fn();
      this.later.push({ t, fn });
    }

    // it crossed the net against the forecast while ours: theirs now, from exactly here (each
    // hand-over numbered, since a shuttle rolling along the tape can change hands more than once
    // between two hits)
    handOver(s) {
      const m = this.m;
      m.owner = 3 - m.me;
      NET.send({ t: 'own', r: this.rally(), n: s.hits, h: ++this.handSeq, ts: G.clock, x: s.x, y: s.y, dx: s.dx, dy: s.dy, speed: s.speed, dir: s.dir });
    }
    remoteHandOver(msg) {
      const m = this.m, s = m.shuttle;
      if (msg.r !== this.rally() || !s || !m.rallyLive || msg.n !== s.hits) return;
      if (msg.h <= this.handed) return; // a copy (they come direct and through the server too), or older
      this.handed = msg.h;
      const tc = this.contactAt(msg);
      m.owner = m.me;
      this.rewind(s, tc, () => Object.assign(s, { x: msg.x, y: msg.y, dx: msg.dx, dy: msg.dy, speed: msg.speed, dir: msg.dir, rotation: msg.dir }));
      this.replan = true;
    }

    // Something happened to the shuttle on their screen at time tc: rewrite its path from that
    // moment (`then` sets it as it was), and fly it on to now, noting where it was on the way.
    rewind(s, tc, then) {
      const m = this.m;
      if (this.traced !== s) {
        this.trace = [];
        this.traced = s;
      }
      this.trace = this.trace.filter((e) => e.t < tc);
      then();
      this.note(s, tc);
      let t = tc;
      while (t + FRAME_MS <= G.clock && m.shuttle === s && m.rallyLive) {
        s.update(1 / 60);
        t += FRAME_MS;
        this.note(s, t);
      }
      if (G.clock - t > 0.5 && m.shuttle === s && m.rallyLive) {
        s.update((G.clock - t) / 1000);
        this.note(s, G.clock);
      }
      this.side = this.sideOf(s.x);
      this.waiting = 0;
    }
    note(s, t) {
      this.trace.push({ t, x: s.x, y: s.y, r: s.rotation });
    }

    // where the shuttle was at time t (drawn from the trace)
    seen(t) {
      const tr = this.trace;
      if (!tr.length) return null;
      if (t <= tr[0].t) return tr[0];
      for (let i = tr.length - 1; i >= 0; i--) {
        if (tr[i].t <= t) {
          const a = tr[i], b = tr[i + 1];
          if (!b || b.t === a.t) return a;
          const k = (t - a.t) / (b.t - a.t);
          return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, r: k < 0.5 ? a.r : b.r };
        }
      }
      return tr[0];
    }

    // from Match.point when our game decided it (before the score changes)
    point(side) {
      NET.send({ t: 'pt', r: this.rally(), side, ts: G.clock });
    }
    // their game called it: it counts when our drawing of the shuttle comes down too
    remotePoint(msg) {
      if (msg.r !== this.rally()) return;
      const t = Math.max(G.clock - MAX_LAG, Math.min(G.clock, this.toLocal(msg.ts, G.now())));
      this.whenDrawn(() => { if (msg.r === this.rally()) this.m.point(msg.side, true); }, t);
    }

    // both players asked for a rematch
    restart() {
      this.games++;
      this.m.resetLevel();
    }

    /* ---- the drawn clock ---- */
    // ms until `side`'s racket could first get to the shuttle along its true flight: from where
    // that player is, running flat out and jumping as soon as they like (a jump takes time to get
    // up), never further over the net than a racket reaches
    reach(side) {
      const m = this.m, s = m.shuttle;
      if (!s) return 0;
      const p = side === m.me ? m.local : m.remote;
      // they may have set off since the moment we draw them at; a jetpack goes wherever its mouse does
      const fly = p.kind === 'jet', head = side === m.me ? 0 : this.figLag;
      const run = (RUN_SPEED * (p.speedMul || 1)) / 1000; // px a ms
      const v = -JUMP_SPEED * (p.jumpMul || 1), apex = (v * v) / (2 * G.GRAVITY);
      // the highest their feet can be ms from now (in the air already: wherever, up to a jump's top)
      const lift = (ms) => {
        const t = ms / 1000;
        return p.inAir || t * G.GRAVITY >= v ? apex : v * t - (G.GRAVITY * t * t) / 2;
      };
      const ok = (x, y, n) => {
        if (!(side === 1 ? x <= G.NET_X - G.NET_GAP + REACH : x >= G.NET_X + G.NET_GAP - REACH)) return false;
        const ms = n * FRAME_MS + head;
        return fly || (Math.abs(x - p.x) <= REACH + run * ms && y >= G.GROUND - RACKET_TOP - lift(ms));
      };
      if (ok(s.x, s.y, 0)) return 0;
      let n = 0, at = -1;
      Shuttle.predictLanding(s.x, s.y, s.dx, s.dy, (x, y) => {
        n++;
        if (at < 0 && ok(x, y, n)) at = n;
      });
      return (at < 0 ? n : at) * FRAME_MS;
    }

    // when the shuttle changes hands (or the rally starts or ends), set off for the right clock
    planClock() {
      const m = this.m, s = m.shuttle;
      const now = { owner: m.owner, live: m.rallyLive, s };
      const w = this.was;
      this.was = now;
      if (w && !this.replan && w.owner === now.owner && w.live === now.live && w.s === now.s) return;
      this.replan = false;
      if (!this.predict) {
        this.lag = 0;
        this.ramp = null;
        return;
      }
      // theirs: on their clock by the time the drawing could show their racket meeting it, the
      // earliest they could get to it drawn `grid` later. (Their hit, whenever it is, then never
      // finds the drawing past it if it got here within `grid`: the drawing slows by 1 - SLOWEST
      // at most.)
      if (s && m.rallyLive && m.owner && m.owner !== m.me) this.toward(null, this.reach(3 - m.me) + this.grid);
      // ours: once the drawing has shown their racket meet it, ease forward to now
      else if (s && m.rallyLive) this.toward(0, this.reach(m.me), this.turnAt === null ? G.clock : this.turnAt + this.lag);
      else this.toward(0, 300);
      this.turnAt = null;
    }
    // From where the lag is (at its current pace) to `to` within `within` ms: the pace eases to a
    // steady rate, holds it, and eases to rest, which spreads the change as evenly as it can (the
    // top speed is 4/3 of the average, where a plain smooth step's is 3/2). Stretched when the time
    // is too short for the shuttle to stay within the slowest and fastest it may be drawn.
    // (Holding still until `start`, if that's later than now. `to` null: onto their frames, as
    // they are by the time it gets there.)
    toward(to, within, start = G.clock) {
      const onGrid = to === null;
      if (onGrid) to = this.grid;
      const wait = Math.max(0, start - G.clock);
      const from = this.lag, d = to - from, s0 = wait > 0 ? 0 : this.slope;
      if (Math.abs(d) < 0.25 && Math.abs(s0) < 0.01) {
        this.lag = to;
        this.ramp = null;
        return;
      }
      const limit = d > 0 ? 1 - SLOWEST : FASTEST - 1;
      const room = limit * (1 - EASE) + (EASE * s0 * Math.sign(d)) / 2;
      const dur = Math.max(within - wait - SAFETY, Math.abs(d) / Math.max(0.2 * limit, room), 2 * FRAME_MS);
      const vc = (d / dur - (EASE * s0) / 2) / (1 - EASE); // the steady pace (ms of lag per ms)
      this.ramp = { from, to, s0, vc, t0: G.clock + wait, dur, onGrid };
    }
    // how far the lag has come u (0..1) of the way through ramp r
    rampAt(r, u) {
      const A = EASE, { s0, vc } = r, PI = Math.PI;
      let k;
      if (u < A) k = s0 * u + ((vc - s0) / 2) * (u - (A / PI) * Math.sin((PI * u) / A));
      else if (u < 1 - A) k = (A * (s0 + vc)) / 2 + vc * (u - A);
      else {
        const w = u - (1 - A);
        k = (A * (s0 + vc)) / 2 + vc * (1 - 2 * A) + (vc / 2) * (w + (A / PI) * Math.sin((PI * w) / A));
      }
      return r.from + r.dur * k;
    }
    stepClock(dt) {
      const before = this.lag, ms = dt * 1000;
      const r = this.ramp;
      // the drawing never runs slower or faster than this
      const paced = (v) => Math.max(before - (FASTEST - 1) * ms, Math.min(before + (1 - SLOWEST) * ms, v));
      if (r) {
        const u = (G.clock - r.t0) / r.dur;
        if (u >= 1) {
          this.lag = r.onGrid ? paced(this.grid) : r.to;
          this.ramp = null;
        } else {
          this.lag = this.rampAt(r, Math.max(0, u));
          // onto their frames: if those have moved since (the delay drifted), make for where they
          // are now (what's left over, the settled drawing below catches up)
          if (r.onGrid && Math.abs(r.to - r.from) >= 1) this.lag = paced(this.lag + (this.grid - r.to) * Math.max(0, Math.min(1, (this.lag - r.from) / (r.to - r.from))));
        }
      } else if (this.predict && this.m.shuttle && this.m.rallyLive && this.m.owner && this.m.owner !== this.m.me) {
        // settled on their clock: stay on their figure's frames (exactly, within the frame or so
        // their frames wobble against ours; gently from further off, after a late hit)
        const d = this.grid - this.lag;
        this.lag += Math.abs(d) <= 2.5 ? d : Math.sign(d) * 0.08 * ms;
      }
      this.lag = Math.max(0, Math.min(MAX_LAG, this.lag));
      this.slope = ms > 0 ? (this.lag - before) / ms : 0;
    }

    /* ---- movement ---- */
    // once per frame: how our player stands and moves, what they're pressing, and when that was
    frame() {
      const p = this.m.local, K = G.KEY, any = (list) => list.some(G.isDown);
      const keys = (any([K.LEFT, K.A]) ? 1 : 0) | (any([K.RIGHT, K.D]) ? 2 : 0) | (any([K.UP, K.W]) ? 4 : 0);
      NET.send({ t: 'st', f: ++this.f, ts: G.clock, p: [r2(p.x), r2(p.y), STATES.indexOf(p.state), CLIPS.indexOf(p.shown),
        p.clips[p.shown].cur, p.clips.serve.cur, p.serving ? 1 : 0, p.inAir ? 1 : 0,
        r2(p.dx), r2(p.dy), p.jumpHeld ? 1 : 0, keys] });
    }

    stream(msg) {
      const h = this.hist;
      if (h.some((x) => x.f === msg.f)) return; // a copy
      msg.arr = G.now();
      msg.tick = this.ticks;
      let i = h.length;
      while (i > 0 && h[i - 1].f > msg.f) i--;
      h.splice(i, 0, msg);
      if (i === h.length - 1) this.stalled = 0;
      const cut = this.timeOf(h[h.length - 1]) - HISTORY;
      while (h.length > 2 && this.timeOf(h[1]) < cut) h.shift();
    }

    // every frame, after our player and the shuttle have moved
    update(dt) {
      const m = this.m, s = m.shuttle;
      this.ticks++;
      this.stalled++;
      this.L = this.predict ? this.targetLag() : 0;
      const step = 0.05 * dt * 1000;
      this.Ls = this.Ls ? this.Ls + Math.max(-step, Math.min(step, this.L - this.Ls)) : this.L;
      this.grid = this.predict ? this.gridLag(dt * 1000, !!s && m.rallyLive && !!m.owner && m.owner !== m.me) : 0;
      if (this.backTo) {
        const { t, fresh } = this.backTo;
        this.needed(Math.max(0, G.clock - t));
        // a serve has no flight on screen yet, so it can start on their figure's clock
        const lag = Math.max(this.lag, Math.min(MAX_LAG, G.clock - t), fresh ? this.grid : 0);
        if (lag > this.lag) this.slope = 0; // (a step: what pace it had before means nothing now)
        this.lag = lag;
        this.backTo = null;
      }
      // (not while their stream has stopped: a hiccup that long isn't worth drawing them back for)
      if (this.hist.length && NET.synced && this.stalled <= 10) this.needed(G.clock - this.timeOf(this.hist[this.hist.length - 1]));
      this.planClock();
      this.stepClock(dt);
      const tau = G.clock - this.lag; // the moment their side is drawn at

      // the shuttle: note where it really is, draw it where it was at that moment
      if (s) {
        if (this.traced !== s) {
          this.trace = [];
          this.traced = s;
        }
        this.note(s, G.clock);
        while (this.trace.length > 2 && this.trace[1].t < G.clock - 1000) this.trace.shift();
        const d = this.lag > 0.01 ? this.seen(tau) : null;
        if (d) {
          s.ox = d.x - s.x;
          s.oy = d.y - s.y;
          s.rotation = d.r;
        } else s.ox = s.oy = 0;
        // their serve, before our drawing of them has thrown it up
        s.hidden = s === this.theirServe && !!d && tau < this.trace[0].t - 0.5;
      }
      // their hits' sparks and sounds, and their points, as the drawing reaches them
      for (let i = 0; i < this.later.length; ) {
        const e = this.later[i];
        if (e.t <= tau + 0.5 || e.t < G.clock - MAX_LAG) {
          this.later.splice(i, 1);
          e.fn();
        } else i++;
      }

      // their figure: on their frames, or with the shuttle while a late hit has it further back
      this.figLag = this.predict ? Math.max(this.lag, this.grid) : 0;
      this.drawThem(dt, G.clock - this.figLag);

      // ours, and it just went over the net when it wasn't meant to: hand it over
      if (s && m.rallyLive) {
        const side = this.sideOf(s.x);
        if (m.owner === m.me && side !== this.side && side !== m.me) this.handOver(s);
        this.side = side;
      }
      // a shuttle that came down on their side waits for their verdict; if their screen has
      // gone quiet, call it here so the rally can't hang
      if (s && m.rallyLive && m.owner !== m.me && s.y >= G.GROUND) {
        if (++this.waiting > STUCK[m.me]) {
          this.waiting = 0;
          m.owner = m.me;
          m.point(s.x > G.NET_X ? 1 : 2);
        }
      } else this.waiting = 0;
    }

    // Their figure at moment t, from messages in H: between two of them if we have news that new,
    // else run on from the newest with the keys they were holding (marked `guess`).
    figAt(t, H) {
      const last = H[H.length - 1], tl = this.timeOf(last);
      if (t > tl + 0.5) return Object.assign(this.guessOn(last, Math.min(MAX_GUESS, t - tl)), { guess: true });
      if (t >= tl) return this.stateOf(last);
      let i = H.length - 1;
      while (i > 0 && this.timeOf(H[i - 1]) > t) i--;
      const b = H[i], a = i > 0 ? H[i - 1] : b;
      const ta = this.timeOf(a), tb = this.timeOf(b);
      const k = tb > ta ? Math.max(0, Math.min(1, (t - ta) / (tb - ta))) : 1;
      const A = a.p, B = b.p, near = k < 0.5 ? A : B;
      // the swing as their screen showed it then (frames are whole: the nearest of theirs, or
      // across lost messages, counted on a frame at a time from the one before)
      let cur = near[4];
      if (tb - ta > 1.5 * FRAME_MS && A[3] === B[3] && A[4] > 1 && B[4] > A[4]) cur = Math.min(B[4], A[4] + Math.round((t - ta) / FRAME_MS));
      return { x: A[0] + (B[0] - A[0]) * k, y: A[1] + (B[1] - A[1]) * k, inAir: !!near[7], state: STATES[near[2]],
        serving: !!near[6], shown: CLIPS[near[3]], cur, serveCur: near[5] };
    }
    guessOn(msg, ms) {
      const p = this.m.remote, a = msg.p, keys = a[11] | 0;
      Object.assign(p, { x: a[0], y: a[1], dx: a[8], dy: a[9], inAir: !!a[7], jumpHeld: !!a[10], serving: !!a[6], state: STATES[a[2]] });
      const frames = ms / FRAME_MS, whole = Math.floor(frames), part = frames - whole;
      const step = () => { p.steer(!!(keys & 1), !!(keys & 2), !!(keys & 4)); p.integrate(1 / 60); };
      for (let i = 0; i < whole; i++) step();
      let x = p.x, y = p.y;
      if (part > 0.01) {
        step();
        x += (p.x - x) * part;
        y += (p.y - y) * part;
      }
      const shown = CLIPS[a[3]], on = Math.round(frames);
      return { x, y, inAir: p.inAir, state: p.state, serving: !!a[6], shown,
        cur: a[4] > 1 ? Math.min(p.clips[shown].total, a[4] + on) : 1,
        serveCur: a[5] > 1 ? Math.min(p.clips.serve.total, a[5] + on) : a[5] };
    }
    stateOf(msg) {
      const a = msg.p;
      return { x: a[0], y: a[1], inAir: !!a[7], state: STATES[a[2]], serving: !!a[6], shown: CLIPS[a[3]], cur: a[4], serveCur: a[5] };
    }

    drawThem(dt, tau) {
      const m = this.m, p = m.remote, H = this.hist;
      if (H.length) {
        let raw;
        if (!this.predict) raw = this.stateOf(H[H.length - 1]); // just what has arrived
        else {
          raw = this.figAt(tau, H);
          // news since last frame moved the model: ease the difference out instead of jumping
          const old = H.filter((x) => x.tick < this.ticks - 1);
          const f = this.fig;
          if (old.length && old.length < H.length) {
            const was = this.figAt(tau, old);
            f.x += was.x - raw.x;
            f.y += was.y - raw.y;
          }
          if (Math.hypot(f.x, f.y) > SNAP) f.x = f.y = f.vx = f.vy = 0;
          // critically damped spring back to the model
          const w = SPRING;
          f.vx += (-2 * w * f.vx - w * w * f.x) * dt;
          f.vy += (-2 * w * f.vy - w * w * f.y) * dt;
          f.x += f.vx * dt;
          f.y += f.vy * dt;
          if (Math.abs(f.x) + Math.abs(f.y) < 0.02 && Math.abs(f.vx) + Math.abs(f.vy) < 0.5) f.x = f.y = f.vx = f.vy = 0;
        }
        p.x = raw.x + this.fig.x;
        p.y = Math.min(G.GROUND, raw.y + this.fig.y);
        p.inAir = raw.inAir;
        p.state = raw.state;
        p.serving = raw.serving;
        // their swing: the frame their screen showed (a swing's first tick often skips frame 2,
        // and their racket test went by what was showing); run on ahead of the news, it never
        // goes backwards and moves at most two frames at a time
        const swingAt = (name, at) => {
          const was = this.shownCur[name] || 1;
          const now = raw.guess && at > 1 && was > 1 ? Math.max(was, Math.min(at, was + 2)) : at;
          this.shownCur[name] = now;
          return now;
        };
        p.shown = raw.shown;
        p.active = p.clips[p.shown];
        const cur = swingAt(p.shown, raw.cur);
        if (cur > 1 && this.lastCur === 1) m.sfx('whoosh'); // they started a swing
        this.lastCur = cur;
        p.active.cur = cur;
        if (p.shown !== 'serve') p.clips.serve.cur = swingAt('serve', raw.serveCur);
      }
      p.anim += dt;
      if (p.kind === 'hover' && G.chance(25)) m.fx.debris(p.x + G.rand(-5, 5), p.y - 60, 'puff');
    }
  }

  window.PeerSync = PeerSync;
})();
