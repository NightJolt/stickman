'use strict';
/*
 * Online 1v1 connection: one WebSocket to the room server (server/server.js), which pairs two
 * players by room code and then relays everything between them. Screens take turns listening
 * through NET.listen(); NET.onLeave() hears about the other player leaving or the line dropping.
 *
 * The server is the page's own host at /ws, or localhost:8787 for a page opened from disk.
 * ?server=wss://host/ws overrides it.
 */
const NET = (() => {
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // as the server deals them
  const CODE_LENGTH = 4;
  let ws = null;
  let listener = null;
  let leaveFn = null;
  let paired = false;
  let pingTimer = null;
  let rtt = null;

  function serverUrl() {
    const q = /[?&]server=([^&]+)/.exec(location.search);
    if (q) return decodeURIComponent(q[1]);
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    }
    return 'ws://localhost:8787/ws';
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // drop the socket (the screens' handlers stay)
  function hangUp() {
    clearInterval(pingTimer);
    pingTimer = null;
    paired = false;
    rtt = null;
    if (ws) {
      const w = ws;
      ws = null;
      w.onclose = w.onmessage = w.onerror = null;
      try { w.close(); } catch (e) { /* already closed */ }
    }
  }

  // leave for good: drop the socket and forget the handlers
  function close() {
    hangUp();
    listener = null;
    leaveFn = null;
  }

  // Open a connection and ask for a room ({t:'create'} or {t:'join', code}).
  function open(first) {
    hangUp();
    let w;
    try { w = new WebSocket(serverUrl()); } catch (e) {
      setTimeout(() => listener && listener({ t: 'error', msg: "Can't reach the game server." }), 0);
      return;
    }
    ws = w;
    let opened = false;
    w.onopen = () => { opened = true; send(first); };
    w.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.t === 'ping') return send({ t: 'pong', ts: msg.ts });
      if (msg.t === 'pong') { rtt = performance.now() - msg.ts; return; }
      if (msg.t === 'paired') {
        paired = true;
        pingTimer = setInterval(() => send({ t: 'ping', ts: performance.now() }), 1000);
      }
      if (msg.t === 'left') {
        const fn = leaveFn;
        hangUp();
        if (fn) fn('left');
        return;
      }
      if (listener) listener(msg);
    };
    w.onclose = () => {
      if (ws !== w) return;
      const wasPaired = paired;
      hangUp();
      if (wasPaired && leaveFn) leaveFn('dropped');
      else if (!wasPaired && listener) listener({ t: 'error', msg: opened ? 'Lost the connection to the game server.' : "Can't reach the game server." });
    };
  }

  return {
    CODE_CHARS,
    CODE_LENGTH,
    create() { open({ t: 'create' }); },
    join(code) { open({ t: 'join', code }); },
    send,
    close,
    listen(fn) { listener = fn; },
    onLeave(fn) { leaveFn = fn; },
    get paired() { return paired; },
    get rtt() { return rtt; },
  };
})();
window.NET = NET;
