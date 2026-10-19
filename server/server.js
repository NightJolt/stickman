'use strict';
/*
 * Room server for Online 1v1. No dependencies: Node's http module plus a small WebSocket
 * (RFC 6455) implementation that handles what browsers send, i.e. masked text frames, pings and
 * closes.
 *
 * A player creates a room and gets a short code; the other joins with it. Once both are in, the
 * server relays every message from one to the other untouched. The game itself runs in the
 * creator's browser (see js/online.js).
 *
 *   node server/server.js            game + rooms on http://localhost:8787 (ws at /ws)
 *   PORT=9000 STATIC=0 node server/server.js
 *                                    rooms only, for running behind nginx (ops/nginx)
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const STATIC = process.env.STATIC !== '0';
const ROOT = path.resolve(__dirname, '..');
const MAX_MESSAGE = 16 * 1024;     // bytes; a match snapshot is well under 1 KB
const MAX_CLIENTS = 1000;
const MAX_RATE = 240;              // messages per second per connection (play sends ~120)
const WAIT_LIMIT = 30 * 60 * 1000; // a room nobody joins is closed after this long
const PING_EVERY = 20 * 1000;      // WebSocket ping; a connection that misses two is dropped
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0 or 1
const CODE_LENGTH = 4;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const rooms = new Map(); // code -> { host, guest, created }
const clients = new Set();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

/* ------------------------------------------------------------------ WebSocket connection */
class Client {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.parts = [];        // fragments of a message still arriving
    this.room = null;
    this.alive = true;
    this.closed = false;
    this.count = 0;         // messages in the current second
    this.second = 0;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.gone());
    socket.on('error', () => this.gone());
  }

  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (!this.closed) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        if (b.readUInt32BE(2) !== 0) return this.close(1009, 'too big');
        len = b.readUInt32BE(6);
        off = 10;
      }
      if (len > MAX_MESSAGE) return this.close(1009, 'too big');
      if (!masked) return this.close(1002, 'unmasked frame');
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this.alive = true;

      if (op === 0x8) return this.close(1000, '');
      if (op === 0x9) { this.frame(0xa, data); continue; } // ping -> pong
      if (op === 0xa) continue;                           // pong
      if (op === 0x2) return this.close(1003, 'text only');
      if (op !== 0x1 && op !== 0x0) return this.close(1002, 'bad opcode');
      this.parts.push(data);
      const size = this.parts.reduce((n, p) => n + p.length, 0);
      if (size > MAX_MESSAGE) return this.close(1009, 'too big');
      if (!fin) continue;
      const text = Buffer.concat(this.parts).toString('utf8');
      this.parts = [];
      this.onMessage(text);
    }
  }

  frame(op, payload) {
    if (this.closed) return;
    const n = payload.length;
    let head;
    if (n < 126) head = Buffer.from([0x80 | op, n]);
    else if (n < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op;
      head[1] = 126;
      head.writeUInt16BE(n, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op;
      head[1] = 127;
      head.writeUInt32BE(0, 2);
      head.writeUInt32BE(n, 6);
    }
    // a peer that stopped reading would make us buffer forever
    if (this.socket.writableLength > 1024 * 1024) return this.close(1008, 'not reading');
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(obj) {
    this.frame(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));
  }

  close(code, reason) {
    if (this.closed) return;
    const r = Buffer.from(reason || '');
    const body = Buffer.alloc(2 + r.length);
    body.writeUInt16BE(code, 0);
    r.copy(body, 2);
    this.frame(0x8, body);
    this.closed = true;
    this.socket.end();
    this.gone();
  }

  gone() {
    if (!clients.has(this)) return;
    clients.delete(this);
    this.closed = true;
    this.socket.destroy();
    leaveRoom(this);
  }

  onMessage(text) {
    const sec = Math.floor(Date.now() / 1000);
    if (sec !== this.second) { this.second = sec; this.count = 0; }
    if (++this.count > MAX_RATE) return this.close(1008, 'too many messages');
    const room = this.room;
    if (room && room.guest) {
      // in a match: pass it on as it came
      const other = room.host === this ? room.guest : room.host;
      other.send(text);
      return;
    }
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return this.close(1007, 'not json'); }
    if (msg.t === 'create') createRoom(this);
    else if (msg.t === 'join') joinRoom(this, String(msg.code || ''));
  }
}

/* ------------------------------------------------------------------ rooms */
function newCode() {
  for (let tries = 0; tries < 1000; tries++) {
    let code = '';
    const bytes = crypto.randomBytes(CODE_LENGTH);
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    if (!rooms.has(code)) return code;
  }
  return null;
}

function createRoom(c) {
  if (c.room) return;
  const code = newCode();
  if (!code) return c.send({ t: 'error', msg: 'The server is full. Try again soon.' });
  const room = { code, host: c, guest: null, created: Date.now() };
  rooms.set(code, room);
  c.room = room;
  c.send({ t: 'created', code });
  log('room', code, 'created', `(${rooms.size} open)`);
}

function joinRoom(c, raw) {
  if (c.room) return;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const room = rooms.get(code);
  if (!room) return c.send({ t: 'error', msg: 'No room with that code.' });
  if (room.guest) return c.send({ t: 'error', msg: 'That room already has two players.' });
  room.guest = c;
  c.room = room;
  room.host.send({ t: 'paired', role: 'host', code });
  c.send({ t: 'paired', role: 'guest', code });
  log('room', code, 'paired');
}

function leaveRoom(c) {
  const room = c.room;
  if (!room) return;
  c.room = null;
  const other = room.host === c ? room.guest : room.host;
  rooms.delete(room.code);
  if (other) {
    other.room = null;
    other.send({ t: 'left' });
    other.close(1000, 'opponent left');
  }
  log('room', room.code, 'closed', `(${rooms.size} open)`);
}

/* ------------------------------------------------------------------ http: upgrade + local files */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

const server = http.createServer((req, res) => {
  if (!STATIC || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(STATIC ? 405 : 404);
    return res.end();
  }
  let rel;
  try { rel = decodeURIComponent(req.url.split('?')[0]); } catch (e) { rel = '/'; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  const inside = path.relative(ROOT, file);
  // only the game's own files: nothing outside the folder, no dotfiles, no server or ops code
  if (inside.startsWith('..') || path.isAbsolute(inside) || inside.split(path.sep).some((p) => p.startsWith('.')) ||
      /^(server|ops)([\\/]|$)/.test(inside)) {
    res.writeHead(404);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (req.url.split('?')[0] !== '/ws' || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  if (clients.size >= MAX_CLIENTS) {
    socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  clients.add(new Client(socket));
});

// drop dead connections, and rooms nobody joined
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.gone(); continue; }
    c.alive = false;
    c.frame(0x9, Buffer.alloc(0));
  }
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.guest && now - room.created > WAIT_LIMIT) room.host.close(1000, 'room expired');
  }
}, PING_EVERY);

server.listen(PORT, HOST, () => {
  log(`Shuttle Sticks rooms on ws://${HOST}:${PORT}/ws` + (STATIC ? ` (game at http://localhost:${PORT}/)` : ''));
});
