'use strict';
/*
 * Gameplay simulation: shuttle, players (keyboard, mouse flyer, hover, computer) and the match.
 * Every rule, constant and update order mirrors the original game's logic.
 */

/* ======================================================================== */
/*                                 Shuttle                                  */
/* ======================================================================== */
class Shuttle {
  constructor(match, x, y) {
    this.m = match;
    this.x = G.tw(x);
    this.y = G.tw(y);
    this.dx = 0;
    this.dy = 0;
    this.dir = 0;
    this.speed = 0;
    this.rotation = 0;
    this.landX = 0;          // predicted landing x (used by the computer)
    this.trail = null;
  }

  // Racket contact: launch at `power` px/s in direction `dir` (deg, 0 = up)
  hit(power, dir, kind) {
    const m = this.m;
    if (!m.rallyLive) return;
    if (!this.trail) this.trail = m.fx.trail(this);
    this.speed = power;
    this.dir = dir;
    this.rotation = dir;
    m.fx.spark(this.x, this.y, dir, (power / 1350) * 0.4);
    SFX.play('hit', power);
    G.applyDir(this);
    this.landX = Shuttle.predictLanding(this.x, this.y, this.dx, this.dy);
  }

  // Where a shuttle at (px, py) moving (vx, vy) lands: fixed 1/60 s steps, walls and net body only.
  // `visit` (optional) sees every predicted point; the debug overlay uses it to draw the path.
  static predictLanding(px, py, vx, vy, visit) {
    if (py > G.GROUND) py = G.GROUND - 1;
    let guard = 0;
    while (py < G.GROUND && guard++ < 200000) {
      const d = 1 / G.FPS;
      vy += G.GRAVITY * d;
      vy = vy * Math.pow(0.965, 60 * d);
      vx *= Math.pow(0.965, 60 * d);
      px += vx * d;
      py += vy * d;
      if (px > G.W - G.WALL) {
        px = G.W - G.WALL;
        vx *= -0.8;
        if (Math.abs(vx) < 200) vx = 200 * G.sign(vx);
      }
      if (px < G.WALL) {
        px = G.WALL;
        vx *= -0.8;
        if (Math.abs(vx) < 200) vx = 200 * G.sign(vx);
      }
      if (G.inBox(G.NET_BODY, px, py)) {
        while (G.inBox(G.NET_BODY, px, py)) {
          if (vx > 0) px--;
          else px += 1;
        }
        vx *= -0.1;
        vy *= 0.1;
      }
      if (visit) visit(px, py);
    }
    return px;
  }

  netCollide() {
    const m = this.m;
    if (G.inBox(G.NET_TOP, this.x, this.y) && this.dy > 0) {
      while (G.inBox(G.NET_BODY, this.x, this.y)) this.y = G.tw(this.y - 1);
      this.dy *= 0.3;
      this.dx *= 0.8;
      if (this.dy > -100) this.dy = -100;
      if (Math.abs(this.dx) < 100) this.dx = G.chance(50) ? -150 : 150;
      m.net.play();
      return true;
    }
    if (G.inBox(G.NET_BODY, this.x, this.y)) {
      while (G.inBox(G.NET_BODY, this.x, this.y)) {
        if (this.dx > 0) this.x = G.tw(this.x - 1);
        else this.x = G.tw(this.x + 1);
      }
      this.dx *= -0.1;
      this.dy *= 0.1;
      m.net.play();
      return true;
    }
    return false;
  }

  update(dt) {
    if (Math.abs(this.dy) > 0) this.dy += G.GRAVITY * dt;
    this.dy *= Math.pow(0.965, 60 * dt);
    this.dx *= Math.pow(0.965, 60 * dt);
    const ox = this.x, oy = this.y;
    if (Math.abs(this.dx) > 5) this.x = G.tw(this.x + this.dx * dt);
    if (Math.abs(this.dy) > 5) this.y = G.tw(this.y + this.dy * dt);
    G.calcDir(this);
    this.rotation = this.dir;
    G.calcSpeed(this);
    if (this.y < -500) this.y = -500;
    if (this.x > G.W - G.WALL) {
      this.x = G.W - G.WALL;
      this.dx *= -0.8;
      if (Math.abs(this.dx) < 200) this.dx = 200 * G.sign(this.dx);
    }
    if (this.x < G.WALL) {
      this.x = G.WALL;
      this.dx *= -0.8;
      if (Math.abs(this.dx) < 200) this.dx = 200 * G.sign(this.dx);
    }
    // four sub-steps between the old and new position for net contact
    const nx = this.x, ny = this.y;
    let hit = false;
    let k = 1;
    while (!hit) {
      this.x = G.tw((k * (nx - ox)) / 4 + ox);
      this.y = G.tw((k * (ny - oy)) / 4 + oy);
      hit = this.netCollide();
      if (k === 4) break;
      k++;
    }
    if (this.y > G.GROUND) {
      this.dy *= -0.4;
      this.y = G.GROUND;
      this.m.point(this.x > G.NET_X ? 1 : 2);
      if (Math.abs(this.dy) < 5) this.dy = 0;
    }
    if (this.trail) this.trail.rate = this.speed / 1000;
  }

  remove() {
    if (this.trail) this.trail.detach();
  }
}

/* ======================================================================== */
/*                                  Player                                  */
/* ======================================================================== */
const RUN_SPEED = 225;
const JUMP_SPEED = -400;
const POWER_TRIM = 0.885;

class Player {
  constructor(match, id, x, y, facing) {
    const def = CHARS[id];
    this.m = match;
    this.id = id;
    this.def = def;
    this.kind = def.kind;
    this.rig = RIGS[def.rig];
    this.x = G.tw(x);
    this.y = G.tw(y);
    this.scaleX = facing * 1.25;
    this.scaleY = 1.25;
    this.speedMul = def.speed;
    this.jumpMul = def.jump;
    this.powerMul = def.power;

    this.dx = 0;
    this.dy = 0;
    this.inAir = false;
    this.serving = false;
    this.cpu = false;
    this.swinging = false;
    this.jumpHeld = false;
    this.swingHeld = false;
    this.overhead = false;
    this.hitLive = false;
    this.power = 1;
    this.controls = 0;         // 0 = solo keys, 1 = P1 (WASD), 2 = P2 (arrows)
    this.state = 'normal';     // normal | forward | backward | jump
    this.underShift = 0;       // temporary hitbox y shifts (player-local px)
    this.cpuShift = 0;

    // computer brain
    this.skill = 0;
    this.skillBase = 0;
    this.overheadChance = 0;
    this.rollA = 100;
    this.rollB = 100;
    this.lastShuttleX = 0;
    this.goHome = false;
    this.rallyOverSeen = false;
    this.lastCpuSwing = 0;
    this.serveTargetX = 0;
    this.jumpServe = false;
    this.serveTriggered = false;

    // floaters
    this.bob = 0;
    this.bobStep = 0.05;
    this.restY = this.kind === 'hover' ? G.GROUND : 0;

    // swing clips
    const mk = (name) => {
      const d = this.rig[name];
      const scripts = {};
      if (d.serve) scripts[d.serve] = () => this.serveShuttle();
      if (d.back) scripts[d.back] = () => this.swingBack();
      scripts[d.reset] = () => this.setupOverhead();
      const c = new G.Clip(d.n, scripts);
      c.data = d;
      c.name = name;
      return c;
    };
    this.clips = { serve: mk('serve'), under: mk('under'), over: mk('over') };
    this.active = this.clips.over;
    this.shown = 'over';
    this.setupOverhead();
    this.anim = 0; // visual walk phase
  }

  setSkill(v) {
    this.skill = v;
    this.skillBase = v;
  }

  frame() {
    return this.active.data.f[this.active.cur - 1];
  }

  /* ---- stage-space hit tests ---- */
  localPoint(px, py) {
    return [(px - (this.x + G.LAYER_DX)) / this.scaleX, (py - this.y) / this.scaleY];
  }
  polyHit(polys, shiftY, px, py) {
    const [lx, ly0] = this.localPoint(px, py);
    const ly = ly0 - shiftY;
    let inside = false;
    for (const p of polys) {
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
        if (yi > ly !== yj > ly && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }
  racketBox() {
    const f = this.frame();
    const ax = this.x + G.LAYER_DX;
    let l = ax + this.scaleX * f[1];
    let r = ax + this.scaleX * f[2];
    if (l > r) { const t = l; l = r; r = t; }
    return { l, r, t: this.y + this.scaleY * f[3], b: this.y + this.scaleY * f[4] };
  }

  /* ---- swing state ---- */
  prepareServe() {
    this.serving = true;
    this.swinging = false;
    this.overhead = false;
    this.active = this.clips.serve;
    this.clips.over.gotoAndStop(1);
    this.clips.under.gotoAndStop(1);
    this.clips.serve.gotoAndStop(1);
    this.shown = 'serve';
    const lineL = G.NET_X - G.SERVE_GAP - 20, lineR = G.NET_X + G.SERVE_GAP + 20;
    if (this.serving && this.scaleX > 0 && this.x > lineL) this.x = lineL;
    if (this.serving && this.scaleX < 0 && this.x < lineR) this.x = lineR;
    if (this.cpu) {
      if (G.chance(33)) {
        this.serveTargetX = G.NET_X + G.SERVE_GAP + 20;
        this.jumpServe = !G.chance(this.skill);
      } else if (G.chance(50)) {
        this.serveTargetX = 526;
        this.jumpServe = false;
      } else {
        this.serveTargetX = 570;
        this.jumpServe = false;
      }
    }
  }

  setupOverhead() {
    if (!this.serving) {
      this.serving = false;
      this.swinging = false;
      this.overhead = true;
      this.active = this.clips.over;
      this.shown = 'over';
    }
  }

  setupUnderhand() {
    if (!this.serving) {
      this.serving = false;
      this.swinging = false;
      this.overhead = false;
      this.active = this.clips.under;
      this.shown = 'under';
    }
  }

  swingBack() {
    this.hitLive = false;
  }

  swing(power = 1) {
    if (this.swinging || this.active.cur !== 1) return;
    const m = this.m;
    const s = m.shuttle;
    this.power = power;
    SFX.play('whoosh');
    this.swinging = true;
    let inReach = false;
    if (this.dy > -100 && this.inAir) this.underShift += 20;
    if (!this.serving && s && this.polyHit(this.rig.underHit, this.underShift, s.x, s.y)) inReach = true;
    if (this.dy > -100 && this.inAir) this.underShift -= 20;
    if (inReach && (s.dy > 0 || s.y > G.NET_TOP.y)) this.setupUnderhand();
    let atNet = false;
    if (this.scaleX > 0 && s && s.x > G.NET_BODY.x - 15) atNet = true;
    else if (this.scaleX < 0 && s && s.x < G.NET_BODY.x + 15) atNet = true;
    if (inReach && !this.cpu && atNet) this.setupOverhead();
    if (inReach && this.cpu && G.chance(this.overheadChance)) this.setupOverhead();
    this.hitLive = !this.serving;
    this.active.play();
  }

  serveShuttle() {
    const m = this.m;
    this.serving = false;
    const sp = this.rig.servePoint;
    m.spawnShuttle(sp[0] * G.sign(this.scaleX) + this.x, sp[1] + this.y);
    if (this.kind === 'hover') {
      m.shuttle.hit(1350 * 1.1, 40 * G.sign(this.scaleX), 'pop');
      m.lastHitter = this;
      SFX.play('pop');
      return;
    }
    const power = 1350 * 1.3 * G.rand(0.93, 1.03) * POWER_TRIM;
    m.shuttle.hit(power, 40 * G.sign(this.scaleX), 'serve');
    m.lastHitter = this;
  }

  racketCheck() {
    const m = this.m;
    const s = m.shuttle;
    if (!this.active || !s || !this.hitLive) return;
    if (!G.inBox(this.racketBox(), s.x, s.y)) return;
    const f = this.frame();
    this.hitLive = false;
    this.skill += 7;
    if (this.power > 1) this.power = 1;
    let power, dir;
    if (this.overhead) {
      const tilt = 30;
      dir = (f[0] + tilt) * G.sign(this.scaleX);
      if (f[0] + tilt > 100) this.power *= 1.25;
      power = 1250 * 1.4 * this.powerMul * POWER_TRIM * this.power;
      s.hit(power, dir);
    } else {
      power = (this.inAir ? 1150 : 1300) * 1.4 * this.powerMul * POWER_TRIM * this.power;
      s.hit(power, 40 * G.sign(this.scaleX), 'underhand');
    }
    m.lastHitter = this;
  }

  jump(mul = 1) {
    if (this.inAir) return;
    this.dy = JUMP_SPEED * this.jumpMul * mul;
    this.inAir = true;
  }

  /* ---- per-frame ---- */
  update(dt) {
    if (this.kind === 'jet') return this.updateJet(dt);
    this.baseUpdate(dt);
    if (this.kind === 'hover') {
      if (this.cpu || !this.inAir) {
        this.bob += this.bobStep * 4;
        if (this.bob > 4) { this.bob = 4; this.bobStep *= -1; }
        if (this.bob < -4) { this.bob = -4; this.bobStep *= -1; }
        this.y = G.tw(this.restY + this.bob);
      }
      if (G.chance(25)) this.m.fx.debris(this.x + G.rand(-5, 5), this.y - 60, 'puff');
    }
  }

  updateJet(dt) {
    const m = this.m;
    if (!m.over) {
      this.bob += this.bobStep;
      if (this.bob > 1) { this.bob = 1; this.bobStep *= -1; }
      if (this.bob < -1) { this.bob = -1; this.bobStep *= -1; }
      const mx = G.mouse.x, my = G.mouse.y;
      if (!isNaN(my) && my !== 5) {
        const k = Math.pow(this.def.follow, 60 * dt);
        this.x = G.tw(this.x - (this.x - mx) / k);
        this.y = G.tw(this.y - ((this.y - my) / k + this.bob));
      }
      this.restY = this.y;
      this.baseUpdate(dt);
    } else {
      this.bob += this.bobStep * 4;
      if (this.bob > 4) { this.bob = 4; this.bobStep *= -1; }
      if (this.bob < -4) { this.bob = -4; this.bobStep *= -1; }
      this.y = G.tw(this.restY + this.bob);
    }
    if (G.chance(25)) m.fx.debris(this.x + G.rand(-5, 5), this.y, 'flame');
  }

  baseUpdate(dt) {
    const m = this.m;
    if (this.cpu) this.think(dt);
    else if (this.kind !== 'jet') this.readKeys(dt);
    if (this.inAir) {
      this.dy += G.GRAVITY * dt;
      this.state = 'jump';
    }
    this.x = G.tw(this.x + this.dx * dt);
    this.y = G.tw(this.y + this.dy * dt);
    if (this.x < G.WALL + 15) this.x = G.WALL + 15;
    if (this.x > G.W - G.WALL - 15) this.x = G.W - G.WALL - 15;
    if (this.scaleX > 0 && this.x > G.NET_X - G.NET_GAP) this.x = G.NET_X - G.NET_GAP;
    if (this.scaleX < 0 && this.x < G.NET_X + G.NET_GAP) this.x = G.NET_X + G.NET_GAP;
    if (this.serving && this.scaleX > 0 && this.x > G.NET_X - G.SERVE_GAP - 20) this.x = G.NET_X - G.SERVE_GAP - 20;
    if (this.serving && this.scaleX < 0 && this.x < G.NET_X + G.SERVE_GAP + 20) this.x = G.NET_X + G.SERVE_GAP + 20;
    if (this.y > G.GROUND && this.inAir) {
      this.inAir = false;
      this.dy = 0;
      this.y = G.GROUND;
    }
    this.racketCheck();
    this.anim += dt;
  }

  readKeys(dt) {
    const K = G.KEY;
    let up, swing, left, right;
    if (this.controls === 0) {
      up = [K.UP, K.W]; swing = [K.DOWN, K.S, K.SPACE, K.J, K.K, K.L]; left = [K.LEFT, K.A]; right = [K.RIGHT, K.D];
    } else if (this.controls === 1) {
      up = [K.W]; swing = [K.S, K.SPACE]; left = [K.A]; right = [K.D];
    } else {
      up = [K.UP]; swing = [K.DOWN]; left = [K.LEFT]; right = [K.RIGHT];
    }
    const any = (list) => list.some(G.isDown);
    const u = any(up), s = any(swing), l = any(left), r = any(right);
    if (r && l) {
      this.dx = 0;
      if (!this.inAir) this.state = 'normal';
    } else if (r) {
      this.dx = RUN_SPEED * this.speedMul;
      if (!this.inAir) this.state = this.scaleX > 0 ? 'forward' : 'backward';
    } else if (l) {
      this.dx = -RUN_SPEED * this.speedMul;
      if (!this.inAir) this.state = this.scaleX > 0 ? 'backward' : 'forward';
    } else {
      this.dx = 0;
      if (!this.inAir) this.state = 'normal';
    }
    if (u) {
      if (!this.jumpHeld) this.jump();
      this.jumpHeld = true;
    } else {
      this.jumpHeld = false;
    }
    if (s) {
      if (!this.swingHeld) {
        if (G.isDown(K.J)) this.swing(1);
        else if (G.isDown(K.K)) this.swing(0.75);
        else if (G.isDown(K.L)) this.swing(0.65);
        else this.swing(0.65);
      } else {
        this.power += (0.35 / 0.024) * dt;
      }
      this.swingHeld = true;
    } else {
      this.swingHeld = false;
    }
  }

  /* ---- computer opponent (always plays the right-hand side) ---- */
  think() {
    const m = this.m;
    const s = m.shuttle;
    const mid = G.W / 2;
    let target;
    if (this.serving) {
      target = this.serveTargetX;
    } else if (this.goHome || s === null || m.lastHitter === this || s.x < mid) {
      target = 450;
    } else if (s.landX > 450 && s.x < 340) {
      target = 450;
    } else {
      let off;
      if (this.rollA < this.skill) {
        off = s.landX < mid + 240 ? 100 - (s.landX - mid) / 11 : 20;
      } else {
        off = 20;
        if (this.rollB < 50 && s.landX < mid + 240) off = 70 - (s.landX - mid) / 11;
      }
      if (m.p1Id === 'jo' && s.landX > mid + 220) off = 20;
      if (Math.abs(this.lastShuttleX - s.x) > 8 || this.rollA < this.skill || this.rollB < (100 - this.skill) / 2) {
        target = s.x + off;
        this.lastShuttleX = s.x;
      } else {
        target = this.lastShuttleX + off;
      }
    }
    this.dbgTarget = target;

    if (!m.rallyLive && !this.rallyOverSeen) {
      this.rallyOverSeen = true;
      G.setTimeout(() => { this.goHome = true; }, 1000);
    } else if (m.rallyLive && this.rallyOverSeen) {
      this.rallyOverSeen = false;
      this.goHome = false;
      this.rollA = 100;
      this.rollB = 100;
      this.skill = this.skillBase - 7;
    }

    const face = G.sign(this.scaleX);
    if (Math.abs(target - this.x) < 10) {
      this.dx = 0;
      this.state = 'normal';
    } else if (target - this.x < 0) {
      this.dx = RUN_SPEED * face * this.speedMul;
      this.state = 'forward';
    } else if (target - this.x > 0) {
      this.dx = -RUN_SPEED * face * this.speedMul;
      this.state = 'backward';
    } else {
      this.dx = 0;
      this.state = 'normal';
    }

    if (s && Math.abs(s.y - 190) < 10 && m.lastHitter !== this && this.x - 60 - s.x < 20 &&
        this.rollB < (100 - this.skill) / 2 && this.rollA >= this.skill && !this.inAir) {
      this.jump();
    }

    if (this.inAir) this.cpuShift -= 20;
    if (G.clock - this.lastCpuSwing > 500 && m.rallyLive && s && this.polyHit(this.rig.cpuHit, this.cpuShift, s.x, s.y) &&
        m.lastHitter !== this && s.x > m.netClipX) {
      this.lastCpuSwing = G.clock;
      this.swing();
      this.rollA = G.rand(0, 100);
      this.rollB = G.rand(0, 100);
    }
    if (this.inAir) this.cpuShift += 20;

    if (this.serving && Math.abs(this.serveTargetX - this.x) < 10 && !this.serveTriggered) {
      this.serveTriggered = true;
      if (this.jumpServe) {
        G.setTimeout(() => { if (!this.inAir) this.jump(); }, 200);
        G.setTimeout(() => { this.swing(); this.serveTriggered = false; }, 300);
      } else {
        G.setTimeout(() => { this.swing(); this.serveTriggered = false; }, 200);
      }
      this.rollA = G.rand(0, 100);
      this.rollB = G.rand(0, 100);
    }
  }

  dispose() {
    for (const k in this.clips) this.clips[k].dispose();
  }
}

/* ======================================================================== */
/*                                  Match                                   */
/* ======================================================================== */
class Match {
  // mode: 'solo' (tournament) or 'versus' (two players)
  constructor(mode, p1Id, p2Id, hooks) {
    this.mode = mode;
    this.p1Id = p1Id;
    this.p2Id = p2Id || null;
    this.hooks = hooks;          // UI callbacks
    this.fx = new FX(this);
    this.shuttle = null;
    this.p1 = null;
    this.p2 = null;
    this.lastHitter = null;
    this.over = false;          // match decided
    this.rallyLive = false;     // points can be scored
    this.celebrating = false;
    this.score1 = 0;
    this.score2 = 0;
    this.server = 1;
    this.round = 0;
    this.flawless = true;
    this.status = '0 - 0';
    this.netClipX = G.NET_X;
    this.net = new G.Clip(24, {});
    this.bubble = null;
    this._update = (dt) => this.update(dt);
  }

  start() {
    G.updates.length = 0;
    G.clearTimers();
    G.addUpdate(this._update);
    G.pauseAllowed = true;
    G.paused = false;
    G.lastT = G.clock;
    this.setupPlayer1();
    if (this.mode === 'versus') {
      this.setupPlayer2();
      this.p1.controls = 1;
      this.p2.controls = 2;
      this.newRally();
      this.banner();
    } else {
      this.nextLevel();
    }
  }

  setupPlayer1() {
    if (this.p1) this.p1.dispose();
    this.p1 = new Player(this, this.p1Id, 150, G.GROUND, 1);
  }

  setupPlayer2() {
    if (this.p2) this.p2.dispose();
    this.p2 = new Player(this, this.p2Id, 500, G.GROUND, -1);
  }

  setupOpponent() {
    if (this.p2) this.p2.dispose();
    const ladder = LADDER[this.p1Id] || ['stan', 'stan', 'stan', 'stan', 'stan'];
    this.p2Id = ladder[this.round - 1];
    let [speed, jump, power, skill] = ROUND_AI[this.round - 1];
    if (this.p1Id === 'jo') speed *= 1.1;
    const p = new Player(this, this.p2Id, 500, G.GROUND, -1);
    p.speedMul = speed;
    p.jumpMul = jump;
    p.powerMul = power;
    p.setSkill(skill);
    p.overheadChance = skill;
    p.cpu = true;
    this.p2 = p;
    const special = greetingFor(this.p2Id, this.p1Id);
    const line = special || G.pick(CHARS[this.p2Id].lines);
    G.setTimeout(() => { if (this.p2 === p) this.say(p, line); }, 1000);
  }

  say(p, text) {
    this.bubble = { text, until: G.clock + 3000, who: p };
  }

  nextLevel() {
    this.over = false;
    this.celebrating = false;
    this.score1 = this.score2 = 0;
    this.server = 1;
    this.round++;
    this.setupOpponent();
    this.newRally();
    this.banner();
  }

  resetLevel() {
    G.pauseAllowed = true;
    this.flawless = true;
    if (this.mode === 'versus') {
      this.over = false;
      this.score1 = this.score2 = 0;
      this.celebrating = false;
      this.newRally();
      this.banner();
    } else {
      this.round--;
      this.nextLevel();
    }
  }

  banner() {
    const title = this.mode === 'versus' ? 'Exhibition' : ROUND_NAMES[this.round - 1];
    let n2 = CHARS[this.p2Id].name;
    if (this.mode !== 'versus' && this.round === 5 && this.p1Id === this.p2Id) n2 = 'Evil Twin';
    this.fx.banner(title, CHARS[this.p1Id].name, n2);
  }

  newRally() {
    if (this.shuttle) {
      this.shuttle.remove();
      this.shuttle = null;
    }
    if (this.server === 1) this.p1.prepareServe();
    else this.p2.prepareServe();
    this.rallyLive = true;
  }

  spawnShuttle(x, y) {
    if (this.shuttle) this.shuttle.remove();
    this.shuttle = new Shuttle(this, x, y);
  }

  point(side) {
    if (!this.rallyLive) return;
    SFX.play('ding');
    this.rallyLive = false;
    if (side === 1) {
      this.score1++;
      this.server = 1;
    } else {
      this.score2++;
      this.server = 2;
      this.flawless = false;
    }
    const WIN = 7;
    if (this.mode === 'versus') {
      if (this.score1 >= WIN || this.score2 >= WIN) {
        this.over = true;
        this.celebrating = true;
        SFX.play('cheer');
        this.status = this.score1 > this.score2 ? 'P1 Wins' : 'P2 Wins';
        this.hooks.matchOver(this, 'versus');
      } else {
        G.setTimeout(() => this.newRally(), 1500);
      }
      return;
    }
    if (this.score1 >= WIN) {
      if (this.round === 5) G.setTimeout(() => { G.pauseAllowed = false; this.hooks.champion(this); }, 1500);
      else this.hooks.matchOver(this, 'won');
      this.over = true;
      this.status = 'You Win';
      this.celebrating = true;
      SFX.play('cheer');
    } else if (this.score2 >= WIN) {
      if (!this.over) G.setTimeout(() => { G.pauseAllowed = false; this.hooks.matchOver(this, 'lost'); }, 1000);
      this.over = true;
      this.status = 'Good Try';
      SFX.play('sigh');
    } else {
      G.setTimeout(() => this.newRally(), 1500);
    }
  }

  update(dt) {
    if (this.p1) this.p1.update(dt);
    if (this.p2) this.p2.update(dt);
    if (this.shuttle) this.shuttle.update(dt);
    if (!this.over) this.status = this.score1 + ' - ' + this.score2;
    if (this.celebrating && G.chance(70)) this.fx.confetti();
  }

  // mouse press during play (mouse flyers swing on click)
  mouseDown() {
    if (this.p1 && this.p1.kind === 'jet' && !this.over) this.p1.swing();
  }

  dispose() {
    if (this.p1) this.p1.dispose();
    if (this.p2) this.p2.dispose();
    this.net.dispose();
    G.updates.length = 0;
    G.clearTimers();
  }
}

/* ======================================================================== */
/*         Effects (they live in the shared update list like the original)  */
/* ======================================================================== */
class FX {
  constructor(match) {
    this.m = match;
    this.list = [];       // drawables
    this.trails = [];
  }
  add(o, update) {
    o._u = (dt) => {
      if (update(dt) === false) this.kill(o);
    };
    this.list.push(o);
    G.addUpdate(o._u);
    return o;
  }
  kill(o) {
    G.removeUpdate(o._u);
    const i = this.list.indexOf(o);
    if (i >= 0) this.list.splice(i, 1);
  }
  // racket contact flash: a 22-frame clip
  spark(x, y, dir, scale) {
    const o = { type: 'spark', x, y, dir, scale, clip: new G.Clip(25, {}) };
    o.clip.scripts[22] = () => { o.clip.stop(); this.kill(o); };
    o.clip.cur = 1;
    o.clip.t = 0;
    o.clip.play();
    o._u = o.clip._tick;
    this.list.push(o);
  }
  // falling celebration paper
  confetti() {
    const o = {
      type: 'confetti', x: G.rand(0, G.W), y: -10, dx: G.rand(1, 4), dy: G.rand(3, 6),
      hue: G.rand(0, 360, true), spin: G.rand(0, 6.28), h: 8,
    };
    this.add(o, (dt) => {
      o.y += o.dy * 30 * dt;
      o.x += o.dx * 30 * dt;
      o.spin += dt * 8;
      if (G.chance(1.6666)) {
        o.dx = G.rand(1, 4);
        if (G.chance(50)) o.dx *= -1;
      }
      if (o.y + o.h / 2 > G.H) return false;
    });
  }
  // exhaust / cloud puffs from floaters
  debris(x, y, look) {
    const o = { type: 'debris', look, x, y, dir: G.rand(145, 215), speed: G.rand(2, 4), spin: G.rand(20, 40), shrink: G.rand(0.85, 0.95), rot: G.rand(0, 360), scale: 1 };
    G.applyDir(o);
    this.add(o, (dt) => {
      o.x += o.dx * 30 * dt;
      o.y += o.dy * 30 * dt;
      o.rot += o.spin * 30 * dt;
      o.scale *= Math.pow(o.shrink, 30 * dt);
      if (o.scale <= 0.1) return false;
    });
  }
  // round intro card: visible 2 s, then fades
  banner(title, n1, n2) {
    const o = { type: 'banner', title, n1, n2, alpha: 1, fading: false };
    G.setTimeout(() => { o.fading = true; }, 2000);
    this.add(o, (dt) => {
      if (o.fading) o.alpha -= 3 * dt;
      if (o.alpha <= 0) return false;
    });
  }
  // shuttle trail: one emitter per serve that keeps ticking for the rest of the match
  trail(shuttle) {
    const t = { pts: [], rate: 0, attached: shuttle, alive: true, heat: 0, fire: [], lastX: null, lastY: null };
    t._emit = (dt) => {
      const s = t.attached;
      if (s) t.pts.push({ x: s.x + G.LAYER_DX, y: s.y, a: Math.min(1, t.rate), r: s.rotation, h: t.heat });
      for (const p of t.pts) p.a -= 0.06;
      while (t.pts.length && t.pts[0].a <= 0) t.pts.shift();
      this.burn(t, s, dt);
    };
    t._follow = () => {};
    t.detach = () => {
      t.attached = null;
      G.removeUpdate(t._follow);
    };
    G.addUpdate(t._emit);
    G.addUpdate(t._follow);
    this.trails.push(t);
    return t;
  }
  // Fire behind fast shots. Heat follows the shuttle's speed above FIRE_SPEED and cools off
  // over a moment. The particles live inside the trail emitter rather than in the shared
  // update list, so the effect cannot change the order the original engine updates things in.
  burn(t, s, dt) {
    if (s) {
      const k = Math.max(0, Math.min(1, (s.speed - FIRE_SPEED) / (FIRE_FULL - FIRE_SPEED)));
      const cold = t.heat < 0.05;
      t.heat = Math.max(t.heat - FIRE_COOL * dt, k);
      if (cold && t.heat > 0.3) SFX.play('ignite', t.heat);
      const x = s.x + G.LAYER_DX, y = s.y;
      if (t.heat > 0.02) {
        // spread new particles along the path flown this frame (fast shots cover ~30 px a frame)
        const px = t.lastX === null ? x : t.lastX, py = t.lastY === null ? y : t.lastY;
        const n = Math.floor(t.heat * 13 + Math.random());
        for (let i = 0; i < n; i++) {
          const u = Math.random();
          t.fire.push({
            x: px + (x - px) * u + (Math.random() - 0.5) * 4,
            y: py + (y - py) * u + (Math.random() - 0.5) * 4,
            vx: -s.dx * 0.06 + (Math.random() - 0.5) * 50,
            vy: -s.dy * 0.06 + (Math.random() - 0.5) * 50 - 30,
            age: 0,
            life: 0.18 + Math.random() * 0.26 * (0.6 + t.heat),
            size: 3.5 + Math.random() * 5 * (0.6 + t.heat),
            smoke: Math.random() < 0.18,
          });
        }
      }
      t.lastX = x;
      t.lastY = y;
    } else {
      t.heat = Math.max(0, t.heat - FIRE_COOL * dt);
    }
    if (!t.fire.length) return;
    const drag = Math.pow(0.15, dt);
    for (const p of t.fire) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy = p.vy * drag - 90 * dt; // hot air rises
      if (p.y > G.GROUND - 1) p.y = G.GROUND - 1;
    }
    if (t.fire.some((p) => p.age >= p.life)) t.fire = t.fire.filter((p) => p.age < p.life);
  }
}

// Shuttle fire: starts above FIRE_SPEED px/s, full blaze at FIRE_FULL. Normal full-power hits
// (~1550) and serves stay clean; late-contact smashes (up to ~2100) catch fire.
const FIRE_SPEED = 1620;
const FIRE_FULL = 2000;
const FIRE_COOL = 1.4; // heat lost per second once the shot slows down

window.Shuttle = Shuttle;
window.Player = Player;
window.Match = Match;
window.FX = FX;
