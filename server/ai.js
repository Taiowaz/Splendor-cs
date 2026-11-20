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

  // 1.5 明面买不起就看看预留区：手里攥满 10 枚时这是唯一能花掉筹码的出口
  const affordableReserved = (player.reservedCards || []).filter(c => canAffordCard(player, c));
  if (affordableReserved.length > 0) {
    affordableReserved.sort((a, b) => b.prestige - a.prestige);
    const card = affordableReserved[0];
    return { action: 'buyReserved', cardId: card.id, tier: card.tier };
  }

  // 2. 拿资源：只提「拿完不超 10」的组合。原来不看手里总数，攥到 8-9 枚还提
  //    「拿 3 枚」会被服务端拒掉，而拒掉之后回合不结束 —— 整桌永久卡死。
  const tokenTotal = Object.values(player.tokens).reduce((a, b) => a + b, 0);
  const room = 10 - tokenTotal;
  const availableResources = RESOURCE_TYPES.filter(r => bank.tokens[r] > 0);
  if (room >= 3 && availableResources.length >= 3) {
    const tokens = {};
    availableResources.slice(0, 3).forEach(r => { tokens[r] = 1; });
    return { action: 'take', tokens };
  }
  if (room >= 2) {
    for (const resource of RESOURCE_TYPES) {
      if (bank.tokens[resource] >= 4) {
        return { action: 'take', tokens: { [resource]: 2 } };
      }
    }
  }
  if (room >= 1 && (bank.tokens.coffee || 0) > 0) {
    return { action: 'take', tokens: { coffee: 1 } };
  }

  // 3. 预留卡牌：送的那杯咖啡也算进 10 上限，满手且银行还有咖啡时预留是非法的
  if (player.reservedCards.length < 3 && (tokenTotal < 10 || (bank.tokens.coffee || 0) === 0)) {
    const tiers = [1, 2, 3];
    for (const tier of tiers) {
      const tierCards = bank[`tier${tier}`];
      if (tierCards.length > 0) {
        const cardIndex = Math.floor(Math.random() * tierCards.length);
        return { action: 'reserve', tier, cardIndex };
      }
    }
  }

  // 4. 理论上仍可能无合法行动（满手、买不起、预留满）：交回执行层跳过，保桌不卡死
  return null;
}

// 执行 AI 操作
export function executeAiTurn(game, playerIndex, room, broadcastFn) {
  const decision = aiDecide(game, playerIndex);
  const player = game.players[playerIndex];
  const currentPlayerId = player.id;

  // 行动被拒 / 无合法行动的兜底：照常结束回合并广播。少了这条，AI 链条会在
  // 这里断掉、整桌永久卡死（aiDecide 里已尽量只提合法行动，这是最后一道保险）。
  const passTurn = () => {
    endTurn(game);
    broadcastFn(room.id, game.gameOver
      ? { type: 'game_over', winner: game.winner, gameState: getSanitizedGameStateForAi(game) }
      : { type: 'turn_changed', currentPlayerIndex: game.currentPlayerIndex, gameState: getSanitizedGameStateForAi(game) });
  };
  if (!decision) { passTurn(); return; }

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

        broadcastFn(room.id, {
          type: 'card_bought',
          playerId: currentPlayerId,
          card: result.card,
          gameState: getSanitizedGameStateForAi(game)
        });

        endTurn(game);

        if (game.gameOver) {
          broadcastFn(room.id, {
            type: 'game_over',
            winner: game.winner,
            gameState: getSanitizedGameStateForAi(game)
          });
        } else {
          broadcastFn(room.id, {
            type: 'turn_changed',
            currentPlayerIndex: game.currentPlayerIndex,
            gameState: getSanitizedGameStateForAi(game)
          });
        }
      } else passTurn();
      break;
    }

    case 'take': {
      const result = takeTokens(player, decision.tokens, game.bank.tokens);
      if (result.success) {
        broadcastFn(room.id, {
          type: 'tokens_taken',
          playerId: currentPlayerId,
          tokens: decision.tokens,
          gameState: getSanitizedGameStateForAi(game)
        });
        endTurn(game);
        broadcastFn(room.id, {
          type: 'turn_changed',
          currentPlayerIndex: game.currentPlayerIndex,
          gameState: getSanitizedGameStateForAi(game)
        });
      } else passTurn();
      break;
    }

    case 'reserve': {
      const result = reserveCard(game, playerIndex, decision.tier, decision.cardIndex);
      if (result.success) {
        broadcastFn(room.id, {
          type: 'card_reserved',
          playerId: currentPlayerId,
          card: result.card,
          gameState: getSanitizedGameStateForAi(game)
        });
        endTurn(game);
        broadcastFn(room.id, {
          type: 'turn_changed',
          currentPlayerIndex: game.currentPlayerIndex,
          gameState: getSanitizedGameStateForAi(game)
        });
      } else passTurn();
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
    gameOver: game.gameOver,
    winner: game.winner,
    turnCount: game.turnCount
  };
}
