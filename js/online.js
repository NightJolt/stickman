'use strict';
/*
 * Online 1v1 sync. The room's creator hosts: their browser runs the real match, with the guest
 * as player 2 playing from keys sent over the wire. Every frame the host sends a snapshot of what
 * is on court plus the sounds and banners of the last few frames. The guest's match is a puppet
 * that plays those snapshots back a few frames behind, which smooths out network jitter, and
 * draws its own sparks, trails, puffs and confetti from them.
 *
 * The guest's own running and jumping don't wait for the host: each frame it takes the host's
 * newest state for its player and replays the keys it has pressed since (the host says which
 * key it applied last) through the same movement code, so its moves show up the moment they're
 * pressed. When the host disagrees the difference is eased out over a few frames. Swings and
 * hits stay the host's call.
 *
 * Messages may come over the direct channel (js/net.js), which can drop or reorder them, so
 * keys carry their last few frames, snapshots carry a frame number and events are repeated in
 * several snapshots.
 */
(() => {
  const STATES = ['normal', 'forward', 'backward', 'jump'];
  const CLIPS = ['over', 'under', 'serve'];
  // The guest plays a few frames behind the newest snapshot. It starts at BUFFER, waits a frame
  // longer each time the snapshots run dry, and creeps back after CALM frames without a stall.
  const BUFFER = 3, MAX_BUFFER = 12, CALM = 600;
  const SLACK = 6;        // more than this many extra frames queued and it skips ahead
  const KEY_HISTORY = 4;  // frames of keys in each key message
  const EVENT_REPEAT = 8; // snapshots each sound or banner rides in
  const SNAP = 30;        // px: a correction bigger than this jumps instead of easing
  const r2 = (v) => Math.round(v * 100) / 100;

  function keyBits() {
    const K = G.KEY, any = (list) => list.some(G.isDown);
    return (any([K.LEFT, K.A]) ? 1 : 0) | (any([K.RIGHT, K.D]) ? 2 : 0) |
      (any([K.UP, K.W]) ? 4 : 0) | (any([K.DOWN, K.S, K.SPACE]) ? 8 : 0);
  }
  const toKeys = (k) => ({ l: !!(k & 1), r: !!(k & 2), u: !!(k & 4), s: !!(k & 8) });

  /* ---------------------------------------------------------------- host */
  class HostSync {
    constructor(m) {
      this.m = m;
      this.f = 0;
      this.events = [];     // [frame, n, ...event] of the last EVENT_REPEAT frames
      this.n = 0;
      this.inputs = [];     // [seq, keys] waiting their turn
      this.seq = 0;         // newest key message seen
      this.applied = 0;     // seq of the keys player 2 is moving on
      m.hostSync = this;
      m.p2.remote = toKeys(0);
    }
    event(...e) {
      // a match's cheer or sigh depends on whose side you are on; the guest picks its own
      if (e[0] === 'sfx' && (e[1] === 'cheer' || e[1] === 'sigh')) return;
      this.events.push([this.f + 1, this.n++, ...e]);
    }
    // a key message: the keys of frame q and the frames before it, newest first
    input(msg) {
      const q = msg.q | 0, k = Array.isArray(msg.k) ? msg.k : [];
      if (q <= this.seq || !k.length) return; // old news, or repeated
      for (let s = Math.max(this.seq + 1, q - k.length + 1); s <= q; s++) this.inputs.push([s, k[q - s] | 0]);
      this.seq = q;
    }

    // once per frame, after everything has moved
    frame() {
      const m = this.m;
      const pl = (p) => [r2(p.x), r2(p.y), STATES.indexOf(p.state), CLIPS.indexOf(p.shown),
        p.clips[p.shown].cur, p.clips.serve.cur, p.serving ? 1 : 0, p.inAir ? 1 : 0,
        r2(p.dx), r2(p.dy), p.jumpHeld ? 1 : 0];
      const s = m.shuttle;
      this.f++;
      this.events = this.events.filter((e) => e[0] > this.f - EVENT_REPEAT);
      const msg = {
        t: 's',
        f: this.f,
        a: this.applied, // the guest's keys this frame was played with
        p: [pl(m.p1), pl(m.p2)],
        s: s ? [m.shuttleSeq, r2(s.x), r2(s.y), r2(s.dx), r2(s.dy), r2(s.speed), r2(s.rotation), s.hits] : 0,
        c: [m.score1, m.score2],
        n: m.net.cur,
        o: (m.over ? 1 : 0) | (m.celebrating ? 2 : 0) | (m.rallyLive ? 4 : 0),
      };
      if (this.events.length) msg.e = this.events;
      NET.send(msg);
      // the guest's keys for the next frame: one frame's worth each, but after a burst merge the
      // backlog (keeping any jump or swing press in it) so their moves don't fall behind
      if (!this.inputs.length) return;
      let [q, k] = this.inputs.shift();
      while (this.inputs.length > 1) {
        const [q2, k2] = this.inputs.shift();
        k = k2 | (k & 12);
        q = q2;
      }
      m.p2.remote = toKeys(k);
      this.applied = q;
    }
  }

  /* ---------------------------------------------------------------- guest */
  class GuestSync {
    constructor(m) {
      this.m = m;
      this.buf = [];        // snapshots waiting to be shown, by frame
      this.latest = null;   // the newest snapshot received
      this.play = null;     // host frame on show
      this.fired = new Map(); // events already played: "frame:n" -> frame
      this.seqShuttle = -1; // which shuttle is on court
      this.hits = 0;
      this.over = false;
      this.stalled = 0;     // frames since anything new arrived
      this.delay = BUFFER;  // frames behind the newest snapshot
      this.calm = 0;        // frames since it last ran dry
      this.starving = false;
      this.q = 0;           // our key messages
      this.keys = [];       // [seq, keys, dt] not yet confirmed by the host
      this.ease = { x: 0, y: 0 }; // correction still being eased out
      this.guess = null;    // where we put our player last frame
      m.guestSync = this;
    }

    snapshot(msg) {
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

    update(dt) {
      const m = this.m;
      this.stalled++;
      // our keys, every frame, with the last few in case one goes missing
      const k = keyBits();
      this.keys.push([++this.q, k, dt]);
      const recent = this.keys.slice(-KEY_HISTORY).map((e) => e[1]).reverse();
      NET.send({ t: 'i', q: this.q, k: recent });
      if (this.keys.length > 600) this.keys.splice(0, this.keys.length - 600);

      // play the host's frames back a few behind the newest
      let last = null, starved = false;
      if (this.play === null && this.buf.length >= this.delay) this.play = this.latest.f - this.delay;
      if (this.play !== null) {
        const newest = this.latest.f;
        let target = this.play + 1;
        const ahead = newest - target;  // frames queued past the one due now
        if (ahead > this.delay + SLACK) target = newest - this.delay; // far behind: jump
        else if (ahead > this.delay + 1) target++;                    // a little behind: play two
        starved = target > newest;
        this.play = Math.min(target, newest);
        while (this.buf.length && this.buf[0].f <= this.play) {
          last = this.buf.shift();
          this.fire(last);
        }
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
      if (last) this.apply(last);
      this.predict(k, dt);
      // the bits the host doesn't send
      for (const p of [m.p1, m.p2]) {
        p.anim += dt;
        if (p.kind === 'hover' && G.chance(25)) m.fx.debris(p.x + G.rand(-5, 5), p.y - 60, 'puff');
      }
      if (m.celebrating && G.chance(70)) m.fx.confetti();
    }

    // Our player now: the host's newest state for it, plus every key we pressed since the one
    // that state was played with.
    predict(k, dt) {
      const p = this.m.p2, sn = this.latest;
      if (!sn || sn.a === undefined) return;
      const shownServing = p.serving;
      const load = (s) => Object.assign(p, s);
      const save = () => ({ x: p.x, y: p.y, dx: p.dx, dy: p.dy, inAir: p.inAir, jumpHeld: p.jumpHeld, serving: p.serving });
      const step = (keys, d) => { p.steer(!!(keys & 1), !!(keys & 2), !!(keys & 4)); p.integrate(d); };
      // what last frame's guess plus this frame's keys gives
      let carried = null;
      if (this.guess) {
        load(this.guess);
        step(k, dt);
        carried = save();
      }
      // what the host's newest state plus our unconfirmed keys gives
      const a = sn.p[1];
      load({ x: a[0], y: a[1], dx: a[8], dy: a[9], inAir: !!a[7], jumpHeld: !!a[10], serving: !!a[6] });
      while (this.keys.length && this.keys[0][0] <= sn.a) this.keys.shift();
      for (const [, keys, d] of this.keys) step(keys, d);
      const now = save();
      // ease out the difference instead of jumping (unless it's a big one, like a new rally)
      if (carried) {
        const ex = carried.x - now.x, ey = carried.y - now.y;
        if (Math.hypot(ex, ey) > SNAP) this.ease = { x: 0, y: 0 };
        else this.ease = { x: this.ease.x * 0.75 + ex * 0.75, y: this.ease.y * 0.75 + ey * 0.75 };
        if (Math.abs(this.ease.x) < 0.05) this.ease.x = 0;
        if (Math.abs(this.ease.y) < 0.05) this.ease.y = 0;
      }
      this.guess = now;
      p.x = now.x + this.ease.x;
      p.y = Math.min(G.GROUND, now.y + this.ease.y);
      p.inAir = now.inAir;
      p.state = now.inAir ? 'jump' : p.dx === 0 ? 'normal' : p.dx * Math.sign(p.scaleX) > 0 ? 'forward' : 'backward';
      p.serving = shownServing; // the serve pose follows the frames on show
    }

    fire(sn) {
      if (!sn.e) return;
      for (const e of sn.e) {
        const key = e[0] + ':' + e[1];
        if (this.fired.has(key)) continue;
        this.fired.set(key, e[0]);
        if (e[2] === 'sfx') SFX.play(e[3], e[4]);
        else if (e[2] === 'banner') this.m.fx.banner(e[3], e[4], e[5]);
      }
      for (const [key, f] of this.fired) if (f < sn.f - EVENT_REPEAT * 2) this.fired.delete(key);
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
        if (!m.shuttle || seq !== this.seqShuttle) {
          m.spawnShuttle(x, y);
          this.seqShuttle = seq;
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
