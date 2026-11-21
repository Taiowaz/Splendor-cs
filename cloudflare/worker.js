import { DurableObject } from 'cloudflare:workers';
import { randomBytes } from 'node:crypto';
import { createAccountService, AuthError } from '../server/accountService.js';
import { createGameServer } from '../server/gameServer.js';

const json = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || origin === 'null') return null;
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.includes(origin)) return origin;
  try {
    if (loopback(new URL(request.url).hostname) && loopback(new URL(origin).hostname)) return origin;
  } catch {}
  return null;
}

function cors(response, origin) {
  if (!origin || response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(response.body, { status: response.status, headers });
}

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError('请求内容不能为空');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2048) {
      await reader.cancel();
      throw new AuthError('请求内容过大', 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(body);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);
    if (request.headers.has('Origin') && !origin) return json({ error: '不允许此站点连接' }, 403);
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), origin);
    if (url.pathname === '/api/status' && request.method === 'GET') {
      return cors(json({ status: 'ok', runtime: 'cloudflare-free', debug: false }), origin);
    }
    const socket = url.pathname === '/ws' && request.method === 'GET' &&
      request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    const auth = ['/api/register', '/api/login'].includes(url.pathname) && request.method === 'POST';
    const me = url.pathname === '/api/me' && request.method === 'GET';
    if (!socket && !auth && !me) return cors(json({ error: '接口不存在' }, 404), origin);
    if (socket && !origin) return json({ error: 'WebSocket 需要受信任的来源' }, 403);
    try {
      let body;
      if (auth) {
        if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
          throw new AuthError('需要 JSON 请求', 415);
        }
        body = await readBody(request);
      }
      const headers = new Headers(request.headers);
      const ip = request.headers.get('CF-Connecting-IP') || 'local';
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
      headers.set('X-Client-Key', Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''));
      const internal = new Request(request.url, { method: request.method, headers, body });
      const hub = env.GAME_HUB.get(env.GAME_HUB.idFromName('competition-v1'));
      return cors(await hub.fetch(internal), origin);
    } catch (error) {
      return cors(json({ error: error instanceof AuthError ? error.message : '服务暂不可用或免费额度已用完，请稍后重试' },
        error instanceof AuthError ? error.status : 503), origin);
    }
  }
};

class SocketPort {
  constructor(socket, hub, saved) {
    this.socket = socket;
    this.hub = hub;
    this.handlers = new Map();
    this.meta = saved || { openedAt: Date.now(), clientKey: '', windowAt: 0, messages: 0 };
    this.attachment = saved ? JSON.stringify(saved) : null;
  }
  get readyState() { return this.socket.readyState; }
  on(type, callback) { this.handlers.set(type, callback); }
  emit(type, data) { this.handlers.get(type)?.(data); }
  send(data) { this.hub.outbox.push(() => { if (this.readyState === 1) this.socket.send(data); }); }
  close(code = 1000, reason = '') { this.hub.outbox.push(() => this.socket.close(code, reason)); }
  save() {
    const value = { ...this.meta, connection: this.hub.game.exportConnection(this.conn) };
    const encoded = JSON.stringify(value);
    if (encoded !== this.attachment) {
      this.socket.serializeAttachment(value);
      this.attachment = encoded;
    }
  }
}

export class GameHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.ports = new Map();
    this.outbox = [];
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL, createdAt INTEGER NOT NULL)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL)');
      this.sql.exec('CREATE INDEX IF NOT EXISTS rate_limits_until ON rate_limits (until)');
      let secret = this.setting('secret');
      if (!secret) {
        secret = randomBytes(32).toString('hex');
        this.sql.exec('INSERT INTO settings (key, value) VALUES (?, ?)', 'secret', secret);
      }
      this.accounts = createAccountService({ secret, store: {
        getByName: name => this.sql.exec('SELECT * FROM users WHERE name = ?', name).toArray()[0],
        getById: id => this.sql.exec('SELECT * FROM users WHERE id = ?', id).toArray()[0],
        insert: user => this.sql.exec('INSERT INTO users (id, name, salt, hash, createdAt) VALUES (?, ?, ?, ?, ?)',
          user.id, user.name, user.salt, user.hash, user.createdAt)
      } });
      this.savedRooms = new Map(this.sql.exec('SELECT id, value FROM rooms').toArray().map(row => [row.id, row.value]));
      this.savedTimers = this.setting('timers') || '{"graceTimers":[],"roomHolds":[]}';
      this.game = createGameServer({ accounts: this.accounts, debug: false,
        maxRooms: Math.min(20, Math.max(1, Number(env.MAX_ROOMS) || 20)),
        snapshot: { rooms: [...this.savedRooms.values()].map(value => JSON.parse(value)), ...JSON.parse(this.savedTimers) }
      });
      for (const socket of ctx.getWebSockets()) {
        const saved = socket.deserializeAttachment();
        if (!saved?.connection) { socket.close(1011, 'Session unavailable'); continue; }
        const port = new SocketPort(socket, this, saved);
        port.conn = this.game.connect(port, saved.connection);
        this.ports.set(socket, port);
      }
      this.game.reconcileConnections();
      await this.persist();
    });
  }

  setting(key) {
    return this.sql.exec('SELECT value FROM settings WHERE key = ?', key).toArray()[0]?.value;
  }

  rateLimit(key, limit, windowMs) {
    const now = Date.now();
    this.sql.exec('DELETE FROM rate_limits WHERE until <= ?', now);
    const record = this.sql.exec('SELECT count FROM rate_limits WHERE key = ?', key).toArray()[0];
    if (record?.count >= limit) return false;
    this.sql.exec('INSERT INTO rate_limits (key, count, until) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1', key, now + windowMs);
    return true;
  }

  async persist() {
    const { rooms, ...timers } = this.game.exportSnapshot();
    const nextRooms = new Map(rooms.map(room => [room.id, JSON.stringify(room)]));
    const nextTimers = JSON.stringify(timers);
    this.ctx.storage.transactionSync(() => {
      for (const [id, value] of nextRooms) {
        if (this.savedRooms.get(id) !== value) {
          this.sql.exec('INSERT INTO rooms (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value', id, value);
        }
      }
      for (const id of this.savedRooms.keys()) if (!nextRooms.has(id)) this.sql.exec('DELETE FROM rooms WHERE id = ?', id);
      if (this.savedTimers !== nextTimers) {
        this.sql.exec('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'timers', nextTimers);
      }
    });
    this.savedRooms = nextRooms;
    this.savedTimers = nextTimers;
    for (const port of this.ports.values()) port.save();
    const pending = [...this.ports.values()].filter(port => !port.conn.identity && port.readyState === 1)
      .map(port => port.meta.openedAt + 15000);
    const gameDeadline = this.game.nextDeadline();
    if (gameDeadline != null) pending.push(gameDeadline);
    const deadline = pending.length ? Math.min(...pending) : null;
    const alarm = await this.ctx.storage.getAlarm();
    if (deadline == null) { if (alarm != null) await this.ctx.storage.deleteAlarm(); }
    else if (alarm !== deadline) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, deadline));
    await this.ctx.storage.sync();
  }

  async event(action) {
    return this.ctx.blockConcurrencyWhile(async () => {
      this.outbox = [];
      try {
        const result = await action();
        await this.persist();
        for (const send of this.outbox) {
          try { send(); } catch {}
        }
        for (const port of this.ports.values()) {
          if (port.conn.detached && port.readyState === 1) port.socket.close(1008, 'Session replaced');
        }
        return result;
      } catch (error) {
        this.outbox = [];
        throw error;
      } finally {
        this.outbox = [];
      }
    });
  }

  fetch(request) {
    return this.event(async () => {
      const url = new URL(request.url);
      const clientKey = request.headers.get('X-Client-Key');
      if (url.pathname === '/ws') {
        const max = Math.min(100, Math.max(1, Number(this.env.MAX_CONNECTIONS) || 100));
        const active = [...this.ports.values()].filter(port => port.readyState === 1);
        if (active.length >= max || active.filter(p => p.meta.clientKey === clientKey).length >= 10 ||
            !this.rateLimit(`connect:${clientKey}`, 30, 60000)) return json({ error: '连接过多，请稍后再试' }, 429);
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        const port = new SocketPort(server, this);
        port.meta.clientKey = clientKey;
        port.conn = this.game.connect(port);
        this.ports.set(server, port);
        return new Response(null, { status: 101, webSocket: client });
      }
      if (url.pathname === '/api/me') {
        const header = request.headers.get('Authorization') || '';
        const user = this.accounts.verifyToken(header.startsWith('Bearer ') ? header.slice(7) : null);
        return user ? json({ user }) : json({ error: '未登录或登录已过期' }, 401);
      }
      if (!this.rateLimit('auth:global', 120, 60000) || !this.rateLimit(`auth:${clientKey}`, 15, 60000)) {
        return json({ error: '登录或注册过于频繁，请稍后再试' }, 429);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: '无效的 JSON 请求' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: '无效的请求' }, 400);
      try {
        if (url.pathname === '/api/register') {
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          if (name && !this.accounts.nameRegistered(name) && this.game.nameTaken(name)) {
            throw new AuthError('这个名字正有人用着，换一个吧', 409);
          }
          const { total } = this.sql.exec('SELECT COUNT(*) AS total FROM users').one();
          if (total >= 1000) throw new AuthError('比赛体验账号名额已满，请使用游客试玩', 409);
          return json(this.accounts.register(body.name, body.password));
        }
        return json(this.accounts.login(body.name, body.password));
      } catch (error) {
        if (error instanceof AuthError) return json({ error: error.message }, error.status);
        throw error;
      }
    });
  }

  webSocketMessage(socket, message) {
    return this.event(() => {
      const port = this.ports.get(socket);
      if (!port) { socket.close(1011, 'Session unavailable'); return; }
      if (typeof message !== 'string' || new TextEncoder().encode(message).byteLength > 8192) {
        port.close(1009, 'Message too large');
        return;
      }
      const now = Date.now();
      if (!port.conn.identity && now >= port.meta.openedAt + 15000) {
        port.close(1008, 'Handshake required');
        return;
      }
      if (now - port.meta.windowAt >= 10000) { port.meta.windowAt = now; port.meta.messages = 0; }
      if (++port.meta.messages > 30) {
        port.send(JSON.stringify({ type: 'error', message: '操作过于频繁，请稍后再试' }));
        return;
      }
      this.game.runDueTasks();
      port.emit('message', message);
    });
  }

  webSocketClose(socket, code, reason, wasClean) {
    return this.event(() => {
      const port = this.ports.get(socket);
      if (port) { port.emit('close'); this.ports.delete(socket); }
      socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    });
  }

  webSocketError(socket) {
    return this.webSocketClose(socket, 1011, 'Connection error', false);
  }

  alarm() {
    return this.event(() => {
      for (const [socket, port] of this.ports) {
        if (!port.conn.identity && Date.now() >= port.meta.openedAt + 15000) {
          port.emit('close');
          port.close(1008, 'Handshake required');
          this.ports.delete(socket);
        }
      }
      this.game.runDueTasks();
    });
  }
}
