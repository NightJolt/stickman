'use strict';
/* All drawing. Coordinates are stage px (640x426). Art is procedural and original to this remake. */
const R = (() => {
  const INK = '#1b1b24';
  const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
  let bg = null, bgScale = 0;

  /* ------------------------------------------------------------ helpers */
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function line(ctx, ax, ay, bx, by) {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  function text(ctx, str, x, y, size, color, align = 'center', weight = 'bold', outline = null, ow = 4) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    const lines = String(str).split('\n');
    const lh = size * 1.15;
    const y0 = y - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => {
      if (outline) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = ow;
        ctx.strokeStyle = outline;
        ctx.strokeText(l, x, y0 + i * lh);
      }
      ctx.fillStyle = color;
      ctx.fillText(l, x, y0 + i * lh);
    });
  }
  // two-bone IK: returns the joint between a and b with segment lengths l1, l2; bendSign picks the side
  function joint(ax, ay, bx, by, l1, l2, bendSign) {
    let dx = bx - ax, dy = by - ay;
    let d = Math.hypot(dx, dy) || 0.0001;
    const reach = l1 + l2;
    if (d > reach) { bx = ax + (dx / d) * reach; by = ay + (dy / d) * reach; dx = bx - ax; dy = by - ay; d = reach; }
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const mx = ax + (dx * a) / d, my = ay + (dy * a) / d;
    return [mx + (-dy / d) * h * bendSign, my + (dx / d) * h * bendSign, bx, by];
  }

  /* ------------------------------------------------------------ background */
  // The hall, in muted colours so the players and the shuttle stand out. It's drawn across the
  // whole visible area v (G.view): the court sits on the stage as always, and the hall carries on
  // to the window's edges. A wide window shows more of the hall to either side (benches beyond
  // the court ends); a tall one shows the roof above (trusses, lamps, a scoreboard, banners) and
  // the near side below (the rest of the court, a barrier, the front rows seen from behind).
  const HALL = {
    wall: [[-300, '#10141a'], [-20, '#1a2029'], [150, '#283140'], [400, '#37414f']], // [y, colour]
    sky: ['#545b70', '#857a86', '#bfa38b'], // dusk: deep above, warm low behind the city
    frame: '#141920',
    city: 'rgba(34,32,46,0.6)',
    steel: '#1c2129', steelHi: '#2c333e',
    lamp: '#e8e2ce', glow: '255,236,204',
    seats: ['#2b313b', '#262c35'],
    boards: ['#40566c', '#86634f', '#4f6c5c', '#6d4a4d'],
    boardText: 'rgba(236,231,221,0.78)',
    floor: ['#6e5640', '#98795a', '#7f634a'],
    plank: 'rgba(52,34,18,0.24)',
    court: '#4b6556', line: '#e3ded2',
    pad: ['#24344a', '#30455c'],
  };
  const COURT_NEAR = 446; // the court's near side line (below the stage on a 16:9 window)
  const mod = (a, n) => ((a % n) + n) % n;
  // something repeating every `step` from `start`: calls fn(x, i) for each across the visible width
  function tile(v, start, step, fn) {
    for (let i = Math.floor((v.x0 - start) / step) - 1; start + i * step < v.x1 + step; i++) fn(start + i * step, i);
  }

  function buildBackground(scale, v) {
    const c = document.createElement('canvas');
    c.width = Math.round((v.x1 - v.x0) * scale);
    c.height = Math.round((v.y1 - v.y0) * scale);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    ctx.translate(-v.x0, -v.y0);
    hallWall(ctx, v);
    if (v.y0 < 0) roof(ctx, v);
    windows(ctx, v);
    ceiling(ctx, v);
    stands(ctx, v);
    adBoards(ctx, v);
    floor(ctx, v);
    court(ctx);
    if (v.x0 < 0 || v.x1 > G.W) courtside(ctx, v);
    if (v.y1 > COURT_NEAR + 24) nearSide(ctx, v);
    endWalls(ctx);
    vignette(ctx, v);
    return c;
  }

  function hallWall(ctx, v) {
    const g = ctx.createLinearGradient(0, -300, 0, 400);
    for (const [y, col] of HALL.wall) g.addColorStop((y + 300) / 700, col);
    ctx.fillStyle = g;
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, 400 - v.y0);
  }

  // tall windows along the back wall, a dusky sky and the city beyond
  function windows(ctx, v) {
    tile(v, 62, 112, (x, i) => {
      const y = 54, w = 76, h = 150;
      const sky = ctx.createLinearGradient(0, y, 0, y + h);
      sky.addColorStop(0, HALL.sky[0]);
      sky.addColorStop(0.5, HALL.sky[1]);
      sky.addColorStop(0.92, HALL.sky[2]);
      ctx.fillStyle = sky;
      rr(ctx, x, y, w, h, 6);
      ctx.fill();
      for (let b = 0; b < 6; b++) {
        const bh = 14 + mod(i * 7 + b * 13, 30), bx = x + b * 13;
        ctx.fillStyle = HALL.city;
        ctx.fillRect(bx, y + h - bh, 11, bh);
        ctx.fillStyle = 'rgba(236,196,140,0.32)'; // a lit window or two
        if (mod(i * 5 + b * 3, 4) === 0) ctx.fillRect(bx + 3, y + h - bh + 5, 2, 2);
        if (mod(i * 3 + b * 7, 5) === 0) ctx.fillRect(bx + 6, y + h - bh + 11, 2, 2);
      }
      // a faint sheen across the glass
      ctx.save();
      rr(ctx, x, y, w, h, 6);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.beginPath();
      ctx.moveTo(x + 10, y + h);
      ctx.lineTo(x + 34, y + h);
      ctx.lineTo(x + w + 10, y + 20);
      ctx.lineTo(x + w - 14, y + 20);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = HALL.frame;
      ctx.lineWidth = 4;
      rr(ctx, x, y, w, h, 6);
      ctx.stroke();
      ctx.lineWidth = 2;
      line(ctx, x + w / 2, y, x + w / 2, y + h);
      line(ctx, x, y + h / 3, x + w, y + h / 3);
      line(ctx, x, y + (2 * h) / 3, x + w, y + (2 * h) / 3);
      // sill
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x - 4, y + h + 3, w + 8, 2);
    });
  }

  // the beam along the top of the wall (the bottom chord of the roof truss) and the lamps under it
  function ceiling(ctx, v) {
    tile(v, 110, 140, (x) => {
      const lg = ctx.createRadialGradient(x, 16, 2, x, 16, 135);
      lg.addColorStop(0, `rgba(${HALL.glow},0.24)`);
      lg.addColorStop(1, `rgba(${HALL.glow},0)`);
      ctx.fillStyle = lg;
      ctx.fillRect(x - 135, -119, 270, 270);
    });
    ctx.fillStyle = HALL.steel;
    ctx.fillRect(v.x0, -3, v.x1 - v.x0, 8);
    ctx.fillStyle = HALL.steelHi;
    ctx.fillRect(v.x0, -3, v.x1 - v.x0, 1.5);
    tile(v, 110, 140, (x) => {
      ctx.strokeStyle = HALL.steel;
      ctx.lineWidth = 1.5;
      line(ctx, x - 15, 5, x - 15, 10);
      line(ctx, x + 15, 5, x + 15, 10);
      ctx.fillStyle = '#2a3039';
      rr(ctx, x - 24, 9, 48, 5, 2);
      ctx.fill();
      ctx.fillStyle = HALL.lamp;
      rr(ctx, x - 22, 12, 44, 4, 2);
      ctx.fill();
    });
  }

  // a lattice girder across the hall: chords at y top and bottom, diagonals every `panel` px
  function truss(ctx, v, top, bottom, panel, k) {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = HALL.steel;
    ctx.lineWidth = 1.6 * k;
    ctx.beginPath();
    for (let x = panel * Math.floor(v.x0 / panel / 2) * 2 - 2 * panel; x < v.x1 + 2 * panel; x += 2 * panel) {
      ctx.moveTo(x, bottom);
      ctx.lineTo(x + panel, top);
      ctx.lineTo(x + 2 * panel, bottom);
      ctx.moveTo(x + panel, top);
      ctx.lineTo(x + panel, bottom);
    }
    ctx.stroke();
    ctx.fillStyle = HALL.steel;
    ctx.fillRect(v.x0, top - 2.5 * k, v.x1 - v.x0, 5 * k);
    ctx.fillRect(v.x0, bottom - 2.5 * k, v.x1 - v.x0, 5 * k);
    ctx.fillStyle = HALL.steelHi;
    ctx.fillRect(v.x0, top - 2.5 * k, v.x1 - v.x0, 1.2 * k);
  }

  // above the stage on a tall window: the roof, from the main truss over the court up to the deck
  function roof(ctx, v) {
    const vw = v.x1 - v.x0;
    // the roof deck: ribs spreading out as they come over us
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = -252, s = 9; y > v.y0 - 2; s *= 1.09, y -= s) ctx.fillRect(v.x0, y, vw, 1.2);
    // skylights in the deck
    if (v.y0 < -320) {
      tile(v, 40, 160, (x) => {
        const g = ctx.createLinearGradient(0, -392, 0, -334);
        g.addColorStop(0, '#2a3446');
        g.addColorStop(1, '#3b4458');
        ctx.fillStyle = g;
        ctx.fillRect(x, -392, 80, 58);
        ctx.strokeStyle = HALL.frame;
        ctx.lineWidth = 3;
        ctx.strokeRect(x, -392, 80, 58);
        ctx.lineWidth = 1.5;
        line(ctx, x + 40, -392, x + 40, -334);
        ctx.fillStyle = 'rgba(230,225,210,0.5)'; // a star or two
        ctx.fillRect(x + 14 + mod(x, 23), -380 + mod(x, 17), 1.4, 1.4);
        ctx.fillRect(x + 52 + mod(x, 11), -360 + mod(x, 13), 1.2, 1.2);
      });
    }
    // the upper truss, further back: thinner
    truss(ctx, v, -236, -202, 24, 0.75);
    // the roof's shadow deepening upward
    const dark = ctx.createLinearGradient(0, -60, 0, -480);
    dark.addColorStop(0, 'rgba(8,10,14,0)');
    dark.addColorStop(1, 'rgba(8,10,14,0.55)');
    ctx.fillStyle = dark;
    ctx.fillRect(v.x0, v.y0, vw, -60 - v.y0);
    // lamps hanging from it, each lighting the air below
    for (const x of [72, 168, 472, 568]) {
      const halo = ctx.createRadialGradient(x, -112, 2, x, -112, 96);
      halo.addColorStop(0, `rgba(${HALL.glow},0.13)`);
      halo.addColorStop(0.35, `rgba(${HALL.glow},0.05)`);
      halo.addColorStop(1, `rgba(${HALL.glow},0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(x - 96, -208, 192, 192);
      ctx.strokeStyle = 'rgba(120,128,140,0.5)';
      ctx.lineWidth = 1;
      line(ctx, x, -202, x, -128);
      ctx.fillStyle = '#2a3039';
      ctx.beginPath();
      ctx.moveTo(x - 4, -130);
      ctx.lineTo(x + 4, -130);
      ctx.lineTo(x + 11, -119);
      ctx.lineTo(x - 11, -119);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = HALL.lamp;
      ctx.fillRect(x - 9, -120, 18, 2.5);
    }
    // championship banners
    const flags = [['#5d3a3e', '1998'], ['#33435a', '2004'], ['#4d5a3d', '2011'], ['#55405a', '2019']];
    [24, 120, 520, 616].forEach((x, i) => {
      const [col, year] = flags[i];
      ctx.fillStyle = 'rgba(120,128,140,0.5)';
      ctx.fillRect(x - 15, -202, 30, 2);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x - 15, -200);
      ctx.lineTo(x + 15, -200);
      ctx.lineTo(x + 15, -142);
      ctx.lineTo(x, -132);
      ctx.lineTo(x - 15, -142);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(214,190,140,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.save();
      ctx.translate(x, -180);
      ctx.rotate(Math.PI);
      drawShuttleShape(ctx);
      ctx.restore();
      text(ctx, year, x, -156, 7, 'rgba(226,212,182,0.8)', 'center', 'bold');
    });
    scoreboard(ctx);
    // the main truss over the court; its bottom chord is the beam along the top of the wall
    truss(ctx, v, -42, 1, 30, 1);
  }

  // the scoreboard hanging over the net
  function scoreboard(ctx) {
    const x = G.NET_X, top = -178, w = 172, h = 80;
    ctx.strokeStyle = 'rgba(120,128,140,0.5)';
    ctx.lineWidth = 1;
    for (const dx of [-74, -34, 34, 74]) line(ctx, x + dx, -202, x + dx * 0.92, top);
    ctx.fillStyle = '#161a20';
    rr(ctx, x - w / 2, top, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = '#2b323d';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#0c0f14';
    rr(ctx, x - w / 2 + 8, top + 8, w - 16, h - 28, 3);
    ctx.fill();
    text(ctx, 'SHUTTLE STICKS', x, top + 25, 14, '#c6a66c', 'center', '900');
    text(ctx, 'HOME  ·  AWAY', x, top + 43, 7, 'rgba(198,190,170,0.55)', 'center', 'bold');
    ctx.fillStyle = '#1d3438';
    ctx.fillRect(x - w / 2 + 8, top + h - 15, w - 16, 8);
    text(ctx, 'FEATHER CUP  ·  SMASH OPEN  ·  STICK LEAGUE', x, top + h - 11, 5, 'rgba(176,206,200,0.7)', 'center', 'bold');
  }

  // the bleachers behind the court, and the crowd in them
  function stands(ctx, v) {
    const vw = v.x1 - v.x0;
    const g = ctx.createLinearGradient(0, 238, 0, 330);
    g.addColorStop(0, '#262c35');
    g.addColorStop(1, '#20252d');
    ctx.fillStyle = g;
    ctx.fillRect(v.x0, 238, vw, 92);
    for (let r = 0; r < 4; r++) {
      ctx.fillStyle = HALL.seats[r % 2];
      ctx.fillRect(v.x0, 244 + r * 22, vw, 18);
    }
    const hues = [12, 40, 200, 160, 280, 330, 90];
    for (let r = 0; r < 4; r++) {
      tile(v, 8 + (r % 2) * 9, 18, (x) => {
        const k = mod(x * 7 + r * 31, 97);
        if (k < 30) return;
        ctx.fillStyle = `hsl(${hues[k % hues.length]},16%,${34 + (k % 15)}%)`;
        ctx.beginPath();
        ctx.arc(x, 252 + r * 22, 6, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = 'rgba(214,194,174,0.5)';
        ctx.beginPath();
        ctx.arc(x, 241 + r * 22, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; // the rail along the front
    ctx.fillRect(v.x0, 328, vw, 1.5);
  }

  function adBoards(ctx, v) {
    const g = ctx.createLinearGradient(0, 332, 0, 372);
    g.addColorStop(0, '#191e26');
    g.addColorStop(1, '#13171e');
    ctx.fillStyle = g;
    ctx.fillRect(v.x0, 332, v.x1 - v.x0, 40);
    const boards = ['SHUTTLE STICKS', 'FEATHER CUP', 'SMASH OPEN', 'STICK LEAGUE'];
    tile(v, 12, 158, (x, i) => {
      ctx.fillStyle = HALL.boards[mod(i, 4)];
      rr(ctx, x, 337, 146, 30, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x + 3, 338, 140, 9);
      text(ctx, boards[mod(i, 4)], x + 73, 352, 13, HALL.boardText, 'center', 'bold');
    });
  }

  // the wooden floor; the planks get wider toward us
  function floor(ctx, v) {
    const vw = v.x1 - v.x0;
    const g = ctx.createLinearGradient(0, 372, 0, 480);
    g.addColorStop(0, HALL.floor[0]);
    g.addColorStop(0.25, HALL.floor[1]);
    g.addColorStop(1, HALL.floor[2]);
    ctx.fillStyle = g;
    ctx.fillRect(v.x0, 372, vw, v.y1 - 372);
    ctx.fillStyle = HALL.plank;
    let r = 0;
    for (let y = 379, s = 8.5; y < v.y1; y += s, s *= 1.05, r++) {
      ctx.fillRect(v.x0, y, vw, 1);
      const step = 90 * (s / 8.5), off = mod(r * 37, 90) * (s / 8.5);
      for (let x = off + step * Math.floor((v.x0 - off) / step) - step; x < v.x1; x += step) ctx.fillRect(x, y, 1, s);
    }
  }

  // the court, from its far side line at the players' feet to its near one below the stage
  function court(ctx) {
    const L = G.WALL, R_ = G.W - G.WALL, top = 396, near = COURT_NEAR, lw = 2.5;
    ctx.fillStyle = HALL.court;
    ctx.fillRect(L, top, R_ - L, near - top + 3);
    const sheen = ctx.createLinearGradient(0, top, 0, near);
    sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = sheen;
    ctx.fillRect(L, top, R_ - L, near - top + 3);
    ctx.fillStyle = HALL.line;
    ctx.fillRect(L, 399, R_ - L, lw);                // side lines, far and near
    ctx.fillRect(L, near - lw, R_ - L, lw);
    ctx.fillRect(L, top, lw, near - top);            // back boundary lines, at the walls
    ctx.fillRect(R_ - lw, top, lw, near - top);
    const ls = (0.76 / 13.4) * (R_ - L);             // long service lines for doubles
    ctx.fillRect(L + ls - lw / 2, top, lw, near - top);
    ctx.fillRect(R_ - ls - lw / 2, top, lw, near - top);
    const sl = G.NET_X - G.SERVE_GAP, sr = G.NET_X + G.SERVE_GAP; // short service lines
    ctx.fillRect(sl - lw / 2, top, lw, near - top);
    ctx.fillRect(sr - lw / 2, top, lw, near - top);
    const mid = (399 + near) / 2;                    // centre lines, back to the short service line
    ctx.fillRect(L, mid - lw / 2, sl - L, lw);
    ctx.fillRect(sr, mid - lw / 2, R_ - sr, lw);
  }

  // beyond the court ends on a wide window: a bench at each end, kit, a cooler
  function courtside(ctx, v) {
    const bench = (x) => {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(x + 22, 400, 26, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#272c34';
      ctx.fillRect(x + 4, 385, 3, 15);
      ctx.fillRect(x + 37, 385, 3, 15);
      ctx.fillStyle = '#6a5641';
      rr(ctx, x, 381, 44, 5, 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + 1, 381, 42, 1.2);
      ctx.fillStyle = '#5b7472'; // a folded towel
      rr(ctx, x + 6, 377, 15, 4.5, 1.5);
      ctx.fill();
    };
    const bottle = (x, col) => {
      ctx.fillStyle = col;
      rr(ctx, x - 2.5, 389, 5, 11, 1.5);
      ctx.fill();
      ctx.fillStyle = '#d9dbd6';
      ctx.fillRect(x - 1.5, 387, 3, 2);
    };
    const bag = (x) => {
      ctx.fillStyle = '#2e333c';
      rr(ctx, x, 386, 30, 14, 5);
      ctx.fill();
      ctx.strokeStyle = '#4a5260';
      ctx.lineWidth = 1;
      line(ctx, x + 4, 391, x + 26, 391);
      ctx.strokeStyle = '#3b414b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x + 15, 386, 7, Math.PI, 0);
      ctx.stroke();
    };
    const cooler = (x) => {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(x, 400, 13, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7c4f47';
      rr(ctx, x - 10, 376, 20, 24, 3);
      ctx.fill();
      ctx.fillStyle = '#d6d2c8';
      ctx.fillRect(x - 10, 380, 20, 3);
      ctx.fillStyle = '#9aa1ab';
      ctx.fillRect(x - 2, 386, 4, 3);
    };
    // the left end (mirrored on the right)
    for (const side of [-1, 1]) {
      const at = (d) => (side < 0 ? -d : G.W + d); // d px out from the stage edge
      if (side < 0 ? v.x0 < 0 : v.x1 > G.W) {
        bench(side < 0 ? at(54) : at(10));
        bottle(at(4), '#5f7891');
        bottle(at(9), '#c9cbc6');
      }
      if (side < 0 ? v.x0 < -70 : v.x1 > G.W + 70) bag(side < 0 ? at(104) : at(74));
      if (side < 0 ? v.x0 < -120 : v.x1 > G.W + 120) cooler(at(134));
    }
  }

  // below the court on a tall window: a low barrier, then the front rows of the near stand,
  // seen from behind, bigger and darker the nearer they are
  function nearSide(ctx, v) {
    const vw = v.x1 - v.x0, by = COURT_NEAR + 26;
    ctx.fillStyle = '#1b2028';
    ctx.fillRect(v.x0, by, vw, v.y1 - by);
    ctx.fillStyle = '#2c333e';
    ctx.fillRect(v.x0, by, vw, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    tile(v, 6, 106, (x) => ctx.fillRect(x, by + 7, 94, 12));
    const hair = ['#2a221c', '#3b2f26', '#1d1b1a', '#4a3d33', '#585550', '#33281f'];
    const shirt = ['#2f3a45', '#41383b', '#38423a', '#3d3a46', '#463d33', '#2e3238'];
    let y = by + 50, k = 1, row = 0;
    while (y - 30 * k < v.y1) {
      // the riser and the seat backs of this row
      ctx.fillStyle = row % 2 ? '#191d24' : '#1d222a';
      ctx.fillRect(v.x0, y + 14 * k, vw, v.y1 - y);
      const step = 34 * k;
      tile(v, mod(row * 13, 34) * k, step, (x, i) => {
        const n = mod(i * 7 + row * 5, 11);
        if (n < 3) {
          ctx.fillStyle = '#262c35'; // an empty seat
          rr(ctx, x - 12 * k, y + 2 * k, 24 * k, 16 * k, 4 * k);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(x - 11 * k, y + 2.5 * k, 22 * k, 1.5 * k);
          return;
        }
        ctx.fillStyle = shirt[n % shirt.length];
        ctx.beginPath();
        ctx.ellipse(x, y + 18 * k, 15 * k, 11 * k, 0, Math.PI, 0);
        ctx.lineTo(x + 15 * k, y + 32 * k);
        ctx.lineTo(x - 15 * k, y + 32 * k);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = hair[(n * 5 + row) % hair.length];
        ctx.beginPath();
        ctx.ellipse(x, y + 2 * k, 7.5 * k, 8.5 * k, 0, 0, Math.PI * 2);
        ctx.fill();
        // the court's light catching the top of the head and the shoulders
        ctx.strokeStyle = 'rgba(214,220,226,0.1)';
        ctx.lineWidth = 1.2 * k;
        ctx.beginPath();
        ctx.ellipse(x, y + 2 * k, 6.8 * k, 7.8 * k, 0, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(x, y + 18 * k, 14 * k, 10 * k, 0, Math.PI * 1.1, Math.PI * 1.35);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(x, y + 18 * k, 14 * k, 10 * k, 0, Math.PI * 1.65, Math.PI * 1.9);
        ctx.stroke();
      });
      row++;
      k *= 1.22;
      y += 46 * k;
    }
    const dark = ctx.createLinearGradient(0, by, 0, Math.max(by + 1, v.y1));
    dark.addColorStop(0, 'rgba(8,10,14,0.1)');
    dark.addColorStop(1, 'rgba(8,10,14,0.5)');
    ctx.fillStyle = dark;
    ctx.fillRect(v.x0, by, vw, v.y1 - by);
  }

  // The walls at the court ends. The shuttle bounces off their inner faces (x = WALL and
  // W - WALL): rink-style barriers, a padded board below and glass above in a steel frame, so the
  // hall shows through instead of being walled off. The right one is the left one mirrored.
  function endWalls(ctx) {
    endWall(ctx);
    ctx.save();
    ctx.translate(G.W, 0);
    ctx.scale(-1, 1);
    endWall(ctx);
    ctx.restore();
  }
  function endWall(ctx) {
    const W = G.WALL, top = 116, rail = 326, base = 397;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(W / 2 + 2, 401, W / 2 + 10, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // the glass: tinted, a little hazier low down, with the lights' reflections across it
    ctx.save();
    ctx.beginPath();
    ctx.rect(3, top + 6, W - 3, rail - top - 6);
    ctx.clip();
    const tint = ctx.createLinearGradient(0, top, 0, rail);
    tint.addColorStop(0, 'rgba(150,182,205,0.06)');
    tint.addColorStop(1, 'rgba(150,182,205,0.15)');
    ctx.fillStyle = tint;
    ctx.fillRect(0, top, W, rail - top);
    const led = ctx.createLinearGradient(0, top + 6, 0, top + 22);
    led.addColorStop(0, 'rgba(236,216,176,0.2)');
    led.addColorStop(1, 'rgba(236,216,176,0)');
    ctx.fillStyle = led;
    ctx.fillRect(0, top + 6, W, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.moveTo(3, 236);
    ctx.lineTo(W, 172);
    ctx.lineTo(W, 196);
    ctx.lineTo(3, 260);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.11)';
    ctx.beginPath();
    ctx.moveTo(3, 290);
    ctx.lineTo(W, 240);
    ctx.lineTo(W, 245);
    ctx.lineTo(3, 295);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // its edge, the face the shuttle meets
    ctx.fillStyle = 'rgba(10,14,20,0.3)';
    ctx.fillRect(W - 3, top + 6, 1, rail - top - 6);
    ctx.fillStyle = 'rgba(218,234,244,0.55)';
    ctx.fillRect(W - 2, top + 6, 2, rail - top - 6);
    // the post at the back of the frame, with the clips holding the glass
    ctx.fillStyle = '#20252d';
    ctx.fillRect(-3, top, 7, base - top);
    ctx.fillStyle = '#39414e';
    ctx.fillRect(-1.6, top, 1.2, base - top);
    ctx.fillStyle = '#15191f';
    ctx.fillRect(2.8, top, 1.2, base - top);
    for (const y of [top + 34, 222, rail - 28]) {
      ctx.fillStyle = '#7b8490';
      rr(ctx, 1, y, 7, 6, 1.5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(1.5, y + 0.5, 6, 1);
    }
    // the rail along the top, a light strip under it, and a broadcast camera watching the court
    ctx.fillStyle = '#2a3039';
    rr(ctx, -4, top, W + 5, 6, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(-3, top, W + 3, 1.2);
    ctx.fillStyle = 'rgba(236,216,176,0.75)';
    ctx.fillRect(4, top + 6, W - 6, 1.3);
    ctx.fillStyle = '#1c2026';
    ctx.fillRect(9, top - 4, 3, 4);
    rr(ctx, 3, top - 13, 16, 9, 2);
    ctx.fill();
    ctx.fillStyle = '#2c333d';
    rr(ctx, 19, top - 12, 6, 7, 1.5);
    ctx.fill();
    ctx.fillStyle = '#5e7e96';
    ctx.beginPath();
    ctx.arc(25, top - 8.5, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b8574f';
    ctx.fillRect(5, top - 11, 2, 2);
    // the padded board: a cushion, stitched across, with the hall's badge
    const pad = ctx.createLinearGradient(0, 0, W, 0);
    pad.addColorStop(0, HALL.pad[0]);
    pad.addColorStop(0.55, HALL.pad[1]);
    pad.addColorStop(1, HALL.pad[0]);
    ctx.fillStyle = pad;
    rr(ctx, -1, rail, W + 1, base - rail, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, rail + 3, W - 1, 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([2.5, 2]);
    line(ctx, 2, 366, W - 2, 366);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(198,166,108,0.85)';
    ctx.beginPath();
    ctx.arc(W / 2, 345, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = HALL.pad[0];
    ctx.beginPath();
    ctx.arc(W / 2, 345, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(W / 2, 346);
    ctx.scale(0.62, 0.62);
    drawShuttleShape(ctx);
    ctx.restore();
    ctx.fillStyle = 'rgba(12,16,22,0.35)'; // scuffed kick plate
    ctx.fillRect(-1, base - 9, W + 1, 9);
    // the cap along the top of the board, and the foot
    ctx.fillStyle = '#b4b9c1';
    rr(ctx, -3, rail - 3, W + 4, 5, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-1, rail + 2, W + 1, 1.5);
    ctx.fillStyle = '#1c2027';
    rr(ctx, -4, base, W + 6, 4, 1.5);
    ctx.fill();
  }

  // the edges of a big window fall gently into shadow, keeping the eye on the court
  function vignette(ctx, v) {
    const cx = G.W / 2, cy = 250;
    const far = Math.max(...[[v.x0, v.y0], [v.x1, v.y0], [v.x0, v.y1], [v.x1, v.y1]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
    const g = ctx.createRadialGradient(cx, cy, 360, cx, cy, Math.max(far, 460));
    g.addColorStop(0, 'rgba(6,8,12,0)');
    g.addColorStop(1, 'rgba(6,8,12,0.38)');
    ctx.fillStyle = g;
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
  }
  function background(ctx, scale) {
    const v = G.view, key = [scale, v.x0, v.y0, v.x1, v.y1].join();
    if (!bg || bgScale !== key) {
      bg = buildBackground(scale, v);
      bgScale = key;
    }
    ctx.drawImage(bg, v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
  }
  // fill the whole window (a dimmed menu, a fade) in the current fill style
  function cover(ctx) {
    const v = G.view;
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
  }

  /* ------------------------------------------------------------ net */
  function net(ctx, clip) {
    const f = clip ? clip.cur : 1;
    const wob = f > 1 ? Math.sin(f * 0.9) * (1 - f / 24) * 3.2 : 0;
    const x = G.NET_X;
    // floor shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, 401, 16, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // post
    ctx.fillStyle = '#d9dde3';
    rr(ctx, x - 2.5, 316, 5, 85, 2);
    ctx.fill();
    ctx.fillStyle = '#8a929c';
    ctx.fillRect(x + 0.8, 318, 1.7, 82);
    ctx.fillStyle = '#3a3f47';
    rr(ctx, x - 9, 396, 18, 6, 2);
    ctx.fill();
    // mesh band (seen side-on)
    ctx.save();
    ctx.translate(x, 0);
    ctx.beginPath();
    ctx.moveTo(-7, 323);
    ctx.lineTo(7, 323);
    ctx.quadraticCurveTo(7 + wob, 350, 6 + wob * 0.6, 377);
    ctx.lineTo(-6 + wob * 0.6, 377);
    ctx.quadraticCurveTo(-7 + wob, 350, -7, 323);
    ctx.closePath();
    ctx.fillStyle = 'rgba(20,24,30,0.45)';
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(235,240,245,0.55)';
    ctx.lineWidth = 0.8;
    for (let y = 323; y < 380; y += 4) line(ctx, -9, y, 9 + wob, y + 2);
    for (let i = -9; i < 10; i += 4) line(ctx, i, 323, i + wob, 380);
    ctx.restore();
    // tape
    ctx.fillStyle = '#ffffff';
    rr(ctx, x - 8, 319.5, 16, 4.5, 2);
    ctx.fill();
  }

  /* ------------------------------------------------------------ shuttle */
  function shuttle(ctx, s) {
    const x = s.x + s.ox + G.LAYER_DX, y = s.y + s.oy;
    // floor shadow
    const h = Math.max(0, G.GROUND - y);
    const k = Math.max(0.25, 1 - h / 380);
    ctx.fillStyle = `rgba(0,0,0,${0.28 * k})`;
    ctx.beginPath();
    ctx.ellipse(x, 401, 6 * k, 1.8 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    // a burning shuttle glows
    const heat = s.trail ? s.trail.heat : 0;
    if (heat > 0.02) {
      const r = 10 + 12 * heat;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, heat * 1.2);
      ctx.drawImage(fireSprite('glow'), x - r, y - r, r * 2, r * 2);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((s.rotation * Math.PI) / 180);
    drawShuttleShape(ctx);
    ctx.restore();
  }
  function drawShuttleShape(ctx) {
    // skirt trails behind (+y), cork leads (-y)
    ctx.beginPath();
    ctx.moveTo(-2.4, -2.5);
    ctx.lineTo(2.4, -2.5);
    ctx.lineTo(6, 8);
    ctx.quadraticCurveTo(0, 10, -6, 8);
    ctx.closePath();
    ctx.fillStyle = '#fbfbf7';
    ctx.fill();
    ctx.strokeStyle = '#7d8590';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.lineWidth = 0.6;
    line(ctx, -1.2, -2.5, -3, 8.6);
    line(ctx, 1.2, -2.5, 3, 8.6);
    line(ctx, 0, -2.5, 0, 9);
    ctx.strokeStyle = '#d8a13a';
    ctx.lineWidth = 1.2;
    line(ctx, -3.6, 1.5, 3.6, 1.5);
    ctx.fillStyle = '#f2e3c3';
    ctx.beginPath();
    ctx.arc(0, -3.6, 2.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6b5a3c';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  function trail(ctx, t) {
    const pts = t.pts;
    if (pts.length >= 2) {
      // flat ends: each segment is its own stroke (its own fade), and round ends would overlap
      // at every joint into a row of brighter dots along the line
      ctx.lineCap = 'butt';
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const al = Math.max(0, Math.min(a.a, b.a)) * 0.55;
        if (al <= 0.01) continue;
        const h = Math.min(1, b.h || 0); // hot segments run white -> orange
        ctx.strokeStyle = `rgba(255,${Math.round(255 - 110 * h)},${Math.round(255 - 215 * h)},${al})`;
        ctx.lineWidth = 1 + 3 * al;
        line(ctx, a.x, a.y, b.x, b.y);
      }
    }
    if (t.fire.length) fire(ctx, t.fire);
  }

  // soft round sprites for fire, drawn once and tinted per stage of a particle's life
  const fireSprites = {};
  function fireSprite(kind) {
    if (fireSprites[kind]) return fireSprites[kind];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    const stops = {
      core: ['rgba(255,255,235,1)', 'rgba(255,225,120,0.85)', 'rgba(255,170,40,0)'],
      flame: ['rgba(255,200,80,1)', 'rgba(255,120,20,0.7)', 'rgba(230,60,0,0)'],
      ember: ['rgba(255,110,30,0.9)', 'rgba(200,40,10,0.5)', 'rgba(120,10,0,0)'],
      smoke: ['rgba(70,64,60,0.55)', 'rgba(55,50,48,0.3)', 'rgba(40,38,36,0)'],
      glow: ['rgba(255,230,150,0.9)', 'rgba(255,140,30,0.45)', 'rgba(255,80,0,0)'],
    }[kind];
    grad.addColorStop(0, stops[0]);
    grad.addColorStop(0.45, stops[1]);
    grad.addColorStop(1, stops[2]);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return (fireSprites[kind] = c);
  }
  function fire(ctx, parts) {
    ctx.save();
    // smoke first, normal blending
    for (const p of parts) {
      if (!p.smoke) continue;
      const f = p.age / p.life;
      const r = p.size * (1.2 + f * 1.6);
      ctx.globalAlpha = (1 - f) * 0.7;
      ctx.drawImage(fireSprite('smoke'), p.x - r, p.y - r, r * 2, r * 2);
    }
    // flames add light: white-yellow when fresh, orange, then dying red embers
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      if (p.smoke) continue;
      const f = p.age / p.life;
      const r = p.size * (1 - f * 0.55);
      ctx.globalAlpha = Math.max(0, 1 - f * f) * (f < 0.12 ? 0.8 : 1);
      ctx.drawImage(fireSprite(f < 0.12 ? 'core' : f < 0.5 ? 'flame' : 'ember'), p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ player figure */
  // Body proportions per rig (player-local px, facing right, feet at y=0)
  const BODY = {
    std: { hip: [0, -27], neck: [3, -53], head: [5, -63.5], r: 8.5, sh: [5, -50], leg: 14.5 },
    small: { hip: [0, -13], neck: [2, -35], head: [4, -45], r: 8.5, sh: [4, -33], leg: 7.5 },
    hover: { hip: [-1, -27], neck: [1, -54], head: [3, -64.5], r: 8.5, sh: [2, -51], leg: 9 },
    jet: { hip: [-2, 23], neck: [0, -3], head: [2, -13.5], r: 8.5, sh: [1, -1], leg: 12 },
  };
  BODY.std1 = BODY.std;
  BODY.jet2 = BODY.jet;
  // head centre above the feet, as figure() places it (flyers are lifted 48 px)
  const headHeight = (id) => -BODY[CHARS[id].rig].head[1] + (CHARS[id].kind === 'jet' ? 48 : 0);

  function legs(ctx, p, B, t) {
    const [hx, hy] = B.hip;
    const L = B.leg;
    const scale = L / 14.5;
    let f1, f2;
    if (p.kind === 'jet') {
      const sw = Math.sin(t * 3) * 3;
      f1 = [hx - 4 + sw, hy + 23];
      f2 = [hx + 4 + sw * 0.7, hy + 22];
    } else if (p.kind === 'hover') {
      f1 = [hx + 12, hy + 4];
      f2 = [hx + 9, hy + 7];
    } else if (p.state === 'jump') {
      f1 = [hx - 9 * scale, hy + 21 * scale];
      f2 = [hx + 6 * scale, hy + 23 * scale];
    } else if (p.state === 'forward' || p.state === 'backward') {
      // the planted foot slides back under the hip and the lifted one swings ahead (local +x = facing)
      const ph = t * 15 * (p.state === 'forward' ? -1 : 1);
      f1 = [hx + Math.sin(ph) * 10 * scale, -Math.max(0, -Math.cos(ph)) * 6 * scale];
      f2 = [hx - Math.sin(ph) * 10 * scale, -Math.max(0, Math.cos(ph)) * 6 * scale];
    } else {
      const br = Math.sin(t * 2.2) * 0.6;
      f1 = [hx - 8 * scale, 0];
      f2 = [hx + 9 * scale, 0];
      void br;
    }
    const bend = p.kind === 'hover' ? 1 : -1;
    for (const f of [f1, f2]) {
      const [kx, ky, fx, fy] = joint(hx, hy, f[0], f[1], L, L, bend);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(kx, ky);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      if (p.id === 'pogo' && p.kind === 'walk') {
        // springs
        ctx.save();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#7f8c8d';
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        for (let i = 1; i <= 4; i++) ctx.lineTo(fx + (i % 2 ? 3 : -3), fy + i * 1.6);
        ctx.stroke();
        ctx.restore();
      }
      if (p.id === 'rae') {
        ctx.save();
        ctx.fillStyle = '#555c66';
        rr(ctx, fx - 4, fy - 2, 8, 6, 2);
        ctx.fill();
        flame(ctx, fx, fy + 4, 1, t);
        ctx.restore();
      }
    }
  }

  function flame(ctx, x, y, s, t) {
    const fl = 7 + Math.sin(t * 40) * 2 + Math.random() * 2;
    const g = ctx.createLinearGradient(x, y, x, y + fl * s);
    g.addColorStop(0, 'rgba(255,240,150,0.95)');
    g.addColorStop(0.5, 'rgba(255,140,40,0.8)');
    g.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 3 * s, y);
    ctx.quadraticCurveTo(x, y + fl * 1.6 * s, x + 3 * s, y);
    ctx.closePath();
    ctx.fill();
  }

  function racket(ctx, p, color) {
    const clip = p.clips[p.shown];
    const f = clip.data.f[clip.cur - 1];
    const gx = f[5], gy = f[6], cx = f[7], cy = f[8];
    const dx = cx - gx, dy = cy - gy;
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    // head seen mostly edge-on: a narrow oval rather than the full face
    const a = len * 0.36, b = len * 0.11;
    const nx = cx - ux * a, ny = cy - uy * a;
    // shaft
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3d3d46';
    line(ctx, gx, gy, nx, ny);
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = '#222';
    line(ctx, gx, gy, gx + ux * 7, gy + uy * 7);
    // head
    const ang = Math.atan2(uy, ux);
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(240,240,240,0.7)';
    ctx.lineWidth = 0.6;
    for (let i = -a; i <= a; i += 3.2) line(ctx, i, -b, i, b);
    for (let i = -b + b / 3; i < b; i += b / 3) line(ctx, -a, i, a, i);
    ctx.restore();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return [gx, gy];
  }

  function head(ctx, p, B, ink) {
    const [x, y] = B.head;
    const r = B.r;
    const def = p.def;
    if (p.id === 'cubey') {
      rr(ctx, x - r, y - r, r * 2, r * 2, 2.5);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = def.glow ? 'rgba(200,247,255,0.15)' : '#fffdf8';
    ctx.fill();
    ctx.stroke();
    // eye (faces the opponent)
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(x + r * 0.45, y - r * 0.12, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.lineWidth = 1.6;
    switch (p.id) {
      case 'pip':
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.arc(x, y - 1, r + 0.6, Math.PI * 1.02, Math.PI * 1.98);
        ctx.closePath();
        ctx.fill();
        rr(ctx, x - r - 7, y - 4, 9, 3, 1.5);
        ctx.fill();
        break;
      case 'zara': {
        ctx.fillStyle = def.color;
        ctx.fillRect(x - r, y - 5, r * 2, 2.8);
        const sw = Math.sin(p.anim * 9) * 2;
        ctx.beginPath();
        ctx.moveTo(x - r + 1, y - 6);
        ctx.quadraticCurveTo(x - r - 9, y - 4 + sw, x - r - 7, y + 9 + sw);
        ctx.quadraticCurveTo(x - r - 2, y + 2, x - r + 2, y - 2);
        ctx.fillStyle = '#6b2a1a';
        ctx.fill();
        break;
      }
      case 'jo':
        ctx.fillStyle = '#ffd166';
        ctx.strokeStyle = ink;
        ctx.beginPath();
        ctx.ellipse(x + 3, y - 4.5, 3.4, 2.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(x - 3, y - 4.5, 3.4, 2.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      case 'boris':
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(x + 1, y + 3);
        ctx.quadraticCurveTo(x + 5, y + 1.5, x + 9, y + 4);
        ctx.stroke();
        ctx.fillStyle = def.color;
        ctx.fillRect(x - r, y - 6, r * 2, 2.6);
        break;
      case 'pogo':
        ctx.fillStyle = def.color;
        for (let i = 0; i < 5; i++) {
          const a0 = Math.PI * (1.1 + i * 0.2);
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
          ctx.lineTo(x + Math.cos(a0 + 0.1) * (r + 6), y + Math.sin(a0 + 0.1) * (r + 6));
          ctx.lineTo(x + Math.cos(a0 + 0.22) * r, y + Math.sin(a0 + 0.22) * r);
          ctx.fill();
        }
        break;
      case 'hank':
        ctx.fillStyle = '#7a4a24';
        ctx.beginPath();
        ctx.moveTo(x - 2, y + 2);
        ctx.quadraticCurveTo(x + 4, y + 13, x + r + 1, y + 2);
        ctx.quadraticCurveTo(x + 4, y + 6, x - 2, y + 2);
        ctx.fill();
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.arc(x, y - 1.5, r + 0.8, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#e9edf0';
        ctx.fillRect(x - r - 0.8, y - 2.5, (r + 0.8) * 2, 2.5);
        ctx.beginPath();
        ctx.arc(x, y - r - 3, 2.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'stan':
        ctx.fillStyle = def.color;
        ctx.fillRect(x - r, y - 5.5, r * 2, 2.6);
        break;
      case 'rae':
        ctx.fillStyle = def.color;
        ctx.strokeStyle = ink;
        ctx.beginPath();
        ctx.arc(x, y, r + 1.5, Math.PI * 0.9, Math.PI * 2.1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(120,200,255,0.75)';
        ctx.beginPath();
        ctx.ellipse(x + 4, y - 0.5, 4.5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'turbo':
        ctx.fillStyle = INK;
        rr(ctx, x - 1, y - 3.5, r + 1.5, 3.4, 1.4);
        ctx.fill();
        break;
      case 'nimbus':
        ctx.fillStyle = '#5f6b7a';
        ctx.beginPath();
        ctx.moveTo(x - r, y - 3);
        ctx.quadraticCurveTo(x, y - r - 12, x + r * 0.6, y - r + 1);
        ctx.fill();
        break;
      default:
        break;
    }
    ctx.restore();
  }

  function player(ctx, p) {
    const def = p.def;
    const B = BODY[def.rig];
    const t = p.anim;
    const ink = def.glow ? '#c8f7ff' : INK;
    // floor shadow
    const h = Math.max(0, G.GROUND - p.y);
    const k = Math.max(0.2, 1 - h / 260);
    ctx.fillStyle = `rgba(0,0,0,${0.22 * k})`;
    ctx.beginPath();
    ctx.ellipse(p.x + G.LAYER_DX, 401, 18 * k, 3 * k, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(p.x + G.LAYER_DX, p.y);
    ctx.scale(p.scaleX, p.scaleY);
    if (def.glow) {
      ctx.shadowColor = 'rgba(120,230,255,0.95)';
      ctx.shadowBlur = 10;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ink;
    ctx.lineWidth = p.id === 'boris' ? 4.2 : 3.2;

    // back-mounted gear
    if (p.id === 'jo') {
      ctx.save();
      ctx.fillStyle = '#7d8793';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      rr(ctx, -15, -4, 10, 22, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = def.color;
      ctx.fillRect(-15, 3, 10, 3);
      flame(ctx, -10, 19, 1.2, t);
      ctx.restore();
    }
    if (p.id === 'turbo') {
      const sw = Math.sin(t * 12) * 2.5;
      ctx.save();
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.moveTo(B.neck[0] - 1, B.neck[1] - 2);
      ctx.quadraticCurveTo(B.neck[0] - 14, B.neck[1] + sw, B.neck[0] - 24, B.neck[1] + 4 - sw);
      ctx.lineTo(B.neck[0] - 20, B.neck[1] + 7 - sw);
      ctx.quadraticCurveTo(B.neck[0] - 12, B.neck[1] + 4 + sw, B.neck[0] + 1, B.neck[1] + 2);
      ctx.fill();
      ctx.restore();
    }

    legs(ctx, p, B, t);

    // cloud seat drawn over the folded legs
    if (p.kind === 'hover') {
      ctx.save();
      ctx.shadowBlur = 0;
      const cy = -16;
      ctx.fillStyle = '#eef2f7';
      ctx.strokeStyle = '#9aa5b4';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(-14, cy + 2, 8, Math.PI * 0.5, Math.PI * 1.5);
      ctx.arc(-5, cy - 5, 9, Math.PI, Math.PI * 1.9);
      ctx.arc(8, cy - 4, 9, Math.PI * 1.1, Math.PI * 2);
      ctx.arc(16, cy + 2, 7, Math.PI * 1.5, Math.PI * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // torso + shirt
    const [hx, hy] = B.hip, [nx, ny] = B.neck;
    if (!def.glow) {
      ctx.save();
      ctx.fillStyle = def.color;
      ctx.globalAlpha *= 0.9;
      const w = p.id === 'boris' ? 6.5 : 4.6;
      ctx.beginPath();
      ctx.moveTo(nx - w, ny + 2);
      ctx.lineTo(nx + w, ny + 2);
      ctx.lineTo(hx + w * 0.75, hy - 2);
      ctx.lineTo(hx - w * 0.75, hy - 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    line(ctx, hx, hy, nx, ny);

    // free arm
    const [sx, sy] = B.sh;
    const sw = Math.sin(t * (p.state === 'normal' ? 2 : 15)) * (p.state === 'normal' ? 1 : 5);
    const free = joint(sx - 2, sy, sx - 9 + sw, sy + 17, 9.5, 9.5, 1);
    ctx.beginPath();
    ctx.moveTo(sx - 2, sy);
    ctx.lineTo(free[0], free[1]);
    ctx.lineTo(free[2], free[3]);
    ctx.stroke();

    // shuttle held before the serve leaves the hand
    if (p.serving && p.kind === 'walk' && p.clips.serve.cur <= 5) {
      ctx.save();
      ctx.translate(sx + 18, sy + 12);
      ctx.rotate(Math.PI);
      drawShuttleShape(ctx);
      ctx.restore();
    }
    if (p.serving && p.kind === 'jet') {
      ctx.save();
      ctx.translate(sx + 16, sy + 22);
      ctx.rotate(Math.PI * 0.9);
      drawShuttleShape(ctx);
      ctx.restore();
    }

    // racket arm
    const [gx, gy] = racket(ctx, p, def.glow ? '#9ff3ff' : def.color);
    const arm = joint(sx, sy, gx, gy, 10, 10, 1);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(arm[0], arm[1]);
    ctx.lineTo(arm[2], arm[3]);
    ctx.stroke();
    if (p.id === 'stan' || p.id === 'boris') {
      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = def.color;
      line(ctx, gx - (gx - arm[0]) * 0.25, gy - (gy - arm[1]) * 0.25, gx - (gx - arm[0]) * 0.45, gy - (gy - arm[1]) * 0.45);
      ctx.restore();
    }
    // head last: the ready-position grip sits at neck height, so the face must cover the arm
    head(ctx, p, B, ink);
    ctx.restore();
  }

  /* ------------------------------------------------------------ effects */
  function effects(ctx, fx, layer) {
    for (const o of fx.list) {
      if (o.type === 'debris' && layer === 'back') {
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate((o.rot * Math.PI) / 180);
        if (o.look === 'flame') {
          ctx.fillStyle = `rgba(255,${120 + Math.floor(o.scale * 120)},40,${0.85 * o.scale})`;
          ctx.fillRect(-3 * o.scale, -3 * o.scale, 6 * o.scale, 6 * o.scale);
        } else {
          ctx.fillStyle = `rgba(235,240,247,${0.9 * o.scale})`;
          ctx.beginPath();
          ctx.arc(0, 0, 4.5 * o.scale, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (o.type === 'confetti' && layer === 'front') {
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate(o.spin);
        ctx.scale(1, Math.cos(o.spin * 1.7));
        ctx.fillStyle = `hsl(${o.hue},85%,60%)`;
        ctx.fillRect(-4, -2.5, 8, 5);
        ctx.restore();
      } else if (o.type === 'spark' && layer === 'front') {
        const pr = o.clip.cur / 22;
        const len = 70 * o.scale;
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate(((o.dir - 90) * Math.PI) / 180);
        ctx.lineCap = 'round';
        ctx.strokeStyle = `rgba(255,250,220,${(1 - pr) * 0.95})`;
        ctx.lineWidth = 2.2 * (1 - pr) + 0.5;
        for (let i = -2; i <= 2; i++) {
          const a = i * 0.32;
          const r0 = len * (0.15 + pr * 0.9), r1 = r0 + len * 0.5 * (1 - pr);
          line(ctx, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1);
        }
        ctx.fillStyle = `rgba(255,255,255,${(1 - pr) * 0.5})`;
        ctx.beginPath();
        ctx.arc(0, 0, len * 0.25 * (1 - pr) + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function banner(ctx, fx) {
    for (const o of fx.list) {
      if (o.type !== 'banner') continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha));
      ctx.fillStyle = 'rgba(12,16,32,0.82)';
      rr(ctx, 150, 150, 340, 110, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,209,102,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
      text(ctx, o.title, 320, 180, 30, '#ffd166', 'center', 'bold');
      text(ctx, o.n1, 230, 228, 17, '#ffffff');
      text(ctx, 'vs', 320, 228, 15, '#9fb3d1');
      text(ctx, o.n2, 410, 228, 17, '#ffffff');
      ctx.restore();
    }
  }

  function bubble(ctx, m) {
    const b = m.bubble;
    if (!b || G.clock > b.until || b.who !== m.p2) return;
    const p = b.who;
    const lift = p.def.rig === 'small' ? -47 : p.def.rig === 'hover' ? -65 : -70;
    // bubble anchor sits 20 local px behind the opponent's facing direction
    const x = p.x - 20 * Math.abs(p.scaleX) + G.LAYER_DX;
    const y = p.y + lift * p.scaleY;
    ctx.save();
    ctx.font = `bold 12px ${FONT}`;
    const w = Math.min(170, ctx.measureText(b.text).width + 20);
    const bx = Math.max(4, Math.min(G.W - w - 4, x - w + 10));
    const by = y - 40;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    rr(ctx, bx, by, w, 28, 10);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 6, by + 27);
    ctx.lineTo(x + 2, by + 38);
    ctx.lineTo(x + 6, by + 27);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(x - 5, by + 25, 10, 3);
    text(ctx, b.text, bx + w / 2, by + 14, 12, INK);
    ctx.restore();
  }

  function hud(ctx, m) {
    const label = m.title();
    ctx.save();
    ctx.fillStyle = 'rgba(10,14,28,0.72)';
    rr(ctx, 248, 8, 144, 40, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    text(ctx, m.status, 320, 25, m.over ? 20 : 24, m.over ? '#ffd166' : '#ffffff');
    text(ctx, label, 320, 42, 9, '#9fb3d1', 'center', 'bold');
    text(ctx, CHARS[m.p1Id].name, 238, 28, 12, 'rgba(255,255,255,0.75)', 'right', 'bold', 'rgba(0,0,0,0.5)', 3);
    text(ctx, m.p2Id ? CHARS[m.p2Id].name : '', 402, 28, 12, 'rgba(255,255,255,0.75)', 'left', 'bold', 'rgba(0,0,0,0.5)', 3);
    ctx.restore();
  }

  /* ------------------------------------------------------------ training */
  // the shot machine: a tripod launcher with a shuttle magazine and a barrel that swings to aim
  function machine(ctx, mc) {
    const { x, y } = MACHINE;
    const hub = 318;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, 401, 36, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#5a616b';
    ctx.lineWidth = 2.4;
    line(ctx, x, hub, x + 8, 397);
    ctx.strokeStyle = '#3a3f47';
    ctx.lineWidth = 3.2;
    line(ctx, x, hub, x - 31, 399);
    line(ctx, x, hub, x + 31, 399);
    ctx.fillStyle = '#2a2e35';
    for (const fx of [x - 31, x + 31]) { rr(ctx, fx - 5, 397, 10, 4, 2); ctx.fill(); }
    // mast
    ctx.fillStyle = '#c9ced6';
    rr(ctx, x - 3, y + 8, 6, hub - y - 4, 2);
    ctx.fill();
    ctx.fillStyle = '#8a929c';
    ctx.fillRect(x + 1, y + 10, 1.6, hub - y - 8);
    ctx.fillStyle = '#3a3f47';
    rr(ctx, x - 6, hub - 6, 12, 10, 3);
    ctx.fill();
    // magazine of shuttles standing on the head
    const mx = x + 5;
    ctx.fillStyle = 'rgba(200,225,255,0.16)';
    rr(ctx, mx - 7, y - 76, 14, 66, 5);
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.translate(mx, y - 21 - i * 9);
      ctx.rotate(Math.PI);
      ctx.scale(0.8, 0.8);
      drawShuttleShape(ctx);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(220,235,255,0.55)';
    ctx.lineWidth = 1.2;
    rr(ctx, mx - 7, y - 76, 14, 66, 5);
    ctx.stroke();
    ctx.fillStyle = '#3a3f47';
    rr(ctx, mx - 8.5, y - 80, 17, 6, 2);
    ctx.fill();
    // barrel (pivots in the head, kicks back when it fires)
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((mc.aim * Math.PI) / 180);
    const kick = mc.recoil * mc.recoil * 6;
    const L = MACHINE.barrel;
    ctx.fillStyle = '#c9ced6';
    rr(ctx, -4.5, -L + kick, 9, L - 2, 3);
    ctx.fill();
    ctx.fillStyle = '#8a929c';
    ctx.fillRect(1.5, -L + 3 + kick, 2, L - 8);
    ctx.fillStyle = '#ff8c42';
    rr(ctx, -5.5, -L - 1 + kick, 11, 4.5, 2);
    ctx.fill();
    if (mc.recoil > 0.4) {
      ctx.fillStyle = `rgba(255,255,255,${(mc.recoil - 0.4) * 1.2})`;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc((i - 1) * 5, -L - 6 - i * 3 * (1 - mc.recoil), 3 + (1 - mc.recoil) * 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    // head housing with the spinning feed wheel
    ctx.fillStyle = '#2f3b52';
    rr(ctx, x - 19, y - 13, 40, 26, 8);
    ctx.fill();
    ctx.fillStyle = '#ff8c42';
    rr(ctx, x - 19, y + 4, 40, 4, 2);
    ctx.fill();
    ctx.fillStyle = '#1b2233';
    ctx.beginPath();
    ctx.arc(x + 7, y - 3, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8fa3c0';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      const a = mc.spin + (i * Math.PI * 2) / 3;
      line(ctx, x + 7, y - 3, x + 7 + Math.cos(a) * 5.5, y - 3 + Math.sin(a) * 5.5);
    }
    // status light: amber while aiming, green while the shot is out
    const aiming = !!mc.next;
    ctx.fillStyle = aiming ? (Math.sin(G.clock / 60) > 0 ? '#ffb142' : '#7a5410') : '#2ed573';
    ctx.beginPath();
    ctx.arc(x - 11, y - 4, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // shuttles the machine has already fired, lying where they came down
  function spent(ctx, list) {
    for (const sp of list) {
      ctx.save();
      ctx.globalAlpha *= 0.85;
      ctx.translate(sp.x + G.LAYER_DX, 396);
      ctx.rotate((sp.r * Math.PI) / 180);
      drawShuttleShape(ctx);
      ctx.restore();
    }
  }

  // T in training: where the shuttle is heading and where it will land, from the same
  // prediction the computer opponent and the debug overlay use
  function flightPath(ctx, m) {
    const s = m.shuttle;
    if (!m.machine.showTrail || G.debug || !s || !m.rallyLive) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    const end = Shuttle.predictLanding(s.x, s.y, s.dx, s.dy, (x, y) => ctx.lineTo(x, y));
    ctx.setLineDash([5, 4]);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(end, G.GROUND, 9, 2.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.ellipse(end, G.GROUND, 3, 1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function pops(ctx, mc) {
    for (const p of mc.pops) {
      const u = p.age / 1.2;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - u * u);
      text(ctx, p.text, p.x, 372 - u * 40, 15, p.color, 'center', '900', 'rgba(0,0,0,0.55)', 4);
      ctx.restore();
    }
  }

  function trainingHud(ctx, m) {
    const mc = m.machine;
    ctx.save();
    ctx.fillStyle = 'rgba(10,14,28,0.72)';
    rr(ctx, 236, 8, 168, 40, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    text(ctx, m.status, 320, 25, 24, '#ffffff');
    text(ctx, `streak ${mc.streak}   ·   best ${mc.best}`, 320, 42, 9, '#9fb3d1', 'center', 'bold');
    text(ctx, CHARS[m.p1Id].name, 226, 28, 12, 'rgba(255,255,255,0.75)', 'right', 'bold', 'rgba(0,0,0,0.5)', 3);
    text(ctx, 'Shot Machine', 414, 28, 12, 'rgba(255,255,255,0.75)', 'left', 'bold', 'rgba(0,0,0,0.5)', 3);
    text(ctx, `T  trail ${mc.showTrail ? 'on' : 'off'}     P  pause     Esc  menu`, 320, 415, 10, 'rgba(255,255,255,0.7)', 'center', 'bold', 'rgba(0,0,0,0.5)', 3);
    ctx.restore();
  }

  // Puts the players and the shuttle where they were between their last two frames, as far on as
  // the screen is into the next one (G.alpha), with the shuttle's trail ending on it. Returns what
  // to put back once they're drawn. Something that jumped (a new rally) isn't slid across.
  function between(m) {
    const a = G.alpha, undo = [];
    if (!(a < 1)) return undo;
    const s = m.shuttle;
    const head = s && !s.hidden ? s.x + (s.ox || 0) + G.LAYER_DX : null;
    for (const o of [m.p1, m.p2, s]) {
      if (!o || o.drawnAt !== G.frame) continue;
      const ox = o.ox || 0, oy = o.oy || 0, x = o.x + ox, y = o.y + oy;
      if (Math.abs(x - o.drawnX) + Math.abs(y - o.drawnY) > 90) continue;
      undo.push([o, o.x, o.y]);
      o.x = o.drawnX + (x - o.drawnX) * a - ox;
      o.y = o.drawnY + (y - o.drawnY) * a - oy;
    }
    if (head !== null && undo.length && undo[undo.length - 1][0] === s) {
      for (const t of m.fx.trails) {
        const p = t.attached === s && t.pts[t.pts.length - 1];
        if (!p || Math.abs(p.x - head) > 0.01) continue;
        undo.push([p, p.x, p.y]);
        p.x = s.x + (s.ox || 0) + G.LAYER_DX;
        p.y = s.y + (s.oy || 0);
      }
    }
    return undo;
  }

  function scene(ctx, m, scale) {
    const undo = between(m);
    try {
      drawScene(ctx, m, scale);
    } finally {
      for (const [o, x, y] of undo) {
        o.x = x;
        o.y = y;
      }
    }
  }
  function drawScene(ctx, m, scale) {
    background(ctx, scale);
    effects(ctx, m.fx, 'back');
    net(ctx, m.net);
    if (m.machine) {
      spent(ctx, m.machine.spent);
      machine(ctx, m.machine);
    }
    if (m.p1) player(ctx, m.p1);
    if (m.p2) player(ctx, m.p2);
    if (m.machine) flightPath(ctx, m);
    for (const t of m.fx.trails) trail(ctx, t);
    if (m.shuttle && !m.shuttle.hidden) shuttle(ctx, m.shuttle);
    bubble(ctx, m);
    effects(ctx, m.fx, 'front');
    if (m.machine) {
      pops(ctx, m.machine);
      trainingHud(ctx, m);
    } else if (m.mode !== 'demo') hud(ctx, m);
    banner(ctx, m.fx);
    if (G.debug) debug(ctx, m);
  }

  /* ------------------------------------------------------------ debug overlay (` key) */
  // Everything is drawn in the same coordinates the hit tests use, so what you see is what collides.
  const DBG = {
    size: 6, lh: 7,  // text size and panel line height (stage px)
    racket: '#39ff6a', reach: '#3fa9ff', cpu: '#ff9f1a', netBody: '#ff4d4d', netTop: '#ffe14d',
    bounds: '#ff4dd8', serve: '#4dfcff', path: '#ffffff', land: '#ff4d4d',
  };
  DBG.font = `${DBG.size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  function dbgText(ctx, str, x, y, color, align = 'left') {
    ctx.font = DBG.font;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
  function dbgBox(ctx, b, color, fillAlpha, dashed) {
    ctx.save();
    if (fillAlpha) {
      ctx.globalAlpha = fillAlpha;
      ctx.fillStyle = color;
      ctx.fillRect(b.l, b.t, b.r - b.l, b.b - b.t);
      ctx.globalAlpha = 1;
    }
    if (dashed) ctx.setLineDash([3, 2]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(b.l, b.t, b.r - b.l, b.b - b.t);
    ctx.restore();
  }
  // a player-local hit polygon (as used by Player.polyHit) in stage space
  function dbgPoly(ctx, p, polys, shift, color) {
    const ax = p.x + G.LAYER_DX;
    ctx.save();
    ctx.beginPath();
    for (const poly of polys) {
      poly.forEach(([lx, ly], i) => {
        const x = ax + p.scaleX * lx, y = p.y + p.scaleY * (ly + shift);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
    }
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = color;
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  function dbgVLine(ctx, x, y0, y1, color, dashed) {
    ctx.save();
    if (dashed) ctx.setLineDash([4, 3]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    line(ctx, x, y0, x, y1);
    ctx.restore();
  }
  function dbgCross(ctx, x, y, color, r = 4) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    line(ctx, x - r, y, x + r, y);
    line(ctx, x, y - r, x, y + r);
    ctx.restore();
  }

  function dbgWorld(ctx) {
    const L = G.WALL, Rt = G.W - G.WALL;
    ctx.save();
    ctx.strokeStyle = DBG.bounds;
    ctx.lineWidth = 1;
    line(ctx, L, G.GROUND, Rt, G.GROUND);
    ctx.restore();
    dbgVLine(ctx, L, 0, G.GROUND, DBG.bounds);
    dbgVLine(ctx, Rt, 0, G.GROUND, DBG.bounds);
    // player limits: walls (+15), net gap, service line
    for (const x of [L + 15, Rt - 15, G.NET_X - G.NET_GAP, G.NET_X + G.NET_GAP]) dbgVLine(ctx, x, 360, G.GROUND, 'rgba(255,255,255,0.35)', true);
    for (const x of [G.NET_X - G.SERVE_GAP - 20, G.NET_X + G.SERVE_GAP + 20]) {
      dbgVLine(ctx, x, 350, G.GROUND, DBG.serve, true);
      dbgText(ctx, 'serve', x, 346, DBG.serve, 'center');
    }
    // which side a landing scores on
    dbgVLine(ctx, G.NET_X, 0, G.GROUND, 'rgba(255,255,255,0.5)', true);
    dbgText(ctx, 'point split', G.NET_X + 3, 406, 'rgba(255,255,255,0.8)');
    dbgBox(ctx, G.NET_BODY, DBG.netBody, 0.22);
    dbgBox(ctx, G.NET_TOP, DBG.netTop, 0.45);
  }

  function dbgPlayer(ctx, m, p) {
    const ax = p.x + G.LAYER_DX;
    // reach test that turns a swing into an underhand (with the airborne +20 shift swing() applies)
    if (p.rig.underHit) {
      const shift = p.underShift + (p.inAir && p.dy > -100 ? 20 : 0);
      dbgPoly(ctx, p, p.rig.underHit, shift, DBG.reach);
    }
    // computer's planned contact: where the shuttle will be when its racket meets it
    const plan = p.brain && p.brain.plan;
    if (plan && plan.mark && !plan.swung) dbgCross(ctx, plan.mark.x, plan.mark.y, DBG.cpu, 6);
    // racket box for the current swing frame: filled while it can still hit
    const b = p.racketBox();
    dbgBox(ctx, b, DBG.racket, p.hitLive ? 0.35 : 0, !p.hitLive);
    const c = p.active;
    const f = p.frame();
    dbgText(ctx, `${c.name} ${c.cur}/${c.total} ${Math.round(f[0])}°${p.hitLive ? ' LIVE' : ''}`, (b.l + b.r) / 2, b.t - 4, DBG.racket, 'center');
    dbgCross(ctx, ax, p.y, '#ffffff', 5);
    // computer's movement target
    if (p.cpu && p.dbgTarget != null && isFinite(p.dbgTarget)) {
      dbgVLine(ctx, p.dbgTarget, 372, G.GROUND + 4, DBG.cpu);
      dbgText(ctx, 'target', p.dbgTarget, 409, DBG.cpu, 'center');
    }
  }

  function dbgShuttle(ctx, s) {
    // predicted flight from the current state (same stepping the computer uses)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    const end = Shuttle.predictLanding(s.x, s.y, s.dx, s.dy, (x, y) => ctx.lineTo(x, y));
    ctx.setLineDash([5, 4]);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = DBG.path;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.restore();
    dbgCross(ctx, end, G.GROUND, DBG.path, 3);
    // landX: what the computer is acting on (computed at the last hit)
    if (s.landX) {
      ctx.save();
      ctx.fillStyle = DBG.land;
      ctx.beginPath();
      ctx.moveTo(s.landX, G.GROUND - 1);
      ctx.lineTo(s.landX - 5, G.GROUND - 10);
      ctx.lineTo(s.landX + 5, G.GROUND - 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      dbgText(ctx, 'landX', s.landX, G.GROUND - 14, DBG.land, 'center');
    }
    // velocity (0.1 s of travel)
    ctx.save();
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 1.5;
    line(ctx, s.x, s.y, s.x + s.dx * 0.1, s.y + s.dy * 0.1);
    ctx.restore();
    dbgCross(ctx, s.x, s.y, '#ff4dd8', 4);
  }

  // a line is [text, colour] or a list of such segments drawn side by side
  function dbgPanel(ctx, x, y, lines, align) {
    ctx.font = DBG.font;
    const segs = lines.map((l) => (Array.isArray(l[0]) ? l : [l]));
    const w = Math.max(...segs.map((l) => l.reduce((a, [str]) => a + ctx.measureText(str).width, 0))) + 6;
    const h = lines.length * DBG.lh + 4;
    const bx = align === 'right' ? x - w : x;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, y, w, h);
    ctx.restore();
    segs.forEach((l, i) => {
      let cx = bx + 3;
      for (const [str, color] of l) {
        dbgText(ctx, str, cx, y + 2 + DBG.lh / 2 + i * DBG.lh, color || '#e6edf7');
        cx += ctx.measureText(str).width;
      }
    });
  }

  function dbgPlayerLines(m, p, label) {
    const n = (v, d = 1) => v.toFixed(d);
    const out = [
      [`${label} ${p.def.name}${p.cpu ? ' (CPU)' : ''}  ${p.kind}`, '#ffffff'],
      [`  x ${n(p.x, 2)}  y ${n(p.y, 2)}  dx ${n(p.dx, 0)}  dy ${n(p.dy, 0)}`],
      [`  ${p.inAir ? 'air' : 'ground'}  ${p.state}  ${p.serving ? 'serving  ' : ''}${p.swinging ? 'swinging  ' : ''}power ${n(p.power, 2)}`],
      [`  spd ${n(p.speedMul, 2)}  jmp ${n(p.jumpMul, 2)}  pow ${n(p.powerMul, 2)}`],
    ];
    if (p.brain) out.push([`  ${p.brain.describe()}`, DBG.cpu]);
    return out;
  }

  function debug(ctx, m) {
    ctx.save();
    dbgWorld(ctx);
    if (m.p1) dbgPlayer(ctx, m, m.p1);
    if (m.p2) dbgPlayer(ctx, m, m.p2);
    if (m.shuttle) dbgShuttle(ctx, m.shuttle);

    const s = m.shuttle;
    const who = (p) => (p === m.p1 ? 'P1' : p === m.p2 ? 'P2' : p && p === m.machine ? 'machine' : '-');
    const left = [
      ['DEBUG  ` to hide', '#39ff6a'],
      [['■ racket ', DBG.racket], ['■ reach ', DBG.reach], ['+ cpu contact ', DBG.cpu], ['■ net ', DBG.netBody], ['■ tape', DBG.netTop]],
      [`fps ${G.fps || 0}  clock ${G.clock}  dt ${Math.round(G.dt * 1000)}ms${G.paused ? '  PAUSED' : ''}`],
      [`updates ${G.updates.length}  timers ${G.timers.length}  fx ${m.fx.list.length}`],
      [`rally ${m.rallyLive ? 'live' : 'dead'}  server P${m.server}  last hit ${who(m.lastHitter)}`],
    ];
    if (s) {
      left.push([`shuttle x ${s.x.toFixed(2)}  y ${s.y.toFixed(2)}`, '#ffe14d']);
      left.push([`  dx ${s.dx.toFixed(1)}  dy ${s.dy.toFixed(1)}  v ${s.speed.toFixed(0)}  dir ${s.dir.toFixed(1)}°`, '#ffe14d']);
      left.push([`  landX ${s.landX.toFixed(1)}  heat ${(s.trail ? s.trail.heat : 0).toFixed(2)}`, '#ffe14d']);
    } else {
      left.push(['shuttle -', '#ffe14d']);
    }
    // panels start below the score box so the HUD stays readable
    dbgPanel(ctx, 4, 54, left);
    if (m.p1) dbgPanel(ctx, 4, 54 + left.length * DBG.lh + 8, dbgPlayerLines(m, m.p1, 'P1'));
    if (m.p2) dbgPanel(ctx, G.W - 4, 54, dbgPlayerLines(m, m.p2, 'P2'), 'right');
    ctx.restore();
  }

  // stand-alone figure for menus (portraits, previews)
  function figure(ctx, id, x, y, scale, opts = {}) {
    const p = opts.player || makeDummy(id, opts);
    p.x = x - G.LAYER_DX;
    // flyers are rigged around the shoulder; lift them so their feet rest on (x, y) like everyone else
    p.y = CHARS[id].kind === 'jet' ? y - 48 * scale : y;
    p.scaleX = scale * (opts.flip ? -1 : 1);
    p.scaleY = scale;
    player(ctx, p);
  }
  const dummies = {};
  function makeDummy(id, opts) {
    const key = id;
    if (!dummies[key]) {
      const def = CHARS[id];
      const rig = RIGS[def.rig];
      const fake = (name) => ({ data: rig[name], cur: 1 });
      dummies[key] = {
        id, def, kind: def.kind, rig, state: 'normal', anim: 0, serving: false,
        clips: { serve: fake('serve'), under: fake('under'), over: fake('over') }, shown: 'over',
      };
    }
    const d = dummies[key];
    d.anim = opts.t || 0;
    d.state = opts.state || 'normal';
    d.clips.over.cur = opts.frame || 1;
    return d;
  }

  return { rr, text, line, scene, figure, headHeight, background, cover, drawShuttleShape, FONT, INK };
})();
window.R = R;
