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
 * Two clocks on one screen: our half of the court is shown as it is now, theirs as it was half a
 * ping ago, which is the newest we can know of it. While the shuttle is theirs to play, it's
 * drawn on their clock: after our hit it slows a little (to 0.65x) until it's half a ping behind,
 * so when their hit arrives, the screen is just reaching the moment of it and the shuttle turns
 * at their racket. Once it's ours again it speeds up a little (to 1.5x) until it's back to now,
 * long before it reaches us. Only the drawing runs on their clock (Shuttle.ox/oy); the flight
 * itself is always where it really is, so our returns are judged on that. The other player is
 * drawn on the same clock: as they were while the shuttle is theirs, and run forward to now (from
 * their speed and held keys, through the same movement code) while it's ours.
 *
 * Movement goes over the direct channel that may drop or reorder messages (only the newest
 * counts); hits and points go over the reliable one (js/net.js).
 */
(() => {
  const STATES = ['normal', 'forward', 'backward', 'jump'];
  const CLIPS = ['over', 'under', 'serve'];
  const FRAME_MS = 1000 / 60;
  const SLOW = 0.35;    // how much slower the shuttle may be drawn while falling behind to their clock
  const FAST = 0.5;     // and how much faster while catching back up to ours
  const MAX_LAG = 250;  // ms: never draw their side further back than this
  const SNAP = 40;      // px: a correction to their figure bigger than this jumps instead of easing
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
      this.latest = null;   // the newest movement message from them
      this.age = 0;         // frames since it arrived
      this.stalled = 0;     // frames since anything new arrived from them
      this.guess = null;    // where we put them last frame, before easing
      this.ease = { x: 0, y: 0 };
      this.lastCur = 1;
      this.shownCur = {};   // the swing frame we're showing of each of their clips
      this.side = 0;        // the half of the court the shuttle was in last frame
      this.waiting = 0;     // frames the shuttle has lain on their side without a verdict
      this.lag = 0;         // ms the shuttle is drawn behind where it is (their clock)
      this.trace = [];      // where the shuttle has really been: { t, x, y, r }
      this.traced = null;   // which shuttle that is
      m.peer = this;
    }

    // which rally of which game: stale hits and points are recognised by it
    rally() { return this.games * 1000 + this.m.score1 + this.m.score2; }

    // how old their news is when it gets here: half the ping, plus the frame it was sent at
    oneWay() { return Math.min(MAX_LAG, (NET.rtt || 0) / 2 + FRAME_MS); }

    /* ---- hits and points ---- */
    // which player's half of the court x is in
    sideOf(x) { return x < G.NET_X ? 1 : 2; }

    // from Shuttle.hit: our racket met it (or we served). It's theirs if it's going over.
    hit(s, power, dir, kind) {
      if (this.applying) return;
      const m = this.m;
      m.owner = this.sideOf(s.landX) === m.me ? m.me : 3 - m.me;
      this.side = this.sideOf(s.x);
      NET.send({ t: 'hit', r: this.rally(), n: s.hits, x: s.x, y: s.y, power, dir, kind: kind || null, o: m.owner });
    }

    // their racket met it: the same launch here, from the moment it happened
    remoteHit(msg) {
      const m = this.m;
      if (msg.r !== this.rally()) return; // a rally that's already over here
      if (m.rallyDue) m.newRally();       // their serve beat our countdown
      if (!m.rallyLive) return;
      if (m.shuttle && msg.n <= m.shuttle.hits) return; // the second copy of a hit we have
      if (msg.n === 1 || !m.shuttle) {
        m.spawnShuttle(msg.x, msg.y);
        this.lag = this.oneWay(); // a new shuttle (their serve): draw it from their racket
      }
      const s = m.shuttle;
      this.rewind(s, () => {
        s.x = msg.x;
        s.y = msg.y;
        this.applying = true;
        s.hit(msg.power, msg.dir, msg.kind || undefined);
        this.applying = false;
      });
      s.hits = msg.n;
      m.lastHitter = m.remote;
      m.owner = msg.o || m.me;
    }

    // it crossed the net against the forecast while ours: theirs now, from exactly here
    handOver(s) {
      const m = this.m;
      m.owner = 3 - m.me;
      NET.send({ t: 'own', r: this.rally(), n: s.hits, x: s.x, y: s.y, dx: s.dx, dy: s.dy, speed: s.speed, dir: s.dir });
    }
    remoteHandOver(msg) {
      const m = this.m, s = m.shuttle;
      if (msg.r !== this.rally() || !s || !m.rallyLive || msg.n !== s.hits) return;
      if (this.handed === s.hits && this.handedShuttle === s) return; // the second copy
      this.handed = s.hits;
      this.handedShuttle = s;
      this.rewind(s, () => Object.assign(s, { x: msg.x, y: msg.y, dx: msg.dx, dy: msg.dy, speed: msg.speed, dir: msg.dir, rotation: msg.dir }));
      m.owner = m.me;
    }

    // Something happened to the shuttle on their screen half a ping ago: rewrite its path from
    // that moment (`then` sets it as it was), and fly it on to now, noting where it was on the way.
    rewind(s, then) {
      const m = this.m, at = G.clock - this.oneWay();
      if (this.traced !== s) {
        this.trace = [];
        this.traced = s;
      }
      this.trace = this.trace.filter((e) => e.t < at);
      then();
      this.note(s, at);
      const frames = Math.round(this.oneWay() / FRAME_MS);
      for (let i = 1; i <= frames && m.shuttle === s && m.rallyLive; i++) {
        s.update(1 / 60);
        this.note(s, at + i * FRAME_MS);
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
      NET.send({ t: 'pt', r: this.rally(), side });
    }
    remotePoint(msg) {
      if (msg.r === this.rally()) this.m.point(msg.side, true);
    }

    // both players asked for a rematch
    restart() {
      this.games++;
      this.m.resetLevel();
    }

    /* ---- movement ---- */
    // once per frame: how our player stands and moves, and what they're pressing
    frame() {
      const p = this.m.local, K = G.KEY, any = (list) => list.some(G.isDown);
      const keys = (any([K.LEFT, K.A]) ? 1 : 0) | (any([K.RIGHT, K.D]) ? 2 : 0) | (any([K.UP, K.W]) ? 4 : 0);
      NET.send({ t: 'st', f: ++this.f, p: [r2(p.x), r2(p.y), STATES.indexOf(p.state), CLIPS.indexOf(p.shown),
        p.clips[p.shown].cur, p.clips.serve.cur, p.serving ? 1 : 0, p.inAir ? 1 : 0,
        r2(p.dx), r2(p.dy), p.jumpHeld ? 1 : 0, keys] });
    }

    stream(msg) {
      if (this.latest && msg.f <= this.latest.f) return; // older than what we have
      this.latest = msg;
      this.age = 0;
      this.stalled = 0;
    }

    // every frame, after our player and the shuttle have moved
    update(dt) {
      const m = this.m, s = m.shuttle;
      this.stalled++;

      // their clock: half a ping back while the shuttle is theirs to play, now otherwise
      const behind = this.predict && s && m.rallyLive && m.owner && m.owner !== m.me ? this.oneWay() : 0;
      const ms = dt * 1000;
      if (this.lag < behind) this.lag = Math.min(behind, this.lag + SLOW * ms);
      else this.lag = Math.max(behind, this.lag - FAST * ms);

      // the shuttle: note where it really is, draw it where it was on that clock
      if (s) {
        if (this.traced !== s) {
          this.trace = [];
          this.traced = s;
        }
        this.note(s, G.clock);
        while (this.trace.length > 2 && this.trace[1].t < G.clock - 1000) this.trace.shift();
        const d = this.lag > 0 ? this.seen(G.clock - this.lag) : null;
        if (d) {
          s.ox = d.x - s.x;
          s.oy = d.y - s.y;
          s.rotation = d.r;
        } else s.ox = s.oy = 0;
      }

      this.drawThem(dt);

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

    // The other player, on the same clock as the shuttle: their newest state run forward by as
    // much as that clock is ahead of it.
    drawThem(dt) {
      const m = this.m, p = m.remote, sn = this.latest;
      if (sn) {
        const a = sn.p, keys = a[11] | 0;
        const ahead = this.predict ? Math.max(0, Math.round((this.oneWay() - this.lag) / FRAME_MS)) + this.age : 0;
        this.age++;
        const step = () => { p.steer(!!(keys & 1), !!(keys & 2), !!(keys & 4)); p.integrate(1 / 60); };
        const save = () => ({ x: p.x, y: p.y, dx: p.dx, dy: p.dy, inAir: p.inAir, jumpHeld: p.jumpHeld });
        // last frame's guess moved on a frame, to compare with the new one
        let carried = null;
        if (this.guess) {
          Object.assign(p, this.guess, { serving: !!a[6] });
          step();
          carried = save();
        }
        Object.assign(p, { x: a[0], y: a[1], dx: a[8], dy: a[9], inAir: !!a[7], jumpHeld: !!a[10], serving: !!a[6] });
        for (let i = 0; i < ahead; i++) step();
        const now = save();
        if (carried) {
          const ex = carried.x - now.x, ey = carried.y - now.y;
          if (Math.hypot(ex, ey) > SNAP) this.ease = { x: 0, y: 0 };
          else this.ease = { x: (this.ease.x + ex) * 0.75, y: (this.ease.y + ey) * 0.75 };
          if (Math.abs(this.ease.x) < 0.05) this.ease.x = 0;
          if (Math.abs(this.ease.y) < 0.05) this.ease.y = 0;
        }
        this.guess = now;
        p.x = now.x + this.ease.x;
        p.y = Math.min(G.GROUND, now.y + this.ease.y);
        p.state = now.inAir ? 'jump' : now.dx === 0 ? 'normal' : now.dx * Math.sign(p.scaleX) > 0 ? 'forward' : 'backward';
        // their swing, moved on as far (playing double speed rather than skipping frames)
        const swingAt = (name, at) => {
          const was = this.shownCur[name] || 1;
          let now = at;
          if (at > 1) {
            now = Math.min(p.clips[name].total, at + ahead, Math.max(at, was + 2));
            if (was > 1 && now < was) now = was; // never backwards within a swing
          }
          this.shownCur[name] = now;
          return now;
        };
        p.shown = CLIPS[a[3]];
        p.active = p.clips[p.shown];
        const cur = swingAt(p.shown, a[4]);
        if (cur > 1 && this.lastCur === 1) m.sfx('whoosh'); // they started a swing
        this.lastCur = cur;
        p.active.cur = cur;
        if (p.shown !== 'serve') p.clips.serve.cur = swingAt('serve', a[5]);
      }
      p.anim += dt;
      if (p.kind === 'hover' && G.chance(25)) m.fx.debris(p.x + G.rand(-5, 5), p.y - 60, 'puff');
    }
  }

  window.PeerSync = PeerSync;
})();
