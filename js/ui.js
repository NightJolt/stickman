'use strict';
/* Screens, buttons, overlays and flow between them. */
const UI = (() => {
  const { rr, text } = R;
  const SAVE_KEY = 'shuttlesticks.unlock';
  const CUP = 'Feather Cup';
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
      text(ctx, typeof b.label === 'function' ? b.label() : b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, b.size || 17, b.primary ? '#2b1d00' : '#ffffff');
      ctx.restore();
    });
  }
  function focusable(list) { return list.some((b) => b.kbd); }
  // Up/Down move the focus through the screen's keyboard buttons, Enter/Space presses it
  function navigate(code) {
    const kb = (screen.buttons || []).filter((b) => b.kbd);
    if (!kb.length) return;
    if (code === G.KEY.DOWN || code === G.KEY.S) focus = (focus + 1) % kb.length;
    else if (code === G.KEY.UP || code === G.KEY.W) focus = (focus + kb.length - 1) % kb.length;
    else if (code === G.KEY.ENTER || code === G.KEY.SPACE) kb[focus].onClick();
  }

  /* ---------------- transitions ---------------- */
  function go(next) {
    if (fade.dir) return;
    fade = { a: 0, dir: 1, then: next };
  }
  function show(next) {
    if (screen && screen.leave) screen.leave();
    screen = next;
    focus = 0;
    if (screen.enter) screen.enter();
  }

  // which build this is (js/version.js, stamped by ops/deploy.sh)
  const BUILD = window.VERSION || { build: 'dev', sha: '' };
  function buildText() {
    return BUILD.build === 'dev' ? 'dev build' : 'build ' + BUILD.build + '  ·  ' + BUILD.sha;
  }

  /* ======================================================== TITLE */
  // menu: 'main', 'single' or 'multi'; `at` is the button to focus. Behind the menu two computer
  // players with random characters rally silently for as long as the title is up.
  // An item opens a screen or returns [menu, focus]; `last` always sits in the bottom slot.
  const MENUS = {
    main: { caption: 'a stick figure badminton showdown', items: [
      ['Single Player', () => ['single']],
      ['Multiplayer', () => ['multi']],
    ], last: ['How to Play', () => howTo()] },
    single: { caption: 'Single Player', items: [
      ['Tournament', () => select1P()],
      ['1v1', () => select1P(null, 'cpu')],
      ['Training', () => select1P(null, 'training')],
    ], last: ['Back', () => ['main', 0]] },
    multi: { caption: 'Multiplayer', items: [
      ['Local 1v1', () => select2P()],
      ['Online 1v1', () => ['online']],
    ], last: ['Back', () => ['main', 1]] },
    online: { caption: 'Online 1v1', items: [
      ['Create Room', () => roomScreen('create')],
      ['Join Room', () => roomScreen('join')],
    ], last: ['Back', () => ['multi', 1]] },
  };
  function titleScreen(menu = 'main', at = 0) {
    let demo = null;
    function setMenu(name, focusAt = 0) {
      const M = MENUS[name];
      menu = name;
      focus = focusAt;
      const ys = [212, 262, 306];
      const press = (open) => () => {
        const next = open();
        if (Array.isArray(next)) setMenu(...next);
        else go(next);
      };
      s.buttons = M.items.map(([label, open], i) => btn(label, 230, ys[i], 180, i ? 38 : 42, press(open), { primary: i === 0, kbd: true }));
      s.buttons.push(btn(M.last[0], 230, 350, 180, 38, press(M.last[1]), { kbd: true }));
      s.buttons.push(btn(() => (SFX.muted ? 'Sound: off' : 'Sound: on'), 540, 386, 86, 28, () => SFX.toggleMute(), { size: 12 }));
    }
    const s = {
      enter() {
        disposeMatch();
        SFX.music('title');
        const a = G.pick(SELECT_2P);
        demo = new Match('demo', a, G.pick(SELECT_2P.filter((id) => id !== a)), {});
        demo.start();
        setMenu(menu, at);
      },
      leave() {
        if (demo) demo.dispose();
        demo = null;
      },
      key(code) {
        if (code === G.KEY.ESC && menu !== 'main') setMenu(...MENUS[menu].last[1]());
        else navigate(code);
      },
      draw(ctx, scale) {
        if (demo) R.scene(ctx, demo, scale);
        else R.background(ctx, scale);
        ctx.fillStyle = 'rgba(8,12,26,0.45)';
        R.cover(ctx);
        // logo
        ctx.save();
        ctx.translate(320, 110);
        ctx.rotate(-0.04);
        text(ctx, 'SHUTTLE', 0, -26, 58, '#ffd166', 'center', '900', '#1b1b24', 10);
        text(ctx, 'STICKS', 0, 32, 58, '#ffffff', 'center', '900', '#1b1b24', 10);
        ctx.restore();
        text(ctx, MENUS[menu].caption, 320, 192, 14, '#c9d6ee', 'center', 'bold');
        text(ctx, buildText(), G.view.x0 + 12, G.view.y1 - 14, 10, 'rgba(255,255,255,0.45)', 'left', 'bold');
        drawButtons(ctx, s.buttons);
      },
    };
    return s;
  }

  /* ======================================================== HOW TO */
  function howTo() {
    const s = {
      enter() {
        s.buttons = [btn('Back', 250, 372, 140, 38, () => go(titleScreen('main', 2)), { primary: true, kbd: true })];
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
          ['Swing', '↓, S or Space'],
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

  /* ======================================================== SELECT (single player) */
  // mode: 'solo' (tournament), 'cpu' (1v1, the opponent is picked next) or 'training'
  const MODE_ITEM = { solo: 0, cpu: 1, training: 2 }; // its button in the Single Player menu
  function select1P(pick, mode = 'solo') {
    const unlocked = unlockedSlots();
    let sel = Math.max(0, SELECT_1P.indexOf(pick));
    const tiles = SELECT_1P.map((id, i) => ({ id, i, x: 18 + (i % 6) * 70, y: 54 + Math.floor(i / 6) * 84, w: 64, h: 78, locked: !unlocked.includes(i) }));
    const choose = (i) => { if (!tiles[i].locked) { sel = i; SFX.play('click'); } };
    const id0 = () => SELECT_1P[sel];
    const start = () => go(mode === 'training' ? briefing(id0(), null, 'training') : mode === 'cpu' ? selectOpponent(id0()) : bracketScreen(id0()));
    const back = () => go(titleScreen('single', MODE_ITEM[mode]));
    const s = {
      enter() {
        s.buttons = [
          btn('Back', 440, 372, 80, 38, back),
          btn(mode === 'cpu' ? 'Next' : 'Play!', 530, 372, 92, 38, start, { primary: true }),
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
        else if (code === K.ESC) back();
      },
      draw(ctx, scale) {
        R.background(ctx, scale);
        ctx.fillStyle = 'rgba(8,12,26,0.72)';
        R.cover(ctx);
        text(ctx, mode === 'training' ? 'Training: pick a player' : mode === 'cpu' ? '1v1: pick your player' : 'Choose your player', 222, 30, 22, '#ffd166');
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

  /* ======================================================== BRACKET */
  // Stepladder bracket climbing to the cup: the player enters bottom-left, each round's
  // opponent drops in from above, and every win moves the player one column up and right.
  const BK = { x0: 12, colW: 114, w: 100, h: 38, base: 296, gap: 56 };
  const bkX = (k) => BK.x0 + k * BK.colW;
  const slotY = (k) => BK.base - (k * BK.gap) / 2; // the player's slot in column k
  const oppY = (k) => slotY(k) - BK.gap;          // round k+1's opponent
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ADV = { strike: 0.35, path: 0.6, pathLen: 0.55, pop: 1.15 }; // win animation timing (s)

  // stroke the first fraction f of a polyline
  function polyPart(ctx, pts, f) {
    let left = 0;
    for (let i = 1; i < pts.length; i++) left += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    left *= f;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length && left > 0; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const d = Math.hypot(bx - ax, by - ay);
      const u = Math.min(1, left / d);
      ctx.lineTo(ax + (bx - ax) * u, ay + (by - ay) * u);
      left -= d;
    }
    ctx.stroke();
  }

  function fitText(ctx, str, x, y, size, color, maxW, align = 'left') {
    ctx.font = `bold ${size}px ${R.FONT}`;
    while (size > 8 && ctx.measureText(str).width > maxW) ctx.font = `bold ${(size -= 0.5)}px ${R.FONT}`;
    text(ctx, str, x, y, size, color, align);
    return ctx.measureText(str).width;
  }

  // o: { kind: 'player' | 'opp' | 'beaten' | 'tbd', sub, hot, strike (0-1), pop (0-1) }
  function bkCard(ctx, id, x, y, o) {
    const { w, h } = BK;
    ctx.save();
    if (o.pop !== undefined) {
      if (o.pop <= 0) { ctx.restore(); return; }
      const u = clamp01(o.pop);
      const sc = u < 1 ? 0.6 + 0.4 * u + Math.sin(u * Math.PI) * 0.18 : 1;
      ctx.translate(x + w / 2, y + h / 2);
      ctx.scale(sc, sc);
      ctx.translate(-x - w / 2, -y - h / 2);
      ctx.globalAlpha *= clamp01(u * 3);
    }
    if (o.kind === 'tbd') {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 7);
      ctx.stroke();
      text(ctx, '?', x + w / 2, y + h / 2 + 1, 16, 'rgba(255,255,255,0.3)');
      ctx.restore();
      return;
    }
    const d = CHARS[id];
    const beaten = o.kind === 'beaten';
    if (o.kind === 'opp' && !o.hot) ctx.globalAlpha *= 0.62;
    ctx.fillStyle = o.kind === 'player' ? '#2c4675' : beaten ? '#171e32' : '#22314f';
    rr(ctx, x, y, w, h, 7);
    ctx.fill();
    if (o.hot) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(255,209,102,${0.55 + 0.45 * Math.sin(time * 5)})`;
    } else {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = o.kind === 'player' ? 'rgba(255,209,102,0.7)' : 'rgba(255,255,255,0.16)';
    }
    ctx.stroke();
    // portrait: head and shoulders over the character's colour
    ctx.save();
    if (beaten) ctx.globalAlpha *= 0.45;
    rr(ctx, x + 4, y + 4, 26, h - 8, 5);
    ctx.fillStyle = d.color + '55';
    ctx.fill();
    ctx.clip();
    R.figure(ctx, id, x + 17, y + 15 + R.headHeight(id) * 0.66, 0.66, { t: o.hot || o.kind === 'player' ? time : 0 });
    ctx.restore();
    const nameW = fitText(ctx, d.name, x + 35, y + 14, 11, beaten ? 'rgba(255,255,255,0.45)' : o.kind === 'player' ? '#ffd166' : '#ffffff', w - 39);
    text(ctx, o.sub || '', x + 35, y + 27, 9, beaten ? '#e17070' : '#9fb3d1', 'left', 'normal');
    if (beaten && o.strike > 0) {
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 1.5;
      R.line(ctx, x + 33, y + 14, x + 33 + (nameW + 4) * clamp01(o.strike), y + 14);
    }
    ctx.restore();
  }

  function bkTrophy(ctx, cx, cy, lit) {
    ctx.save();
    ctx.globalAlpha *= lit ? 1 : 0.4;
    ctx.translate(cx, cy);
    ctx.scale(0.62, 0.62);
    trophy(ctx, 0, 14);
    ctx.restore();
  }

  // st: { p1, won (rounds won), results, cur (round being or about to be played, 0 = none),
  //       since (s since the latest win, animates it; omit for a static bracket), panel: 'next' | 'now', score }
  function drawBracket(ctx, st) {
    const ladder = ladderFor(st.p1);
    const { w, h } = BK;
    const since = st.since === undefined ? 99 : st.since;
    const latest = st.won - 1; // column whose win is animating
    const strikeU = clamp01((since - ADV.strike) / 0.25);
    const pathU = clamp01((since - ADV.path) / ADV.pathLen);
    const popU = clamp01((since - ADV.pop) / 0.28);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let k = 0; k < 5; k++) {
      const ex = bkX(k) + w + 7;
      const top = oppY(k) + h / 2, bot = slotY(k) + h / 2, mid = (top + bot) / 2;
      const nx = k < 4 ? bkX(k + 1) : bkX(5);
      const pPath = [[bkX(k) + w, bot], [ex, bot], [ex, mid], [nx, mid]];
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      polyPart(ctx, [[bkX(k) + w, top], [ex, top], [ex, mid]], 1);
      polyPart(ctx, pPath, 1);
      if (k < st.won) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#ffd166';
        polyPart(ctx, pPath, k === latest ? pathU : 1);
      }
      if (st.cur === k + 1) {
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(ex, mid, 9, 0, Math.PI * 2);
        ctx.fill();
        text(ctx, 'VS', ex, mid + 0.5, 8, '#2b1d00', 'center', '900');
      }
      text(ctx, ROUND_NAMES[k], bkX(k) + w / 2, oppY(k) - 9, 10, st.cur === k + 1 ? '#ffd166' : '#9fb3d1');
      // the player's slot
      if (k === 0) bkCard(ctx, st.p1, bkX(0), slotY(0), { kind: 'player', sub: 'You', hot: st.cur === 1 });
      else if (k <= st.won) {
        const r = st.results[k - 1];
        bkCard(ctx, st.p1, bkX(k), slotY(k), {
          kind: 'player', sub: r ? `Won ${r[0]} – ${r[1]}` : 'Won', hot: st.cur === k + 1, pop: k === st.won ? popU : undefined,
        });
        if (k === st.won && popU < 1) bkCard(ctx, null, bkX(k), slotY(k), { kind: 'tbd', pop: 1 - popU * 3 });
      } else bkCard(ctx, null, bkX(k), slotY(k), { kind: 'tbd' });
      // the opponent
      if (k < st.won) bkCard(ctx, ladder[k], bkX(k), oppY(k), { kind: 'beaten', sub: 'Knocked out', strike: k === latest ? strikeU : 1 });
      else bkCard(ctx, ladder[k], bkX(k), oppY(k), { kind: 'opp', sub: st.cur === k + 1 ? (st.panel === 'now' ? 'Playing now' : 'Up next') : 'Waiting', hot: st.cur === k + 1 });
    }
    // the cup
    const cx = bkX(5) + 26, cy = slotY(5) + h / 2;
    text(ctx, 'Champion', cx, cy - 37, 10, st.won >= 5 ? '#ffd166' : '#9fb3d1');
    ctx.fillStyle = st.won >= 5 ? '#2c4675' : '#1a2238';
    rr(ctx, cx - 26, cy - 27, 52, 54, 9);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = st.won >= 5 ? '#ffd166' : 'rgba(255,255,255,0.16)';
    ctx.stroke();
    bkTrophy(ctx, cx, cy, st.won >= 5);
    // match card for the round at hand
    const opp = st.cur ? ladder[st.cur - 1] : null;
    if (opp) {
      const px = 12, py = 64, pw = 288, ph = 98;
      ctx.fillStyle = 'rgba(20,30,52,0.92)';
      rr(ctx, px, py, pw, ph, 12);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,209,102,0.35)';
      ctx.stroke();
      text(ctx, (st.panel === 'now' ? 'NOW PLAYING' : 'UP NEXT') + '  ·  ' + ROUND_NAMES[st.cur - 1], px + 14, py + 14, 10, '#ffd166', 'left');
      ctx.save();
      rr(ctx, px + 2, py + 2, pw - 4, ph - 4, 10);
      ctx.clip();
      R.figure(ctx, st.p1, px + 44, py + ph - 6, 0.68, { t: time });
      R.figure(ctx, opp, px + pw - 44, py + ph - 6, 0.68, { t: time, flip: true });
      ctx.restore();
      text(ctx, CHARS[st.p1].name, px + pw / 2, py + 40, 14, '#ffffff');
      text(ctx, st.panel === 'now' ? st.score : 'vs', px + pw / 2, py + 58, st.panel === 'now' ? 15 : 11, st.panel === 'now' ? '#ffd166' : '#9fb3d1');
      text(ctx, CHARS[opp].name, px + pw / 2, py + 76, 14, '#ffffff');
    }
    ctx.restore();
  }

  // the empty arena, dimmed, so the match underneath doesn't show through
  function bracketBackdrop(ctx, scale) {
    R.background(ctx, scale);
    ctx.fillStyle = 'rgba(8,12,26,0.84)';
    R.cover(ctx);
  }

  function bracketScreen(p1) {
    const start = () => go(briefing(p1, null, 'solo'));
    const back = () => go(select1P(p1));
    const s = {
      enter() {
        s.buttons = [
          btn('Back', 404, 364, 90, 40, back),
          btn('Start', 504, 364, 124, 40, start, { primary: true }),
        ];
      },
      key(code) {
        if (code === G.KEY.ENTER || code === G.KEY.SPACE) start();
        else if (code === G.KEY.ESC) back();
      },
      draw(ctx, scale) {
        bracketBackdrop(ctx, scale);
        text(ctx, CUP, 320, 28, 26, '#ffd166', 'center', '900', '#1b1b24', 6);
        text(ctx, 'Five straight wins take the cup', 320, 51, 12, '#c9d6ee', 'center', 'normal');
        drawBracket(ctx, { p1, won: 0, results: [], cur: 1, panel: 'next' });
        text(ctx, 'Lose a match and you replay that round.', 14, 384, 11, 'rgba(255,255,255,0.5)', 'left', 'normal');
        drawButtons(ctx, s.buttons);
      },
    };
    return s;
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
          btn('Back', 40, 372, 90, 38, () => go(titleScreen('multi'))),
          btn('Undo', 140, 372, 90, 38, () => { picks.pop(); }),
          btn('Play!', 500, 372, 110, 38, () => { if (startable()) go(briefing(picks[0], picks[1], 'versus')); }, { primary: true }),
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
        else if (code === K.ENTER || code === K.SPACE) { if (startable()) go(briefing(picks[0], picks[1], 'versus')); else choose(cursor); }
        else if (code === 8) picks.pop();
        else if (code === K.ESC) go(titleScreen('multi'));
      },
      draw(ctx, scale) {
        R.background(ctx, scale);
        ctx.fillStyle = 'rgba(8,12,26,0.72)';
        R.cover(ctx);
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

  // how the two players are connected, for the corner of the screen
  function linkText() {
    const how = NET.path === 'direct' ? 'Direct' : NET.path === 'connecting' ? 'Connecting...' : 'Relayed';
    return NET.rtt === null ? how : how + '  ·  ' + Math.round(NET.rtt) + ' ms';
  }

  /* ======================================================== ONLINE: rooms */
  // kind 'create': get a code from the room server and wait for the other player.
  // kind 'join': type the code you were sent.
  // Online prediction (js/online.js): on by default, the room's creator can turn it off for both
  const PREDICT_KEY = 'shuttlesticks.predict';
  function savedPredict() {
    try { return localStorage.getItem(PREDICT_KEY) !== '0'; } catch (e) { return true; }
  }
  function roomScreen(kind) {
    const create = kind === 'create';
    let state = create ? 'connecting' : 'typing'; // connecting | waiting | typing | joining | error
    let code = '', err = '', copied = 0, keep = false;
    const back = () => go(titleScreen('online', create ? 0 : 1));
    const join = () => {
      if (code.length !== NET.CODE_LENGTH || state === 'joining') return;
      state = 'joining';
      err = '';
      NET.join(code);
    };
    const type = (ch) => {
      ch = ch.toUpperCase();
      if (state === 'typing' && code.length < NET.CODE_LENGTH && NET.CODE_CHARS.includes(ch)) {
        code += ch;
        err = '';
        SFX.play('click');
      }
    };
    let predict = savedPredict();
    const togglePredict = () => {
      predict = !predict;
      try { localStorage.setItem(PREDICT_KEY, predict ? '1' : '0'); } catch (e) { /* storage blocked */ }
      SFX.play('click');
    };
    const copy = () => {
      try {
        navigator.clipboard.writeText(code).then(() => { copied = time; }, () => {});
      } catch (e) { /* no clipboard here */ }
    };
    const s = {
      typing: !create,
      enter() {
        NET.listen((msg) => {
          if (msg.t === 'created') {
            code = msg.code;
            state = 'waiting';
          } else if (msg.t === 'paired') {
            keep = true;
            SFX.play('pop');
            go(onlineSelect(msg.role, msg.code, predict));
          } else if (msg.t === 'error') {
            err = msg.msg;
            state = create ? 'error' : 'typing';
          }
        });
        if (create) NET.create();
        s.buttons = create
          ? [btn('Copy code', 230, 300, 180, 38, copy, { primary: true }), btn('Cancel', 260, 350, 120, 34, back),
            btn(() => 'Prediction: ' + (predict ? 'On' : 'Off'), 245, 258, 150, 28, togglePredict, { size: 13 })]
          : [btn('Join', 230, 300, 180, 40, join, { primary: true }), btn('Back', 260, 350, 120, 34, back)];
      },
      leave() { if (!keep) NET.close(); },
      key(c) {
        const K = G.KEY;
        if (c === K.ESC) return back();
        if (create) {
          if (c === K.P) togglePredict();
          if (c === K.ENTER && state === 'waiting') copy();
          if (c === K.ENTER && state === 'error') { state = 'connecting'; err = ''; NET.create(); }
          return;
        }
        if (c === 8) { code = code.slice(0, -1); err = ''; }
        else if (c === K.ENTER) join();
        else if ((c >= 65 && c <= 90) || (c >= 48 && c <= 57)) type(String.fromCharCode(c));
      },
      paste(str) {
        if (create || state !== 'typing') return;
        for (const ch of String(str).replace(/\s/g, '')) type(ch);
      },
      draw(ctx, scale) {
        R.background(ctx, scale);
        ctx.fillStyle = 'rgba(8,12,26,0.78)';
        R.cover(ctx);
        text(ctx, create ? 'Create Room' : 'Join Room', 320, 60, 30, '#ffd166', 'center', '900', '#1b1b24', 6);
        let line = '';
        if (create) {
          if (state === 'connecting') line = 'Connecting' + '...'.slice(0, 1 + (Math.floor(time * 3) % 3));
          else if (state === 'waiting') line = 'Send this code to your opponent.\nWaiting for them to join' + '...'.slice(0, 1 + (Math.floor(time * 3) % 3));
        } else {
          line = state === 'joining' ? 'Joining' + '...'.slice(0, 1 + (Math.floor(time * 3) % 3)) : 'Type the code your opponent sent you.';
        }
        text(ctx, line, 320, 116, 14, '#c9d6ee', 'center', 'normal');
        // the code, one box per character
        const n = NET.CODE_LENGTH, w = 56, gap = 12, x0 = 320 - (n * w + (n - 1) * gap) / 2;
        for (let i = 0; i < n; i++) {
          const x = x0 + i * (w + gap), ch = code[i] || '';
          const caret = !create && state === 'typing' && i === code.length && Math.floor(time * 2) % 2 === 0;
          ctx.fillStyle = 'rgba(20,30,52,0.95)';
          rr(ctx, x, 158, w, 66, 10);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = caret || (create && ch) ? '#ffd166' : 'rgba(255,255,255,0.25)';
          ctx.stroke();
          if (ch) text(ctx, ch, x + w / 2, 192, 38, '#ffffff', 'center', '900');
          else if (caret) {
            ctx.fillStyle = '#ffd166';
            ctx.fillRect(x + w / 2 - 1.5, 172, 3, 38);
          }
        }
        if (err) text(ctx, err, 320, 242, 14, '#ff7675', 'center', 'bold');
        else if (create && copied && time - copied < 1.5) text(ctx, 'Copied!', 320, 242, 14, '#7bed9f', 'center', 'bold');
        if (create) text(ctx, predict ? 'Smooths over the delay: you see your opponent where they are now (P)' : 'You see exactly what has arrived, half a ping late (P)', 320, 296 - 6, 9, 'rgba(255,255,255,0.45)', 'center', 'normal');
        const hide = (b, h) => { b.hidden = h; };
        if (create) {
          hide(s.buttons[0], state !== 'waiting' && state !== 'error');
          s.buttons[0].label = state === 'error' ? 'Try again' : 'Copy code';
          s.buttons[0].onClick = state === 'error' ? () => { state = 'connecting'; err = ''; NET.create(); } : copy;
        } else hide(s.buttons[0], code.length !== n || state === 'joining');
        drawButtons(ctx, s.buttons);
      },
    };
    return s;
  }

  /* ======================================================== ONLINE: pick players */
  // Each player picks their own character and says they're ready; the host starts the match.
  // predict: the creator's setting; the joiner learns it with 'go'
  function onlineSelect(role, room, predict) {
    const me = role === 'host' ? 0 : 1, them = 1 - me;
    const picks = [null, null], ready = [false, false];
    let cursor = 0, keep = false, gone = null;
    const tiles = SELECT_2P.map((id, i) => ({ id, i, x: 40 + (i % 5) * 76, y: 64 + Math.floor(i / 5) * 88, w: 70, h: 82 }));
    const leave = () => go(titleScreen('online'));
    const start = (p1, p2, pred) => {
      keep = true;
      go(onlineMatch(role, p1, p2, pred));
    };
    const pick = (i) => {
      if (gone || told) return;
      cursor = i;
      picks[me] = SELECT_2P[i];
      ready[me] = false;
      NET.send({ t: 'pick', id: picks[me] });
      NET.send({ t: 'ready', on: false });
      SFX.play('click');
    };
    // Both games have to be the same build. One too old to say which it is counts as different.
    const since = time;
    const mismatch = () => {
      if (NET.theirVersion === null) return time - since > 4 ? 'old' : null;
      return NET.theirVersion !== NET.version ? NET.theirVersion : null;
    };
    const toggleReady = () => {
      if (gone || told || !picks[me] || mismatch()) return;
      ready[me] = !ready[me];
      NET.send({ t: 'ready', on: ready[me] });
      SFX.play('click');
      check();
    };
    // the host says go; the guest starts and answers, and the host starts on that answer, so
    // neither game can serve before the other is there to see it
    let told = false;
    const check = () => {
      if (role !== 'host' || !ready[0] || !ready[1] || told) return;
      told = true;
      NET.send({ t: 'go', p1: picks[0], p2: picks[1], pred: predict });
    };
    const s = {
      enter() {
        NET.listen((msg) => {
          if (msg.t === 'pick' && SELECT_2P.includes(msg.id)) { picks[them] = msg.id; ready[them] = false; told = false; }
          else if (msg.t === 'ready') { ready[them] = !!msg.on && !!picks[them]; check(); }
          else if (msg.t === 'go' && role === 'guest' && CHARS[msg.p1] && CHARS[msg.p2]) {
            NET.send({ t: 'going' });
            start(msg.p1, msg.p2, msg.pred !== false);
          } else if (msg.t === 'going' && role === 'host' && told) start(picks[0], picks[1], predict);
        });
        NET.onLeave((why) => { gone = why; SFX.play('thud'); });
        s.buttons = [
          btn('Leave', 40, 372, 90, 38, leave),
          btn(() => (ready[me] ? 'Not ready' : 'Ready!'), 500, 372, 110, 38, toggleReady, { primary: true }),
        ];
      },
      leave() { if (!keep) NET.close(); },
      click(x, y) {
        for (const t of tiles) if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) pick(t.i);
      },
      key(code) {
        const K = G.KEY;
        if (code === K.RIGHT || code === K.D) cursor = (cursor + 1) % 10;
        else if (code === K.LEFT || code === K.A) cursor = (cursor + 9) % 10;
        else if (code === K.DOWN || code === K.UP || code === K.S || code === K.W) cursor = (cursor + 5) % 10;
        else if (code === K.ENTER || code === K.SPACE) {
          if (picks[me] === SELECT_2P[cursor]) toggleReady();
          else pick(cursor);
        } else if (code === K.ESC) leave();
      },
      draw(ctx, scale) {
        R.background(ctx, scale);
        ctx.fillStyle = 'rgba(8,12,26,0.72)';
        R.cover(ctx);
        text(ctx, 'Online 1v1: pick your player', 230, 34, 22, '#ffd166');
        text(ctx, 'Room ' + room + '   ·   ' + linkText(), 620, 18, 11, 'rgba(255,255,255,0.5)', 'right', 'bold');
        tiles.forEach((t) => {
          const on = t.i === cursor, mine = picks[me] === t.id;
          ctx.save();
          ctx.fillStyle = on || mine ? '#3d5a8c' : '#25355a';
          rr(ctx, t.x, t.y, t.w, t.h, 8);
          ctx.fill();
          ctx.lineWidth = on ? 3 : mine ? 2 : 1.5;
          ctx.strokeStyle = on ? '#ffd166' : mine ? '#7bed9f' : 'rgba(255,255,255,0.18)';
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
        // you and them; the host plays on the left
        [me, them].forEach((k, row) => {
          const x = 440, y = 64 + row * 150;
          ctx.fillStyle = 'rgba(20,30,52,0.9)';
          rr(ctx, x, y, 180, 140, 12);
          ctx.fill();
          if (ready[k]) {
            ctx.strokeStyle = '#7bed9f';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          text(ctx, (k === me ? 'You' : 'Opponent') + (k === 0 ? '  (left)' : '  (right)'), x + 12, y + 16, 11, '#9fb3d1', 'left');
          text(ctx, ready[k] ? 'READY' : k === them && !picks[k] ? 'choosing...' : '', x + 168, y + 16, 11, ready[k] ? '#7bed9f' : 'rgba(255,255,255,0.45)', 'right', 'bold');
          if (picks[k]) {
            R.figure(ctx, picks[k], x + 100, y + 134, 0.9, { t: time, flip: k === 1 });
            text(ctx, CHARS[picks[k]].name, x + 12, y + 36, 15, '#ffffff', 'left');
          }
        });
        text(ctx, 'Move  ← → / A D     Jump  ↑ / W     Swing  ↓ / S / Space', 230, 260, 11, 'rgba(255,255,255,0.55)', 'center', 'normal');
        text(ctx, picks[me] ? (ready[me] ? 'Waiting for your opponent...' : 'Press Ready when you are set.') : 'Click a player or use the arrows and Enter.', 230, 284, 12, '#c9d6ee', 'center', 'normal');
        const bad = mismatch();
        s.buttons[1].hidden = !picks[me] || !!gone || !!bad;
        drawButtons(ctx, s.buttons);
        if (bad && !gone) {
          ctx.fillStyle = 'rgba(8,12,26,0.85)';
          rr(ctx, 40, 300, 380, 60, 12);
          ctx.fill();
          const theirs = bad === 'old' ? 'an older build' : 'build ' + bad.split('-')[0];
          text(ctx, 'Your opponent is on ' + theirs + ', you are on ' + (BUILD.build === 'dev' ? 'a dev build' : 'build ' + BUILD.build) + '.\nWhoever is behind should reload the page.', 230, 330, 12, '#ff7675', 'center', 'bold');
        }
        if (gone) {
          ctx.fillStyle = 'rgba(8,12,26,0.85)';
          rr(ctx, 120, 300, 360, 56, 12);
          ctx.fill();
          text(ctx, gone === 'left' ? 'Your opponent left the room.' : 'Lost the connection.', 300, 328, 15, '#ff7675', 'center', 'bold');
        }
      },
    };
    return s;
  }

  /* ======================================================== ONLINE: the match */
  // Each screen plays its own player (js/online.js); the host is on the left.
  function onlineMatch(role, p1, p2, predict) {
    const host = role === 'host';
    let sync = null, overlay = null, gone = null;
    let asked = false, theyAsked = false;
    const menu = () => go(titleScreen());
    const rematch = () => {
      if (asked || gone) return;
      asked = true;
      NET.send({ t: 'rematch' });
      if (theyAsked) restart();
    };
    const restart = () => { // both want another: each screen starts it
      sync.restart();
      closeOverlay();
    };
    function closeOverlay() {
      if (overlay) overlay.fading = true;
      asked = theyAsked = false;
    }
    function openOverlay(kind) {
      const buttons = kind === 'over'
        ? [btn('Rematch', 236, 244, 168, 42, rematch, { primary: true }), btn('Menu', 270, 296, 100, 34, menu)]
        : [btn('Menu', 250, 260, 140, 40, menu, { primary: true })];
      const won = host ? match.score1 > match.score2 : match.score2 > match.score1;
      overlay = { kind, alpha: 0, fading: false, buttons, won, s: host ? [match.score1, match.score2] : [match.score2, match.score1] };
    }
    const s = {
      isPlay: true,
      enter() {
        disposeMatch();
        SFX.music('game');
        match = new Match('peer', p1, p2, { matchOver() { openOverlay('over'); } });
        match.me = host ? 1 : 2;
        sync = new PeerSync(match, { predict });
        match.start();
        NET.listen((msg) => {
          if (msg.t === 'st') sync.stream(msg);
          else if (msg.t === 'hit') sync.remoteHit(msg);
          else if (msg.t === 'own') sync.remoteHandOver(msg);
          else if (msg.t === 'pt') sync.remotePoint(msg);
          else if (msg.t === 'rematch') {
            theyAsked = true;
            if (asked) restart();
          }
        });
        NET.onLeave((why) => {
          gone = why;
          SFX.play('thud');
          openOverlay('left');
        });
      },
      leave() { NET.close(); },
      key(code) {
        if (code === G.KEY.ESC) { SFX.play('thud'); menu(); return; }
        if (overlay && !overlay.fading && code === G.KEY.ENTER) overlay.buttons[0].onClick();
      },
      tick(dt) {
        if (sync && !gone) sync.frame();
        if (!overlay) return;
        if (overlay.fading) {
          overlay.alpha -= 4.5 * dt;
          if (overlay.alpha <= 0) overlay = null;
        } else if (overlay.alpha < 1) overlay.alpha = Math.min(1, overlay.alpha + 4.5 * dt);
      },
      get buttons() { return overlay && !overlay.fading ? overlay.buttons : []; },
      draw(ctx, scale) {
        if (!match) return;
        R.scene(ctx, match, scale);
        // which one is you
        const p = match.local;
        if (p && !match.over) {
          const y = p.y - 1.25 * R.headHeight(p.id) - 30;
          ctx.save();
          ctx.globalAlpha = 0.85;
          text(ctx, 'YOU', p.x, y, 10, '#ffd166', 'center', '900', '#1b1b24', 3);
          ctx.fillStyle = '#ffd166';
          ctx.beginPath();
          ctx.moveTo(p.x - 5, y + 7);
          ctx.lineTo(p.x + 5, y + 7);
          ctx.lineTo(p.x, y + 13);
          ctx.fill();
          ctx.restore();
        }
        if (!gone) text(ctx, linkText() + (predict ? '' : '  ·  no prediction'), 8, 12, 10, 'rgba(255,255,255,0.55)', 'left', 'bold');
        if (sync && sync.stalled > 90 && !overlay && !gone) {
          ctx.fillStyle = 'rgba(8,12,26,0.75)';
          rr(ctx, 190, 170, 260, 44, 10);
          ctx.fill();
          text(ctx, 'Waiting for your opponent' + '...'.slice(0, 1 + (Math.floor(time * 3) % 3)), 320, 192, 14, '#ffffff', 'center', 'bold');
        }
        if (overlay) {
          const o = overlay;
          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha));
          ctx.fillStyle = 'rgba(8,12,26,0.85)';
          rr(ctx, 180, 120, 280, 228, 16);
          ctx.fill();
          ctx.strokeStyle = '#ffd166';
          ctx.lineWidth = 2;
          ctx.stroke();
          if (o.kind === 'over') {
            text(ctx, o.won ? 'You Win!' : 'Good Try', 320, 158, 32, '#ffd166', 'center', '900');
            text(ctx, 'Final score ' + o.s[0] + ' - ' + o.s[1], 320, 196, 14, '#dfe7f5', 'center', 'normal');
            const note = gone ? '' : asked ? 'Waiting for your opponent...' : theyAsked ? 'Your opponent wants a rematch!' : '';
            text(ctx, note, 320, 222, 12, theyAsked && !asked ? '#7bed9f' : '#9fb3d1', 'center', 'bold');
          } else {
            text(ctx, 'Match over', 320, 166, 28, '#ffd166', 'center', '900');
            text(ctx, gone === 'left' ? 'Your opponent left.' : 'Lost the connection.', 320, 208, 15, '#dfe7f5', 'center', 'normal');
          }
          drawButtons(ctx, o.buttons);
          ctx.restore();
        }
      },
    };
    return s;
  }

  /* ======================================================== SELECT (1v1 opponent) */
  const LEVEL_KEY = 'shuttlesticks.level';
  function savedLevel() {
    try {
      const v = localStorage.getItem(LEVEL_KEY);
      return v !== null && CPU_LEVELS[v] ? Number(v) : 1;
    } catch (e) { return 1; }
  }
  // The computer can't fly a mouse flyer, so opponents come from the two-player roster, all of
  // them open whatever is unlocked. Tab or the buttons set the difficulty, which is remembered.
  function selectOpponent(p1, pick) {
    let sel = Math.max(0, SELECT_2P.indexOf(pick || ladderFor(p1)[0]));
    let level = savedLevel();
    const tiles = SELECT_2P.map((id, i) => ({ id, i, x: 18 + (i % 5) * 84, y: 54 + Math.floor(i / 5) * 92, w: 78, h: 86 }));
    const setLevel = (v) => {
      level = v;
      try { localStorage.setItem(LEVEL_KEY, String(v)); } catch (e) { /* storage blocked */ }
    };
    const start = () => go(briefing(p1, SELECT_2P[sel], 'cpu', level));
    const back = () => go(select1P(p1, 'cpu'));
    const s = {
      enter() {
        s.levels = CPU_LEVELS.map((L, i) => btn(L.name, 448 + (i % 2) * 85, 280 + Math.floor(i / 2) * 30, 81, 26, () => setLevel(i), { size: 13 }));
        s.buttons = [
          btn('Back', 440, 372, 80, 38, back),
          btn('Play!', 530, 372, 92, 38, start, { primary: true }),
          ...s.levels,
        ];
      },
      click(x, y) {
        for (const t of tiles) if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) { sel = t.i; SFX.play('click'); }
      },
      key(code) {
        const K = G.KEY, n = tiles.length;
        if (code === K.RIGHT || code === K.D) sel = (sel + 1) % n;
        else if (code === K.LEFT || code === K.A) sel = (sel + n - 1) % n;
        else if (code === K.DOWN || code === K.UP || code === K.S || code === K.W) sel = (sel + 5) % n;
        else if (code === K.TAB) setLevel((level + 1) % CPU_LEVELS.length);
        else if (code === K.ENTER || code === K.SPACE) return start();
        else if (code === K.ESC) return back();
        else return;
        SFX.play('click');
      },
      draw(ctx, scale) {
        R.background(ctx, scale);
        ctx.fillStyle = 'rgba(8,12,26,0.72)';
        R.cover(ctx);
        text(ctx, '1v1: pick your opponent', 222, 30, 22, '#ffd166');
        for (const t of tiles) {
          const on = t.i === sel;
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
          R.figure(ctx, t.id, t.x + t.w / 2 + 4, t.y + t.h + 2, 0.95, { t: on ? time : 0, flip: true });
          ctx.restore();
        }
        // info
        const id = SELECT_2P[sel], d = CHARS[id];
        ctx.fillStyle = 'rgba(20,30,52,0.9)';
        rr(ctx, 18, 246, 414, 164, 12);
        ctx.fill();
        text(ctx, d.name, 34, 270, 22, '#ffffff', 'left');
        text(ctx, d.bio, 34, 306, 13, '#c9d6ee', 'left', 'normal');
        text(ctx, d.pros, 34, 340, 13, '#ffd166', 'left', 'bold');
        text(ctx, '“' + (greetingFor(id, p1) || d.lines[0]) + '”', 34, 380, 13, '#9fb3d1', 'left', 'italic');
        // the match-up and the difficulty
        ctx.fillStyle = 'rgba(20,30,52,0.9)';
        rr(ctx, 440, 54, 182, 308, 12);
        ctx.fill();
        R.figure(ctx, p1, 488, 214, 1.15, { t: 0 });
        R.figure(ctx, id, 576, 214, 1.15, { t: time, flip: true });
        text(ctx, 'vs', 531, 120, 18, '#9fb3d1', 'center', '900');
        fitText(ctx, CHARS[p1].name, 486, 232, 11, 'rgba(255,255,255,0.75)', 86, 'center');
        fitText(ctx, d.name, 578, 232, 11, '#ffffff', 86, 'center');
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        R.line(ctx, 452, 250, 610, 250);
        text(ctx, 'Difficulty', 450, 265, 12, '#9fb3d1', 'left');
        text(ctx, 'Tab', 612, 265, 10, 'rgba(255,255,255,0.4)', 'right', 'normal');
        text(ctx, CPU_LEVELS[level].note, 531, 348, 10, CPU_LEVELS[level].ai === CHAMPION_AI ? '#ffd166' : '#c9d6ee', 'center', 'normal');
        s.levels.forEach((b, i) => { b.primary = i === level; });
        drawButtons(ctx, s.buttons);
      },
    };
    return s;
  }

  /* ======================================================== BRIEFING */
  // mode: 'solo', 'cpu', 'versus' or 'training' (as for Match); level: the 1v1 difficulty
  function briefing(p1, p2, mode, level) {
    const versus = mode === 'versus';
    const kind = CHARS[p1].kind;
    const start = () => go(playScreen(mode, p1, p2, level));
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
          rows = [['Move', '← →  or  A D'], ['Jump', '↑  or  W'], ['Swing', '↓, S or Space']];
          note = kind === 'hover'
            ? 'Your cloud keeps you floating just above the floor,\nand your serve pops straight up out of it.'
            : 'Swing early for a high lob, late for a steep smash.';
        }
        if (mode === 'cpu') {
          title = '1v1 Match';
          rows.unshift(['Opponent', CHARS[p2].name + '  ·  ' + CPU_LEVELS[level].name]);
        }
        if (mode === 'training') {
          title = 'Training  ·  ' + CHARS[p1].name;
          rows = kind === 'jet' ? [rows[0], rows[1]] : rows;
          rows.push(['Shot trail', 'T  (on / off)']);
          note = 'It feeds you clears, lobs, drops, drives and smashes.\nThe trail shows where each shot is heading and where it will land.';
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

  function playScreen(mode, p1, p2, level) {
    let overlay = null; // {kind, alpha, fading, buttons}
    const s = {
      isPlay: true,
      enter() {
        disposeMatch();
        SFX.music('game');
        match = new Match(mode, p1, p2, {
          matchOver(m, kind) { openOverlay(kind); },
          champion() { openOverlay('champion'); },
        }, level);
        match.start();
      },
      key(code) {
        const K = G.KEY;
        if (code === K.ESC) { SFX.play('thud'); go(titleScreen()); return; }
        if (code === K.P) { G.togglePause(); return; }
        if (code === K.T && match && match.machine) { match.machine.toggleTrail(); SFX.play('click'); return; }
        if (overlay && !overlay.fading && code === K.ENTER) overlay.buttons[0].onClick();
      },
      mouseDown() { if (match && !overlay) match.mouseDown(); },
      tick(dt) {
        if (!overlay) return;
        if (overlay.kind === 'won' && !overlay.popped && time - overlay.t0 >= ADV.pop) { overlay.popped = true; SFX.play('pop'); }
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
        if (G.paused && match.mode === 'solo' && !match.over) {
          bracketBackdrop(ctx, scale);
          text(ctx, 'PAUSED', 320, 28, 26, '#ffffff', 'center', '900', '#1b1b24', 6);
          text(ctx, 'P to resume  ·  Esc for menu  ·  M sound', 320, 51, 12, '#c9d6ee', 'center', 'normal');
          drawBracket(ctx, { p1: match.p1Id, won: match.round - 1, results: match.results, cur: match.round, panel: 'now', score: match.score1 + ' – ' + match.score2 });
        } else if (G.paused) {
          ctx.fillStyle = 'rgba(8,12,26,0.6)';
          R.cover(ctx);
          text(ctx, 'PAUSED', 320, 190, 40, '#ffffff', 'center', '900', '#1b1b24', 8);
          text(ctx, 'P to resume  ·  Esc for menu  ·  M sound', 320, 232, 14, '#c9d6ee', 'center', 'normal');
        }
        if (overlay) drawOverlay(ctx, scale);
      },
    };

    function openOverlay(kind) {
      const menu = () => go(titleScreen());
      const close = (fn) => () => { overlay.fading = true; fn(); };
      let buttons;
      if (kind === 'won') buttons = [btn('Next Round', 504, 364, 124, 40, close(() => match.nextLevel()), { primary: true }), btn('Menu', 404, 364, 90, 40, menu)];
      else if (kind === 'versus') {
        const players = () => go(mode === 'cpu' ? selectOpponent(p1, p2) : select2P());
        buttons = [btn('Rematch', 236, 236, 168, 42, close(() => match.resetLevel()), { primary: true }), btn('Players', 226, 288, 90, 34, players), btn('Menu', 324, 288, 90, 34, menu)];
      }
      else if (kind === 'lost') buttons = [btn('Try Again', 236, 250, 168, 42, close(() => match.resetLevel()), { primary: true }), btn('Menu', 270, 302, 100, 34, menu)];
      else {
        const lv = unlockLevel() + 1;
        setUnlockLevel(lv);
        kind = 'champion';
        buttons = [btn('Menu', 250, 364, 140, 40, menu, { primary: true })];
        buttons.unlockText = lv <= UNLOCK_TIERS.length - 1 ? 'New players unlocked!' : 'You ruled the league. Again.';
      }
      // snapshot the result: Next Round / Try Again / Rematch reset the match while this fades out
      const res = { round: match.round, opp: match.p2Id, s1: match.score1, s2: match.score2, flawless: match.flawless, status: match.status };
      overlay = { kind, alpha: 0, fading: false, buttons, res, t0: time, popped: false };
    }

    function drawOverlay(ctx, scale) {
      const o = overlay;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha));
      const res = o.res;
      if (o.kind === 'won') {
        bracketBackdrop(ctx, scale);
        const r = res.round;
        text(ctx, 'You Win!', 320, 28, 26, '#ffd166', 'center', '900', '#1b1b24', 6);
        text(ctx, (res.flawless ? 'Flawless!  ' : '') + 'Beat ' + CHARS[res.opp].name + ' ' + res.s1 + ' – ' + res.s2, 320, 51, 12, '#c9d6ee', 'center', 'normal');
        drawBracket(ctx, { p1: match.p1Id, won: r, results: match.results, cur: r + 1, since: time - o.t0, panel: 'next' });
        const left = 5 - r;
        text(ctx, left === 1 ? 'One more win for the cup.' : left + ' more wins for the cup.', 14, 384, 11, 'rgba(255,255,255,0.5)', 'left', 'normal');
      } else if (o.kind === 'versus') {
        ctx.fillStyle = 'rgba(8,12,26,0.82)';
        rr(ctx, 180, 120, 280, 216, 16);
        ctx.fill();
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.stroke();
        text(ctx, res.status + '!', 320, 160, 32, '#ffd166', 'center', '900');
        text(ctx, 'Final score ' + res.s1 + ' - ' + res.s2, 320, 200, 14, '#dfe7f5', 'center', 'normal');
      } else if (o.kind === 'lost') {
        ctx.fillStyle = 'rgba(8,12,26,0.88)';
        R.cover(ctx);
        text(ctx, 'Good Try', 320, 96, 44, '#ffffff', 'center', '900', '#1b1b24', 8);
        text(ctx, (ROUND_NAMES[res.round - 1] || 'Match') + ':  ' + CHARS[res.opp].name + ' wins ' + res.s2 + ' - ' + res.s1, 320, 146, 15, '#c9d6ee', 'center', 'normal');
        text(ctx, 'Shake it off and run it back.', 320, 172, 13, '#9fb3d1', 'center', 'normal');
        R.figure(ctx, match.p1Id, 130, 360, 1.3, { t: time });
        R.figure(ctx, res.opp, 510, 360, 1.3, { t: time, flip: true });
      } else {
        ctx.fillStyle = 'rgba(8,12,26,0.9)';
        R.cover(ctx);
        text(ctx, 'CHAMPION!', 320, 58, 50, '#ffd166', 'center', '900', '#1b1b24', 10);
        text(ctx, CHARS[match.p1Id].name + ' wins the ' + CUP + '.', 320, 102, 16, '#ffffff', 'center', 'bold');
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
        R.cover(ctx);
      }
    },
    key(code) {
      if (code === G.KEY.BACKQUOTE) { G.toggleDebug(); return; }
      if (fade.dir) return;
      if (code === G.KEY.M && !screen.typing) { SFX.toggleMute(); return; }
      if (screen.key) screen.key(code);
      else navigate(code);
    },
    paste(str) {
      if (screen && screen.paste && !fade.dir) screen.paste(str);
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
