'use strict';
/*
 * Online 1v1 sync. The room's creator hosts: their browser runs the real match, with the guest
 * as player 2 playing from keys sent over the wire. Every frame the host sends a snapshot of what
 * is on court plus the sounds and banners of that frame. The guest's match is a puppet that plays
 * those snapshots back a few frames behind, which smooths out network jitter, and draws its own
 * sparks, trails, puffs and confetti from them.
 *
 * Running one simulation keeps both screens in agreement. The price is lag for the guest: their
 * own moves show up a round trip (plus the buffer) after they press.
 */
(() => {
  const STATES = ['normal', 'forward', 'backward', 'jump'];
  const CLIPS = ['over', 'under', 'serve'];
  // The guest plays a few frames behind the newest snapshot. It starts at BUFFER, waits a frame
  // longer each time the snapshots run dry, and creeps back after CALM frames without a stall.
  const BUFFER = 3, MAX_BUFFER = 12, CALM = 600;
  const SLACK = 6;       // more than this many extra frames queued and it skips ahead
  const r2 = (v) => Math.round(v * 100) / 100;

  function keyBits() {
    const K = G.KEY, any = (list) => list.some(G.isDown);
    return (any([K.LEFT, K.A]) ? 1 : 0) | (any([K.RIGHT, K.D]) ? 2 : 0) |
      (any([K.UP, K.W]) ? 4 : 0) | (any([K.DOWN, K.S, K.SPACE]) ? 8 : 0);
  }

  /* ---------------------------------------------------------------- host */
  class HostSync {
    constructor(m) {
      this.m = m;
      this.f = 0;
      this.events = [];
      this.inputs = [];
      m.hostSync = this;
      m.p2.remote = { l: false, r: false, u: false, s: false };
    }
    event(...e) {
      // a match's cheer or sigh depends on whose side you are on; the guest picks its own
      if (e[0] === 'sfx' && (e[1] === 'cheer' || e[1] === 'sigh')) return;
      this.events.push(e);
    }
    input(k) { this.inputs.push(k); }

    // once per frame, after everything has moved
    frame() {
      const m = this.m;
      // the guest's keys: one change per frame, so a quick tap still lands; catch up after a burst
      if (this.inputs.length > SLACK) this.inputs.splice(0, this.inputs.length - 2);
      if (this.inputs.length) {
        const k = this.inputs.shift();
        m.p2.remote = { l: !!(k & 1), r: !!(k & 2), u: !!(k & 4), s: !!(k & 8) };
      }
      const pl = (p) => [r2(p.x), r2(p.y), STATES.indexOf(p.state), CLIPS.indexOf(p.shown),
        p.clips[p.shown].cur, p.clips.serve.cur, p.serving ? 1 : 0, p.inAir ? 1 : 0];
      const s = m.shuttle;
      const msg = {
        t: 's',
        f: ++this.f,
        p: [pl(m.p1), pl(m.p2)],
        s: s ? [m.shuttleSeq, r2(s.x), r2(s.y), r2(s.dx), r2(s.dy), r2(s.speed), r2(s.rotation), s.hits] : 0,
        c: [m.score1, m.score2],
        n: m.net.cur,
        o: (m.over ? 1 : 0) | (m.celebrating ? 2 : 0) | (m.rallyLive ? 4 : 0),
      };
      if (this.events.length) {
        msg.e = this.events;
        this.events = [];
      }
      NET.send(msg);
    }
  }

  /* ---------------------------------------------------------------- guest */
  class GuestSync {
    constructor(m) {
      this.m = m;
      this.buf = [];
      this.play = null;    // host frame on show
      this.keys = -1;
      this.keyAge = 0;
      this.seq = -1;       // which shuttle is on court
      this.hits = 0;
      this.over = false;
      this.stalled = 0;    // frames with nothing new to show
      this.delay = BUFFER; // frames behind the newest snapshot
      this.calm = 0;       // frames since it last ran dry
      this.starving = false;
      m.guestSync = this;
    }
    snapshot(msg) { this.buf.push(msg); }

    update(dt) {
      const m = this.m;
      // send our keys when they change, and now and then anyway
      const k = keyBits();
      if (k !== this.keys || ++this.keyAge >= 15) {
        NET.send({ t: 'i', k });
        this.keys = k;
        this.keyAge = 0;
      }
      // play the host's frames back a few behind the newest
      let last = null, starved = false;
      if (this.play === null && this.buf.length >= this.delay) this.play = this.buf[0].f - 1;
      if (this.play !== null) {
        const newest = this.buf.length ? this.buf[this.buf.length - 1].f : this.play;
        let target = this.play + 1;
        const ahead = newest - target; // frames queued past the one due now
        if (ahead > this.delay + SLACK) target = newest - this.delay; // far behind: jump
        else if (ahead > this.delay + 1) target++;                    // a little behind: play two
        starved = target > newest;
        while (this.buf.length && this.buf[0].f <= target) {
          last = this.buf.shift();
          this.fire(last.e);
        }
        if (last) this.play = last.f;
      }
      if (starved) {
        // ran dry: wait a frame longer from now on
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
      this.stalled = last ? 0 : this.stalled + 1;
      if (last) this.apply(last);
      // the bits the host doesn't send
      for (const p of [m.p1, m.p2]) {
        p.anim += dt;
        if (p.kind === 'hover' && G.chance(25)) m.fx.debris(p.x + G.rand(-5, 5), p.y - 60, 'puff');
      }
      if (m.celebrating && G.chance(70)) m.fx.confetti();
    }

    fire(events) {
      if (!events) return;
      for (const e of events) {
        if (e[0] === 'sfx') SFX.play(e[1], e[2]);
        else if (e[0] === 'banner') this.m.fx.banner(e[1], e[2], e[3]);
      }
    }

    apply(sn) {
      const m = this.m;
      sn.p.forEach((a, i) => {
        const p = i ? m.p2 : m.p1;
        p.x = a[0];
        p.y = a[1];
        p.state = STATES[a[2]];
        p.shown = CLIPS[a[3]];
        p.active = p.clips[p.shown];
        p.active.cur = a[4];
        p.clips.serve.cur = a[5];
        p.serving = !!a[6];
        p.inAir = !!a[7];
      });
      if (sn.s) {
        const [seq, x, y, dx, dy, speed, rot, hits] = sn.s;
        if (!m.shuttle || seq !== this.seq) {
          m.spawnShuttle(x, y);
          this.seq = seq;
          this.hits = 0;
        }
        const s = m.shuttle;
        Object.assign(s, { x, y, dx, dy, speed, rotation: rot, dir: rot });
        if (hits > this.hits) { // a racket met it since the last frame shown
          if (!s.trail) s.trail = m.fx.trail(s);
          m.fx.spark(x, y, rot, (speed / 1350) * 0.4);
          this.hits = hits;
        }
        if (s.trail) s.trail.rate = speed / 1000;
      } else if (m.shuttle) {
        m.shuttle.remove();
        m.shuttle = null;
      }
      m.net.cur = sn.n;
      [m.score1, m.score2] = sn.c;
      const over = (sn.o & 1) !== 0;
      m.celebrating = (sn.o & 2) !== 0;
      m.rallyLive = (sn.o & 4) !== 0;
      m.over = over;
      const won = m.score2 > m.score1;
      m.status = over ? (won ? 'You Win' : 'Good Try') : m.score1 + ' - ' + m.score2;
      if (over && !this.over) {
        SFX.play(won ? 'cheer' : 'sigh');
        m.hooks.matchOver(m, 'online');
      } else if (!over && this.over && m.hooks.rematch) {
        m.hooks.rematch(m);
      }
      this.over = over;
    }
  }

  window.HostSync = HostSync;
  window.GuestSync = GuestSync;
})();
