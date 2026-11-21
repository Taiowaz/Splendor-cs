import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, copyFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from 'ws';

async function connect(url, name, token) {
  const ws = new WebSocket(url);
  const messages = [];
  const waiters = [];
  ws.on('message', data => {
    const message = JSON.parse(data);
    const index = waiters.findIndex(item => item.type === message.type);
    if (index >= 0) { const [item] = waiters.splice(index, 1); clearTimeout(item.timer); item.resolve(message); }
    else messages.push(message);
  });
  const client = {
    ws,
    send(message) { ws.send(JSON.stringify(message)); },
    next(type) {
      const index = messages.findIndex(message => message.type === type);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const item = { type, resolve, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(item), 1);
          reject(new Error(`No ${type} message`));
        }, 5000) };
        waiters.push(item);
      });
    }
  };
  await once(ws, 'open');
  client.send({ type: 'hello', name, token });
  client.welcome = await client.next('welcome');
  return client;
}

test('existing Node adapter keeps real socket synchronization, timers and isolated file accounts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'splendor-node-adapter-'));
  const directory = join(root, 'server');
  const clients = [];
  let server;
  let wss;
  const previous = process.env.NODE_ENV;
  try {
    await mkdir(directory);
    for (const name of ['websocket.js', 'gameServer.js', 'accounts.js', 'accountService.js', 'gameLogic.js', 'ai.js', 'package.json']) {
      await copyFile(new URL(name, import.meta.url), join(directory, name));
    }
    await symlink(fileURLToPath(new URL('./node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir');
    await symlink(fileURLToPath(new URL('../shared', import.meta.url)), join(root, 'shared'), 'dir');
    process.env.NODE_ENV = 'production';
    const { setupWebSocket } = await import(pathToFileURL(join(directory, 'websocket.js')).href);
    const accountsUrl = pathToFileURL(join(directory, 'accounts.js')).href;
    const accounts = await import(accountsUrl);
    const registration = accounts.register('Node账号', 'test-password');
    const reloaded = await import(accountsUrl + '?reload=1');
    assert.deepEqual(reloaded.login('Node账号', 'test-password').user, registration.user);
    assert.deepEqual(reloaded.verifyToken(registration.token), registration.user);
    server = createServer();
    wss = setupWebSocket(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `ws://127.0.0.1:${server.address().port}/ws`;
    const a = await connect(url, '', registration.token); clients.push(a);
    const b = await connect(url, 'Node游客'); clients.push(b);
    a.send({ type: 'create_room' });
    const { roomId } = await a.next('room_created');
    b.send({ type: 'join_room', roomId, playerName: 'Node游客' }); await b.next('joined_room');
    a.send({ type: 'add_ai' }); a.send({ type: 'start_game' });
    assert.deepEqual((await a.next('game_started')).gameState, (await b.next('game_started')).gameState);
    a.send({ type: 'debug_set_tokens', tokens: { data: 99 } });
    assert.match((await a.next('error')).message, /不开放调试/);
    a.send({ type: 'take_tokens', tokens: { data: 1, compute: 1, citation: 1 } });
    assert.deepEqual((await a.next('tokens_taken')).gameState, (await b.next('tokens_taken')).gameState);
    await a.next('turn_changed'); await b.next('turn_changed');
    b.send({ type: 'reserve_card', tier: 1, cardIndex: 0 });
    await a.next('card_reserved'); await b.next('card_reserved');
    await a.next('turn_changed'); await b.next('turn_changed');
    const afterAi = (await a.next('turn_changed')).gameState;
    assert.equal(afterAi.turnCount, 3);
    assert.equal(afterAi.currentPlayerIndex, 0);
    assert.deepEqual((await b.next('turn_changed')).gameState, afterAi);
    b.ws.close(); await once(b.ws, 'close'); await a.next('player_offline');
    const reconnected = await connect(url, '', b.welcome.token); clients.push(reconnected);
    assert.deepEqual((await reconnected.next('session_restored')).gameState, afterAi);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    await Promise.all(clients.map(async ({ ws }) => {
      if (ws.readyState === WebSocket.CLOSED) return;
      const closed = once(ws, 'close'); ws.close(); await closed;
    }));
    if (wss) await new Promise(resolve => wss.close(resolve));
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
