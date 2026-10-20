'use strict';
/*
 * Online 1v1 connection. A WebSocket to the room server (server/server.js) pairs two players by
 * room code. Then the two browsers try to connect to each other directly over WebRTC, using
 * that WebSocket to swap the connection offer and addresses (public STUN servers help each side
 * find its own). Once the direct channel is open, the fast traffic (snapshots, keys, pings)
 * goes straight between the players; the rest stays on the server, which relays it. If a direct
 * link can't be made (some mobile and office networks block it) or drops, everything simply
 * keeps going through the server.
 *
 * The direct channel is unordered and never resends, like UDP: a late snapshot is worthless
 * anyway, and nothing waits behind a lost one. js/online.js copes with gaps and reordering.
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
  const FAST = new Set(['s', 'i', 'ping', 'pong']); // what goes over the direct channel
  let ws = null;
  let listener = null;
  let leaveFn = null;
  let paired = false;
  let pingTimer = null;
  let rtt = null;
  let pc = null;           // RTCPeerConnection
  let dc = null;           // its data channel, once open
  let pendingIce = [];     // candidates that arrived before the offer/answer
  let directTimer = null;
  let path = 'relay';      // 'connecting' | 'direct' | 'relay'

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
    if (FAST.has(obj.t) && dc && dc.readyState === 'open') {
      try {
        dc.send(JSON.stringify(obj));
        return;
      } catch (e) { /* fall through to the server */ }
    }
    viaServer(obj);
  }

  function receive(data) {
    let msg;
    try { msg = JSON.parse(data); } catch (err) { return; }
    if (msg.t === 'ping') return send({ t: 'pong', ts: msg.ts });
    if (msg.t === 'pong') { rtt = performance.now() - msg.ts; return; }
    if (msg.t === 'rtc') return signal(msg);
    if (msg.t === 'paired') {
      paired = true;
      pingTimer = setInterval(() => send({ t: 'ping', ts: performance.now() }), 1000);
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

  /* ---------------------------------------------------------------- direct link (WebRTC) */
  // The host makes the offer and the channel; the guest answers. Either way, if it isn't open
  // within DIRECT_WAIT the game stays on the server.
  function goDirect(role) {
    if (typeof RTCPeerConnection === 'undefined') return;
    try { pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }); } catch (e) { pc = null; return; }
    path = 'connecting';
    pc.onicecandidate = (e) => { if (e.candidate) viaServer({ t: 'rtc', ice: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) dropDirect();
    };
    const wire = (ch) => {
      ch.onopen = () => {
        dc = ch;
        path = 'direct';
        clearTimeout(directTimer);
      };
      ch.onclose = () => { if (dc === ch) dropDirect(); };
      ch.onmessage = (e) => receive(e.data);
    };
    if (role === 'host') {
      wire(pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 }));
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
    const p = pc, d = dc;
    pc = dc = null;
    pendingIce = [];
    if (paired) path = 'relay';
    if (d) { d.onopen = d.onclose = d.onmessage = null; try { d.close(); } catch (e) { /* closed */ } }
    if (p) { p.onicecandidate = p.onconnectionstatechange = p.ondatachannel = null; try { p.close(); } catch (e) { /* closed */ } }
  }

  /* ---------------------------------------------------------------- the server connection */
  // drop the connection (the screens' handlers stay)
  function hangUp() {
    clearInterval(pingTimer);
    pingTimer = null;
    paired = false;
    rtt = null;
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
    get path() { return path; },
  };
})();
window.NET = NET;
