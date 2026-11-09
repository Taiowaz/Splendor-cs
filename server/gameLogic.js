// 学术资源类型
import { ACTIVE_NOBLES } from '../shared/nobles.js';

export const RESOURCE_TYPES = ['data', 'compute', 'citation', 'collaborator', 'funding'];

export const RESOURCE_NAMES = {
  data: '数据',
  compute: '算力',
  citation: '引用',
  collaborator: '合作者',
  funding: '经费',
  coffee: '咖啡'
};

// 卡牌等级
export const TIERS = {
  1: { count: 40, prestigeRange: [0, 1], costRange: [3, 4] },
  2: { count: 30, prestigeRange: [2, 3], costRange: [5, 7] },
  3: { count: 20, prestigeRange: [4, 5], costRange: [7, 9] }
};

// 生成卡牌数据
function generateCards() {
  const cards = [];
  let id = 0;

  // Tier 1 - 入门论文 (Workshop)
  const tier1Templates = [
    { prestige: 0, cost: { data: 1, compute: 1, citation: 1, collaborator: 1, funding: 1 } },
    { prestige: 0, cost: { data: 2, compute: 1, citation: 1 } },
    { prestige: 0, cost: { compute: 2, citation: 1, collaborator: 1 } },
    { prestige: 0, cost: { citation: 2, collaborator: 1, funding: 1 } },
    { prestige: 0, cost: { collaborator: 2, funding: 1, data: 1 } },
    { prestige: 0, cost: { funding: 2, data: 1, compute: 1 } },
    { prestige: 1, cost: { data: 2, compute: 2 } },
    { prestige: 1, cost: { compute: 2, citation: 2 } },
    { prestige: 1, cost: { citation: 2, collaborator: 2 } },
    { prestige: 1, cost: { collaborator: 2, funding: 2 } },
    { prestige: 1, cost: { funding: 2, data: 2 } }
  ];

  for (let i = 0; i < 40; i++) {
    const template = tier1Templates[i % tier1Templates.length];
    const bonusResource = RESOURCE_TYPES[i % 5];
    cards.push({
      id: id++,
      tier: 1,
      name: `Workshop Paper ${i + 1}`,
      prestige: template.prestige,
      bonus: bonusResource,
      cost: { ...template.cost }
    });
  }

  // Tier 2 - 期刊论文 (Journal)
  const tier2Templates = [
    { prestige: 2, cost: { data: 3, compute: 2, citation: 2 } },
    { prestige: 2, cost: { compute: 3, citation: 2, collaborator: 2 } },
    { prestige: 2, cost: { citation: 3, collaborator: 2, funding: 2 } },
    { prestige: 2, cost: { collaborator: 3, funding: 2, data: 2 } },
    { prestige: 2, cost: { funding: 3, data: 2, compute: 2 } },
    { prestige: 3, cost: { data: 3, compute: 3, citation: 2 } },
    { prestige: 3, cost: { compute: 3, citation: 3, collaborator: 2 } },
    { prestige: 3, cost: { citation: 3, collaborator: 3, funding: 2 } },
    { prestige: 3, cost: { collaborator: 3, funding: 3, data: 2 } },
    { prestige: 3, cost: { funding: 3, data: 3, compute: 2 } }
  ];

  for (let i = 0; i < 30; i++) {
    const template = tier2Templates[i % tier2Templates.length];
    const bonusResource = RESOURCE_TYPES[i % 5];
    cards.push({
      id: id++,
      tier: 2,
      name: `Journal Paper ${i + 1}`,
      prestige: template.prestige,
      bonus: bonusResource,
      cost: { ...template.cost }
    });
  }

  // Tier 3 - 顶会论文 (Top Conference)
  const tier3Templates = [
    { prestige: 4, cost: { data: 3, compute: 3, citation: 3, collaborator: 2 } },
    { prestige: 4, cost: { compute: 3, citation: 3, collaborator: 3, funding: 2 } },
    { prestige: 4, cost: { citation: 3, collaborator: 3, funding: 3, data: 2 } },
    { prestige: 4, cost: { collaborator: 3, funding: 3, data: 3, compute: 2 } },
    { prestige: 4, cost: { funding: 3, data: 3, compute: 3, citation: 2 } },
    { prestige: 5, cost: { data: 4, compute: 4, citation: 2 } },
    { prestige: 5, cost: { compute: 4, citation: 4, collaborator: 2 } },
    { prestige: 5, cost: { citation: 4, collaborator: 4, funding: 2 } },
    { prestige: 5, cost: { collaborator: 4, funding: 4, data: 2 } },
    { prestige: 5, cost: { funding: 4, data: 4, compute: 2 } }
  ];

  for (let i = 0; i < 20; i++) {
    const template = tier3Templates[i % tier3Templates.length];
    const bonusResource = RESOURCE_TYPES[i % 5];
    cards.push({
      id: id++,
      tier: 3,
      name: `Top Conference ${i + 1}`,
      prestige: template.prestige,
      bonus: bonusResource,
      cost: { ...template.cost }
    });
  }

  return cards;
}

// 初始化游戏
export function initializeGame(playerCount) {
  const allCards = generateCards();

  // 按等级分组并洗牌
  const tier1Cards = shuffle(allCards.filter(c => c.tier === 1)).slice(0, 4);
  const tier2Cards = shuffle(allCards.filter(c => c.tier === 2)).slice(0, 4);
  const tier3Cards = shuffle(allCards.filter(c => c.tier === 3)).slice(0, 4);

  // 根据玩家数量决定贵族数量（官方规则：翻 playerCount+1 张，其余移出本局）
  const nobleCount = playerCount + 1;
  const nobles = shuffle(ACTIVE_NOBLES).slice(0, nobleCount);

  // 资源token数量
  const tokenCounts = {
    2: { data: 4, compute: 4, citation: 4, collaborator: 4, funding: 4, coffee: 5 },
    3: { data: 5, compute: 5, citation: 5, collaborator: 5, funding: 5, coffee: 5 },
    4: { data: 7, compute: 7, citation: 7, collaborator: 7, funding: 7, coffee: 5 }
  };

  return {
    players: [],
    bank: {
      tokens: tokenCounts[playerCount],
      tier1: tier1Cards,
      tier2: tier2Cards,
      tier3: tier3Cards,
      nobles: nobles
    },
    currentPlayerIndex: 0,
    gameOver: false,
    winner: null,
    turnCount: 0
  };
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 玩家状态
export function createPlayer(id, name) {
  return {
    id,
    name,
    tokens: { data: 0, compute: 0, citation: 0, collaborator: 0, funding: 0, coffee: 0 },
    cards: [],
    reservedCards: [],
    prestige: 0,
    bonus: { data: 0, compute: 0, citation: 0, collaborator: 0, funding: 0 }
  };
}

// 检查是否可以购买卡牌
export function canAffordCard(player, card) {
  const totalCost = { ...card.cost };
  let coffeeNeeded = 0;

  for (const resource of RESOURCE_TYPES) {
    const cost = totalCost[resource] || 0;
    const has = player.tokens[resource] || 0;
    const bonus = player.bonus[resource] || 0;
    const effectiveCost = Math.max(0, cost - bonus);

    if (has >= effectiveCost) {
      continue;
    } else {
      coffeeNeeded += effectiveCost - has;
    }
  }

  return coffeeNeeded <= player.tokens.coffee;
}

// 购买卡牌
export function buyCard(gameState, playerIndex, cardId, tier) {
  const player = gameState.players[playerIndex];
  const tierCards = gameState.bank[`tier${tier}`];
  const cardIndex = tierCards.findIndex(c => c.id === cardId);

  if (cardIndex === -1) return { success: false, error: '卡牌不存在' };

  const card = tierCards[cardIndex];
  if (!canAffordCard(player, card)) {
    return { success: false, error: '资源不足' };
  }

  // 支付费用
  let coffeeUsed = 0;
  for (const resource of RESOURCE_TYPES) {
    const cost = card.cost[resource] || 0;
    const bonus = player.bonus[resource] || 0;
    const effectiveCost = Math.max(0, cost - bonus);
    const has = player.tokens[resource] || 0;

    if (has >= effectiveCost) {
      player.tokens[resource] -= effectiveCost;
      gameState.bank.tokens[resource] += effectiveCost;
    } else {
      coffeeUsed += effectiveCost - has;
      gameState.bank.tokens[resource] += has;
      player.tokens[resource] = 0;
    }
  }
  player.tokens.coffee -= coffeeUsed;
  gameState.bank.tokens.coffee += coffeeUsed;

  // 添加卡牌
  player.cards.push(card);
  player.bonus[card.bonus]++;
  player.prestige += card.prestige;

  // 从银行移除卡牌
  tierCards.splice(cardIndex, 1);

  return { success: true, card };
}

// 拿取资源token
export function takeTokens(player, tokens, bankTokens) {
  const totalTokens = Object.values(tokens).reduce((a, b) => a + b, 0);
  const playerTotal = Object.values(player.tokens).reduce((a, b) => a + b, 0);

  // 检查是否超过token上限（10个）
  if (playerTotal + totalTokens > 10) {
    return { success: false, error: '超过资源上限（10个）' };
  }

  // 检查银行是否有足够的token
  for (const [type, count] of Object.entries(tokens)) {
    if (bankTokens[type] < count) {
      return { success: false, error: `银行${type}不足` };
    }
  }

  // 转移token
  for (const [type, count] of Object.entries(tokens)) {
    player.tokens[type] += count;
    bankTokens[type] -= count;
  }

  return { success: true };
}

// 预留卡牌
export function reserveCard(gameState, playerIndex, tier, cardIndex) {
  const player = gameState.players[playerIndex];
  const tierCards = gameState.bank[`tier${tier}`];

  if (cardIndex >= tierCards.length) {
    return { success: false, error: '卡牌不存在' };
  }

  if (player.reservedCards.length >= 3) {
    return { success: false, error: '预留卡牌已满（最多3张）' };
  }

  const card = tierCards.splice(cardIndex, 1)[0];
  player.reservedCards.push(card);

  // 拿1个咖啡
  if (gameState.bank.tokens.coffee > 0) {
    player.tokens.coffee++;
    gameState.bank.tokens.coffee--;
  }

  return { success: true, card };
}

// 检查贵族是否来访
export function checkNobleVisit(player, nobles) {
  for (const noble of nobles) {
    const req = noble.requirement;
    let meets = true;

    for (const [resource, count] of Object.entries(req)) {
      if ((player.bonus[resource] || 0) < count) {
        meets = false;
        break;
      }
    }

    if (meets) {
      return noble;
    }
  }

  return null;
}

// 检查胜利条件
export function checkVictory(gameState) {
  for (const player of gameState.players) {
    if (player.prestige >= 15) {
      return player;
    }
  }
  return null;
}

// 回合结束处理
export function endTurn(gameState) {
  // 检查胜利
  const winner = checkVictory(gameState);
  if (winner) {
    gameState.gameOver = true;
    gameState.winner = winner;
    return;
  }

  // 切换到下一个玩家
  gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
  gameState.turnCount++;
}
