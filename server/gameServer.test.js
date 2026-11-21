import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { createAccountService } from './accountService.js';
import { createGameServer } from './gameServer.js';

const START = 1_700_000_000_000;
const TTL = 30 * 24 * 3600 * 1000;
const THREE_COLORS = { data: 1, compute: 1, citation: 1 };
const TEN_TOKENS = { data: 2, compute: 2, citation: 2, collaborator: 1, funding: 1, coffee: 2 };
const clone = value => JSON.parse(JSON.stringify(value));

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  closes = [];

  send(data) {
    assert.equal(typeof data, 'string');
    assert.equal(this.readyState, 1);
    this.messages.push(JSON.parse(data));
  }

  request(message) {
    this.receive(JSON.stringify(message));
  }

  receive(data, isBinary = false) {
    this.emit('message', data, isBinary);
  }

  close(code, reason) {
    if (this.readyState !== 1) return;
    this.closes.push({ code, reason });
    this.readyState = 3;
    this.emit('close', code, reason);
  }

  last(type) {
    const message = this.messages.findLast(item => item.type === type);
    assert.ok(message, `expected ${type}; received ${this.messages.map(item => item.type).join(', ')}`);
    return message;
  }

  count(type) {
    return this.messages.filter(message => message.type === type).length;
  }
}

function fixture(t, options = {}) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const users = [];
  const clock = { value: START };
  const now = () => clock.value;
  const accounts = createAccountService({
    secret: 'game-server-tests-only',
    now,
    store: {
      getByName: name => users.find(user => user.name === name),
      getById: id => users.find(user => user.id === id),
      insert: user => users.push(user)
    }
  });
  const build = snapshot => createGameServer({ accounts, now, ...options, snapshot });
  return { accounts, clock, build, engine: build(), clients: [] };
}

function connect(h, saved = null) {
  const ws = new Socket();
  ws.connection = h.engine.connect(ws, saved);
  h.clients.push(ws);
  return ws;
}

function hello(h, name, token) {
  const ws = connect(h);
  ws.request({ type: 'hello', name, token });
  const welcome = ws.last('welcome');
  assert.deepEqual(h.accounts.verifyToken(welcome.token), welcome.player);
  return ws;
}

function table(t, options = {}, { aiCount = 0, humans = 2, started = true } = {}) {
  const h = fixture(t, options);
  const host = hello(h, 'Alice');
  host.request({ type: 'create_room', playerName: 'Alice' });
  h.roomId = host.last('room_created').roomId;
  if (humans === 2) {
    const guest = hello(h, 'Bob');
    guest.request({ type: 'join_room', roomId: h.roomId, playerName: 'Bob' });
    guest.last('joined_room');
  }
  for (let i = 0; i < aiCount; i++) host.request({ type: 'add_ai', aiName: `Bot ${i}` });
  if (started) {
    host.request({ type: 'start_game' });
    host.last('game_started');
  }
  return h;
}

function snapshot(h) {
  return clone(h.engine.exportSnapshot());
}

function room(h) {
  const result = snapshot(h).rooms.find(item => item.id === h.roomId);
  assert.ok(result, 'room must exist');
  return result;
}

function reconstruct(h, mutate = () => {}) {
  const state = snapshot(h);
  const saved = h.clients.map(ws => clone(h.engine.exportConnection(ws.connection)));
  mutate(state.rooms.find(item => item.id === h.roomId), state);
  h.engine = h.build(state);
  h.clients = [];
  for (const attachment of saved) connect(h, attachment);
  h.engine.reconcileConnections();
  return h.clients;
}

function giveTokens(game, playerIndex, tokens) {
  for (const [type, count] of Object.entries(tokens)) {
    assert.ok(game.bank.tokens[type] >= count);
    game.bank.tokens[type] -= count;
    game.players[playerIndex].tokens[type] += count;
  }
}

function assertConserved(game) {
  const supply = { 2: 4, 3: 5, 4: 7 }[game.players.length];
  for (const type of Object.keys(game.bank.tokens)) {
    const counts = [game.bank.tokens[type], ...game.players.map(player => player.tokens[type])];
    assert.ok(counts.every(count => Number.isSafeInteger(count) && count >= 0), type);
    assert.equal(counts.reduce((sum, count) => sum + count, 0), type === 'coffee' ? 5 : supply, type);
  }
}

function assertPublicState(state, game) {
  assert.deepEqual(state.players, game.players);
  for (const tier of [1, 2, 3]) {
    assert.equal(Object.hasOwn(state.bank, `draw${tier}`), false);
    assert.equal(state.bank[`draw${tier}Count`], game.bank[`draw${tier}`].length);
    assert.deepEqual(state.bank[`tier${tier}`], game.bank[`tier${tier}`]);
  }
  assert.deepEqual(state.bank.tokens, game.bank.tokens);
  assert.deepEqual(state.bank.nobles, game.bank.nobles);
  for (const key of ['currentPlayerIndex', 'pendingDiscard', 'gameOver', 'winner', 'turnCount']) {
    assert.deepEqual(state[key], game[key], key);
  }
}

function assertSynchronized(h, type, clients = h.clients) {
  const game = room(h).game;
  const expected = clients[0].last(type);
  for (const ws of clients) {
    assert.deepEqual(ws.last(type), expected);
    assertPublicState(ws.last(type).gameState, game);
  }
  assertConserved(game);
}

function assertRejected(h, ws, message, pattern) {
  const before = snapshot(h);
  const count = ws.messages.length;
  ws.request(message);
  const received = ws.messages.slice(count);
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'error');
  if (pattern) assert.match(received[0].message, pattern);
  assert.deepEqual(snapshot(h), before, 'rejected requests must not mutate persistent state');
}

function assertTransportFree(value) {
  assert.doesNotThrow(() => JSON.stringify(value));
  const visit = node => {
    assert.notEqual(typeof node, 'function');
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      assert.notEqual(key, 'ws');
      assert.notEqual(key, 'conn');
      visit(child);
    }
  };
  visit(value);
  assert.deepEqual(clone(value), value);
}

test('two clients handshake, create, join, start and take synchronized public turns', t => {
  const h = table(t);
  const [host, guest] = h.clients;
  assert.equal(host.count('session_lost'), 1);
  assert.equal(guest.count('session_lost'), 1);
  assert.equal(host.last('room_created').playerId, host.last('welcome').player.id);
  assert.equal(guest.last('joined_room').hostId, host.last('welcome').player.id);
  assert.deepEqual(host.last('room_update'), guest.last('room_update'));
  assert.equal(host.last('room_update').players.length, 2);
  assertSynchronized(h, 'game_started');
  assert.equal(h.engine.nextDeadline(), null);

  host.request({ type: 'take_tokens', tokens: THREE_COLORS });
  assertSynchronized(h, 'tokens_taken');
  assertSynchronized(h, 'turn_changed');
  assert.equal(room(h).game.currentPlayerIndex, 1);
  assert.equal(room(h).game.turnCount, 1);
  assert.equal(room(h).game.players[0].tokens.data, 1);
  guest.request({ type: 'take_tokens', tokens: { collaborator: 2 } });
  assertSynchronized(h, 'tokens_taken');
  assertSynchronized(h, 'turn_changed');
  assert.equal(room(h).game.currentPlayerIndex, 0);
  assert.equal(room(h).game.turnCount, 2);
});

test('only the host may add or remove AI and start; host authority transfers on departure', t => {
  const h = table(t, {}, { started: false });
  const [host, guest] = h.clients;
  assertRejected(h, guest, { type: 'add_ai' }, /房主/);
  assertRejected(h, guest, { type: 'start_game' }, /房主/);
  host.request({ type: 'add_ai', aiName: 'Assistant' });
  const ai = room(h).players.find(player => player.isAi);
  assert.ok(ai);
  assertRejected(h, guest, { type: 'remove_ai', playerId: ai.id }, /房主/);
  host.request({ type: 'remove_ai', playerId: ai.id });
  assert.equal(room(h).players.length, 2);
  host.request({ type: 'add_ai', aiName: 'Replacement' });
  host.request({ type: 'leave_room' });
  assert.equal(room(h).hostId, guest.last('welcome').player.id);
  guest.request({ type: 'start_game' });
  guest.last('game_started');
  assert.equal(room(h).started, true);
});

test('a solo host cannot start and an active game cannot be restarted or change AI seats', t => {
  const h = table(t, {}, { humans: 1, started: false });
  const [host] = h.clients;
  assertRejected(h, host, { type: 'start_game' }, /至少需要2/);
  host.request({ type: 'add_ai' });
  const aiId = room(h).players[1].id;
  host.request({ type: 'start_game' });
  host.request({ type: 'take_tokens', tokens: THREE_COLORS });
  assertRejected(h, host, { type: 'start_game' }, /本局还在进行/);
  assertRejected(h, host, { type: 'add_ai' }, /游戏已开始/);
  assertRejected(h, host, { type: 'remove_ai', playerId: aiId }, /游戏已开始/);
});

test('turn authority ignores forged player ids for every gameplay action', t => {
  const h = table(t);
  const [host, guest] = h.clients;
  const hostId = host.last('welcome').player.id;
  const card = room(h).game.bank.tier1[0];
  for (const message of [
    { type: 'take_tokens', tokens: THREE_COLORS },
    { type: 'return_tokens', tokens: { data: 1 } },
    { type: 'reserve_card', tier: 1, cardIndex: 0 },
    { type: 'buy_card', tier: 1, cardId: card.id }
  ]) assertRejected(h, guest, { ...message, playerId: hostId }, /不是你的回合/);
  host.request({ type: 'take_tokens', tokens: THREE_COLORS });
  assertRejected(h, host, { type: 'take_tokens', tokens: THREE_COLORS }, /不是你的回合/);
});

test('game-over snapshots reject gameplay actions without changing the winner or deck', t => {
  const h = table(t);
  const [host] = reconstruct(h, savedRoom => {
    savedRoom.game.gameOver = true;
    savedRoom.game.winner = savedRoom.game.players[0];
  });
  for (const message of [
    { type: 'take_tokens', tokens: THREE_COLORS },
    { type: 'return_tokens', tokens: { data: 1 } },
    { type: 'reserve_card', tier: 1, cardIndex: 0 },
    { type: 'buy_card', tier: 1, cardId: room(h).game.bank.tier1[0].id }
  ]) assertRejected(h, host, message, /游戏已结束/);
});

test('taking over the limit requires a synchronized exact discard before advancing', t => {
  const h = table(t, { debug: true });
  const [host, guest] = reconstruct(h, savedRoom => giveTokens(savedRoom.game, 0, TEN_TOKENS));
  const hostId = room(h).players[0].id;
  host.request({ type: 'take_tokens', tokens: THREE_COLORS });
  assertSynchronized(h, 'tokens_taken');
  assertSynchronized(h, 'discard_required');
  assert.deepEqual(room(h).game.pendingDiscard, { playerId: hostId, count: 3 });
  assert.equal(room(h).game.currentPlayerIndex, 0);
  assert.equal(room(h).game.turnCount, 0);
  assert.equal(host.count('turn_changed'), 0);
  for (const message of [
    { type: 'take_tokens', tokens: THREE_COLORS },
    { type: 'reserve_card', tier: 1, cardIndex: 0 },
    { type: 'buy_card', tier: 1, cardId: room(h).game.bank.tier1[0].id },
    { type: 'debug_set_tokens', playerId: hostId, tokens: { data: 0 } },
    { type: 'debug_reserved', playerId: hostId, delta: 1 },
    { type: 'debug_vc', playerId: hostId, resource: 'data', count: 1 }
  ]) assertRejected(h, host, message, /归还/);
  assertRejected(h, guest, { type: 'return_tokens', tokens: { data: 3 } }, /不是你的回合/);
  for (const tokens of [{ data: 2 }, { data: 4 }, { funding: 3 }, { data: -3 }, { data: 1.5, compute: 1.5 }]) {
    assertRejected(h, host, { type: 'return_tokens', tokens });
  }
  host.request({ type: 'return_tokens', tokens: { data: 1, funding: 1, coffee: 1 } });
  assertSynchronized(h, 'tokens_returned');
  assertSynchronized(h, 'turn_changed');
  assert.equal(room(h).game.pendingDiscard, null);
  assert.equal(room(h).game.turnCount, 1);
  assert.equal(room(h).game.currentPlayerIndex, 1);
  assertRejected(h, host, { type: 'return_tokens', tokens: { data: 1 } }, /不是你的回合/);
});

test('pending discard survives JSON reconstruction and delays victory until return', t => {
  const h = table(t);
  reconstruct(h, savedRoom => {
    giveTokens(savedRoom.game, 0, TEN_TOKENS);
    savedRoom.game.players[0].prestige = 15;
  });
  h.clients[0].request({ type: 'take_tokens', tokens: THREE_COLORS });
  const pending = room(h).game;
  assert.equal(pending.gameOver, false);
  const [host] = reconstruct(h);
  assert.deepEqual(room(h).game, pending);
  host.request({ type: 'return_tokens', tokens: { data: 3 } });
  assertSynchronized(h, 'game_over');
  assert.equal(room(h).game.winner.id, room(h).players[0].id);
  assert.equal(room(h).game.turnCount, 0);
  assert.equal(room(h).game.pendingDiscard, null);
});

test('reserving at ten tokens publishes the card and pauses for a coffee discard', t => {
  const h = table(t);
  const [host] = reconstruct(h, savedRoom => giveTokens(savedRoom.game, 0, TEN_TOKENS));
  const before = room(h).game;
  host.request({ type: 'reserve_card', tier: 2, cardIndex: 1 });
  assertSynchronized(h, 'card_reserved');
  assertSynchronized(h, 'discard_required');
  const game = room(h).game;
  assert.deepEqual(game.players[0].reservedCards, [before.bank.tier2[1]]);
  assert.equal(game.players[0].tokens.coffee, 3);
  assert.deepEqual(game.bank.tier2, [...before.bank.tier2.filter((_, index) => index !== 1), before.bank.draw2[0]]);
  assert.deepEqual(game.bank.draw2, before.bank.draw2.slice(1));
  assert.deepEqual(game.pendingDiscard, { playerId: game.players[0].id, count: 1 });
  host.request({ type: 'return_tokens', tokens: { coffee: 1 } });
  assertSynchronized(h, 'turn_changed');
  assert.equal(room(h).game.currentPlayerIndex, 1);
});

for (const fromReserved of [false, true]) {
  test(`publishing a ${fromReserved ? 'reserved' : 'face-up'} card pays costs and synchronizes bonus and deck`, t => {
    const h = table(t);
    const selected = room(h).game.bank.tier1[0];
    let [host, guest] = reconstruct(h, savedRoom => giveTokens(savedRoom.game, 0, selected.cost));
    if (fromReserved) {
      host.request({ type: 'reserve_card', tier: 1, cardIndex: 0 });
      assertSynchronized(h, 'card_reserved');
      assert.deepEqual(guest.last('card_reserved').card, selected);
      guest.request({ type: 'reserve_card', tier: 2, cardIndex: 0 });
      [host, guest] = reconstruct(h);
    }
    const before = room(h).game;
    host.request({ type: 'buy_card', cardId: selected.id, tier: 1, fromReserved });
    assertSynchronized(h, 'card_bought');
    assertSynchronized(h, 'turn_changed');
    const after = room(h).game;
    assert.deepEqual(after.players[0].cards, [selected]);
    assert.deepEqual(after.players[0].reservedCards, []);
    assert.equal(after.players[0].bonus[selected.bonus], 1);
    assert.equal(after.players[0].prestige, selected.prestige);
    for (const [type, cost] of Object.entries(selected.cost)) {
      assert.equal(after.players[0].tokens[type], before.players[0].tokens[type] - cost);
      assert.equal(after.bank.tokens[type], before.bank.tokens[type] + cost);
    }
    assert.equal(after.players[0].tokens.coffee, fromReserved ? 1 : 0);
    assert.deepEqual(after.bank.draw1, fromReserved ? before.bank.draw1 : before.bank.draw1.slice(1));
    assert.deepEqual(after.bank.tier1, fromReserved ? before.bank.tier1 : [...before.bank.tier1.slice(1), before.bank.draw1[0]]);
  });
}

test('production defaults deny every debug operation without altering the game', t => {
  const h = table(t);
  const [host] = h.clients;
  const playerId = room(h).players[0].id;
  for (const message of [
    { type: 'debug_set_tokens', playerId, tokens: { data: 2 } },
    { type: 'debug_reserved', playerId, delta: 1 },
    { type: 'debug_vc', playerId, resource: 'data', count: 1 },
    { type: 'debug_unknown' }
  ]) assertRejected(h, host, message, /生产环境/);
});

test('debug true retains token, reservation and published-card controls across reconstruction', t => {
  const h = table(t, { debug: true });
  const [host, guest] = reconstruct(h);
  const playerId = room(h).players[0].id;
  guest.request({ type: 'debug_set_tokens', playerId, tokens: { data: 2 } });
  assertSynchronized(h, 'debug_update');
  assert.equal(room(h).game.players[0].tokens.data, 2);
  host.request({ type: 'debug_reserved', playerId, delta: 1 });
  assertSynchronized(h, 'debug_update');
  assert.equal(room(h).game.players[0].reservedCards.length, 1);
  host.request({ type: 'debug_reserved', playerId, delta: -1 });
  assert.equal(room(h).game.players[0].reservedCards.length, 0);
  host.request({ type: 'debug_vc', playerId, resource: 'data', count: 1 });
  assertSynchronized(h, 'debug_update');
  assert.equal(room(h).game.players[0].bonus.data, 1);
  assert.equal(room(h).game.players[0].cards.length, 1);
  host.request({ type: 'debug_vc', playerId, resource: 'data', count: 0 });
  assertSynchronized(h, 'debug_update');
  assert.equal(room(h).game.players[0].cards.length, 0);
  assert.equal(room(h).game.players[0].bonus.data, 0);
  assert.equal(room(h).game.turnCount, 0);
  assert.equal(room(h).game.currentPlayerIndex, 0);
});

test('duplicate hello cannot replace a seated identity or token', t => {
  const h = table(t);
  const [host, guest] = h.clients;
  const before = clone(h.engine.exportConnection(host.connection));
  assertRejected(h, host, { type: 'hello', token: guest.last('welcome').token, name: 'Other' }, /已完成身份验证/);
  assertRejected(h, host, { type: 'hello', token: 'invalid', name: 'Other' }, /已完成身份验证/);
  assert.deepEqual(h.engine.exportConnection(host.connection), before);
  host.request({ type: 'take_tokens', tokens: THREE_COLORS });
  assert.equal(guest.last('tokens_taken').playerId, before.playerId);
});

test('same-token takeover detaches the old socket and its later close cannot disconnect the new seat', t => {
  const h = table(t, { graceMs: 50 });
  const [old, guest] = h.clients;
  const replacement = hello(h, undefined, old.last('welcome').token);
  assert.equal(old.last('session_elsewhere').type, 'session_elsewhere');
  assert.equal(replacement.last('session_restored').reclaimed, false);
  const detached = h.engine.exportConnection(old.connection);
  assert.equal(detached.detached, true);
  assert.equal(detached.roomId, null);
  assert.equal(detached.playerId, null);
  const before = snapshot(h);
  old.request({ type: 'take_tokens', tokens: THREE_COLORS });
  old.request({ type: 'hello', token: guest.last('welcome').token });
  assert.equal(old.count('session_elsewhere'), 3);
  assert.deepEqual(snapshot(h), before);
  old.close();
  assert.equal(room(h).players[0].offline, false);
  assert.equal(h.engine.nextDeadline(), null);
  replacement.request({ type: 'take_tokens', tokens: THREE_COLORS });
  assertSynchronized(h, 'tokens_taken', [replacement, guest]);
});

test('disconnect and token reconnect preserve the full deck and cancel the grace deadline', t => {
  const h = table(t, { graceMs: 50 });
  const [host, guest] = h.clients;
  const token = host.last('welcome').token;
  const game = room(h).game;
  host.close();
  assert.equal(guest.last('player_offline').graceMs, 50);
  assert.equal(room(h).players[0].offline, true);
  assert.equal(h.engine.nextDeadline(), START + 50);
  h.clock.value += 49;
  const replacement = hello(h, undefined, token);
  assert.equal(replacement.last('session_restored').reclaimed, false);
  assertPublicState(replacement.last('session_restored').gameState, game);
  assert.deepEqual(room(h).game, game);
  assert.equal(h.engine.nextDeadline(), null);
  assert.deepEqual(snapshot(h).graceTimers, []);
  h.clock.value++;
  h.engine.runDueTasks();
  assert.equal(room(h).players[0].isAi, false);
  replacement.request({ type: 'take_tokens', tokens: THREE_COLORS });
  assertSynchronized(h, 'tokens_taken', [replacement, guest]);
});

test('snapshots and connection attachments serialize without transport objects and restore exact matching seats', t => {
  const h = table(t);
  h.clients[0].request({ type: 'reserve_card', tier: 3, cardIndex: 2 });
  const state = h.engine.exportSnapshot();
  assertTransportFree(state);
  const attachments = h.clients.map(ws => h.engine.exportConnection(ws.connection));
  for (const [index, attachment] of attachments.entries()) {
    assertTransportFree(attachment);
    assert.equal(state.rooms[0].players[index].connectionId, attachment.id);
    assert.equal(state.rooms[0].players[index].id, attachment.playerId);
    assert.equal(state.rooms[0].id, attachment.roomId);
  }
  const before = clone(state);
  const [host, guest] = reconstruct(h);
  assert.deepEqual(snapshot(h), before);
  for (const [index, ws] of h.clients.entries()) {
    assert.deepEqual(h.engine.exportConnection(ws.connection), attachments[index]);
    assert.equal(ws.messages.length, 0);
  }
  assert.equal(h.engine.nextDeadline(), null);
  guest.request({ type: 'reserve_card', tier: 1, cardIndex: 1 });
  assertSynchronized(h, 'card_reserved');
  const after = room(h).game;
  assert.deepEqual(after.players[1].reservedCards, [before.rooms[0].game.bank.tier1[1]]);
  assert.deepEqual(after.bank.draw1, before.rooms[0].game.bank.draw1.slice(1));
  assert.deepEqual(after.bank.draw2, before.rooms[0].game.bank.draw2);
  assert.deepEqual(after.bank.draw3, before.rooms[0].game.bank.draw3);
  assert.equal(host.count('turn_changed'), 1);
});

test('an attachment with a nonmatching connection id cannot attach or act as that seat', t => {
  const h = table(t, { graceMs: 50 });
  const saved = clone(h.engine.exportConnection(h.clients[0].connection));
  h.engine = h.build(snapshot(h));
  h.clients = [];
  const stale = connect(h, { ...saved, id: 'not-the-saved-connection' });
  const exported = h.engine.exportConnection(stale.connection);
  assert.equal(exported.roomId, null);
  assert.equal(exported.playerId, null);
  h.engine.reconcileConnections();
  assert.equal(room(h).players[0].offline, true);
  assert.equal(h.engine.nextDeadline(), START + 50);
  const before = snapshot(h);
  stale.request({ type: 'take_tokens', tokens: THREE_COLORS });
  assert.deepEqual(snapshot(h), before);
  const recovered = hello(h, undefined, saved.token);
  assert.equal(recovered.last('session_restored').playerId, saved.playerId);
  recovered.request({ type: 'take_tokens', tokens: THREE_COLORS });
  assert.equal(room(h).game.turnCount, 1);
});

test('a saved detached connection remains unable to act after reconstruction', t => {
  const h = table(t);
  const [old] = h.clients;
  hello(h, undefined, old.last('welcome').token);
  const [restoredOld, guest, replacement] = reconstruct(h);
  const before = snapshot(h);
  restoredOld.request({ type: 'take_tokens', tokens: THREE_COLORS });
  restoredOld.last('session_elsewhere');
  restoredOld.close();
  assert.deepEqual(snapshot(h), before);
  replacement.request({ type: 'take_tokens', tokens: THREE_COLORS });
  assertSynchronized(h, 'tokens_taken', [replacement, guest]);
});

test('reconciling zero connections creates stable grace deadlines, reclaimable AI, then room cleanup', t => {
  const h = table(t, { graceMs: 50, roomHoldMs: 200 });
  const token = h.clients[0].last('welcome').token;
  const beforeGame = room(h).game;
  h.engine = h.build(snapshot(h));
  h.clients = [];
  assert.equal(h.engine.nextDeadline(), null);
  h.engine.reconcileConnections();
  assert.equal(room(h).players.every(player => player.offline), true);
  const held = snapshot(h);
  assert.equal(held.graceTimers.length, 2);
  assert.ok(held.graceTimers.every(([, deadline]) => deadline === START + 50));
  h.clock.value += 49;
  h.engine.reconcileConnections();
  h.engine.runDueTasks();
  assert.deepEqual(snapshot(h), held);
  h.clock.value++;
  h.engine.runDueTasks();
  assert.ok(room(h).players.every(player => player.isAi && player.wasHuman && !player.offline && !player.leftByUser));
  assert.deepEqual(room(h).game, beforeGame);
  assert.deepEqual(snapshot(h).graceTimers, []);
  assert.equal(room(h).aiDueAt, null);
  assert.equal(h.engine.nextDeadline(), START + 250);
  assert.equal(h.engine.nameTaken('Alice'), true);
  h.clock.value = START + 249;
  h.engine.runDueTasks();
  assert.equal(snapshot(h).rooms.length, 1);
  h.clock.value++;
  h.engine.runDueTasks();
  assert.deepEqual(snapshot(h), { rooms: [], graceTimers: [], roomHolds: [] });
  assert.equal(h.engine.nextDeadline(), null);
  assert.equal(h.engine.nameTaken('Alice'), false);
  const client = hello(h, undefined, token);
  client.last('session_lost');
  assert.equal(client.count('session_restored'), 0);
});

test('a grace-expired human can reclaim AI progress automatically with the original token', t => {
  const h = table(t, { graceMs: 50 });
  const [host, guest] = h.clients;
  const token = host.last('welcome').token;
  host.close();
  h.clock.value += 50;
  h.engine.runDueTasks();
  assert.equal(room(h).players[0].isAi, true);
  assert.equal(room(h).players[0].leftByUser, false);
  assert.equal(room(h).hostId, room(h).players[1].id);
  assert.equal(h.engine.nextDeadline(), START + 1050);
  h.clock.value = h.engine.nextDeadline();
  h.engine.runDueTasks();
  const game = room(h).game;
  assert.equal(game.turnCount, 1);
  assert.equal(game.currentPlayerIndex, 1);
  const replacement = hello(h, undefined, token);
  assert.equal(replacement.last('session_restored').reclaimed, true);
  guest.last('player_reclaimed');
  assert.deepEqual(room(h).game, game);
  assert.equal(h.engine.nextDeadline(), null);
  assert.equal(room(h).players[0].isAi, false);
  guest.request({ type: 'take_tokens', tokens: THREE_COLORS });
  replacement.request({ type: 'take_tokens', tokens: THREE_COLORS });
  assertSynchronized(h, 'tokens_taken', [replacement, guest]);
});

test('intentional departure requires explicit join to reclaim and cancels the empty-room hold', t => {
  const h = table(t, { roomHoldMs: 200 });
  const [host, guest] = h.clients;
  const token = host.last('welcome').token;
  host.request({ type: 'leave_room' });
  guest.request({ type: 'leave_room' });
  assert.equal(room(h).players.every(player => player.isAi && player.leftByUser), true);
  assert.equal(h.engine.nextDeadline(), START + 200);
  const replacement = hello(h, undefined, token);
  assert.equal(replacement.count('session_restored'), 0);
  replacement.request({ type: 'list_rooms' });
  assert.equal(replacement.last('room_list').rooms[0].rejoinable, true);
  replacement.request({ type: 'join_room', roomId: h.roomId, playerName: 'Alice' });
  assert.equal(replacement.last('session_restored').reclaimed, true);
  assert.deepEqual(snapshot(h).roomHolds, []);
  assert.equal(h.engine.nextDeadline(), null);
  h.clock.value += 200;
  h.engine.runDueTasks();
  assert.equal(room(h).players[0].isAi, false);
});

test('reconnecting after all grace periods expire cancels the room hold', t => {
  const h = table(t, { graceMs: 50, roomHoldMs: 200 });
  const token = h.clients[0].last('welcome').token;
  h.clients.forEach(ws => ws.close());
  h.clock.value += 50;
  h.engine.runDueTasks();
  assert.equal(h.engine.nextDeadline(), START + 250);
  const replacement = hello(h, undefined, token);
  assert.equal(replacement.last('session_restored').reclaimed, true);
  assert.deepEqual(snapshot(h).roomHolds, []);
  assert.equal(h.engine.nextDeadline(), null);
});

test('empty lobby expiry removes departed seats and lets a new entrant become host', t => {
  const h = table(t, { graceMs: 50, roomHoldMs: 200 }, { humans: 1, started: false });
  h.clients[0].close();
  h.clock.value += 50;
  h.engine.runDueTasks();
  assert.deepEqual(room(h).players, []);
  assert.equal(h.engine.nextDeadline(), START + 250);
  const newcomer = hello(h, 'Carol');
  newcomer.request({ type: 'join_room', roomId: h.roomId, playerName: 'Carol' });
  assert.equal(room(h).hostId, newcomer.last('welcome').player.id);
  assert.deepEqual(snapshot(h).roomHolds, []);
  newcomer.request({ type: 'add_ai' });
  newcomer.request({ type: 'start_game' });
  newcomer.last('game_started');
});

test('AI alarms advance only one action per due timestamp, even when overdue and reconstructed', t => {
  const h = table(t, {}, { humans: 1, aiCount: 2 });
  h.clients[0].request({ type: 'take_tokens', tokens: THREE_COLORS });
  const firstDue = h.engine.nextDeadline();
  assert.equal(firstDue, START + 1000);
  const waiting = snapshot(h);
  h.clock.value = firstDue - 1;
  h.engine.runDueTasks();
  assert.deepEqual(snapshot(h), waiting);
  const [host] = reconstruct(h);
  assert.equal(h.engine.nextDeadline(), firstDue);
  h.clock.value = firstDue + 20_000;
  h.engine.runDueTasks();
  assert.equal(room(h).game.turnCount, 2);
  assert.equal(room(h).game.currentPlayerIndex, 2);
  assert.equal(host.count('turn_changed'), 1);
  assertPublicState(host.last('turn_changed').gameState, room(h).game);
  assert.equal(h.engine.nextDeadline(), h.clock.value + 1000);
  const once = snapshot(h);
  h.engine.runDueTasks();
  h.engine.runDueTasks();
  assert.deepEqual(snapshot(h), once);
  assert.equal(host.count('turn_changed'), 1);
  h.clock.value += 1000;
  h.engine.runDueTasks();
  assert.equal(room(h).game.turnCount, 3);
  assert.equal(room(h).game.currentPlayerIndex, 0);
  assert.equal(host.count('turn_changed'), 2);
  assert.equal(h.engine.nextDeadline(), null);
  assertConserved(room(h).game);
});

test('an AI pending discard uses a separate alarm rather than consuming two actions at once', t => {
  const h = table(t, {}, { humans: 1, aiCount: 1 });
  reconstruct(h, savedRoom => {
    giveTokens(savedRoom.game, 1, TEN_TOKENS);
    for (const tier of [1, 2, 3]) {
      for (const card of savedRoom.game.bank[`tier${tier}`]) card.cost = { data: 99 };
    }
  });
  const [host] = h.clients;
  host.request({ type: 'take_tokens', tokens: THREE_COLORS });
  h.clock.value = h.engine.nextDeadline();
  h.engine.runDueTasks();
  assert.equal(room(h).game.pendingDiscard.count, 3);
  assert.equal(room(h).game.currentPlayerIndex, 1);
  assert.equal(room(h).game.turnCount, 1);
  assert.equal(host.count('discard_required'), 1);
  const afterTake = snapshot(h);
  h.engine.runDueTasks();
  assert.deepEqual(snapshot(h), afterTake);
  assert.equal(host.count('tokens_returned'), 0);
  h.clock.value = h.engine.nextDeadline();
  h.engine.runDueTasks();
  assert.equal(host.count('tokens_returned'), 1);
  assert.equal(room(h).game.pendingDiscard, null);
  assert.equal(room(h).game.turnCount, 2);
  assert.equal(h.engine.nextDeadline(), null);
  assertConserved(room(h).game);
});

test('all humans leaving cancels pending AI work and holds a frozen game until cleanup', t => {
  const h = table(t, { roomHoldMs: 5000 }, { humans: 1, aiCount: 2 });
  const [host] = h.clients;
  host.request({ type: 'take_tokens', tokens: THREE_COLORS });
  assert.equal(h.engine.nextDeadline(), START + 1000);
  host.request({ type: 'leave_room' });
  const game = room(h).game;
  assert.equal(room(h).aiDueAt, null);
  assert.equal(h.engine.nextDeadline(), START + 5000);
  h.clock.value += 1000;
  h.engine.runDueTasks();
  assert.deepEqual(room(h).game, game);
  h.clock.value = START + 4999;
  h.engine.runDueTasks();
  assert.deepEqual(room(h).game, game);
  h.clock.value++;
  h.engine.runDueTasks();
  assert.equal(snapshot(h).rooms.length, 0);
  assert.equal(h.engine.nextDeadline(), null);
});

test('grace expiry suppresses an already-due AI alarm when no humans remain', t => {
  const h = table(t, { graceMs: 50, roomHoldMs: 5000 }, { humans: 1, aiCount: 1 });
  const [host] = h.clients;
  host.request({ type: 'take_tokens', tokens: THREE_COLORS });
  const game = room(h).game;
  host.close();
  assert.equal(h.engine.nextDeadline(), START + 50);
  h.clock.value += 2000;
  h.engine.runDueTasks();
  assert.deepEqual(room(h).game, game);
  assert.equal(room(h).aiDueAt, null);
  assert.equal(h.engine.nextDeadline(), START + 7000);
});

test('maxRooms counts held rooms, permits joining, and frees capacity after hold expiry', t => {
  const h = table(t, { maxRooms: 1, roomHoldMs: 100 }, { humans: 1, started: false });
  const [host] = h.clients;
  const guest = hello(h, 'Bob');
  assertRejected(h, guest, { type: 'create_room', playerName: 'Bob' }, /房间已满/);
  guest.request({ type: 'join_room', roomId: h.roomId, playerName: 'Bob' });
  guest.last('joined_room');
  host.request({ type: 'leave_room' });
  guest.request({ type: 'leave_room' });
  assertRejected(h, guest, { type: 'create_room', playerName: 'Bob' }, /房间已满/);
  h.clock.value += 100;
  h.engine.runDueTasks();
  guest.request({ type: 'create_room', playerName: 'Bob' });
  guest.last('room_created');
  assert.equal(snapshot(h).rooms.length, 1);
  assert.equal(snapshot(h).rooms[0].hostId, guest.last('welcome').player.id);
});

test('maxRooms zero refuses room creation without assigning a seat', t => {
  const h = fixture(t, { maxRooms: 0 });
  const client = hello(h, 'Alice');
  assertRejected(h, client, { type: 'create_room', playerName: 'Alice' }, /房间已满/);
  assert.equal(h.engine.exportConnection(client.connection).roomId, null);
});

test('unauthenticated, malformed, unknown and non-JSON binary messages cannot mutate state', t => {
  const h = fixture(t);
  const client = connect(h);
  assertRejected(h, client, { type: 'create_room', playerName: 'Alice' }, /hello/);
  client.request({ type: 'hello', name: 'Alice' });
  assertRejected(h, client, { type: 'not_a_command' }, /Unknown/);
  for (const data of ['', '{', 'null', '[]', '1', 'true', '"hello"', '{}', '{"type":1}', Buffer.from([0xff, 0, 0x80])]) {
    const before = snapshot(h);
    const count = client.count('error');
    assert.doesNotThrow(() => client.receive(data, Buffer.isBuffer(data)));
    assert.equal(client.count('error'), count + 1);
    assert.match(client.last('error').message, /Invalid message/);
    assert.deepEqual(snapshot(h), before);
  }
  client.request({ type: 'list_rooms' });
  assert.deepEqual(client.last('room_list').rooms, []);
});

test('Node WebSocket text Buffers support hello and authenticated commands', t => {
  const h = fixture(t);
  const client = connect(h);
  client.receive(Buffer.from(JSON.stringify({ type: 'hello', name: 'Alice' })), false);
  client.last('welcome');
  client.receive(Buffer.from(JSON.stringify({ type: 'create_room', playerName: 'Alice' })), false);
  client.last('room_created');
  assert.equal(snapshot(h).rooms.length, 1);
});

test('8192-byte messages are accepted and larger string or Buffer messages are rejected', t => {
  const h = fixture(t);
  const client = hello(h, 'Alice');
  const base = JSON.stringify({ type: 'list_rooms' });
  const boundary = base.padEnd(8192);
  for (const data of [boundary, Buffer.from(boundary)]) {
    client.receive(data);
    assert.equal(client.last('room_list').type, 'room_list');
  }
  assert.equal(client.count('room_list'), 2);
  for (const data of [`${boundary} `, Buffer.from(`${boundary} `)]) {
    const before = snapshot(h);
    const errors = client.count('error');
    client.receive(data);
    assert.equal(client.count('error'), errors + 1);
    assert.deepEqual(snapshot(h), before);
  }
});

test('the message size limit applies to UTF-8 bytes, not JavaScript character count', t => {
  const h = fixture(t);
  const client = hello(h, 'Alice');
  const data = JSON.stringify({ type: 'list_rooms', padding: '界'.repeat(3000) });
  assert.ok(data.length < 8192);
  assert.ok(Buffer.byteLength(data) > 8192);
  const errors = client.count('error');
  client.receive(data);
  assert.equal(client.count('error'), errors + 1);
  assert.equal(client.count('room_list'), 0);
});

test('nameTaken includes registered users, lobby connections and held seats, excluding the same guest', t => {
  const h = table(t, { graceMs: 50 });
  h.accounts.register('Registered', 'test-password');
  const [host] = h.clients;
  const id = host.last('welcome').player.id;
  assert.equal(h.engine.nameTaken('Registered'), true);
  assert.equal(h.engine.nameTaken('Alice'), true);
  assert.equal(h.engine.nameTaken('Alice', id), false);
  assert.equal(h.engine.nameTaken(''), false);
  const lobby = hello(h, 'Carol');
  assert.equal(h.engine.nameTaken('Carol'), true);
  lobby.close();
  assert.equal(h.engine.nameTaken('Carol'), false);
  host.close();
  assert.equal(h.engine.nameTaken('Alice'), true);
  h.clock.value += 50;
  h.engine.runDueTasks();
  assert.equal(h.engine.nameTaken('Alice'), true);
  const duplicate = hello(h, 'Different');
  assertRejected(h, duplicate, { type: 'create_room', playerName: 'Alice' }, /已经有人/);
  assertRejected(h, duplicate, { type: 'create_room', playerName: 'Registered' }, /已经有人/);
});

for (const registered of [false, true]) {
  test(`${registered ? 'account' : 'guest'} identity expiry rejects actions, closes the socket and makes the seat reclaimable`, t => {
    const h = fixture(t, { roomHoldMs: 200 });
    const token = registered
      ? h.accounts.register('Alice', 'test-password').token
      : h.accounts.guestToken('Alice').token;
    const host = hello(h, undefined, token);
    host.request({ type: 'create_room', playerName: 'Alice' });
    h.roomId = host.last('room_created').roomId;
    host.request({ type: 'add_ai' });
    host.request({ type: 'start_game' });
    h.clock.value = START + TTL - 1;
    host.request({ type: 'list_rooms' });
    host.last('room_list');
    const game = room(h).game;
    h.clock.value++;
    host.request({ type: 'take_tokens', tokens: THREE_COLORS });
    assert.match(host.last('error').message, /登录已过期/);
    assert.deepEqual(host.closes, [{ code: 1008, reason: 'Session expired' }]);
    assert.equal(h.engine.exportConnection(host.connection).detached, true);
    assert.deepEqual(room(h).game, game);
    assert.equal(room(h).players[0].isAi, true);
    assert.equal(room(h).players[0].wasHuman, true);
    assert.equal(room(h).players[0].leftByUser, false);
    assert.equal(room(h).aiDueAt, null);
    assert.deepEqual(snapshot(h).graceTimers, []);
    assert.equal(h.engine.nextDeadline(), START + TTL + 200);
  });
}

test('expired hello tokens receive a new guest identity rather than reclaiming the old seat', t => {
  const h = table(t);
  const [host] = h.clients;
  const old = host.last('welcome');
  h.clock.value += TTL;
  const replacement = hello(h, 'New guest', old.token);
  assert.notEqual(replacement.last('welcome').player.id, old.player.id);
  assert.equal(replacement.last('welcome').player.guest, true);
  replacement.last('session_lost');
  assert.equal(replacement.count('session_restored'), 0);
  assert.equal(room(h).players[0].id, old.player.id);
});

test('restored saved identities are revalidated before acting after token expiry', t => {
  const h = table(t);
  const game = room(h).game;
  h.clock.value += TTL;
  const [host] = reconstruct(h);
  host.request({ type: 'take_tokens', tokens: THREE_COLORS });
  assert.match(host.last('error').message, /登录已过期/);
  assert.equal(host.readyState, 3);
  assert.deepEqual(room(h).game, game);
  assert.equal(room(h).players[0].isAi, true);
});
