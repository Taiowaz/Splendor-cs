// AI 玩家逻辑
import {
  canAffordCard,
  takeTokens,
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

  // 2. 尝试拿资源（优先拿缺少的资源）
  const tokenTotal = Object.values(player.tokens).reduce((a, b) => a + b, 0);
  if (tokenTotal < 8) {
    // 拿3个不同的资源
    const availableResources = RESOURCE_TYPES.filter(r => bank.tokens[r] > 0);
    if (availableResources.length >= 3) {
      const tokens = {};
      availableResources.slice(0, 3).forEach(r => { tokens[r] = 1; });
      return { action: 'take', tokens };
    }
    // 拿2个相同的（如果银行有足够多）
    for (const resource of RESOURCE_TYPES) {
      if (bank.tokens[resource] >= 4) {
        return { action: 'take', tokens: { [resource]: 2 } };
      }
    }
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

  // 4. 默认：拿3个不同资源
  const availableResources = RESOURCE_TYPES.filter(r => bank.tokens[r] > 0);
  if (availableResources.length >= 3) {
    const tokens = {};
    availableResources.slice(0, 3).forEach(r => { tokens[r] = 1; });
    return { action: 'take', tokens };
  }

  return null;
}

// 执行 AI 操作
export function executeAiTurn(game, playerIndex, room, broadcastFn) {
  const decision = aiDecide(game, playerIndex);
  if (!decision) return;

  const player = game.players[playerIndex];
  const currentPlayerId = player.id;

  switch (decision.action) {
    case 'buy': {
      const result = buyCard(game, playerIndex, decision.cardId, decision.tier);
      if (result.success) {
        const noble = checkNobleVisit(player, game.bank.nobles);
        if (noble) {
          player.prestige += noble.prestige;
          game.bank.nobles = game.bank.nobles.filter(n => n.id !== noble.id);
          broadcastFn(room.id, {
            type: 'noble_visit',
            playerId: currentPlayerId,
            noble,
            message: `${noble.cn} 认可了 ${player.name} 的学术成就！+${noble.prestige} 声誉`
          });
        }

        broadcastFn(room.id, {
          type: 'card_bought',
          playerId: currentPlayerId,
          card: result.card,
          gameState: getSanitizedGameStateForAi(game, currentPlayerId)
        });

        endTurn(game);

        if (game.gameOver) {
          broadcastFn(room.id, {
            type: 'game_over',
            winner: game.winner,
            gameState: getSanitizedGameStateForAi(game, null)
          });
        } else {
          broadcastFn(room.id, {
            type: 'turn_changed',
            currentPlayerIndex: game.currentPlayerIndex,
            gameState: getSanitizedGameStateForAi(game, null)
          });
        }
      }
      break;
    }

    case 'take': {
      const result = takeTokens(player, decision.tokens, game.bank.tokens);
      if (result.success) {
        broadcastFn(room.id, {
          type: 'tokens_taken',
          playerId: currentPlayerId,
          tokens: decision.tokens,
          gameState: getSanitizedGameStateForAi(game, currentPlayerId)
        });
        endTurn(game);
        broadcastFn(room.id, {
          type: 'turn_changed',
          currentPlayerIndex: game.currentPlayerIndex,
          gameState: getSanitizedGameStateForAi(game, null)
        });
      }
      break;
    }

    case 'reserve': {
      const result = reserveCard(game, playerIndex, decision.tier, decision.cardIndex);
      if (result.success) {
        broadcastFn(room.id, {
          type: 'card_reserved',
          playerId: currentPlayerId,
          card: result.card,
          gameState: getSanitizedGameStateForAi(game, currentPlayerId)
        });
        endTurn(game);
        broadcastFn(room.id, {
          type: 'turn_changed',
          currentPlayerIndex: game.currentPlayerIndex,
          gameState: getSanitizedGameStateForAi(game, null)
        });
      }
      break;
    }
  }
}

function getSanitizedGameStateForAi(game, requestingPlayerId) {
  return {
    players: game.players.map(p => ({
      id: p.id,
      name: p.name,
      tokens: p.tokens, // 筹码公开，和 websocket.js 的 getSanitizedGameState 同一口径
      cards: p.cards,
      reservedCards: requestingPlayerId === p.id
        ? p.reservedCards
        : p.reservedCards.map(c => ({ tier: c.tier })),
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
    gameOver: game.gameOver,
    winner: game.winner,
    turnCount: game.turnCount
  };
}
