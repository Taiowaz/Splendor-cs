import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { once } from 'node:events';
import WebSocket from 'ws';

const origin = 'https://frontend.example.test';
const base = 'https://backend.example.test';
const script = await readFile(new URL('./dist/worker.js', import.meta.url), 'utf8');

function runtime(persistence, overrides = {}) {
  return new Miniflare({
    host: '127.0.0.1', telemetry: { enabled: false }, enableDevRegistry: false,
    unsafeInspectDurableObjects: true,
    resourcePersistencePath: persistence,
    workers: [{ config: {
      name: 'splendor-test', compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'],
      manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: script } } },
      env: {
        ALLOWED_ORIGINS: { type: 'text', value: origin },
        MAX_ROOMS: { type: 'text', value: '20' },
        MAX_CONNECTIONS: { type: 'text', value: '100' },
        GAME_HUB: { type: 'durable-object', worker: 'splendor-test', exportName: 'GameHub' },
        ...overrides
      },
      exports: { GameHub: { type: 'durable-object', storage: 'sqlite' } }
    } }]
  });
}

async function auth(mf, path, name, password = 'test-password') {
  const response = await mf.dispatchFetch(base + path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password })
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

async function connect(mf, name, token) {
  const response = await mf.dispatchFetch(base + '/ws', { headers: { Upgrade: 'websocket', Origin: origin } });
  assert.equal(response.status, 101);
  const ws = response.webSocket;
  ws.accept();
  const messages = [];
  const waiters = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const i = waiters.findIndex(waiter => waiter.type === message.type);
    if (i >= 0) { const [waiter] = waiters.splice(i, 1); clearTimeout(waiter.timer); waiter.resolve(message); }
    else messages.push(message);
  });
  const client = {
    ws, messages,
    send(message) { ws.send(JSON.stringify(message)); },
    next(type, timeout = 5000) {
      const index = messages.findIndex(message => message.type === type);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for ${type}; received ${messages.map(m => m.type)}`));
        }, timeout) };
        waiters.push(waiter);
      });
    },
    clear() { messages.length = 0; }
  };
  client.send({ type: 'hello', name, token });
  client.welcome = await client.next('welcome');
  return client;
}

async function cleanup(mf, clients = []) {
  for (const client of clients) { try { client.ws.close(1000); } catch {} }
  await mf.dispose();
}

test('HTTP boundaries, CORS, account hashing, uniqueness and signed identity', async () => {
  const mf = runtime();
  try {
    assert.equal((await mf.dispatchFetch(base + '/api/status')).status, 200);
    assert.equal((await mf.dispatchFetch(base + '/api/status', { headers: { Origin: 'https://evil.example.test' } })).status, 403);
    const preflight = await mf.dispatchFetch(base + '/api/login', { method: 'OPTIONS', headers: { Origin: origin } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal((await mf.dispatchFetch(base + '/api/login', { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await mf.dispatchFetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(2049) })).status, 413);
    assert.equal((await mf.dispatchFetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await mf.dispatchFetch(base + '/debug')).status, 404);
    const registered = await auth(mf, '/api/register', '测试账户');
    assert.equal(registered.status, 200, JSON.stringify(registered.body));
    assert.equal(registered.headers.get('access-control-allow-origin'), origin);
    assert.deepEqual(Object.keys(registered.body.user).sort(), ['guest', 'id', 'name']);
    assert.equal((await auth(mf, '/api/register', '测试账户')).status, 409);
    assert.equal((await auth(mf, '/api/login', '测试账户', 'incorrect')).status, 401);
    const loggedIn = await auth(mf, '/api/login', '测试账户');
    assert.equal(loggedIn.status, 200);
    assert.equal(loggedIn.body.user.id, registered.body.user.id);
    const me = await mf.dispatchFetch(base + '/api/me', { headers: { Authorization: `Bearer ${loggedIn.body.token}` } });
    assert.deepEqual((await me.json()).user, loggedIn.body.user);
    assert.equal((await mf.dispatchFetch(base + '/api/me', { headers: { Authorization: `Bearer ${loggedIn.body.token}x` } })).status, 401);
    const missingOrigin = await mf.dispatchFetch(base + '/ws', { headers: { Upgrade: 'websocket' } });
    assert.equal(missingOrigin.status, 403);
    const badOrigin = await mf.dispatchFetch(base + '/ws', { headers: { Upgrade: 'websocket', Origin: 'https://evil.example.test' } });
    assert.equal(badOrigin.status, 403);
  } finally { await cleanup(mf); }
});

test('two players synchronize, reject cheats, reconnect and displace stale sessions', async () => {
  const mf = runtime();
  const clients = [];
  try {
    const a = await connect(mf, '甲同学'); clients.push(a);
    const b = await connect(mf, '乙同学'); clients.push(b);
    a.send({ type: 'create_room', playerName: '甲同学' });
    const created = await a.next('room_created');
    b.send({ type: 'join_room', roomId: created.roomId, playerName: '乙同学' });
    await b.next('joined_room');
    b.send({ type: 'start_game' });
    assert.match((await b.next('error')).message, /房主/);
    a.send({ type: 'start_game' });
    const initial = (await a.next('game_started')).gameState;
    assert.deepEqual((await b.next('game_started')).gameState, initial);
    b.send({ type: 'take_tokens', tokens: { data: 2 } });
    assert.match((await b.next('error')).message, /回合/);
    a.send({ type: 'debug_set_tokens', playerId: created.playerId, tokens: { data: 99 } });
    assert.match((await a.next('error')).message, /不开放调试/);
    a.send({ type: 'take_tokens', tokens: { data: 1, compute: 1, citation: 1 } });
    const taken = await a.next('tokens_taken');
    assert.deepEqual((await b.next('tokens_taken')).gameState, taken.gameState);
    assert.equal(taken.gameState.currentPlayerIndex, 1);
    b.send({ type: 'reserve_card', tier: 1, cardIndex: 0 });
    const reserved = await b.next('card_reserved');
    assert.deepEqual((await a.next('card_reserved')).gameState, reserved.gameState);
    assert.equal(reserved.gameState.players[1].reservedCards.length, 1);
    const replacement = await connect(mf, '', a.welcome.token); clients.push(replacement);
    const restored = await replacement.next('session_restored');
    assert.equal(restored.roomId, created.roomId);
    assert.deepEqual(restored.gameState, reserved.gameState);
    await a.next('session_elsewhere');
    await new Promise(resolve => {
      if (a.ws.readyState !== 1) resolve();
      else a.ws.addEventListener('close', resolve, { once: true });
    });
    assert.notEqual(a.ws.readyState, 1);
    replacement.send({ type: 'hello', token: b.welcome.token });
    assert.match((await replacement.next('error')).message, /已完成身份验证/);
    replacement.send({ type: 'list_rooms' });
    await replacement.next('room_list');
    b.ws.close(1000);
    await replacement.next('player_offline');
    const reconnect = await connect(mf, '', b.welcome.token); clients.push(reconnect);
    assert.deepEqual((await reconnect.next('session_restored')).gameState, reserved.gameState);
  } finally { await cleanup(mf, clients); }
});

test('AI actions run from alarms and pause after humans leave', async () => {
  const mf = runtime();
  const clients = [];
  try {
    const a = await connect(mf, 'AI测试'); clients.push(a);
    a.send({ type: 'create_room', playerName: 'AI测试' });
    await a.next('room_created');
    a.send({ type: 'add_ai' });
    a.send({ type: 'start_game' });
    await a.next('game_started');
    a.send({ type: 'take_tokens', tokens: { data: 1, compute: 1, citation: 1 } });
    assert.equal((await a.next('turn_changed')).gameState.currentPlayerIndex, 1);
    const aiTurn = await a.next('turn_changed', 15000);
    assert.equal(aiTurn.gameState.currentPlayerIndex, 0);
    assert.equal(aiTurn.gameState.turnCount, 2);
    a.send({ type: 'leave_room' });
    await a.next('left_room');
    a.send({ type: 'list_rooms' });
    assert.equal((await a.next('room_list')).rooms[0].rejoinable, true);
  } finally { await cleanup(mf, clients); }
});

test('account keys and room state survive an actual local runtime restart', async () => {
  const path = await mkdtemp(join(tmpdir(), 'splendor-workers-test-'));
  let mf = runtime(path);
  let clients = [];
  try {
    const registered = await auth(mf, '/api/register', '持久账号');
    assert.equal(registered.status, 200, JSON.stringify(registered.body));
    const a = await connect(mf, '', registered.body.token); clients.push(a);
    const b = await connect(mf, '持久游客'); clients.push(b);
    a.send({ type: 'create_room' });
    const { roomId } = await a.next('room_created');
    b.send({ type: 'join_room', roomId, playerName: '持久游客' });
    await b.next('joined_room');
    a.send({ type: 'start_game' });
    await a.next('game_started'); await b.next('game_started');
    a.send({ type: 'take_tokens', tokens: { data: 1, compute: 1, citation: 1 } });
    const state = (await a.next('tokens_taken')).gameState;
    await b.next('tokens_taken');
    const guestToken = b.welcome.token;
    await cleanup(mf, clients);
    clients = [];
    mf = runtime(path);
    const login = await auth(mf, '/api/login', '持久账号');
    assert.equal(login.status, 200);
    assert.equal(login.body.user.id, registered.body.user.id);
    const restored = await connect(mf, '', registered.body.token); clients.push(restored);
    const session = await restored.next('session_restored');
    assert.equal(session.roomId, roomId);
    assert.deepEqual(session.gameState, state);
    const guest = await connect(mf, '', guestToken); clients.push(guest);
    assert.deepEqual((await guest.next('session_restored')).gameState, state);
    guest.send({ type: 'reserve_card', tier: 2, cardIndex: 0 });
    assert.equal((await guest.next('card_reserved')).gameState.currentPlayerIndex, 0);
  } finally {
    await cleanup(mf, clients);
    await rm(path, { recursive: true, force: true });
  }
});

test('hibernation restores live sockets, full deck and the next AI deadline', async () => {
  const mf = runtime();
  const clients = [];
  try {
    const a = await connect(mf, '休眠甲'); clients.push(a);
    const b = await connect(mf, '休眠乙'); clients.push(b);
    a.send({ type: 'create_room', playerName: '休眠甲' });
    const { roomId } = await a.next('room_created');
    b.send({ type: 'join_room', roomId, playerName: '休眠乙' }); await b.next('joined_room');
    a.send({ type: 'add_ai' }); a.send({ type: 'start_game' });
    const initial = (await a.next('game_started')).gameState; await b.next('game_started');
    await mf.unsafeEvictDurableObject('splendor-test', 'GameHub', { name: 'competition-v1', webSockets: 'hibernate' });
    assert.equal(a.ws.readyState, 1);
    assert.equal(b.ws.readyState, 1);
    a.send({ type: 'take_tokens', tokens: { data: 1, compute: 1, citation: 1 } });
    const taken = (await a.next('tokens_taken')).gameState;
    assert.deepEqual((await b.next('tokens_taken')).gameState, taken);
    await a.next('turn_changed'); await b.next('turn_changed');
    assert.deepEqual(taken.bank.tier1, initial.bank.tier1);
    assert.equal(taken.turnCount, 1);
    b.send({ type: 'reserve_card', tier: 1, cardIndex: 0 });
    await b.next('card_reserved'); await a.next('card_reserved');
    await a.next('turn_changed'); await b.next('turn_changed');
    await mf.unsafeEvictDurableObject('splendor-test', 'GameHub', { name: 'competition-v1', webSockets: 'hibernate' });
    const ai = (await a.next('turn_changed', 15000)).gameState;
    assert.equal(ai.turnCount, 3);
    assert.equal(ai.currentPlayerIndex, 0);
    assert.deepEqual((await b.next('turn_changed')).gameState, ai);
  } finally { await cleanup(mf, clients); }
});

test('replaced sockets close and cannot permanently exhaust connection slots', async () => {
  const mf = runtime();
  const clients = [];
  try {
    const first = await connect(mf, '接管测试'); clients.push(first);
    first.send({ type: 'create_room', playerName: '接管测试' }); await first.next('room_created');
    for (let i = 0; i < 12; i++) {
      const previous = clients.at(-1);
      const client = await connect(mf, '', first.welcome.token); clients.push(client);
      await client.next('session_restored');
      await previous.next('session_elsewhere');
      if (previous.ws.readyState === 1) await new Promise(resolve => previous.ws.addEventListener('close', resolve, { once: true }));
      assert.notEqual(previous.ws.readyState, 1);
    }
    clients.at(-1).send({ type: 'list_rooms' }); await clients.at(-1).next('room_list');
  } finally { await cleanup(mf, clients); }
});

test('global authentication cap bounds per-IP storage and expiry uses its index', async () => {
  const mf = runtime();
  try {
    for (let i = 0; i < 125; i++) {
      const response = await mf.dispatchFetch(base + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `192.0.2.${i + 1}` },
        body: JSON.stringify({ name: 'unknown', password: 'bad' })
      });
      assert.equal(response.status, i < 120 ? 400 : 429);
    }
    const storage = await mf.unsafeGetDurableObjectStorage('splendor-test', 'GameHub', { name: 'competition-v1' });
    assert.equal((await storage.exec('SELECT COUNT(*) AS total FROM rate_limits'))[0].total, 121);
    const query = await storage.exec('EXPLAIN QUERY PLAN DELETE FROM rate_limits WHERE until <= ?', Date.now());
    assert.ok(query.some(row => row.detail.includes('rate_limits_until')));
  } finally { await cleanup(mf); }
});

test('unverified sockets expire and binary or oversized messages close safely', { timeout: 25000 }, async () => {
  const mf = runtime();
  const clients = [];
  try {
    const address = new URL('/ws', await mf.ready);
    address.protocol = 'ws:';
    // Local workerd delays TCP teardown after the alarm's close frame.
    const idle = new WebSocket(address, { origin, closeTimeout: 1000 }); clients.push({ ws: idle });
    const timeout = once(idle, 'close');
    await once(idle, 'open');
    for (const payload of [new Uint8Array([1, 2, 3]), '中'.repeat(3000)]) {
      const client = await connect(mf, '输入边界'); clients.push(client);
      const closed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Close not received for ${typeof payload}`)), 5000);
        client.ws.addEventListener('close', event => { clearTimeout(timer); resolve(event.code); }, { once: true });
      });
      client.ws.send(payload);
      assert.equal(await closed, 1009);
    }
    assert.equal((await timeout)[0], 1008);
  } finally { await cleanup(mf, clients); }
});

test('connection and account caps still allow an existing client and guest play', async () => {
  const mf = runtime(undefined, { MAX_CONNECTIONS: { type: 'text', value: '1' } });
  const clients = [];
  try {
    const a = await connect(mf, '限额游客'); clients.push(a);
    const extra = await mf.dispatchFetch(base + '/ws', { headers: { Origin: origin, Upgrade: 'websocket' } });
    assert.equal(extra.status, 429);
    const storage = await mf.unsafeGetDurableObjectStorage('splendor-test', 'GameHub', { name: 'competition-v1' });
    await storage.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x + 1 FROM n WHERE x < 1000)
      INSERT INTO users (id, name, salt, hash, createdAt)
      SELECT 'u_test_' || x, '测试账号' || x, 'unused-test-salt', 'unused-test-hash', 0 FROM n`);
    const registered = await auth(mf, '/api/register', '新测试账号');
    assert.equal(registered.status, 409);
    assert.match(registered.body.error, /账号名额已满/);
    a.send({ type: 'create_room', playerName: '限额游客' });
    await a.next('room_created');
  } finally { await cleanup(mf, clients); }
});

test('free-tier room cap and authentication throttling are enforced', async () => {
  const mf = runtime(undefined, { MAX_ROOMS: { type: 'text', value: '1' } });
  const clients = [];
  try {
    const a = await connect(mf, '限额甲'); clients.push(a);
    const b = await connect(mf, '限额乙'); clients.push(b);
    a.send({ type: 'create_room', playerName: '限额甲' }); await a.next('room_created');
    b.send({ type: 'create_room', playerName: '限额乙' });
    assert.match((await b.next('error')).message, /房间已满/);
    assert.equal((await auth(mf, '/api/register', '限额甲')).status, 409);
    let response;
    for (let i = 0; i < 16; i++) response = await auth(mf, '/api/login', 'invalid', 'bad');
    assert.equal(response.status, 429);
  } finally { await cleanup(mf, clients); }
});
