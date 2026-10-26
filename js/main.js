'use strict';
/* Boot: canvas sizing, input, and the 60 fps frame clock. */
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  // The canvas fills the window. The 640x426 stage is scaled to fit inside it and centred; the
  // room either side shows more of the arena (G.view), so gameplay sizes never change.
  let scale = 1;            // device px per stage px
  let fit = 1, offX = 0, offY = 0; // CSS px per stage px, and where the stage starts

  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    fit = Math.min(vw / G.W, vh / G.H);
    offX = (vw - G.W * fit) / 2;
    offY = (vh - G.H * fit) / 2;
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    scale = fit * dpr;
    G.view = { x0: -offX / fit, y0: -offY / fit, x1: G.W + offX / fit, y1: G.H + offY / fit };
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---------- input ---------- */
  function toStage(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left - offX) / fit, (e.clientY - r.top - offY) / fit];
  }
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = toStage(e);
    G.mouse.x = x;
    G.mouse.y = y;
    canvas.style.cursor = UI.cursor(x, y);
  });
  canvas.addEventListener('pointerdown', (e) => {
    SFX.unlock();
    const [x, y] = toStage(e);
    G.mouse.x = x;
    G.mouse.y = y;
    UI.mouseDown(x, y);
  });
  canvas.addEventListener('pointerup', (e) => {
    const [x, y] = toStage(e);
    UI.click(x, y);
    canvas.style.cursor = UI.cursor(x, y);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    SFX.unlock();
    const code = G.codeFromEvent(e);
    if ([32, 37, 38, 39, 40, 8, 9].includes(code)) e.preventDefault();
    if (!G.isDown(code)) G.keys.push(code);
    if (!e.repeat) UI.key(code);
  });
  window.addEventListener('keyup', (e) => {
    const code = G.codeFromEvent(e);
    const i = G.keys.indexOf(code);
    if (i !== -1) G.keys.splice(i, 1);
  });
  window.addEventListener('blur', () => { G.keys.length = 0; });
  window.addEventListener('paste', (e) => {
    const t = e.clipboardData && e.clipboardData.getData('text');
    if (t) UI.paste(t);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.pauseAllowed && !G.paused) G.togglePause();
  });

  /* ---------- frame clock ---------- */
  // Frames are stepped on an ideal 60 fps timeline with integer-ms timestamps, independent of the
  // display refresh rate. After a long stall the timeline is re-anchored instead of catching up.
  let origin = performance.now();
  let frameNo = 0;
  // G.clock is the last stepped frame's time; this is the same clock read right now, between
  // frames (Online 1v1 times its messages with it)
  G.now = () => performance.now() - origin;
  let fpsT = origin, fpsN = 0;
  function loop(now) {
    requestAnimationFrame(loop); // first, so one bad frame can't stop the game
    fpsN++;
    if (now - fpsT >= 500) {
      G.fps = Math.round((fpsN * 1000) / (now - fpsT));
      fpsT = now;
      fpsN = 0;
    }
    let target = Math.floor(((now - origin) * G.FPS) / 1000);
    if (target - frameNo > 8) {
      origin = now - ((frameNo + 1) * 1000) / G.FPS;
      target = frameNo + 1;
    }
    while (frameNo < target) {
      frameNo++;
      const t = Math.floor((frameNo * 1000) / G.FPS);
      const prev = G.clock;
      G.clock = t;
      G.runTimers();
      G.enterFrame(t);
      UI.tick((t - prev) / 1000);
    }
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offX * dpr, offY * dpr);
    UI.draw(ctx, scale);
  }

  UI.start();
  requestAnimationFrame(loop);
})();
