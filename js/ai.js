'use strict';
/*
 * Computer player. New to this remake: the original's computer ran to a spot near the shuttle
 * and swung as soon as it came into a fixed reach zone, so it never knew which part of the swing
 * would meet the shuttle, netted about half its shots and almost never jumped.
 *
 * This one plans every return. Once its reaction time has passed it replays the incoming flight
 * with the game's own physics and, for each coming frame and each frame of its two swings, works
 * out where it would have to stand, whether it has to jump and when, and on which frame to start
 * swinging. It flies every shot that would come off the racket, drops the ones that net, and
 * keeps the one the opponent will find hardest to reach in time. Then it runs, jumps and swings
 * on those exact frames.
 *
 * What makes it beatable are human-sized mistakes, set per level in ROUND_AI: reaction time,
 * footwork a few px off, swings that go a frame early or late, how tight it dares to play the
 * net, and how carefully it picks between good shots.
 */
(() => {
  const SPF = 1 / G.FPS;
  const LOOKAHEAD = 100;            // frames of incoming flight to consider
  const REACH_Y = G.GROUND - 110;   // height at which an opponent usually meets a falling shuttle
  const HOME = 150;                 // px behind the net to wait at
  const GHOST = { point() {}, net: { play() {} } }; // stand-in match for predicted flights

  // dt of the frame now running (index 0) and of the ones after it, as main.js will step them
  function frameDts(n) {
    const out = [G.dt > 0 ? G.dt : SPF];
    const f0 = Math.ceil((G.clock * G.FPS) / 1000 - 1e-6);
    const exact = Math.floor((f0 * 1000) / G.FPS) === G.clock;
    for (let j = 1; j < n; j++) {
      out.push(exact ? (Math.floor(((f0 + j) * 1000) / G.FPS) - Math.floor(((f0 + j - 1) * 1000) / G.FPS)) / 1000 : SPF);
    }
    return out;
  }

  // Where the racket check will find the shuttle on each frame (index 0 = the frame now running):
  // the real Shuttle.update run on a copy, which keeps rolling the way it was going off the tape.
  function flight(s, dts) {
    const g = Object.create(Shuttle.prototype);
    Object.assign(g, { m: GHOST, ghost: true, x: s.x, y: s.y, dx: s.dx, dy: s.dy, dir: s.dir, speed: s.speed, rotation: s.rotation, trail: null });
    const out = [];
    for (let j = 0; j < dts.length && g.y < G.GROUND; j++) {
      out.push({ x: g.x, y: g.y });
      g.update(dts[j]);
    }
    return out;
  }

  function gauss() {
    return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  }

  class Brain {
    constructor(p, tune) {
      this.p = p;
      this.t = tune;
      this.tick = 0;
      this.shot = null;      // shuttle and hit count of the shot being answered
      this.hits = -1;
      this.readyAt = 0;      // tick its reaction time runs out
      this.plan = null;
      this.idleSince = null; // tick the rally ended
      this.serveX = 0;
      this.jumpServe = false;
      this.serveTriggered = false;
    }

    get face() { return G.sign(this.p.scaleX); }
    // The racket is free once its clip is back on frame 1. (Player.swinging can't tell: switching
    // to a swing's clip clears it, an original quirk.)
    get free() { return this.p.active.cur === 1 && !this.p.active.playing; }
    back(d) { return G.NET_X - this.face * d; } // stage x d px behind the net on this side
    foe() { const m = this.p.m; return this.p === m.p1 ? m.p2 : m.p1; }

    /* ---- serving: the original's three spots ---- */
    prepareServe() {
      if (G.chance(33)) {
        this.serveX = this.back(G.SERVE_GAP + 20);
        this.jumpServe = G.chance(this.t.jumpServe);
      } else {
        this.serveX = this.back(G.chance(50) ? 208.75 : 252.75);
        this.jumpServe = false;
      }
    }
    serve() {
      const p = this.p;
      p.dbgTarget = this.serveX;
      this.moveTo(this.serveX);
      if (Math.abs(this.serveX - p.x) < 10 && !this.serveTriggered) {
        this.serveTriggered = true;
        if (this.jumpServe) {
          G.setTimeout(() => { if (!p.inAir) p.jump(); }, 200);
          G.setTimeout(() => { p.swing(); this.serveTriggered = false; }, 300);
        } else {
          G.setTimeout(() => { p.swing(); this.serveTriggered = false; }, 200);
        }
      }
    }

    /* ---- every frame, before the player moves ---- */
    update() {
      const p = this.p, m = p.m, s = m.shuttle;
      this.tick++;
      if (p.serving) return this.serve();
      if (!m.rallyLive || !s) return this.idle();
      this.idleSince = null;
      if (m.lastHitter === p || !m.lastHitter) {
        this.plan = null;
        return this.home();
      }
      if (this.shot !== s || this.hits !== s.hits) { // a new shot to answer
        this.shot = s;
        this.hits = s.hits;
        this.plan = null;
        this.readyAt = this.tick + Math.round(this.t.react * G.FPS * G.rand(0.8, 1.2));
      }
      if (this.plan && !this.plan.swung && this.offCourse(s)) {
        // it clipped the tape or did something else unforeseen: take a moment and look again
        this.plan = null;
        this.readyAt = Math.max(this.readyAt, this.tick + 4);
      }
      if (!this.plan && this.tick >= this.readyAt) this.plan = this.makePlan();
      if (!this.plan || this.plan.none) return this.home();
      this.follow();
    }

    offCourse(s) {
      const q = this.plan.path[this.tick - this.plan.t0];
      return !q || Math.abs(q.x - s.x) > 0.5 || Math.abs(q.y - s.y) > 0.5;
    }

    follow() {
      const p = this.p, pl = this.plan, now = this.tick - pl.t0, s = p.m.shuttle;
      p.dbgTarget = pl.x;
      this.moveTo(pl.x);
      if (pl.scramble) {
        // no clean return: get under it and swing when it comes into reach
        if (this.free && p.polyHit(p.rig.cpuHit, p.inAir ? -20 : 0, s.x, s.y)) p.swing(1);
        return;
      }
      if (now === pl.jump && !p.inAir) p.jump();
      if (now === pl.swing) {
        p.swing(1, pl.clip);
        pl.swung = true;
      } else if (pl.swung && now > pl.swing + 2 && this.free) {
        this.plan = null; // the swing found nothing; the racket is back, so look again
      }
    }

    moveTo(x) {
      const p = this.p, dt = G.dt > 0 ? G.dt : SPF, v = RUN_SPEED * p.speedMul, d = x - p.x;
      p.dx = Math.abs(d) < 0.06 ? 0 : Math.abs(d) <= v * dt ? d / dt : Math.sign(d) * v;
      if (!p.inAir) p.state = Math.abs(p.dx) < v * 0.3 ? 'normal' : p.dx * this.face > 0 ? 'forward' : 'backward';
    }
    home() {
      this.p.dbgTarget = this.back(HOME);
      this.moveTo(this.back(HOME));
    }
    idle() { // rally over: catch a breath, then walk home
      if (this.idleSince === null) this.idleSince = this.tick;
      if (this.tick - this.idleSince > 40) return this.home();
      this.moveTo(this.p.x);
    }

    /* ---- planning ---- */
    makePlan() {
      const p = this.p, s = p.m.shuttle, t = this.t, face = this.face;
      const dts = frameDts(LOOKAHEAD);
      const path = flight(s, dts);
      const n = path.length;
      const plan = { t0: this.tick, path, swung: false };
      if (!path.some((q) => (q.x - G.NET_X) * face < 0)) return { ...plan, none: true };

      const v = (RUN_SPEED * p.speedMul) / G.FPS;
      const lo = face > 0 ? G.WALL + 15 : G.NET_X + G.NET_GAP;
      const hi = face > 0 ? G.NET_X - G.NET_GAP : G.W - G.WALL - 15;
      const busy = this.free ? 0 : p.active.total - p.active.cur + 1; // frames until the racket is back

      // swing timing: the clip frame on show at each frame after a start on frame S (Clip.tick)
      const run = [], startAt = [];
      for (let S = busy; S < n; S++) {
        const r = [1];
        let tt = SPF;
        for (let i = 1; i < 16 && S + i < n; i++) {
          tt += dts[S + i - 1];
          r.push(Math.floor(tt / SPF) + 1);
        }
        run[S] = r;
        r.forEach((c, i) => { (startAt[S + i] || (startAt[S + i] = new Map())).set(c, S); });
      }

      // feet height on each frame (after that frame's movement) when jumping on frame J
      const falls = new Map();
      const fall = (J) => {
        if (falls.has(J)) return falls.get(J);
        const Y = [], A = [];
        let y = p.y, dy = p.dy, air = p.inAir, ok = true;
        for (let k = 0; k < n; k++) {
          if (k === J) {
            if (air) { ok = false; break; }
            dy = JUMP_SPEED * p.jumpMul;
            air = true;
          }
          if (air) {
            dy += G.GRAVITY * dts[k];
            y = G.tw(y + dy * dts[k]);
            if (y > G.GROUND) { y = G.GROUND; dy = 0; air = false; }
          }
          Y.push(y);
          A.push(air);
        }
        const out = ok ? { Y, A } : null;
        falls.set(J, out);
        return out;
      };
      const ground = fall(null);
      // a jump's height by frames since take-off, for picking take-off frames
      const arc = [];
      for (let y = 0, dy = JUMP_SPEED * p.jumpMul; ; ) {
        dy += G.GRAVITY * SPF;
        y += dy * SPF;
        if (y > 0) break;
        arc.push(y);
      }
      const takeOffs = (k, needY, half) => {
        const out = [];
        const apex = arc.indexOf(Math.min(...arc));
        for (const [a, b] of [[0, apex], [apex, arc.length - 1]]) { // on the way up, on the way down
          let best = -1, err = Infinity;
          for (let i = a; i <= b; i++) {
            const e = Math.abs(G.GROUND + arc[i] - needY);
            if (e < err) { err = e; best = i; }
          }
          const J = k - best;
          if (best >= 0 && err < half * 0.8 && J >= 0 && !ground.A[J] && !out.includes(J)) out.push(J);
        }
        return out;
      };

      // first racket contact for a swing started on frame S, standing at x, with heights ft
      const contact = (clip, x, S, ft) => {
        const data = p.rig[clip], r = run[S];
        const ax = x + G.LAYER_DX;
        for (let i = 0; i < r.length; i++) {
          const k = S + i, c = r[i];
          if (c >= data.back) return null; // the racket has gone dead
          const f = data.f[c - 1], q = path[k], y = ft.Y[k];
          let l = ax + p.scaleX * f[1], rr = ax + p.scaleX * f[2];
          if (l > rr) [l, rr] = [rr, l];
          if (q.x >= l && q.x <= rr && q.y >= y + p.scaleY * f[3] && q.y <= y + p.scaleY * f[4]) return { k, c, air: ft.A[k] };
        }
        return null;
      };

      const judged = new Map();
      const outcome = (clip, x, S, ft) => {
        const hit = contact(clip, x, S, ft);
        if (!hit) return null;
        const key = clip + hit.c + ':' + hit.k + ':' + hit.air;
        if (!judged.has(key)) judged.set(key, this.judge(path[hit.k], clip, hit.c, hit.air, hit.k));
        return judged.get(key);
      };
      const wobble = Math.max(1.5, t.aim);
      // what it is after: an aggressive player hunts for the open court, a timid one just wants
      // it back over, high and safe
      const want = (o) => t.aggr * o.score + (1 - t.aggr) * 0.4 * Math.min(1, o.clear / 80);
      const cands = [];
      for (let k = busy; k < n; k++) {
        const q = path[k];
        if ((q.x - G.NET_X) * face >= 0 || !startAt[k]) continue;
        for (const clip of ['over', 'under']) {
          const data = p.rig[clip];
          for (let c = 1; c < data.back; c++) {
            const S = startAt[k].get(c);
            if (S === undefined) continue;
            const f = data.f[c - 1];
            const half = (p.scaleY * (f[4] - f[3])) / 2;
            const needY = q.y - (p.scaleY * (f[3] + f[4])) / 2; // feet height that puts it mid-box
            let jumps = [null];
            if (Math.abs(needY - ground.Y[k]) > half) {
              if (clip === 'under' || needY > G.GROUND) continue; // too low for this frame's box
              jumps = takeOffs(k, needY, half);
            }
            const cx = q.x - G.LAYER_DX - (p.scaleX * (f[1] + f[2])) / 2;
            const w = Math.abs(p.scaleX * (f[2] - f[1]));
            for (const J of jumps) {
              const ft = fall(J);
              if (!ft) continue;
              const by = J === null ? S : Math.min(S, J);
              for (const off of [0, -0.3, 0.3]) {
                const x = Math.max(lo, Math.min(hi, cx + off * w));
                if (Math.abs(x - p.x) > v * by + 0.5) continue; // can't get there in time
                const j = outcome(clip, x, S, ft);
                if (!j) continue;
                // a shot that falls apart if its feet are a little off is worth less
                const near = [outcome(clip, x - wobble, S, ft), outcome(clip, x + wobble, S, ft)];
                const sure = near.reduce((a, o) => a + (o && o.clear >= t.margin ? want(o) : -1.5), 0) / 2;
                cands.push({ x, S, J, clip, run: Math.abs(x - p.x), ...j, want: want(j), sure });
              }
            }
          }
        }
      }

      let pool = cands.filter((c) => c.clear >= t.margin);
      if (!pool.length) pool = cands; // nothing safe: take what there is
      if (!pool.length) return this.scramble(plan, path, lo, hi);
      for (const c of pool) {
        c.value = (1 - t.care / 2) * c.want + (t.care / 2) * c.sure - (0.06 * c.run) / (v * G.FPS) +
          (c.J !== null && Math.abs(c.dir) >= 95 ? t.flair : 0);
      }
      const best = Math.max(...pool.map((c) => c.value));
      const weights = pool.map((c) => Math.exp((c.value - best) / t.loose));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0), pick = pool[0];
      for (let i = 0; i < pool.length; i++) if ((r -= weights[i]) <= 0) { pick = pool[i]; break; }

      // the human part: footwork and timing that are not quite what was meant
      const x = Math.max(lo, Math.min(hi, pick.x + gauss() * t.aim));
      let swing = pick.S;
      if (G.chance(t.slip * 100)) swing = Math.max(busy, swing + (G.chance(50) ? 1 : -1));
      if (G.chance(t.fumble * 100)) swing = Math.max(busy, swing + (G.chance(50) ? 6 : -6)); // badly mistimed
      return { ...plan, x: Math.round(x * 20) / 20, swing, jump: pick.J, clip: pick.clip, pick, mark: path[pick.k] };
    }

    // Fly the shot a contact would produce (Player.racketCheck) and rate it: null if it nets or
    // comes back to this side, otherwise how far short in time the opponent will be (seconds,
    // higher is better), plus a little for pace and for clearing the net comfortably.
    judge(q, clip, c, air, k) {
      const p = this.p, face = this.face, foe = this.foe();
      let dir, power;
      if (clip === 'over') {
        const a = p.rig.over.f[c - 1][0] + 30;
        dir = a * face;
        power = 1250 * 1.4 * p.powerMul * POWER_TRIM * (a > 100 ? 1.25 : 1);
      } else {
        dir = 40 * face;
        power = (air ? 1150 : 1300) * 1.4 * p.powerMul * POWER_TRIM;
      }
      const r = ((dir - 90) * Math.PI) / 180;
      let steps = 0, px = q.x, py = q.y, reach = null;
      let clear = (q.x - G.NET_X) * face > 0 ? 99 : null;
      const land = Shuttle.predictLanding(q.x, q.y, Math.cos(r) * power, Math.sin(r) * power, (x, y) => {
        steps++;
        if (clear === null && (x - G.NET_X) * face > 0) clear = G.NET_TOP.t - (py + ((y - py) * (G.NET_X - px)) / (x - px));
        if (reach === null && clear !== null && y >= REACH_Y && y > py) reach = { steps, x, v: Math.hypot(x - px, y - py) * G.FPS };
        px = x;
        py = y;
      });
      if (clear === null || (land - G.NET_X) * face <= 0) return null;
      const tr = (reach ? reach.steps : steps) / G.FPS;
      const vo = foe.kind === 'jet' ? 450 : RUN_SPEED * foe.speedMul;
      const late = Math.max(0, Math.abs((reach ? reach.x : land) - foe.x) - 30) / vo - tr;
      const pace = reach ? Math.min(1, reach.v / 1500) : 0;
      return { k, c, dir, clear, land, score: late + 0.12 * pace + (0.05 * Math.min(clear, 50)) / 50 };
    }

    // Nothing it can return cleanly: run to where the shuttle drops to racket height and hope.
    scramble(plan, path, lo, hi) {
      const face = this.face;
      let q = null;
      for (const pt of path) if ((pt.x - G.NET_X) * face < 0 && pt.y > G.GROUND - 150) { q = pt; break; }
      if (!q) q = path[path.length - 1];
      return { ...plan, scramble: true, x: Math.max(lo, Math.min(hi, q.x - face * 20)) };
    }

    describe() {
      const pl = this.plan;
      if (!pl) return this.tick < this.readyAt ? `reacting ${this.readyAt - this.tick}f` : 'waiting';
      if (pl.none) return 'not coming here';
      if (pl.scramble) return 'scrambling';
      const now = this.tick - pl.t0;
      const k = pl.pick;
      return `${pl.clip} f${k.c} ${Math.round(Math.abs(k.dir))}°${pl.jump !== null ? ' jump' : ''}  swing ${pl.swing - now}f  clear ${k.clear.toFixed(0)}  score ${k.score.toFixed(2)}`;
    }
  }

  window.Brain = Brain;
})();
