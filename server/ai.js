// AI 玩家逻辑
import {
  canAffordCard,
  takeTokens,
  returnTokens,
  buyCard,
  reserveCard,
  checkNobleVisit,
  endTurn,
  RESOURCE_TYPES
} from './gameLogic.js';

// AI 决策：选择最佳操作
export function aiDecide(game, playerIndex) {
  const player = game.players[playerIndex];
  const bank = game.bank;

  if (game.gameOver) return null;
  if (game.pendingDiscard) {
    if (game.pendingDiscard.playerId !== player.id) return null;
    const remaining = { ...player.tokens };
    const tokens = {};
    for (let i = 0; i < game.pendingDiscard.count; i++) {
      const resource = RESOURCE_TYPES.filter(r => remaining[r] > 0)
        .sort((a, b) => remaining[b] - remaining[a])[0] || 'coffee';
      if (!remaining[resource]) return null;
      remaining[resource]--;
      tokens[resource] = (tokens[resource] || 0) + 1;
    }
    return { action: 'return', tokens };
  }

  // 1. 尝试购买卡牌（优先高声望）
  const allCards = [
    ...bank.tier1.map(c => ({ ...c, tier: 1 })),
    ...bank.tier2.map(c => ({ ...c, tier: 2 })),
    ...bank.tier3.map(c => ({ ...c, tier: 3 }))
  ];

  const affordableCards = allCards.filter(c => canAffordCard(player, c));
  if (affordableCards.length > 0) {
    // 优先买声望高的
    affordableCards.sort((a, b) => b.prestige - a.prestige);
    const card = affordableCards[0];
    return { action: 'buy', cardId: card.id, tier: card.tier };
  }

  // 1.5 明面买不起就看看预留区
  const affordableReserved = (player.reservedCards || []).filter(c => canAffordCard(player, c));
  if (affordableReserved.length > 0) {
    affordableReserved.sort((a, b) => b.prestige - a.prestige);
    const card = affordableReserved[0];
    return { action: 'buyReserved', cardId: card.id, tier: card.tier };
  }

  // 2. 拿普通资源，超额在归还阶段处理。
  const availableResources = RESOURCE_TYPES.filter(r => bank.tokens[r] > 0)
    .sort((a, b) => player.tokens[a] - player.tokens[b]);
  if (availableResources.length >= 3) {
    const tokens = {};
    availableResources.slice(0, 3).forEach(r => { tokens[r] = 1; });
    return { action: 'take', tokens };
  }
  for (const resource of availableResources) {
    if (bank.tokens[resource] >= 4) {
      return { action: 'take', tokens: { [resource]: 2 } };
    }
  }
  if (availableResources.length > 0) {
    return { action: 'take', tokens: Object.fromEntries(availableResources.map(r => [r, 1])) };
  }

  // 3. 预留卡牌
  if (player.reservedCards.length < 3) {
    const tiers = [1, 2, 3];
    for (const tier of tiers) {
      const tierCards = bank[`tier${tier}`];
      if (tierCards.length > 0) {
        const cardIndex = Math.floor(Math.random() * tierCards.length);
        return { action: 'reserve', tier, cardIndex };
      }
    }
  }

  // 4. 无合法行动时交回执行层跳过
  return null;
}

// 执行 AI 操作
export function executeAiTurn(game, playerIndex, room, broadcastFn) {
  if (game.gameOver || playerIndex !== game.currentPlayerIndex) return;
  const decision = aiDecide(game, playerIndex);
  const player = game.players[playerIndex];
  const currentPlayerId = player.id;

  const finishTurn = (actionMessage = null) => {
    endTurn(game);
    const gameState = getSanitizedGameStateForAi(game);
    if (actionMessage) broadcastFn(room.id, { ...actionMessage, gameState });
    broadcastFn(room.id, {
      type: game.pendingDiscard ? 'discard_required' : game.gameOver ? 'game_over' : 'turn_changed',
      currentPlayerIndex: game.currentPlayerIndex,
      winner: game.winner,
      gameState
    });
  };
  if (!decision) { finishTurn(); return; }

  switch (decision.action) {
    case 'buy':
    case 'buyReserved': {
      const result = buyCard(game, playerIndex, decision.cardId, decision.tier, decision.action === 'buyReserved');
      if (result.success) {
        const noble = checkNobleVisit(player, game.bank.nobles);
        if (noble) {
          player.prestige += noble.prestige;
          player.nobles.push(noble);
          game.bank.nobles = game.bank.nobles.filter(n => n.id !== noble.id);
          broadcastFn(room.id, {
            type: 'noble_visit',
            playerId: currentPlayerId,
            noble,
            message: `${noble.cn} 认可了 ${player.name} 的学术成就！+${noble.prestige} 声誉`
          });
        }

        finishTurn({ type: 'card_bought', playerId: currentPlayerId, card: result.card });
      } else finishTurn();
      break;
    }

    case 'take': {
      const result = takeTokens(player, decision.tokens, game.bank.tokens);
      if (result.success) {
        finishTurn({ type: 'tokens_taken', playerId: currentPlayerId, tokens: decision.tokens });
      } else finishTurn();
      break;
    }

    case 'reserve': {
      const result = reserveCard(game, playerIndex, decision.tier, decision.cardIndex);
      if (result.success) {
        finishTurn({ type: 'card_reserved', playerId: currentPlayerId, card: result.card });
      } else finishTurn();
      break;
    }

    case 'return': {
      const result = returnTokens(game, playerIndex, decision.tokens);
      if (result.success) {
        finishTurn({ type: 'tokens_returned', playerId: currentPlayerId, tokens: decision.tokens });
      } else finishTurn();
      break;
    }
  }
}

function getSanitizedGameStateForAi(game) {
  return {
    players: game.players.map(p => ({
      id: p.id,
      name: p.name,
      tokens: p.tokens, // 筹码公开，和 websocket.js 的 getSanitizedGameState 同一口径
      cards: p.cards,
      // 会士卡立在玩家面前，是公开信息
      nobles: p.nobles,
      // 预留卡公开（只能从牌桌明面预留），口径同 websocket.js：整张卡下发，
      // 对手框要按真卡面显示
      reservedCards: p.reservedCards,
      prestige: p.prestige,
      bonus: p.bonus
    })),
    bank: {
      tokens: game.bank.tokens,
      draw1Count: game.bank.draw1.length,
      draw2Count: game.bank.draw2.length,
      draw3Count: game.bank.draw3.length,
      tier1: game.bank.tier1,
      tier2: game.bank.tier2,
      tier3: game.bank.tier3,
      nobles: game.bank.nobles
    },
    currentPlayerIndex: game.currentPlayerIndex,
    pendingDiscard: game.pendingDiscard,
    gameOver: game.gameOver,
    winner: game.winner,
    turnCount: game.turnCount
  };
}
