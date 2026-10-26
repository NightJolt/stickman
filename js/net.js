'use strict';
/*
 * Online 1v1 connection. A WebSocket to the room server (server/server.js) pairs two players by
 * room code. Then the two browsers try to connect to each other directly over WebRTC, using
 * that WebSocket to swap the connection offer and addresses (public STUN servers help each side
 * find its own). Once the direct link is up, match traffic goes straight between the players
 * over two channels: 'fast', unordered and never resent like UDP, for each player's movement
 * and the pings (a late frame is worthless anyway, and nothing waits behind a lost one), and
 * 'sure', reliable and in order, for hits and points. Those also go through the server every
 * time, so one can't be lost if the direct link drops while it's on the way; js/online.js
 * ignores whichever copy arrives second. Picking players and rematches stay on the server. If a
 * direct link can't be made (some mobile and office networks block it) or drops, everything
 * simply keeps going through the server.
 *
 * Screens take turns listening through NET.listen(); NET.onLeave() hears about the other player
 * leaving or the line dropping. The server is the page's own host at /ws, or localhost:8787 for
 * a page opened from disk; ?server=wss://host/ws overrides it.
 */
const NET = (() => {
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // as the server deals them
  const CODE_LENGTH = 4;
  const ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  const DIRECT_WAIT = 10000;                  // ms to try for a direct link before settling
  const FAST = new Set(['st', 'ping', 'pong']);     // direct and unreliable
  const SURE = new Set(['hit', 'own', 'pt']);        // direct and reliable, and via the server too
  let ws = null;
  let listener = null;
  let leaveFn = null;
  let paired = false;
  let pingTimer = null;
  let rtt = null;          // ms there and back (median of the recent pings)
  // Clock sync, NTP-style: each ping carries our game clock (G.now) out and their clock back, so
  // every exchange gives a round trip and an offset between the two clocks. The offset comes from
  // the quickest recent exchanges, the ones least bent by queueing on the way.
  const PING_EVERY = 250;
  let samples = [];        // recent { r: round trip, o: their clock minus ours }
  let offset = 0;
  let synced = false;
  let pc = null;           // RTCPeerConnection
  let chans = {};          // its open data channels: { fast, sure }
  let pendingIce = [];     // candidates that arrived before the offer/answer
  let directTimer = null;
  let path = 'relay';      // 'connecting' | 'direct' | 'relay'
  let theirVersion = null; // the other player's build (js/version.js), once they've said
  const V = window.VERSION || { build: 'dev', sha: '' };
  const VERSION_ID = V.build + (V.sha ? '-' + V.sha : '');

  function serverUrl() {
    const q = /[?&]server=([^&]+)/.exec(location.search);
    if (q) return decodeURIComponent(q[1]);
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    }
    return 'ws://localhost:8787/ws';
  }

  function viaServer(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function send(obj) {
    const ch = FAST.has(obj.t) ? chans.fast : SURE.has(obj.t) ? chans.sure : null;
    if (ch && ch.readyState === 'open') {
      try {
        ch.send(JSON.stringify(obj));
        if (FAST.has(obj.t)) return;
      } catch (e) { /* fall through to the server */ }
    }
    viaServer(obj);
  }

  function receive(data) {
    let msg;
    try { msg = JSON.parse(data); } catch (err) { return; }
    if (msg.t === 'ping') return send({ t: 'pong', a: msg.a, b: G.now() });
    if (msg.t === 'pong') return heard(msg);
    if (msg.t === 'rtc') return signal(msg);
    if (msg.t === 'hello') { theirVersion = String(msg.v); return; }
    if (msg.t === 'paired') {
      viaServer({ t: 'hello', v: VERSION_ID }); // so a game that's out of date can be spotted
      paired = true;
      pingTimer = setInterval(() => send({ t: 'ping', a: G.now() }), PING_EVERY);
      goDirect(msg.role);
    }
    if (msg.t === 'left') {
      const fn = leaveFn;
      hangUp();
      if (fn) fn('left');
      return;
    }
    if (listener) listener(msg);
  }

  function heard(msg) {
    const c = G.now(), r = c - msg.a;
    if (!(r >= 0 && r < 5000)) return;
    const s = { r, o: msg.b - (msg.a + c) / 2 };
    // Two quick exchanges in a row that agree with each other but not with the offset: a clock
    // jumped (a stalled screen re-anchors its frame clock), so the older samples are stale.
    const last = samples[samples.length - 1];
    if (synced && last && r < rtt + 30 && last.r < rtt + 30 && Math.abs(s.o - last.o) < 15 &&
        Math.abs(s.o - offset) > 40 && Math.abs(last.o - offset) > 40) samples = [last];
    samples.push(s);
    if (samples.length > 12) samples.shift();
    const rs = samples.map((x) => x.r).sort((x, y) => x - y);
    rtt = rs[rs.length >> 1];
    // the offset from the quickest few; jump to it at first, or when a clock has jumped (a stall)
    const quick = samples.slice().sort((x, y) => x.r - y.r).slice(0, 3);
    const best = quick.reduce((a, x) => a + x.o, 0) / quick.length;
    if (!synced || Math.abs(best - offset) > 40) offset = best;
    else offset += (best - offset) * 0.3;
    synced = synced || samples.length >= 3; // (stays synced through a restart above)
  }

  /* ---------------------------------------------------------------- direct link (WebRTC) */
  // The host makes the offer and the channel; the guest answers. Either way, if it isn't open
  // within DIRECT_WAIT the game stays on the server.
  function goDirect(role) {
    // without WebRTC here, tell the other side not to wait for us
    const cant = () => viaServer({ t: 'rtc', off: true });
    if (typeof RTCPeerConnection === 'undefined') return cant();
    try { pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }); } catch (e) { pc = null; return cant(); }
    path = 'connecting';
    pc.onicecandidate = (e) => { if (e.candidate) viaServer({ t: 'rtc', ice: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) dropDirect();
    };
    const wire = (ch) => {
      ch.onopen = () => {
        chans[ch.label] = ch;
        if (chans.fast && chans.sure) {
          path = 'direct';
          clearTimeout(directTimer);
        }
      };
      ch.onclose = () => { if (chans[ch.label] === ch) dropDirect(); };
      ch.onmessage = (e) => receive(e.data);
      if (ch.readyState === 'open') ch.onopen(); // a channel handed over already open
    };
    if (role === 'host') {
      wire(pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
      wire(pc.createDataChannel('sure'));
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => viaServer({ t: 'rtc', sdp: pc.localDescription }))
        .catch(dropDirect);
    } else {
      pc.ondatachannel = (e) => wire(e.channel);
    }
    directTimer = setTimeout(() => { if (path !== 'direct') dropDirect(); }, DIRECT_WAIT);
  }

  function signal(msg) {
    if (!pc) return;
    if (msg.off) return dropDirect();
    if (msg.sdp) {
      pc.setRemoteDescription(msg.sdp)
        .then(() => {
          pendingIce.forEach((c) => pc.addIceCandidate(c).catch(() => {}));
          pendingIce = [];
          if (msg.sdp.type !== 'offer') return null;
          return pc.createAnswer()
            .then((answer) => pc.setLocalDescription(answer))
            .then(() => viaServer({ t: 'rtc', sdp: pc.localDescription }));
        })
        .catch(dropDirect);
    } else if (msg.ice) {
      if (pc.remoteDescription) pc.addIceCandidate(msg.ice).catch(() => {});
      else pendingIce.push(msg.ice);
    }
  }

  // give up on the direct link (or lose it): the server carries everything again
  function dropDirect() {
    clearTimeout(directTimer);
    directTimer = null;
    const p = pc, open = Object.values(chans);
    pc = null;
    chans = {};
    pendingIce = [];
    if (paired) path = 'relay';
    for (const d of open) { d.onopen = d.onclose = d.onmessage = null; try { d.close(); } catch (e) { /* closed */ } }
    if (p) { p.onicecandidate = p.onconnectionstatechange = p.ondatachannel = null; try { p.close(); } catch (e) { /* closed */ } }
  }

  /* ---------------------------------------------------------------- the server connection */
  // drop the connection (the screens' handlers stay)
  function hangUp() {
    clearInterval(pingTimer);
    pingTimer = null;
    paired = false;
    rtt = null;
    samples = [];
    offset = 0;
    synced = false;
    theirVersion = null;
    dropDirect();
    path = 'relay';
    if (ws) {
      const w = ws;
      ws = null;
      w.onclose = w.onmessage = w.onerror = null;
      try { w.close(); } catch (e) { /* already closed */ }
    }
  }

  // leave for good: drop the connection and forget the handlers
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
    w.onopen = () => { opened = true; viaServer(first); };
    w.onmessage = (e) => receive(e.data);
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
    // their game clock minus ours (ms), once a few pings have been and gone
    get offset() { return offset; },
    get synced() { return synced; },
    get path() { return path; },
    get version() { return VERSION_ID; },
    get theirVersion() { return theirVersion; },
  };
})();
window.NET = NET;
