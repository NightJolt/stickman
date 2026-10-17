'use strict';
/* Screens, buttons, overlays and flow between them. */
const UI = (() => {
  const { rr, text } = R;
  const SAVE_KEY = 'shuttlesticks.unlock';
  let screen = null;
  let fade = { a: 0, dir: 0, then: null };
  let time = 0;
  let match = null;
  let focus = 0;

  /* ---------------- save ---------------- */
  function unlockLevel() {
    try { return Number(localStorage.getItem(SAVE_KEY)) || 0; } catch (e) { return 0; }
  }
  function setUnlockLevel(v) {
    try { localStorage.setItem(SAVE_KEY, String(v)); } catch (e) { /* storage blocked */ }
  }
  if (/[?&]unlockall\b/.test(location.search) && unlockLevel() < 3) setUnlockLevel(3);
  function unlockedSlots() {
    const lv = unlockLevel();
    const out = [];
    UNLOCK_TIERS.forEach((tier, i) => { if (i <= lv) out.push(...tier); });
    return out;
  }

  /* ---------------- buttons ---------------- */
  function btn(label, x, y, w, h, onClick, opts = {}) {
    return { label, x, y, w, h, onClick, ...opts };
  }
  function hit(b, x, y) {
    return !b.hidden && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }
  function drawButtons(ctx, list) {
    list.forEach((b, i) => {
      if (b.hidden) return;
      const hover = hit(b, G.mouse.x, G.mouse.y) || (focusable(list) && i === focus);
      ctx.save();
      ctx.fillStyle = b.primary ? (hover ? '#ffd166' : '#f6b93b') : hover ? '#3d5a8c' : '#2a3f66';
      rr(ctx, b.x, b.y, b.w, b.h, 10);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = b.primary ? '#7a4f00' : 'rgba(255,255,255,0.25)';
      ctx.stroke();
      text(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, b.size || 17, b.primary ? '#2b1d00' : '#ffffff');
      ctx.restore();
    });
  }
  function focusable(list) { return list.some((b) => b.kbd); }

  /* ---------------- transitions ---------------- */
  function go(next) {
    if (fade.dir) return;
    fade = { a: 0, dir: 1, then: next };
  }
  function show(next) {
    screen = next;
    focus = 0;
    if (screen.enter) screen.enter();
  }

  /* ======================================================== TITLE */
  function titleScreen() {
    const s = {
      enter() {
        disposeMatch();
        SFX.music('title');
        G.pauseAllowed = false;
        s.buttons = [
          btn('Tournament', 230, 236, 180, 44, () => go(select1P()), { primary: true, kbd: true }),
          btn('2 Players', 230, 290, 180, 40, () => go(select2P()), { kbd: true }),
          btn('How to Play', 230, 340, 180, 40, () => go(howTo()), { kbd: true }),
          btn(SFX.muted ? 'Sound: off' : 'Sound: on', 540, 386, 86, 28, () => { SFX.toggleMute(); s.buttons[3].label = SFX.muted ? 'Sound: off' : 'Sound: on'; }, { size: 12 }),
        ];
      },
      draw(ctx, scale) {
        R.background(ctx, scale);
        ctx.fillStyle = 'rgba(8,12,26,0.45)';
        ctx.fillRect(0, 0, G.W, G.H);
        // rally between two figures
        const ph = (time % 2.4) / 2.4;
        const fwd = Math.floor(time / 2.4) % 2 === 0;
        const u = fwd ? ph : 1 - ph;
        const sx = 120 + u * 400, sy = 300 - Math.sin(u * Math.PI) * 190;
        R.figure(ctx, 'stan', 110, 400, 1.6, { t: time, frame: 1 + Math.floor(((fwd ? ph : 1 - ph) < 0.12 ? (fwd ? ph : 1 - ph) * 8 : 0) * 26) });
        R.figure(ctx, 'zara', 530, 400, 1.6, { t: time, flip: true, frame: 1 + Math.floor((u > 0.88 ? (u - 0.88) * 8 : 0) * 26) });
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate((fwd ? 1 : -1) * (Math.PI / 2) + (fwd ? 1 : -1) * (u - 0.5) * 2.2);
        ctx.scale(1.4, 1.4);
        R.drawShuttleShape(ctx);
        ctx.restore();
        // logo
        ctx.save();
        ctx.translate(320, 110);
        ctx.rotate(-0.04);
        text(ctx, 'SHUTTLE', 0, -26, 58, '#ffd166', 'center', '900', '#1b1b24', 10);
        text(ctx, 'STICKS', 0, 32, 58, '#ffffff', 'center', '900', '#1b1b24', 10);
        ctx.restore();
        text(ctx, 'a stick figure badminton showdown', 320, 192, 14, '#c9d6ee', 'center', 'bold');
        drawButtons(ctx, s.buttons);
        text(ctx, 'Arrow keys + Enter or mouse', 14, 404, 11, 'rgba(255,255,255,0.5)', 'left', 'normal');
      },
    };
    return s;
  }

  /* ======================================================== HOW TO */
  function howTo() {
    const s = {
      enter() {
        s.buttons = [btn('Back', 250, 372, 140, 38, () => go(titleScreen()), { primary: true, kbd: true })];
      },
      draw(ctx, scale) {
        R.background(ctx, scale);
        ctx.fillStyle = 'rgba(8,12,26,0.78)';
        rr(ctx, 30, 20, 580, 340, 16);
        ctx.fill();
        text(ctx, 'How to Play', 320, 52, 28, '#ffd166');
        const L = [
          ['Move', '← →  or  A D'],
          ['Jump', '↑  or  W'],
          ['Swing', '↓, S or Space  (hold for full power)'],
          ['Power swings', 'J strong   ·   K medium   ·   L soft'],
          ['Pause / Menu', 'P   ·   Esc          Sound: M'],
        ];
        L.forEach(([a, b], i) => {
          text(ctx, a, 200, 98 + i * 30, 15, '#9fb3d1', 'right');
          text(ctx, b, 216, 98 + i * 30, 15, '#ffffff', 'left', 'normal');
        });
        const tips = 'First to 7 points wins. Land the shuttle on the far side of the net to score;\n' +
          'it bounces off the side walls, so nothing is ever out. The point winner serves.\n' +
          'Timing sets the shot: swing early for a high lob, late for a steep smash.\n' +
          'Shuttles dropping low in front of you get a rising underhand lift.\n' +
          'Win the 5-round tournament to unlock new players.';
        text(ctx, tips, 320, 296, 13, '#dfe7f5', 'center', 'normal');
        drawButtons(ctx, s.buttons);
      },
    };
    return s;
  }

  /* ======================================================== SELECT (tournament) */
  function select1P() {
    let sel = 0;
    const unlocked = unlockedSlots();
    const tiles = SELECT_1P.map((id, i) => ({ id, i, x: 18 + (i % 6) * 70, y: 54 + Math.floor(i / 6) * 84, w: 64, h: 78, locked: !unlocked.includes(i) }));
    const choose = (i) => { if (!tiles[i].locked) { sel = i; SFX.play('click'); } };
    const start = () => go(briefing(SELECT_1P[sel], null));
    const s = {
      enter() {
        s.buttons = [
          btn('Back', 440, 372, 80, 38, () => go(titleScreen())),
          btn('Play!', 530, 372, 92, 38, start, { primary: true }),
        ];
      },
      click(x, y) {
        for (const t of tiles) if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) choose(t.i);
      },
      key(code) {
        const K = G.KEY;
        const step = (d) => {
          let i = sel;
          for (let n = 0; n < 12; n++) {
            i = (i + d + 12) % 12;
            if (!tiles[i].locked) { sel = i; SFX.play('click'); return; }
          }
        };
        if (code === K.RIGHT || code === K.D) step(1);
        else if (code === K.LEFT || code === K.A) step(-1);
        else if (code === K.DOWN || code === K.UP || code === K.S || code === K.W) step(6);
        else if (code === K.ENTER || code === K.SPACE) start();
        else if (code === K.ESC) go(titleScreen());
      },
      draw(ctx, scale) {
        R.background(ctx, scale);
        ctx.fillStyle = 'rgba(8,12,26,0.72)';
        ctx.fillRect(0, 0, G.W, G.H);
        text(ctx, 'Choose your player', 222, 30, 22, '#ffd166');
        for (const t of tiles) {
          const on = t.i === sel;
          ctx.save();
          ctx.fillStyle = t.locked ? '#1a2238' : on ? '#3d5a8c' : '#25355a';
          rr(ctx, t.x, t.y, t.w, t.h, 8);
          ctx.fill();
          ctx.lineWidth = on ? 3 : 1.5;
          ctx.strokeStyle = on ? '#ffd166' : 'rgba(255,255,255,0.18)';
          ctx.stroke();
          ctx.beginPath();
          rr(ctx, t.x + 2, t.y + 2, t.w - 4, t.h - 4, 7);
          ctx.clip();
          if (t.locked) {
            ctx.globalAlpha = 0.25;
            R.figure(ctx, t.id, t.x + t.w / 2, t.y + t.h + 2, 0.95, { t: 0 });
            ctx.globalAlpha = 1;
            lock(ctx, t.x + t.w / 2, t.y + 34);
          } else {
            R.figure(ctx, t.id, t.x + t.w / 2 - 4, t.y + t.h + 2, 0.95, { t: on ? time : 0 });
          }
          ctx.restore();
        }
        // info
        const id = SELECT_1P[sel], d = CHARS[id];
        ctx.fillStyle = 'rgba(20,30,52,0.9)';
        rr(ctx, 18, 230, 410, 180, 12);
        ctx.fill();
        text(ctx, d.name, 34, 254, 22, '#ffffff', 'left');
        text(ctx, d.bio, 34, 292, 13, '#c9d6ee', 'left', 'normal');
        text(ctx, d.pros, 34, 326, 13, '#ffd166', 'left', 'bold');
        const stats = d.kind === 'jet' ? [['Control', 'Mouse'], ['Flight', d.follow === 1.4 ? 'Agile' : 'Swift'], ['Power', d.power]] : [['Speed', d.speed], ['Jump', d.jump], ['Power', d.power]];
        stats.forEach(([n, v], i) => {
          const y = 352 + i * 18;
          text(ctx, n, 34, y, 12, '#9fb3d1', 'left');
          if (typeof v === 'string') { text(ctx, v, 96, y, 12, '#ffffff', 'left'); return; }
          ctx.fillStyle = '#0f1a30';
          rr(ctx, 96, y - 5, 200, 10, 5);
          ctx.fill();
          ctx.fillStyle = v > 1.001 ? '#4cd137' : v < 0.999 ? '#e1b12c' : '#74b9ff';
          rr(ctx, 96, y - 5, 200 * Math.min(1, (v - 0.7) / 0.6), 10, 5);
          ctx.fill();
        });
        if (unlockLevel() < UNLOCK_TIERS.length - 1) text(ctx, 'Win the tournament to unlock more players', 222, 220, 11, 'rgba(255,255,255,0.55)', 'center', 'normal');
        // big preview
        ctx.fillStyle = 'rgba(20,30,52,0.9)';
        rr(ctx, 440, 54, 182, 308, 12);
        ctx.fill();
        const swingT = time % 1.6;
        const fr = swingT < 0.45 ? 1 + Math.floor(swingT * 60) : 1;
        R.figure(ctx, id, 520, 330, 2.1, { t: time, frame: Math.min(fr, RIGS[d.rig].over.n) });
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        R.line(ctx, 452, 331, 610, 331);
        drawButtons(ctx, s.buttons);
      },
    };
    return s;
  }

  function lock(ctx, x, y) {
    ctx.save();
    ctx.strokeStyle = '#9fb3d1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y - 6, 7, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#9fb3d1';
    rr(ctx, x - 11, y - 6, 22, 17, 3);
    ctx.fill();
    ctx.fillStyle = '#1a2238';
    ctx.fillRect(x - 1.5, y, 3, 6);
    ctx.restore();
  }

  /* ======================================================== SELECT (two players) */
  function select2P() {
    const picks = [];
    let cursor = 0;
    const tiles = SELECT_2P.map((id, i) => ({ id, i, x: 40 + (i % 5) * 76, y: 64 + Math.floor(i / 5) * 88, w: 70, h: 82 }));
    const choose = (i) => { if (picks.length < 2) { picks.push(SELECT_2P[i]); SFX.play('click'); } };
    const startable = () => picks.length === 2;
    const s = {
      enter() {
        s.buttons = [
          btn('Back', 40, 372, 90, 38, () => go(titleScreen())),
          btn('Undo', 140, 372, 90, 38, () => { picks.pop(); }),
          btn('Play!', 500, 372, 110, 38, () => { if (startable()) go(briefing(picks[0], picks[1])); }, { primary: true }),
        ];
      },
      click(x, y) {
        for (const t of tiles) if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) choose(t.i);
      },
      key(code) {
        const K = G.KEY;
        if (code === K.RIGHT || code === K.D) cursor = (cursor + 1) % 10;
        else if (code === K.LEFT || code === K.A) cursor = (cursor + 9) % 10;
        else if (code === K.DOWN || code === K.UP || code === K.S || code === K.W) cursor = (cursor + 5) % 10;
        else if (code === K.ENTER || code === K.SPACE) { if (startable()) go(briefing(picks[0], picks[1])); else choose(cursor); }
        else if (code === 8) picks.pop();
        else if (code === K.ESC) go(titleScreen());
      },
      draw(ctx, scale) {
        R.background(ctx, scale);
        ctx.fillStyle = 'rgba(8,12,26,0.72)';
        ctx.fillRect(0, 0, G.W, G.H);
        const head = picks.length === 0 ? '- Selecting Player 1 -' : picks.length === 1 ? '- Selecting Player 2 -' : 'Ready to play!';
        text(ctx, head, 230, 34, 22, '#ffd166');
        tiles.forEach((t) => {
          const on = t.i === cursor;
          ctx.save();
          ctx.fillStyle = on ? '#3d5a8c' : '#25355a';
          rr(ctx, t.x, t.y, t.w, t.h, 8);
          ctx.fill();
          ctx.lineWidth = on ? 3 : 1.5;
          ctx.strokeStyle = on ? '#ffd166' : 'rgba(255,255,255,0.18)';
          ctx.stroke();
          ctx.beginPath();
          rr(ctx, t.x + 2, t.y + 2, t.w - 4, t.h - 4, 7);
          ctx.clip();
          R.figure(ctx, t.id, t.x + t.w / 2 - 2, t.y + t.h - 14, 0.72, { t: on ? time : 0 });
          ctx.fillStyle = 'rgba(8,12,26,0.75)';
          ctx.fillRect(t.x, t.y + t.h - 16, t.w, 16);
          ctx.restore();
          text(ctx, CHARS[t.id].name, t.x + t.w / 2, t.y + t.h - 8, 10, '#ffffff', 'center', 'bold');
        });
        // slots
        [0, 1].forEach((k) => {
          const x = 440, y = 64 + k * 150;
          ctx.fillStyle = 'rgba(20,30,52,0.9)';
          rr(ctx, x, y, 180, 140, 12);
          ctx.fill();
          text(ctx, k === 0 ? 'Player 1  (A D · W · S)' : 'Player 2  (← → · ↑ · ↓)', x + 90, y + 16, 11, '#9fb3d1');
          if (picks[k]) {
            R.figure(ctx, picks[k], x + 100, y + 134, 0.9, { t: time, flip: k === 1 });
            text(ctx, CHARS[picks[k]].name, x + 90, y + 36, 15, '#ffffff');
          }
        });
        drawButtons(ctx, s.buttons);
      },
    };
    return s;
  }

  /* ======================================================== BRIEFING */
  function briefing(p1, p2) {
    const versus = !!p2;
    const kind = CHARS[p1].kind;
    const start = () => go(playScreen(versus ? 'versus' : 'solo', p1, p2));
    const s = {
      enter() {
        SFX.music('game');
        s.buttons = [btn('Start', 250, 360, 140, 44, start, { primary: true, kbd: true })];
      },
      key(code) {
        if (code === G.KEY.ENTER || code === G.KEY.SPACE) start();
        else if (code === G.KEY.ESC) go(titleScreen());
      },
      draw(ctx, scale) {
        R.background(ctx, scale);
        ctx.fillStyle = 'rgba(8,12,26,0.8)';
        rr(ctx, 40, 30, 560, 316, 16);
        ctx.fill();
        let title, rows, note;
        if (versus) {
          title = 'Exhibition Match';
          rows = [['Player 1 (left)', 'A D move  ·  W jump  ·  S or Space swing'], ['Player 2 (right)', '← → move  ·  ↑ jump  ·  ↓ swing']];
          note = 'First to 7 points wins.';
        } else if (kind === 'jet') {
          title = CHARS[p1].name;
          rows = [['Fly', 'Move the mouse'], ['Swing', 'Click (always full power)'], ['Pause / Menu', 'P  ·  Esc']];
          note = 'You go wherever the cursor goes, as long as you stay on your side.\nSwing as the shuttle reaches you. Early = lob, late = smash.';
        } else {
          title = CHARS[p1].name;
          rows = [['Move', '← →  or  A D'], ['Jump', '↑  or  W'], ['Swing', '↓, S or Space  (hold = full power)'], ['Power swings', 'J strong  ·  K medium  ·  L soft']];
          note = kind === 'hover'
            ? 'Your cloud keeps you floating just above the floor,\nand your serve pops straight up out of it.'
            : 'Swing early for a high lob, late for a steep smash.\nTap for a soft touch, hold for full power.';
        }
        text(ctx, title, 320, 64, 28, '#ffd166');
        rows.forEach(([a, b], i) => {
          text(ctx, a, 230, 118 + i * 32, 15, '#9fb3d1', 'right');
          text(ctx, b, 246, 118 + i * 32, 15, '#ffffff', 'left', 'normal');
        });
        text(ctx, note, 320, 290, 13, '#dfe7f5', 'center', 'normal');
        R.figure(ctx, p1, 100, 336, 1.1, { t: time });
        if (p2) R.figure(ctx, p2, 540, 336, 1.1, { t: time, flip: true });
        drawButtons(ctx, s.buttons);
      },
    };
    return s;
  }

  /* ======================================================== PLAY */
  function disposeMatch() {
    if (match) match.dispose();
    match = null;
    G.paused = false;
    G.pauseAllowed = false;
  }

  function playScreen(mode, p1, p2) {
    let overlay = null; // {kind, alpha, fading, buttons}
    const s = {
      isPlay: true,
      enter() {
        disposeMatch();
        SFX.music('game');
        match = new Match(mode, p1, p2, {
          matchOver(m, kind) { openOverlay(kind); },
          champion() { openOverlay('champion'); },
        });
        match.start();
      },
      key(code) {
        const K = G.KEY;
        if (code === K.ESC) { SFX.play('thud'); go(titleScreen()); return; }
        if (code === K.P) { G.togglePause(); return; }
        if (overlay && !overlay.fading && code === K.ENTER) overlay.buttons[0].onClick();
      },
      mouseDown() { if (match && !overlay) match.mouseDown(); },
      tick(dt) {
        if (!overlay) return;
        if (overlay.fading) {
          overlay.alpha -= 4.5 * dt;
          if (overlay.alpha <= 0) { overlay = null; }
        } else if (overlay.alpha < 1) overlay.alpha = Math.min(1, overlay.alpha + 4.5 * dt);
      },
      get buttons() { return overlay && !overlay.fading ? overlay.buttons : []; },
      cursorHidden() { return match && match.p1 && match.p1.kind === 'jet' && !match.over && !G.paused && !overlay; },
      draw(ctx, scale) {
        if (!match) return;
        R.scene(ctx, match, scale);
        if (G.paused) {
          ctx.fillStyle = 'rgba(8,12,26,0.6)';
          ctx.fillRect(0, 0, G.W, G.H);
          text(ctx, 'PAUSED', 320, 190, 40, '#ffffff', 'center', '900', '#1b1b24', 8);
          text(ctx, 'P to resume  ·  Esc for menu  ·  M sound', 320, 232, 14, '#c9d6ee', 'center', 'normal');
        }
        if (overlay) drawOverlay(ctx);
      },
    };

    function openOverlay(kind) {
      const menu = () => go(titleScreen());
      const close = (fn) => () => { overlay.fading = true; fn(); };
      let buttons;
      if (kind === 'won') buttons = [btn('Next Round', 236, 236, 168, 42, close(() => match.nextLevel()), { primary: true }), btn('Menu', 270, 288, 100, 34, menu)];
      else if (kind === 'versus') buttons = [btn('Rematch', 236, 236, 168, 42, close(() => match.resetLevel()), { primary: true }), btn('Menu', 270, 288, 100, 34, menu)];
      else if (kind === 'lost') buttons = [btn('Try Again', 236, 250, 168, 42, close(() => match.resetLevel()), { primary: true }), btn('Menu', 270, 302, 100, 34, menu)];
      else {
        const lv = unlockLevel() + 1;
        setUnlockLevel(lv);
        kind = 'champion';
        buttons = [btn('Menu', 250, 364, 140, 40, menu, { primary: true })];
        buttons.unlockText = lv <= UNLOCK_TIERS.length - 1 ? 'New players unlocked!' : 'You ruled the league. Again.';
      }
      overlay = { kind, alpha: 0, fading: false, buttons };
    }

    function drawOverlay(ctx) {
      const o = overlay;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha));
      if (o.kind === 'won' || o.kind === 'versus') {
        ctx.fillStyle = 'rgba(8,12,26,0.82)';
        rr(ctx, 180, 120, 280, 216, 16);
        ctx.fill();
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.stroke();
        const head = o.kind === 'won' ? 'You Win!' : match.status + '!';
        text(ctx, head, 320, 160, 32, '#ffd166', 'center', '900');
        const sub = o.kind === 'won'
          ? (match.flawless ? 'Flawless! ' : '') + 'Next up: ' + ROUND_NAMES[match.round]
          : 'Final score ' + match.score1 + ' - ' + match.score2;
        text(ctx, sub, 320, 200, 14, '#dfe7f5', 'center', 'normal');
      } else if (o.kind === 'lost') {
        ctx.fillStyle = 'rgba(8,12,26,0.88)';
        ctx.fillRect(0, 0, G.W, G.H);
        text(ctx, 'Good Try', 320, 96, 44, '#ffffff', 'center', '900', '#1b1b24', 8);
        text(ctx, (ROUND_NAMES[match.round - 1] || 'Match') + ':  ' + CHARS[match.p2Id].name + ' wins ' + match.score2 + ' - ' + match.score1, 320, 146, 15, '#c9d6ee', 'center', 'normal');
        text(ctx, 'Shake it off and run it back.', 320, 172, 13, '#9fb3d1', 'center', 'normal');
        R.figure(ctx, match.p1Id, 130, 360, 1.3, { t: time });
        R.figure(ctx, match.p2Id, 510, 360, 1.3, { t: time, flip: true });
      } else {
        ctx.fillStyle = 'rgba(8,12,26,0.9)';
        ctx.fillRect(0, 0, G.W, G.H);
        text(ctx, 'CHAMPION!', 320, 58, 50, '#ffd166', 'center', '900', '#1b1b24', 10);
        text(ctx, CHARS[match.p1Id].name + ' wins the Feather Cup.', 320, 102, 16, '#ffffff', 'center', 'bold');
        R.figure(ctx, match.p1Id, 290, 312, 1.45, { t: time, frame: 1 + (Math.floor(time * 30) % RIGS[CHARS[match.p1Id].rig].over.n) });
        trophy(ctx, 392, 300);
        text(ctx, o.buttons.unlockText, 320, 344, 16, '#4cd137', 'center', 'bold');
      }
      drawButtons(ctx, o.buttons);
      ctx.restore();
    }
    return s;
  }

  function trophy(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = '#f6b93b';
    ctx.strokeStyle = '#7a4f00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 18, y - 40);
    ctx.lineTo(x + 18, y - 40);
    ctx.quadraticCurveTo(x + 16, y - 8, x, y - 4);
    ctx.quadraticCurveTo(x - 16, y - 8, x - 18, y - 40);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(x - 3, y - 4, 6, 12);
    rr(ctx, x - 12, y + 8, 24, 7, 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /* ======================================================== public */
  return {
    start() { show(titleScreen()); },
    tick(dt) {
      time += dt;
      if (fade.dir === 1) {
        fade.a += dt / 0.17;
        if (fade.a >= 1) {
          fade.a = 1;
          show(fade.then);
          fade.dir = -1;
        }
      } else if (fade.dir === -1) {
        fade.a -= dt / 0.33;
        if (fade.a <= 0) { fade.a = 0; fade.dir = 0; }
      }
      if (screen && screen.tick) screen.tick(dt);
    },
    draw(ctx, scale) {
      if (screen) screen.draw(ctx, scale);
      if (G.debug && !(screen && screen.isPlay)) {
        // hitboxes only exist during a match; just show that the overlay is armed
        ctx.save();
        ctx.font = '6px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(57,255,106,0.85)';
        ctx.fillText('DEBUG on  ·  ` to hide', G.W - 4, 3);
        ctx.restore();
      }
      if (fade.a > 0) {
        ctx.fillStyle = `rgba(6,8,18,${fade.a})`;
        ctx.fillRect(0, 0, G.W, G.H);
      }
    },
    key(code) {
      if (code === G.KEY.BACKQUOTE) { G.toggleDebug(); return; }
      if (fade.dir) return;
      if (code === G.KEY.M) { SFX.toggleMute(); return; }
      if (screen.key) { screen.key(code); return; }
      const list = screen.buttons || [];
      if (!focusable(list)) return;
      const kb = list.filter((b) => b.kbd);
      if (code === G.KEY.DOWN || code === G.KEY.S) focus = (focus + 1) % kb.length;
      else if (code === G.KEY.UP || code === G.KEY.W) focus = (focus + kb.length - 1) % kb.length;
      else if (code === G.KEY.ENTER || code === G.KEY.SPACE) kb[focus].onClick();
    },
    mouseDown(x, y) {
      if (screen && screen.mouseDown) screen.mouseDown(x, y);
    },
    click(x, y) {
      if (fade.dir || !screen) return;
      for (const b of screen.buttons || []) {
        if (hit(b, x, y)) { SFX.play('click'); b.onClick(); return; }
      }
      if (screen.click) screen.click(x, y);
    },
    cursor(x, y) {
      if (screen && screen.cursorHidden && screen.cursorHidden()) return 'none';
      for (const b of (screen && screen.buttons) || []) if (hit(b, x, y)) return 'pointer';
      return 'default';
    },
    get match() { return match; },
  };
})();
window.UI = UI;
