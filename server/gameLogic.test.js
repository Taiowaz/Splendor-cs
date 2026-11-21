import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESOURCE_TYPES,
  initializeGame,
  createPlayer,
  takeTokens,
  returnTokens,
  reserveCard,
  buyCard,
  endTurn
} from './gameLogic.js';

const TOKEN_TYPES = [...RESOURCE_TYPES, 'coffee'];
const SUPPLY = { 2: 4, 3: 5, 4: 7 };
const THREE_COLORS = { data: 1, compute: 1, citation: 1 };
const TEN_TOKENS = {
  data: 2, compute: 2, citation: 2, collaborator: 1, funding: 1, coffee: 2
};

function total(tokens) {
  return Object.values(tokens).reduce((sum, count) => sum + count, 0);
}

function assertConserved(game) {
  for (const type of TOKEN_TYPES) {
    const counts = [game.bank.tokens[type], ...game.players.map(player => player.tokens[type])];
    assert.ok(counts.every(count => Number.isSafeInteger(count) && count >= 0), type);
    assert.equal(
      counts.reduce((sum, count) => sum + count, 0),
      type === 'coffee' ? 5 : SUPPLY[game.players.length],
      `${type}: bank + players must equal the initial supply`
    );
  }
}

function makeGame(playerCount = 4) {
  const game = initializeGame(playerCount);
  game.players = Array.from({ length: playerCount }, (_, index) =>
    createPlayer(`player-${index}`, `Player ${index}`));
  // Replace shuffled cards/nobles with deterministic fixtures; token supply is unchanged.
  game.bank.nobles = [];
  for (const tier of [1, 2, 3]) {
    game.bank[`tier${tier}`] = [];
    game.bank[`draw${tier}`] = [];
  }
  game.bank.tier1 = [{
    id: 'test-card', tier: 1, name: 'Test card', bonus: 'funding', prestige: 0, cost: {}
  }];
  assertConserved(game);
  return game;
}

function giveTokens(game, playerIndex, tokens) {
  for (const [type, count] of Object.entries(tokens)) {
    assert.ok(TOKEN_TYPES.includes(type));
    assert.ok(Number.isSafeInteger(count) && count >= 0);
    assert.ok(game.bank.tokens[type] >= count);
    game.bank.tokens[type] -= count;
    game.players[playerIndex].tokens[type] += count;
  }
  assertConserved(game);
}

function reduceBank(game, targets) {
  for (const [type, remaining] of Object.entries(targets)) {
    assert.ok(remaining >= 0 && remaining <= game.bank.tokens[type]);
    while (game.bank.tokens[type] > remaining) {
      // Spread scarce-bank fixtures across players instead of creating/destroying tokens.
      const index = game.players.reduce((lowest, player, candidate) =>
        total(player.tokens) < total(game.players[lowest].tokens) ? candidate : lowest, 0);
      giveTokens(game, index, { [type]: 1 });
    }
  }
}

function assertRejectedUnchanged(game, action) {
  const before = structuredClone(game);
  assert.equal(action().success, false);
  assert.deepEqual(game, before, 'a rejected action must leave the entire game unchanged');
  assertConserved(game);
}

function assertTaken(game, tokens) {
  const expected = structuredClone(game);
  const index = game.currentPlayerIndex;
  for (const [type, count] of Object.entries(tokens)) {
    expected.players[index].tokens[type] += count;
    expected.bank.tokens[type] -= count;
  }
  assert.equal(takeTokens(game.players[index], tokens, game.bank.tokens).success, true);
  assert.deepEqual(game, expected, 'taking tokens must not advance the turn or start discard itself');
  assertConserved(game);
}

function assertPending(game) {
  const expected = structuredClone(game);
  const player = game.players[game.currentPlayerIndex];
  const count = total(player.tokens) - 10;
  assert.ok(count > 0);
  expected.pendingDiscard = { playerId: player.id, count };
  endTurn(game);
  assert.deepEqual(game, expected, 'discard must precede rotation, turnCount changes and victory');
  assertConserved(game);
}

function assertReturned(game, tokens) {
  const expected = structuredClone(game);
  const index = game.currentPlayerIndex;
  for (const [type, count] of Object.entries(tokens)) {
    expected.players[index].tokens[type] -= count;
    expected.bank.tokens[type] += count;
  }
  expected.pendingDiscard = null;
  assert.equal(returnTokens(game, index, tokens).success, true);
  assert.deepEqual(game, expected, 'returning tokens must not end the turn or check victory');
  assert.equal(total(game.players[index].tokens), 10);
  assertConserved(game);
}

function assertRotates(game) {
  const expected = structuredClone(game);
  expected.currentPlayerIndex = (expected.currentPlayerIndex + 1) % expected.players.length;
  expected.turnCount++;
  expected.pendingDiscard = null;
  endTurn(game);
  assert.deepEqual(game, expected);
  assertConserved(game);
}

function pendingGame() {
  const game = makeGame();
  game.turnCount = 12;
  giveTokens(game, 0, TEN_TOKENS);
  assertTaken(game, THREE_COLORS);
  assertPending(game);
  return game;
}

for (const playerCount of [2, 3, 4]) {
  test(`initializeGame(${playerCount}) starts without a pending discard and with official supply`, () => {
    const game = initializeGame(playerCount);
    assert.equal(game.pendingDiscard, null);
    assert.equal(game.currentPlayerIndex, 0);
    assert.equal(game.turnCount, 0);
    assert.equal(game.gameOver, false);
    assert.equal(game.winner, null);
    assert.deepEqual(game.players, []);
    assert.deepEqual(game.bank.tokens, {
      data: SUPPLY[playerCount], compute: SUPPLY[playerCount], citation: SUPPLY[playerCount],
      collaborator: SUPPLY[playerCount], funding: SUPPLY[playerCount], coffee: 5
    });
    const player = createPlayer('new', 'New player');
    assert.deepEqual(player.tokens, Object.fromEntries(TOKEN_TYPES.map(type => [type, 0])));
  });

  test(`${playerCount} players may take three distinct ordinary colors`, () => {
    const game = makeGame(playerCount);
    assertTaken(game, THREE_COLORS);
    assert.equal(total(game.players[0].tokens), 3);
    assertRotates(game);
  });

  for (const type of RESOURCE_TYPES) {
    test(`take two ${type} when the pre-take pool is ${SUPPLY[playerCount]}`, () => {
      const game = makeGame(playerCount);
      assertTaken(game, { [type]: 2 });
      assert.equal(game.bank.tokens[type], SUPPLY[playerCount] - 2);
      assert.equal(game.players[0].tokens[type], 2);
    });
  }
}

for (const remaining of [0, 1, 2, 3]) {
  test(`taking two of one color is rejected with only ${remaining} in the bank`, () => {
    const game = makeGame();
    reduceBank(game, { data: remaining });
    assertRejectedUnchanged(game, () => takeTokens(game.players[0], { data: 2 }, game.bank.tokens));
  });
}

for (const available of [1, 2]) {
  test(`with ${available} ordinary colors available, take all available colors once`, () => {
    const game = makeGame();
    const types = RESOURCE_TYPES.slice(0, available);
    reduceBank(game, Object.fromEntries(RESOURCE_TYPES.map(type => [type, types.includes(type) ? 1 : 0])));
    assert.equal(game.bank.tokens.coffee, 5, 'coffee does not count as an ordinary color');
    assertTaken(game, Object.fromEntries(types.map(type => [type, 1])));
    assert.ok(RESOURCE_TYPES.every(type => game.bank.tokens[type] === 0));
  });
}

test('a single remaining ordinary color still permits a pair if its pool is at least four', () => {
  const game = makeGame();
  reduceBank(game, { data: 4, compute: 0, citation: 0, collaborator: 0, funding: 0 });
  assertTaken(game, { data: 2 });
  assert.equal(game.bank.tokens.data, 2);
});

test('with two colors available, taking only one color once is rejected', () => {
  const game = makeGame();
  reduceBank(game, { citation: 0, collaborator: 0, funding: 0 });
  assertRejectedUnchanged(game, () => takeTokens(game.players[0], { data: 1 }, game.bank.tokens));
});

test('an exhausted selected color is rejected even if three other ordinary colors remain', () => {
  const game = makeGame();
  reduceBank(game, { citation: 0 });
  assertRejectedUnchanged(game, () => takeTokens(game.players[0], THREE_COLORS, game.bank.tokens));
});

for (const coffeeRemaining of [0, 5]) {
  test(`zero ordinary colors cannot be taken, even with ${coffeeRemaining} coffee in the bank`, () => {
    const game = makeGame();
    reduceBank(game, {
      ...Object.fromEntries(RESOURCE_TYPES.map(type => [type, 0])), coffee: coffeeRemaining
    });
    for (const tokens of [{}, { data: 1 }, { data: 2 }, THREE_COLORS, { coffee: 1 }]) {
      assertRejectedUnchanged(game, () => takeTokens(game.players[0], tokens, game.bank.tokens));
    }
  });
}

const invalidContainers = [
  ['null', null], ['undefined', undefined], ['array', []],
  ['entry array', [['data', 1], ['compute', 1], ['citation', 1]]],
  ['string', 'data'], ['number', 1], ['boolean', true], ['function', () => {}]
];
const invalidCounts = [
  ['zero', 0], ['negative', -1], ['fraction', 1.5], ['numeric string', '1'],
  ['null', null], ['undefined', undefined], ['boolean', true], ['array', [1]],
  ['object', {}], ['NaN', NaN], ['infinity', Infinity], ['negative infinity', -Infinity],
  ['unsafe integer', Number.MAX_SAFE_INTEGER + 1], ['bigint', 1n], ['symbol', Symbol('count')]
];
const invalidTakes = [
  ...invalidContainers,
  ['empty selection', {}], ['one of five colors', { data: 1 }],
  ['two of five colors', { data: 1, compute: 1 }],
  ['four colors', { ...THREE_COLORS, funding: 1 }],
  ['five colors', { ...THREE_COLORS, collaborator: 1, funding: 1 }],
  ['mixed pair and single', { data: 2, compute: 1 }],
  ['mixed pair and two singles', { data: 2, compute: 1, citation: 1 }],
  ['two pairs', { data: 2, compute: 2 }], ['three of one color', { data: 3 }],
  ['coffee alone', { coffee: 1 }], ['coffee pair', { coffee: 2 }],
  ['coffee among three colors', { data: 1, compute: 1, coffee: 1 }],
  ['coffee added to valid colors', { ...THREE_COLORS, coffee: 1 }],
  ['unknown color', { data: 1, compute: 1, unknown: 1 }],
  ['JSON __proto__ key', JSON.parse('{"data":1,"compute":1,"__proto__":1}')],
  ['JSON __proto__ object', JSON.parse('{"data":1,"compute":1,"citation":1,"__proto__":{"polluted":true}}')],
  ['constructor key', { data: 1, compute: 1, constructor: 1 }],
  ...invalidCounts.map(([name, value]) => [`${name} count`, { data: 1, compute: 1, citation: value }])
];

for (const [name, tokens] of invalidTakes) {
  test(`takeTokens atomically rejects ${name}`, () => {
    const game = makeGame();
    assertRejectedUnchanged(game, () => takeTokens(game.players[0], tokens, game.bank.tokens));
  });
}

for (const startingTotal of [8, 9, 10]) {
  for (const [action, tokens, taken] of [
    ['three colors', THREE_COLORS, 3], ['a same-color pair', { data: 2 }, 2]
  ]) {
    test(`with ${startingTotal} tokens, taking ${action} happens before the ten-token limit`, () => {
      const game = makeGame();
      game.turnCount = 7;
      giveTokens(game, 0, { data: 3, compute: 3, citation: startingTotal - 6 });
      assertTaken(game, tokens);
      assert.equal(total(game.players[0].tokens), startingTotal + taken);
      const excess = startingTotal + taken - 10;
      if (excess > 0) {
        assertPending(game);
        assert.deepEqual(game.pendingDiscard, { playerId: 'player-0', count: excess });
        assertPending(game); // Repeated endTurn cannot skip the outstanding discard.
        assertReturned(game, { data: excess });
      }
      assertRotates(game);
    });
  }
}

for (const coffeeAvailable of [true, false]) {
  test(`reserving at ten tokens ${coffeeAvailable ? 'adds coffee and requires discard' : 'succeeds without coffee when its bank is empty'}`, () => {
    const game = makeGame();
    giveTokens(game, 0, TEN_TOKENS);
    if (!coffeeAvailable) giveTokens(game, 1, { coffee: game.bank.tokens.coffee });
    const card = structuredClone(game.bank.tier1[0]);
    const replacement = { ...card, id: 'replacement-card' };
    game.bank.draw1.push(replacement);
    const expected = structuredClone(game);
    expected.players[0].reservedCards.push(expected.bank.tier1.shift());
    expected.bank.tier1.push(expected.bank.draw1.shift());
    if (coffeeAvailable) {
      expected.players[0].tokens.coffee++;
      expected.bank.tokens.coffee--;
    }
    const result = reserveCard(game, 0, 1, 0);
    assert.equal(result.success, true);
    assert.deepEqual(result.card, card);
    assert.deepEqual(game, expected);
    assertConserved(game);
    assert.equal(total(game.players[0].tokens), coffeeAvailable ? 11 : 10);
    if (coffeeAvailable) {
      assertPending(game);
      assertReturned(game, { coffee: 1 });
    }
    assertRotates(game);
  });
}

for (const type of TOKEN_TYPES) {
  test(`discard may return held ${type}, regardless of whether it was just taken`, () => {
    const game = makeGame();
    giveTokens(game, 0, { data: 2, compute: 2, citation: 2, coffee: 2 });
    assertTaken(game, { data: 1, collaborator: 1, funding: 1 });
    assertPending(game);
    assertReturned(game, { [type]: 1 });
    assertRotates(game);
  });
}

test('one discard can combine previously held tokens, newly taken tokens and coffee', () => {
  const game = pendingGame();
  assertReturned(game, { data: 1, funding: 1, coffee: 1 });
  assertRotates(game);
});

test('all six token types can be returned together when the actual excess is six', () => {
  const game = makeGame();
  giveTokens(game, 0, { data: 3, compute: 3, citation: 3, collaborator: 3, funding: 2, coffee: 2 });
  assertPending(game);
  assert.equal(game.pendingDiscard.count, 6);
  assertReturned(game, Object.fromEntries(TOKEN_TYPES.map(type => [type, 1])));
  assertRotates(game);
});

const invalidReturns = [
  ...invalidContainers,
  ['empty selection', {}], ['too few tokens', { data: 2 }],
  ['too many held tokens', { data: 3, compute: 1 }],
  ['more than owned with the correct total', { collaborator: 3 }],
  ['valid prefix then more than owned', { data: 1, collaborator: 2 }],
  ['too much coffee', { coffee: 3 }],
  ['unknown key', { data: 2, unknown: 1 }],
  ['JSON __proto__ key', JSON.parse('{"data":2,"__proto__":1}')],
  ['JSON __proto__ object', JSON.parse('{"data":3,"__proto__":{"polluted":true}}')],
  ['constructor key', { data: 2, constructor: 1 }],
  ['zero in addition to an otherwise valid return', { data: 3, funding: 0 }],
  ['negative count whose sum matches the excess', { data: 3, compute: 1, funding: -1 }],
  ['fractional counts whose sum matches the excess', { data: 1.5, compute: 1.5 }],
  ...invalidCounts.map(([name, value]) => [`${name} count`, { data: 1, compute: value }])
];

for (const [name, tokens] of invalidReturns) {
  test(`returnTokens atomically rejects ${name}`, () => {
    const game = pendingGame();
    assertRejectedUnchanged(game, () => returnTokens(game, 0, tokens));
  });
}

test('returning even one token of an unowned color is rejected without partial transfer', () => {
  const game = makeGame();
  giveTokens(game, 0, { data: 3, compute: 3, citation: 3, coffee: 2 });
  assertPending(game);
  assertRejectedUnchanged(game, () => returnTokens(game, 0, { funding: 1 }));
});

test('returnTokens uses the actual excess rather than trusting a stale pending count', () => {
  const game = pendingGame();
  game.pendingDiscard.count = 1;
  assertRejectedUnchanged(game, () => returnTokens(game, 0, { data: 1 }));
  assertReturned(game, { data: 3 });
  assertRotates(game);
});

test('an over-limit hand cannot return tokens before endTurn establishes pendingDiscard', () => {
  const game = makeGame();
  giveTokens(game, 0, TEN_TOKENS);
  assertTaken(game, THREE_COLORS);
  assertRejectedUnchanged(game, () => returnTokens(game, 0, { data: 3 }));
});

test('a normal hand without pendingDiscard cannot return tokens', () => {
  const game = makeGame();
  giveTokens(game, 0, TEN_TOKENS);
  assertRejectedUnchanged(game, () => returnTokens(game, 0, { data: 1 }));
});

for (const playerIndex of [1, -1, 4, undefined]) {
  test(`returnTokens rejects non-current or missing player index ${playerIndex}`, () => {
    const game = pendingGame();
    if (playerIndex === 1) giveTokens(game, 1, { data: 3 });
    assertRejectedUnchanged(game, () => returnTokens(game, playerIndex, { data: 3 }));
  });
}

test('the current player cannot fulfill a discard belonging to another player', () => {
  const game = pendingGame();
  game.pendingDiscard.playerId = game.players[1].id;
  assertRejectedUnchanged(game, () => returnTokens(game, 0, { data: 3 }));
});

test('even the pending player cannot discard if they are not the current player', () => {
  const game = pendingGame();
  game.currentPlayerIndex = 1;
  assertRejectedUnchanged(game, () => returnTokens(game, 0, { data: 3 }));
});

test('a game that is already over rejects returns even with pendingDiscard', () => {
  const game = pendingGame();
  game.gameOver = true;
  game.winner = game.players[1];
  assertRejectedUnchanged(game, () => returnTokens(game, 0, { data: 3 }));
  const before = structuredClone(game);
  endTurn(game);
  assert.deepEqual(game, before);
});

test('repeated returns are rejected both before and after the explicit endTurn', () => {
  const game = pendingGame();
  assertReturned(game, { data: 1, compute: 1, citation: 1 });
  assertRejectedUnchanged(game, () => returnTokens(game, 0, { data: 1, compute: 1, citation: 1 }));
  assertRotates(game);
  assertRejectedUnchanged(game, () => returnTokens(game, 0, { data: 1 }));
  assertRejectedUnchanged(game, () => returnTokens(game, 1, { data: 1 }));
});

for (const { name, scores, winnerIndex } of [
  { name: 'below fifteen points', scores: [14, 0], winnerIndex: null },
  { name: 'current player at fifteen points', scores: [15, 0], winnerIndex: 0 },
  { name: 'current player above fifteen points', scores: [16, 0], winnerIndex: 0 },
  { name: 'another qualifying player', scores: [0, 15], winnerIndex: 1 },
  { name: 'existing first-qualifying-player priority', scores: [15, 16], winnerIndex: 0 }
]) {
  test(`victory waits for discard and explicit endTurn: ${name}`, () => {
    const game = makeGame();
    game.turnCount = 20;
    game.players[0].prestige = scores[0];
    game.players[1].prestige = scores[1];
    giveTokens(game, 0, TEN_TOKENS);
    assertTaken(game, THREE_COLORS);
    assertPending(game);
    assert.equal(game.gameOver, false);
    assert.equal(game.winner, null);
    assertReturned(game, { data: 3 });
    assert.equal(game.gameOver, false);
    assert.equal(game.winner, null);
    if (winnerIndex === null) {
      assertRotates(game);
    } else {
      const expected = structuredClone(game);
      expected.gameOver = true;
      expected.winner = expected.players[winnerIndex];
      endTurn(game);
      assert.deepEqual(game, expected, 'existing victory rules still run before rotation');
      assert.equal(game.winner, game.players[winnerIndex]);
      assertRejectedUnchanged(game, () => returnTokens(game, 0, { compute: 1 }));
      assertConserved(game);
    }
  });
}

for (const playerCount of [2, 3, 4]) {
  for (const tokenCount of [0, 8, 9, 10]) {
    test(`${playerCount}-player rotation, including wraparound, is unchanged at ${tokenCount} tokens`, () => {
      const game = makeGame(playerCount);
      game.turnCount = 9;
      for (let index = 0; index < playerCount; index++) {
        const hand = {};
        let needed = tokenCount;
        for (const type of TOKEN_TYPES) {
          const count = Math.min(needed, game.bank.tokens[type]);
          if (count) hand[type] = count;
          needed -= count;
        }
        assert.equal(needed, 0);
        giveTokens(game, index, hand);
        assert.equal(game.currentPlayerIndex, index);
        assertRotates(game);
      }
      assert.equal(game.currentPlayerIndex, 0);
      assert.equal(game.turnCount, 9 + playerCount);
    });
  }
}

for (const fromReserved of [false, true]) {
  test(`buying a free ${fromReserved ? 'reserved' : 'face-up'} card grants permanent bonus, not tokens`, () => {
    const game = makeGame();
    giveTokens(game, 0, TEN_TOKENS);
    const card = game.bank.tier1[0];
    if (fromReserved) game.players[0].reservedCards.push(game.bank.tier1.shift());
    const expected = structuredClone(game);
    expected.players[0].cards.push(structuredClone(card));
    expected.players[0].bonus.funding++;
    if (fromReserved) expected.players[0].reservedCards.shift();
    else expected.bank.tier1.shift();
    const result = buyCard(game, 0, card.id, 1, fromReserved);
    assert.equal(result.success, true);
    assert.deepEqual(result.card, card);
    assert.deepEqual(game, expected);
    assert.equal(total(game.players[0].tokens), 10);
    assertConserved(game);
    assertRotates(game);
  });
}

test('paid purchases return ordinary tokens and coffee to the bank, without emitting bonus tokens', () => {
  const game = makeGame();
  giveTokens(game, 0, { data: 1, compute: 2, coffee: 2 });
  game.players[0].bonus.data = 1;
  const card = game.bank.tier1[0];
  card.cost = { data: 3, compute: 1 };
  card.bonus = 'data';
  card.prestige = 2;
  const expected = structuredClone(game);
  expected.players[0].cards.push(expected.bank.tier1.shift());
  expected.players[0].bonus.data++;
  expected.players[0].prestige += 2;
  for (const type of ['data', 'compute', 'coffee']) {
    expected.players[0].tokens[type]--;
    expected.bank.tokens[type]++;
  }
  assert.equal(buyCard(game, 0, card.id, 1).success, true);
  assert.deepEqual(game, expected);
  assertConserved(game);
  assertRotates(game);
});
