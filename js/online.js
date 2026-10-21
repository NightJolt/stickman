'use strict';
/*
 * Online 1v1 sync, peer to peer: each screen runs the match and is in charge of its own player.
 * You move, jump and swing with no delay, and your own game decides whether your racket met the
 * shuttle. When it does, the launch (contact point, power, angle) goes to the other screen, which
 * launches the same shot and fast-forwards it by half the ping so it is where it really is.
 *
 * The shuttle belongs to the player it is flying to: only their racket can hit it next, and only
 * their game decides where it came down and who won the point. So the two screens never award
 * different points, even when their flights differ by a pixel. (Online only: you can't hit your
 * own shot again after it bounces back off the net.)
 *
 * The other player is drawn from the movement they send every frame, a couple of frames behind
 * the newest so network jitter doesn't show. Movement goes over the direct channel that may drop
 * or reorder frames; hits and points go over the reliable one (js/net.js).
 */
(() => {
  const STATES = ['normal', 'forward', 'backward', 'jump'];
  const CLIPS = ['over', 'under', 'serve'];
  // The other player is drawn a few frames behind their newest message. It starts at BUFFER,
  // waits a frame longer each time their messages run dry, and creeps back after CALM frames.
  const BUFFER = 2, MAX_BUFFER = 12, CALM = 600;
  const SLACK = 6;   // more than this many extra frames queued and it skips ahead
  const STUCK = 240; // frames a landed shuttle waits for the other screen's verdict
  const r2 = (v) => Math.round(v * 100) / 100;

  class PeerSync {
    constructor(m) {
      this.m = m;
      this.f = 0;           // our movement messages
      this.games = 0;       // rematches played, for telling rallies apart
      this.applying = false;
      this.buf = [];        // the other player's movement, by frame
      this.latest = null;
      this.play = null;     // their frame on show
      this.delay = BUFFER;
      this.calm = 0;
      this.starving = false;
      this.stalled = 0;     // frames since anything new arrived from them
      this.lastCur = 1;
      this.waiting = 0;     // frames the shuttle has lain on their side without a verdict
      m.peer = this;
    }

    // which rally of which game: stale hits and points are recognised by it
    rally() { return this.games * 1000 + this.m.score1 + this.m.score2; }

    /* ---- hits and points ---- */
    // from Shuttle.hit: our racket met it (or we served), so it's theirs now
    hit(s, power, dir, kind) {
      if (this.applying) return;
      this.m.owner = 3 - this.m.me;
      NET.send({ t: 'hit', r: this.rally(), n: s.hits, x: s.x, y: s.y, power, dir, kind: kind || null });
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
      m.owner = m.me;
      this.waiting = 0;
      const ahead = 1 + Math.min(15, Math.round((NET.rtt || 0) / 2 / (1000 / 60)));
      for (let i = 0; i < ahead && m.shuttle === s && m.rallyLive; i++) s.update(1 / 60);
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
    // once per frame: how our player stands, for the other screen
    frame() {
      const p = this.m.local;
      NET.send({ t: 'st', f: ++this.f, p: [r2(p.x), r2(p.y), STATES.indexOf(p.state), CLIPS.indexOf(p.shown),
        p.clips[p.shown].cur, p.clips.serve.cur, p.serving ? 1 : 0, p.inAir ? 1 : 0] });
    }

    stream(msg) {
      if (this.play !== null && msg.f <= this.play) return; // too late to show
      let i = this.buf.length;
      while (i > 0 && this.buf[i - 1].f > msg.f) i--;
      if (i > 0 && this.buf[i - 1].f === msg.f) return;     // a copy
      this.buf.splice(i, 0, msg);
      if (!this.latest || msg.f > this.latest.f) {
        this.latest = msg;
        this.stalled = 0;
      }
    }

    // every frame, after our player and the shuttle have moved
    update(dt) {
      const m = this.m;
      this.stalled++;
      let last = null, starved = false;
      if (this.play === null && this.buf.length >= this.delay) this.play = this.latest.f - this.delay;
      if (this.play !== null) {
        const newest = this.latest.f;
        let target = this.play + 1;
        const ahead = newest - target;
        if (ahead > this.delay + SLACK) target = newest - this.delay; // far behind: jump
        else if (ahead > this.delay + 1) target++;                    // a little behind: play two
        starved = target > newest;
        this.play = Math.min(target, newest);
        while (this.buf.length && this.buf[0].f <= this.play) last = this.buf.shift();
      }
      if (starved) {
        if (!this.starving) {
          this.delay = Math.min(MAX_BUFFER, this.delay + 1);
          this.calm = 0;
        }
        this.starving = true;
      } else {
        this.starving = false;
        if (++this.calm >= CALM && this.delay > BUFFER) {
          this.delay--;
          this.calm = 0;
        }
      }
      const p = m.remote;
      if (last) {
        const a = last.p;
        p.x = a[0];
        p.y = a[1];
        p.state = STATES[a[2]];
        p.shown = CLIPS[a[3]];
        p.active = p.clips[p.shown];
        if (a[4] > 1 && this.lastCur === 1) m.sfx('whoosh'); // they started a swing
        this.lastCur = a[4];
        p.active.cur = a[4];
        p.clips.serve.cur = a[5];
        p.serving = !!a[6];
        p.inAir = !!a[7];
      }
      p.anim += dt;
      if (p.kind === 'hover' && G.chance(25)) m.fx.debris(p.x + G.rand(-5, 5), p.y - 60, 'puff');

      // a shuttle that came down on their side waits for their verdict; if their screen has
      // gone quiet, call it here so the rally can't hang
      const s = m.shuttle;
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
