'use strict';
/*
 * Online 1v1 sync, peer to peer: each screen runs the match and is in charge of its own player.
 * You move, jump and swing with no delay, and your own game decides whether your racket met the
 * shuttle. When it does, the launch (contact point, power, angle) goes to the other screen, which
 * launches the same shot and fast-forwards it by half the ping so it is where it really is.
 *
 * One game at a time owns the shuttle: only that player's racket can hit it, and only that game
 * decides where it came down and who won the point, so the two screens never award different
 * points even when their flights differ by a pixel. A shot that's going over the net belongs to
 * the opponent from the moment it's hit, so they can return it without waiting. One that will
 * come down on the hitter's side (a mishit, a serve into the net) stays the hitter's, to hit
 * again. If the flight surprises us (a roll over the tape, a bounce back off the net), the owner
 * hands it over when it actually crosses.
 *
 * The other player is drawn where they are now, not where their last message left them: each
 * frame they send their position, speed and the keys they're holding, and this screen runs that
 * forward by half the ping (plus however long ago it arrived) through the same running and
 * jumping code, and moves their swing on as far. So their racket meets the shuttle when the
 * shuttle leaves it. When they change direction the guess is briefly wrong; the difference is
 * eased out over a few frames.
 *
 * Movement goes over the direct channel that may drop or reorder messages (only the newest
 * counts); hits and points go over the reliable one (js/net.js).
 */
(() => {
  const STATES = ['normal', 'forward', 'backward', 'jump'];
  const CLIPS = ['over', 'under', 'serve'];
  const FRAME_MS = 1000 / 60;
  const MAX_AHEAD = 20; // frames we'll guess ahead at most
  const SNAP = 40;      // px: a correction bigger than this jumps instead of easing
  const STUCK = 240;    // frames a landed shuttle waits for the other screen's verdict
  const r2 = (v) => Math.round(v * 100) / 100;

  class PeerSync {
    constructor(m) {
      this.m = m;
      this.f = 0;           // our movement messages
      this.games = 0;       // rematches played, for telling rallies apart
      this.applying = false;
      this.latest = null;   // the newest movement message from them
      this.age = 0;         // frames since it arrived
      this.stalled = 0;     // frames since anything new arrived from them
      this.guess = null;    // where we put them last frame, before easing
      this.ease = { x: 0, y: 0 };
      this.lastCur = 1;
      this.side = 0;        // the half of the court the shuttle was in last frame
      this.waiting = 0;     // frames the shuttle has lain on their side without a verdict
      m.peer = this;
    }

    // which rally of which game: stale hits and points are recognised by it
    rally() { return this.games * 1000 + this.m.score1 + this.m.score2; }

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

    // it crossed the net against the forecast while ours: theirs now, from exactly here
    handOver(s) {
      const m = this.m;
      m.owner = 3 - m.me;
      NET.send({ t: 'own', r: this.rally(), n: s.hits, x: s.x, y: s.y, dx: s.dx, dy: s.dy, speed: s.speed, dir: s.dir });
    }
    remoteHandOver(msg) {
      const m = this.m, s = m.shuttle;
      if (msg.r !== this.rally() || !s || !m.rallyLive || msg.n !== s.hits) return;
      Object.assign(s, { x: msg.x, y: msg.y, dx: msg.dx, dy: msg.dy, speed: msg.speed, dir: msg.dir, rotation: msg.dir });
      m.owner = m.me;
      this.catchUp(s, 0);
    }

    // a shuttle sent from their screen has been flying there for half a ping (and `extra` frames)
    catchUp(s, extra) {
      const m = this.m;
      this.waiting = 0;
      const ahead = extra + Math.min(15, Math.round((NET.rtt || 0) / 2 / (1000 / 60)));
      for (let i = 0; i < ahead && m.shuttle === s && m.rallyLive; i++) s.update(1 / 60);
      this.side = this.sideOf(s.x);
    }

    // their racket met it: the same launch here, caught up to where it is by now
    remoteHit(msg) {
      const m = this.m;
      if (msg.r !== this.rally()) return; // a rally that's already over here
      if (m.rallyDue) m.newRally();       // their serve beat our countdown
      if (!m.rallyLive) return;
      if (msg.n === 1 || !m.shuttle) m.spawnShuttle(msg.x, msg.y);
      const s = m.shuttle;
      s.x = msg.x;
      s.y = msg.y;
      this.applying = true;
      s.hit(msg.power, msg.dir, msg.kind || undefined);
      this.applying = false;
      s.hits = msg.n;
      m.lastHitter = m.remote;
      m.owner = msg.o || m.me;
      this.catchUp(s, 1);
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
      const m = this.m, p = m.remote, sn = this.latest;
      this.stalled++;
      if (sn) {
        const a = sn.p, keys = a[11] | 0;
        // how far behind that message is by now: half the ping, plus its time here
        const ahead = Math.min(MAX_AHEAD, Math.round((NET.rtt || 0) / 2 / FRAME_MS) + this.age);
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
        // their newest state, run forward to now
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
        // their swing, moved on as far
        p.shown = CLIPS[a[3]];
        p.active = p.clips[p.shown];
        const cur = a[4] > 1 ? Math.min(p.active.total, a[4] + ahead) : 1;
        if (cur > 1 && this.lastCur === 1) m.sfx('whoosh'); // they started a swing
        this.lastCur = cur;
        p.active.cur = cur;
        p.clips.serve.cur = a[6] && a[5] > 1 ? Math.min(p.clips.serve.total, a[5] + ahead) : a[5];
      }
      p.anim += dt;
      if (p.kind === 'hover' && G.chance(25)) m.fx.debris(p.x + G.rand(-5, 5), p.y - 60, 'puff');

      const s = m.shuttle;
      // ours, and it just went over the net when it wasn't meant to: hand it over
      if (s && m.rallyLive) {
        const side = this.sideOf(s.x);
        if (m.owner === m.me && side !== this.side && side !== m.me) this.handOver(s);
        this.side = side;
      }
      // a shuttle that came down on their side waits for their verdict; if their screen has
      // gone quiet, call it here so the rally can't hang
      if (s && m.rallyLive && m.owner !== m.me && s.y >= G.GROUND) {
        if (++this.waiting > STUCK) {
          this.waiting = 0;
          m.owner = m.me;
          m.point(s.x > G.NET_X ? 1 : 2);
        }
      } else this.waiting = 0;
    }
  }

  window.PeerSync = PeerSync;
})();
