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
  function buildBackground(scale) {
    const c = document.createElement('canvas');
    c.width = Math.round(G.W * scale);
    c.height = Math.round(G.H * scale);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    // hall wall
    let g = ctx.createLinearGradient(0, 0, 0, 400);
    g.addColorStop(0, '#1f2a44');
    g.addColorStop(0.55, '#33476b');
    g.addColorStop(1, '#4b6288');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, G.W, 400);
    // tall windows with evening sky
    for (let i = 0; i < 5; i++) {
      const x = 62 + i * 112, y = 54, w = 76, h = 150;
      const sky = ctx.createLinearGradient(0, y, 0, y + h);
      sky.addColorStop(0, '#f6a76b');
      sky.addColorStop(0.5, '#e7766a');
      sky.addColorStop(1, '#7b5a9a');
      ctx.fillStyle = sky;
      rr(ctx, x, y, w, h, 6);
      ctx.fill();
      ctx.strokeStyle = '#18213a';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.lineWidth = 2;
      line(ctx, x + w / 2, y, x + w / 2, y + h);
      line(ctx, x, y + h / 3, x + w, y + h / 3);
      line(ctx, x, y + (2 * h) / 3, x + w, y + (2 * h) / 3);
      // distant city silhouette
      ctx.fillStyle = 'rgba(40,30,70,0.55)';
      for (let b = 0; b < 6; b++) {
        const bh = 14 + ((i * 7 + b * 13) % 30);
        ctx.fillRect(x + b * 13, y + h - bh, 11, bh);
      }
    }
    // ceiling lights
    for (let i = 0; i < 4; i++) {
      const x = 110 + i * 140;
      const lg = ctx.createRadialGradient(x, 18, 2, x, 18, 120);
      lg.addColorStop(0, 'rgba(255,240,200,0.35)');
      lg.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(x - 120, 0, 240, 200);
      ctx.fillStyle = '#e9e4d0';
      rr(ctx, x - 22, 10, 44, 7, 3);
      ctx.fill();
    }
    // bleachers band
    g = ctx.createLinearGradient(0, 238, 0, 330);
    g.addColorStop(0, '#2a3657');
    g.addColorStop(1, '#222c47');
    ctx.fillStyle = g;
    ctx.fillRect(0, 238, G.W, 92);
    for (let r = 0; r < 4; r++) {
      ctx.fillStyle = r % 2 ? '#26314f' : '#2e3b5e';
      ctx.fillRect(0, 244 + r * 22, G.W, 18);
    }
    // crowd heads
    const hues = [12, 40, 200, 160, 280, 330, 90];
    for (let r = 0; r < 4; r++) {
      for (let x = 8 + (r % 2) * 9; x < G.W; x += 18) {
        const k = (x * 7 + r * 31) % 97;
        if (k < 30) continue;
        ctx.fillStyle = `hsl(${hues[k % hues.length]},35%,${38 + (k % 15)}%)`;
        ctx.beginPath();
        ctx.arc(x, 252 + r * 22, 6, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = 'rgba(240,215,190,0.55)';
        ctx.beginPath();
        ctx.arc(x, 241 + r * 22, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // advertising boards
    g = ctx.createLinearGradient(0, 332, 0, 372);
    g.addColorStop(0, '#16213a');
    g.addColorStop(1, '#0f172b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 332, G.W, 40);
    const boards = ['SHUTTLE STICKS', 'FEATHER CUP', 'SMASH OPEN', 'STICK LEAGUE'];
    for (let i = 0; i < 4; i++) {
      const x = 12 + i * 158;
      ctx.fillStyle = ['#2b6cb0', '#c05621', '#2f855a', '#9b2c2c'][i];
      rr(ctx, x, 337, 146, 30, 4);
      ctx.fill();
      text(ctx, boards[i], x + 73, 352, 13, 'rgba(255,255,255,0.85)', 'center', 'bold');
    }
    // floor
    g = ctx.createLinearGradient(0, 372, 0, G.H);
    g.addColorStop(0, '#9c6a3e');
    g.addColorStop(0.3, '#c98d55');
    g.addColorStop(1, '#a8703f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 372, G.W, G.H - 372);
    ctx.strokeStyle = 'rgba(80,45,20,0.25)';
    ctx.lineWidth = 1;
    for (let y = 380; y < G.H; y += 9) line(ctx, 0, y, G.W, y);
    for (let i = 0; i < 40; i++) {
      const y = 376 + (i % 6) * 9, x = (i * 97) % G.W;
      line(ctx, x, y, x, y + 9);
    }
    // court surface strip + lines
    ctx.fillStyle = 'rgba(46,125,90,0.55)';
    ctx.fillRect(G.WALL, 396, G.W - 2 * G.WALL, 30);
    ctx.fillStyle = '#f4f1e8';
    ctx.fillRect(G.WALL, 399, G.W - 2 * G.WALL, 2.5);
    ctx.fillRect(G.WALL, 396, 2.5, 30);
    ctx.fillRect(G.W - G.WALL - 2.5, 396, 2.5, 30);
    const sl = G.NET_X - G.SERVE_GAP, sr = G.NET_X + G.SERVE_GAP;
    ctx.fillRect(sl - 1.25, 396, 2.5, 30);
    ctx.fillRect(sr - 1.25, 396, 2.5, 30);
    // side wall pads (the shuttle bounces off these)
    for (const x of [0, G.W - G.WALL]) {
      g = ctx.createLinearGradient(x, 0, x + G.WALL, 0);
      g.addColorStop(0, '#173a6b');
      g.addColorStop(0.5, '#1f4f8f');
      g.addColorStop(1, '#173a6b');
      ctx.fillStyle = g;
      ctx.fillRect(x, 120, G.WALL, 280);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1.5;
      for (let y = 160; y < 400; y += 40) line(ctx, x + 3, y, x + G.WALL - 3, y);
      ctx.fillStyle = '#0f2747';
      ctx.fillRect(x, 116, G.WALL, 6);
    }
    return c;
  }
  function background(ctx, scale) {
    if (!bg || bgScale !== scale) {
      bg = buildBackground(scale);
      bgScale = scale;
    }
    ctx.drawImage(bg, 0, 0, G.W, G.H);
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
    const x = s.x + G.LAYER_DX, y = s.y;
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
      ctx.lineCap = 'round';
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
      const ph = t * 15 * (p.state === 'backward' ? -1 : 1);
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
      ctx.globalAlpha = 0.9;
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
    const label = m.mode === 'versus' ? 'Exhibition' : ROUND_NAMES[m.round - 1] || '';
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

  function scene(ctx, m, scale) {
    background(ctx, scale);
    effects(ctx, m.fx, 'back');
    net(ctx, m.net);
    if (m.p1) player(ctx, m.p1);
    if (m.p2) player(ctx, m.p2);
    for (const t of m.fx.trails) trail(ctx, t);
    if (m.shuttle) shuttle(ctx, m.shuttle);
    bubble(ctx, m);
    effects(ctx, m.fx, 'front');
    hud(ctx, m);
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
    // computer's "swing now" zone (with the airborne -20 shift think() applies)
    if (p.cpu && p.rig.cpuHit) {
      const shift = p.cpuShift + (p.inAir ? -20 : 0);
      dbgPoly(ctx, p, p.rig.cpuHit, shift, DBG.cpu);
    }
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
    if (p.cpu) {
      const cd = Math.max(0, 500 - (G.clock - p.lastCpuSwing));
      out.push([`  skill ${n(p.skill, 0)}/${n(p.skillBase, 0)}  rollA ${n(p.rollA, 0)}  rollB ${n(p.rollB, 0)}  cd ${cd}ms${p.goHome ? '  home' : ''}`, DBG.cpu]);
    }
    return out;
  }

  function debug(ctx, m) {
    ctx.save();
    dbgWorld(ctx);
    if (m.p1) dbgPlayer(ctx, m, m.p1);
    if (m.p2) dbgPlayer(ctx, m, m.p2);
    if (m.shuttle) dbgShuttle(ctx, m.shuttle);

    const s = m.shuttle;
    const who = (p) => (p === m.p1 ? 'P1' : p === m.p2 ? 'P2' : '-');
    const left = [
      ['DEBUG  ` to hide', '#39ff6a'],
      [['■ racket ', DBG.racket], ['■ reach ', DBG.reach], ['■ cpu swing ', DBG.cpu], ['■ net ', DBG.netBody], ['■ tape', DBG.netTop]],
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

  return { rr, text, line, scene, figure, background, drawShuttleShape, FONT, INK };
})();
window.R = R;
