// 学术资源类型
import { ACTIVE_NOBLES } from '../shared/nobles.js';
import { VENUES } from '../shared/venues.js';

export const RESOURCE_TYPES = ['data', 'compute', 'citation', 'collaborator', 'funding'];

export const RESOURCE_NAMES = {
  data: '数据',
  compute: '算力',
  citation: '引用',
  collaborator: '合作者',
  funding: '经费',
  coffee: '咖啡'
};

// 牌库 = shared/venues.js 的 90 条注册表（CCF-A 20 / B 30 / C 40）。
// 成本、产出、声誉都以那张表为准；要改数值改 tools/vc-matrix.js 的 BONUS / INPUTS / HI，
// 跑 node tools/vc-matrix.js --write 回写注册表，别在服务端再硬编码一套。
const TIERS = [1, 2, 3];
const FACE_UP = 4;

// 会议卡：卡面信息（英文名、中文、CCF 档、徽标）跟着卡进游戏状态，客户端不用再查一份表
function buildDeck() {
  return VENUES.map(v => ({
    id: v.id,
    tier: v.tier,
    name: v.name,
    cn: v.cn,
    fullName: v.fullName,
    ccf: v.ccf,
    prestige: v.prestige,
    bonus: v.bonus,
    cost: { ...v.cost },
    art: { ...v.art }
  }));
}

// 初始化游戏
export function initializeGame(playerCount) {
  const allCards = buildDeck();

  // 根据玩家数量决定贵族数量（官方规则：翻 playerCount+1 张，其余移出本局）
  const nobleCount = playerCount + 1;
  const nobles = shuffle(ACTIVE_NOBLES).slice(0, nobleCount);

  // 资源token数量
  const tokenCounts = {
    2: { data: 4, compute: 4, citation: 4, collaborator: 4, funding: 4, coffee: 5 },
    3: { data: 5, compute: 5, citation: 5, collaborator: 5, funding: 5, coffee: 5 },
    4: { data: 7, compute: 7, citation: 7, collaborator: 7, funding: 7, coffee: 5 }
  };

  // 每档洗一叠：前 4 张摊在桌上，其余进抽牌堆
  const bank = {
    tokens: tokenCounts[playerCount],
    nobles: nobles
  };
  for (const tier of TIERS) {
    const pile = shuffle(allCards.filter(c => c.tier === tier));
    bank[`tier${tier}`] = pile.slice(0, FACE_UP);
    bank[`draw${tier}`] = pile.slice(FACE_UP);
  }

  return {
    players: [],
    bank: bank,
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

// 桌上的卡被买走/预留后从抽牌堆补满 4 张；抽牌堆空了留空位（官方规则）
function refillTier(gameState, tier) {
  const row = gameState.bank[`tier${tier}`];
  const draw = gameState.bank[`draw${tier}`];
  while (row.length < FACE_UP && draw.length > 0) {
    row.push(draw.shift());
  }
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

// 购买卡牌（fromReserved = true 时从玩家预留区买，不动牌桌）
export function buyCard(gameState, playerIndex, cardId, tier, fromReserved = false) {
  const player = gameState.players[playerIndex];
  const row = fromReserved ? player.reservedCards : gameState.bank[`tier${tier}`];
  const cardIndex = row.findIndex(c => c.id === cardId);

  if (cardIndex === -1) return { success: false, error: '卡牌不存在' };

  const card = row[cardIndex];
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

  // 从预留区/牌桌移除，牌桌那侧补一张
  row.splice(cardIndex, 1);
  if (!fromReserved) refillTier(gameState, tier);

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

  if (cardIndex < 0 || cardIndex >= tierCards.length) {
    return { success: false, error: '卡牌不存在' };
  }

  if (player.reservedCards.length >= 3) {
    return { success: false, error: '预留卡牌已满（最多3张）' };
  }

  const card = tierCards.splice(cardIndex, 1)[0];
  player.reservedCards.push(card);
  refillTier(gameState, tier);

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
