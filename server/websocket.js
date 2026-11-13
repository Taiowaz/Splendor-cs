import { WebSocketServer } from 'ws';
import {
  initializeGame,
  createPlayer,
  takeTokens,
  buyCard,
  reserveCard,
  canAffordCard,
  checkNobleVisit,
  endTurn,
  refillTier,
  RESOURCE_TYPES,
  RESOURCE_NAMES,
  FACE_UP
} from './gameLogic.js';
import { executeAiTurn } from './ai.js';
import { verifyToken, guestToken, renameGuest } from './accounts.js';

// 房间管理
const rooms = new Map();

// 掉线保席：刷新/断网不立刻把席位交给 AI，先留一段时间等本人回来。
// 测试可以用 GRACE_MS 缩短（见 probe-account.mjs 的超时用例）。
const GRACE_MS = Number(process.env.GRACE_MS || 120000);
const graceTimers = new Map(); // `${roomId}|${playerId}` -> timeout

// 空房保号：等待室里最后一个真人走了，房号可能已经发给同学了，不能立刻销毁。
// 留一段时间等人回来或同学进来，超时没人再回收。
const ROOM_HOLD_MS = Number(process.env.ROOM_HOLD_MS || 600000);
const roomHolds = new Map(); // roomId -> timeout

function clearRoomHold(roomId) {
  const t = roomHolds.get(roomId);
  if (t) clearTimeout(t);
  roomHolds.delete(roomId);
}

function holdEmptyRoom(room) {
  clearRoomHold(room.id);
  roomHolds.set(room.id, setTimeout(() => {
    roomHolds.delete(room.id);
    const r = rooms.get(room.id);
    if (r && !r.started && !r.players.some(p => !p.isAi)) {
      clearRoomGrace(r.id);
      rooms.delete(r.id);
      console.log(`Empty room ${r.id} recycled after ${ROOM_HOLD_MS}ms`);
    }
  }, ROOM_HOLD_MS));
  console.log(`Room ${room.id} empty, code held ${ROOM_HOLD_MS}ms`);
}

const graceKey = (roomId, playerId) => `${roomId}|${playerId}`;

function clearGrace(roomId, playerId) {
  const key = graceKey(roomId, playerId);
  const t = graceTimers.get(key);
  if (t) clearTimeout(t);
  graceTimers.delete(key);
}

function clearRoomGrace(roomId) {
  for (const key of [...graceTimers.keys()]) {
    if (key.startsWith(`${roomId}|`)) clearGrace(roomId, key.split('|')[1]);
  }
}

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    // 一条连接一份上下文。身份来自 hello 里的 token（账号或游客），席位按身份 id
    // 认，所以刷新换一条 socket 也还是同一个人 —— 这是「刷新不丢房间」的根。
    const conn = { ws, identity: null, roomId: null, playerId: null, detached: false };

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (message.type !== 'hello') console.log('Received:', message.type);

        if (message.type !== 'hello' && !conn.identity) {
          ws.send(JSON.stringify({ type: 'error', message: '请先握手（hello）' }));
          return;
        }

        switch (message.type) {
          case 'hello':
            handleHello(message);
            break;
          case 'create_room':
            handleCreateRoom(message);
            break;
          case 'join_room':
            handleJoinRoom(message);
            break;
          case 'leave_room':
            handleLeaveRoom();
            break;
          case 'add_ai':
            handleAddAi(message);
            break;
          case 'remove_ai':
            handleRemoveAi(message);
            break;
          case 'start_game':
            handleStartGame();
            break;
          case 'take_tokens':
            handleTakeTokens(message);
            break;
          case 'buy_card':
            handleBuyCard(message);
            break;
          case 'reserve_card':
            handleReserveCard(message);
            break;
          case 'list_rooms':
            handleListRooms();
            break;
          case 'debug_set_tokens':
            handleDebugSetTokens(message);
            break;
          case 'debug_reserved':
            handleDebugReserved(message);
            break;
          default:
            ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
        }
      } catch (err) {
        console.error('Message error:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      if (conn.detached || !conn.roomId || !conn.playerId) return;
      const room = rooms.get(conn.roomId);
      const seat = room?.players.find(p => p.id === conn.playerId);
      // 只有「这条连接确实是该席位当前的连接」才保席：被别的标签页顶掉的旧连接
      // 关闭时，不能把新连接刚接上的席位又标记成离线。
      if (!seat || seat.ws !== ws) return;

      seat.ws = null;
      seat.offline = true;
      broadcastToRoom(room.id, {
        type: 'player_offline',
        playerId: seat.id,
        playerName: seat.name,
        graceMs: GRACE_MS
      });
      broadcastToRoom(room.id, roomUpdate(room));

      clearGrace(room.id, seat.id);
      graceTimers.set(graceKey(room.id, seat.id), setTimeout(() => {
        graceTimers.delete(graceKey(room.id, seat.id));
        const r = rooms.get(room.id);
        const s = r?.players.find(p => p.id === seat.id);
        if (r && s && s.offline && !s.ws) leaveSeat(room.id, seat.id, '掉线');
      }, GRACE_MS));

      console.log(`${seat.name} offline in room ${room.id}, seat held ${GRACE_MS}ms`);
    });

    // 握手：验 token（账号或游客），没带/验不过就发一张游客 token。然后看这个
    // 身份有没有席位等着认领 —— 刷新回房、掉线重连都走这里。
    function handleHello(message) {
      let token = message.token;
      let identity = verifyToken(token);
      if (!identity) {
        const g = guestToken(message.name);
        token = g.token;
        identity = verifyToken(token);
      } else if (identity.guest && message.name && message.name.trim() && message.name.trim() !== identity.name) {
        // 游客在入口页改了昵称：uid 不变重签一张，席位还是他的
        const renamed = renameGuest(token, message.name);
        if (renamed) {
          token = renamed;
          identity = verifyToken(token);
        }
      }
      conn.identity = identity;
      ws.send(JSON.stringify({ type: 'welcome', token, player: identity }));

      const found = findSeat(identity.id);
      if (!found) {
        // 房间只活在内存里：服务端重启后 token 还认得出人，但席位没了。明说一声，
        // 客户端好把上一局那张已经点不动的牌桌撤掉，而不是假装还在局里。
        ws.send(JSON.stringify({ type: 'session_lost' }));
        return;
      }
      const { room, seat } = found;

      // 同账号在别的标签页/设备还连着：把旧连接请下去，避免两条连接操纵同一席位
      if (seat.conn && seat.conn !== conn && seat.conn.ws.readyState === 1) {
        seat.conn.detached = true;
        seat.conn.roomId = null;
        seat.conn.playerId = null;
        seat.conn.ws.send(JSON.stringify({ type: 'session_elsewhere' }));
      }

      const reclaimed = !!seat.isAi;
      clearGrace(room.id, seat.id);
      seat.ws = ws;
      seat.conn = conn;
      seat.isAi = false;
      seat.offline = false;
      seat.wasHuman = true;
      seat.name = identity.name;
      const gamePlayer = room.game?.players.find(p => p.id === seat.id);
      if (gamePlayer) gamePlayer.name = identity.name;
      conn.roomId = room.id;
      conn.playerId = seat.id;

      ws.send(JSON.stringify({
        type: 'session_restored',
        roomId: room.id,
        playerId: seat.id,
        hostId: room.hostId,
        started: room.started,
        players: rosterOf(room),
        gameState: room.started && room.game ? getSanitizedGameState(room.game) : null,
        reclaimed
      }));
      broadcastToRoom(room.id, roomUpdate(room));
      // 「回来了 / 认领回来了」是说给同桌其他人听的，本人那份提示在 session_restored 里，
      // 发给自己会把「已回到房间 X」盖成「✅ 自己 回来了」
      broadcastToRoom(room.id, {
        type: reclaimed ? 'player_reclaimed' : 'player_online',
        playerId: seat.id,
        playerName: seat.name
      }, ws);
      console.log(`${seat.name} resumed seat in room ${room.id}${reclaimed ? ' (reclaimed from AI)' : ''}`);
    }

    // 找这个身份的席位：优先真人席（在线或保席中），其次是被 AI 代打但原本属于
    // 他的席位（掉线超时之后回来，还能认领回自己的进度）。
    function findSeat(uid) {
      let fallback = null;
      for (const room of rooms.values()) {
        const seat = room.players.find(p => p.id === uid);
        if (!seat) continue;
        if (!seat.isAi) return { room, seat };
        if (seat.wasHuman && !fallback) fallback = { room, seat };
      }
      return fallback;
    }

    function seatedElsewhere() {
      return conn.roomId ? rooms.get(conn.roomId) || null : null;
    }

    function handleCreateRoom(message) {
      if (seatedElsewhere()) {
        ws.send(JSON.stringify({ type: 'error', message: `你已在房间 ${conn.roomId} 里，先退出再建新房` }));
        return;
      }
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const playerId = conn.identity.id;

      const room = {
        id: roomId,
        hostId: playerId,
        hostName: conn.identity.name,
        players: [{ id: playerId, name: conn.identity.name, ws, conn, wasHuman: true }],
        game: null,
        started: false
      };

      rooms.set(roomId, room);
      conn.roomId = roomId;
      conn.playerId = playerId;

      ws.send(JSON.stringify({
        type: 'room_created',
        roomId,
        playerId,
        hostId: playerId,
        players: rosterOf(room)
      }));
      broadcastToRoom(roomId, roomUpdate(room));

      console.log(`Room created: ${roomId} by ${conn.identity.name}`);
    }

    function handleJoinRoom(message) {
      if (seatedElsewhere()) {
        ws.send(JSON.stringify({ type: 'error', message: `你已在房间 ${conn.roomId} 里，先退出再加入别的房` }));
        return;
      }
      const room = rooms.get(message.roomId);

      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
        return;
      }

      if (room.started) {
        ws.send(JSON.stringify({ type: 'error', message: '游戏已开始' }));
        return;
      }

      if (room.players.length >= 4) {
        ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
        return;
      }

      const playerId = conn.identity.id;
      if (room.players.some(p => p.id === playerId)) {
        ws.send(JSON.stringify({ type: 'error', message: '你已经在这个房间里了' }));
        return;
      }
      // 空房保号期间进来的人接手房主：原房主退出后 hostId 还指着他，不移交的话
      // 新房里没人能补 AI / 开局。
      const wasEmpty = !room.players.some(p => !p.isAi);
      room.players.push({ id: playerId, name: conn.identity.name, ws, conn, wasHuman: true });
      if (wasEmpty) {
        room.hostId = playerId;
        room.hostName = conn.identity.name;
      }
      clearRoomHold(room.id);
      conn.roomId = message.roomId;
      conn.playerId = playerId;

      // 通知新玩家
      ws.send(JSON.stringify({
        type: 'joined_room',
        roomId: message.roomId,
        playerId,
        hostId: room.hostId,
        players: rosterOf(room)
      }));

      // 房间里的人重新拿一遍名单
      broadcastToRoom(message.roomId, roomUpdate(room));

      console.log(`${conn.identity.name} joined room ${message.roomId}`);
    }

    // 主动退出房间（回大厅）。开完局之后退出＝把这席位交给 AI 代打，和掉线走同一条
    // 清理逻辑；但主动走的不留认领标记（他是故意不要这席位的）。
    function handleLeaveRoom() {
      if (!conn.roomId || !conn.playerId) return;
      const room = rooms.get(conn.roomId);
      if (!room) return;

      clearGrace(room.id, conn.playerId);
      leaveSeat(conn.roomId, conn.playerId, '离开');
      ws.send(JSON.stringify({ type: 'left_room' }));
      conn.roomId = null;
      conn.playerId = null;
    }

    function handleAddAi(message) {
      const room = rooms.get(conn.roomId);

      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
        return;
      }

      if (room.hostId !== conn.playerId) {
        ws.send(JSON.stringify({ type: 'error', message: '只有房主可以添加AI' }));
        return;
      }

      if (room.started) {
        ws.send(JSON.stringify({ type: 'error', message: '游戏已开始' }));
        return;
      }

      if (room.players.length >= 4) {
        ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
        return;
      }

      const aiId = `ai_${Date.now()}`;
      const aiName = message.aiName || `AI玩家${room.players.length}`;
      room.players.push({ id: aiId, name: aiName, ws: null, isAi: true });

      broadcastToRoom(conn.roomId, roomUpdate(room));

      console.log(`AI ${aiName} added to room ${conn.roomId}`);
    }

    // 等待室里反悔加多了的 AI。只允许摘 AI 席位——真人要走自己发 leave_room。
    function handleRemoveAi(message) {
      const room = rooms.get(conn.roomId);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
        return;
      }
      if (room.hostId !== conn.playerId) {
        ws.send(JSON.stringify({ type: 'error', message: '只有房主可以移除AI' }));
        return;
      }
      if (room.started) {
        ws.send(JSON.stringify({ type: 'error', message: '游戏已开始' }));
        return;
      }

      const seat = room.players.find(p => p.id === message.playerId && p.isAi);
      if (!seat) return;

      room.players = room.players.filter(p => p.id !== seat.id);
      broadcastToRoom(conn.roomId, roomUpdate(room));
      console.log(`AI ${seat.name} removed from room ${conn.roomId}`);
    }

    function handleStartGame() {
      const room = rooms.get(conn.roomId);

      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
        return;
      }

      if (room.hostId !== conn.playerId) {
        ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始游戏' }));
        return;
      }

      if (room.players.length < 2) {
        ws.send(JSON.stringify({ type: 'error', message: '至少需要2名玩家' }));
        return;
      }

      // 局没打完就想重开，会把这些人的进度全冲掉 —— 结算之后才允许再来一局。
      if (room.started && room.game && !room.game.gameOver) {
        ws.send(JSON.stringify({ type: 'error', message: '本局还在进行' }));
        return;
      }

      // 初始化游戏
      const game = initializeGame(room.players.length);
      game.players = room.players.map((p, i) => createPlayer(p.id, p.name));
      room.game = game;
      room.started = true;

      // 为每个玩家单独发送游戏开始消息（包含各自的资源信息）
      room.players.forEach(player => {
        if (player.ws && player.ws.readyState === 1) {
          player.ws.send(JSON.stringify({
            type: 'game_started',
            gameState: getSanitizedGameState(game)
          }));
        }
      });

      console.log(`Game started in room ${conn.roomId}`);

      // 如果第一个玩家是AI，自动执行
      checkAndExecuteAiTurn(room);
    }

    function handleTakeTokens(message) {
      const room = rooms.get(conn.roomId);
      if (!room || !room.game) return;

      const game = room.game;
      const playerIndex = game.players.findIndex(p => p.id === conn.playerId);

      if (playerIndex !== game.currentPlayerIndex) {
        ws.send(JSON.stringify({ type: 'error', message: '不是你的回合' }));
        return;
      }

      const player = game.players[playerIndex];
      const { tokens } = message;

      // 合法的拿取只有三种：3 个不同色 / 2 枚同色（银行该色至少 4）/ 单独 1 枚咖啡。
      // 咖啡（万能）不参与前两种 —— 「拿 1 枚万能」本身就是完整的一个行动，
      // 不能和别的颜色混拿，一轮也拿不到 2 枚（参考实现 TakeTokenAction 里
      // double 和 unique 互斥，gold 更是直接拒收，这里是官方变体的放宽版）。
      const tokenTypes = Object.keys(tokens);
      const totalTokens = Object.values(tokens).reduce((a, b) => a + b, 0);
      const coffeeTaken = tokens.coffee || 0;
      const saneCounts = tokenTypes.length > 0 &&
        tokenTypes.every(t => Number.isInteger(tokens[t]) && tokens[t] > 0 && tokens[t] <= 2);
      const threeDiff = totalTokens === 3 && tokenTypes.length === 3 && !coffeeTaken;
      const pairSame = totalTokens === 2 && tokenTypes.length === 1 && !coffeeTaken &&
        game.bank.tokens[tokenTypes[0]] >= 4;
      const soloCoffee = totalTokens === 1 && coffeeTaken === 1;

      if (!saneCounts || (!threeDiff && !pairSame && !soloCoffee)) {
        ws.send(JSON.stringify({ type: 'error', message: '无效的token选择' }));
        return;
      }

      const result = takeTokens(player, tokens, game.bank.tokens);
      if (!result.success) {
        ws.send(JSON.stringify({ type: 'error', message: result.error }));
        return;
      }

      broadcastToRoom(conn.roomId, {
        type: 'tokens_taken',
        playerId: conn.playerId,
        tokens,
        gameState: getSanitizedGameState(game)
      });
      endTurn(game);
      broadcastToRoomWithPlayerState(conn.roomId, {
        type: 'turn_changed',
        currentPlayerIndex: game.currentPlayerIndex
      }, game);
      checkAndExecuteAiTurn(room);
    }

    function handleBuyCard(message) {
      const room = rooms.get(conn.roomId);
      if (!room || !room.game) return;

      const game = room.game;
      const playerIndex = game.players.findIndex(p => p.id === conn.playerId);

      if (playerIndex !== game.currentPlayerIndex) {
        ws.send(JSON.stringify({ type: 'error', message: '不是你的回合' }));
        return;
      }

      const player = game.players[playerIndex];
      const { cardId, tier, fromReserved } = message;

      let result;
      if (fromReserved) {
        // 从预留卡牌中购买
        const reservedIndex = player.reservedCards.findIndex(c => c.id === cardId);
        if (reservedIndex === -1) {
          ws.send(JSON.stringify({ type: 'error', message: '卡牌不在预留区' }));
          return;
        }
        if (!canAffordCard(player, player.reservedCards[reservedIndex])) {
          ws.send(JSON.stringify({ type: 'error', message: '资源不足' }));
          return;
        }
        result = buyCard(game, playerIndex, cardId, tier, true);
      } else {
        result = buyCard(game, playerIndex, cardId, tier);
      }

      if (result.success) {
        // 检查贵族访问
        const noble = checkNobleVisit(player, game.bank.nobles);
        if (noble) {
          player.prestige += noble.prestige;
          player.nobles.push(noble);
          game.bank.nobles = game.bank.nobles.filter(n => n.id !== noble.id);
          broadcastToRoom(conn.roomId, {
            type: 'noble_visit',
            playerId: conn.playerId,
            noble,
            message: `${noble.cn} 认可了你的学术成就！+${noble.prestige} 声誉`
          });
        }

        broadcastToRoom(conn.roomId, {
          type: 'card_bought',
          playerId: conn.playerId,
          card: result.card,
          gameState: getSanitizedGameState(game)
        });

        endTurn(game);

        if (game.gameOver) {
          broadcastToRoom(conn.roomId, {
            type: 'game_over',
            winner: game.winner,
            gameState: getSanitizedGameState(game)
          });
        } else {
          broadcastToRoomWithPlayerState(conn.roomId, {
            type: 'turn_changed',
            currentPlayerIndex: game.currentPlayerIndex
          }, game);
          checkAndExecuteAiTurn(room);
        }
      } else {
        ws.send(JSON.stringify({ type: 'error', message: result.error }));
      }
    }

    function handleReserveCard(message) {
      const room = rooms.get(conn.roomId);
      if (!room || !room.game) return;

      const game = room.game;
      const playerIndex = game.players.findIndex(p => p.id === conn.playerId);

      if (playerIndex !== game.currentPlayerIndex) {
        ws.send(JSON.stringify({ type: 'error', message: '不是你的回合' }));
        return;
      }

      const { tier, cardIndex } = message;
      const result = reserveCard(game, playerIndex, tier, cardIndex);

      if (result.success) {
        broadcastToRoom(conn.roomId, {
          type: 'card_reserved',
          playerId: conn.playerId,
          card: result.card,
          gameState: getSanitizedGameState(game)
        });

        endTurn(game);
        broadcastToRoomWithPlayerState(conn.roomId, {
          type: 'turn_changed',
          currentPlayerIndex: game.currentPlayerIndex
        }, game);
        checkAndExecuteAiTurn(room);
      } else {
        ws.send(JSON.stringify({ type: 'error', message: result.error }));
      }
    }

    // 测试面板改资源：守恒 —— 每色的总数（公共牌堆 + 所有玩家手里）是固定的，所以
    // 某个玩家最多只能设到「牌堆现有的 + 自己已有的」，超了就拒掉并回一条错误。
    // 凭空生成的话总数就变了，而且一超 takeTokens 那条「手里最多 10 枚」就把后面的
    // 拿取全堵死。不改回合、不结算。
    function handleDebugSetTokens(message) {
      const room = rooms.get(conn.roomId);
      if (!room || !room.game) return;

      const game = room.game;
      // 请求方得在这局里（面板只对本局玩家可见，别拿它去戳别人的房间）
      if (!game.players.some(p => p.id === conn.playerId)) return;
      const player = game.players.find(p => p.id === message.playerId);
      if (!player || !message.tokens) return;

      const rejected = [];
      let changed = false;
      for (const [type, want] of Object.entries(message.tokens)) {
        if (!(type in player.tokens)) continue;
        if (!Number.isInteger(want) || want < 0) {
          rejected.push(`${RESOURCE_NAMES[type] || type}只能填 0 以上的整数`);
          continue;
        }
        const max = game.bank.tokens[type] + player.tokens[type];
        if (want > max) {
          rejected.push(`${RESOURCE_NAMES[type] || type}最多 ${max} 枚（牌堆 ${game.bank.tokens[type]} + 手里 ${player.tokens[type]}）`);
          continue;
        }
        game.bank.tokens[type] -= want - player.tokens[type];
        player.tokens[type] = want;
        changed = true;
      }

      if (rejected.length) {
        ws.send(JSON.stringify({ type: 'error', message: `设不进去：${rejected.join('、')}` }));
      }
      if (!changed) return;

      broadcastToRoomWithPlayerState(conn.roomId, {
        type: 'debug_update'
      }, game);
    }

    // 测试面板发/收预留卡：+1 从牌桌明面随机抽一张（那一档补牌），−1 把最后一张
    // 退回同档（明面不满 4 张就回明面，否则压回抽牌堆尾巴，卡不会丢）。
    // 不像正式预留那样附送咖啡，也不改回合 —— 这就是个摆状态的工具。
    function handleDebugReserved(message) {
      const room = rooms.get(conn.roomId);
      if (!room || !room.game) return;

      const game = room.game;
      if (!game.players.some(p => p.id === conn.playerId)) return;
      const player = game.players.find(p => p.id === message.playerId);
      if (!player) return;

      if (message.delta === 1) {
        if (player.reservedCards.length >= 3) {
          ws.send(JSON.stringify({ type: 'error', message: '预留已满（最多 3 张）' }));
          return;
        }
        const tiers = [3, 2, 1].filter(t => game.bank[`tier${t}`].length > 0);
        if (!tiers.length) {
          ws.send(JSON.stringify({ type: 'error', message: '牌桌上没有可拿的卡了' }));
          return;
        }
        const tier = tiers[Math.floor(Math.random() * tiers.length)];
        const row = game.bank[`tier${tier}`];
        player.reservedCards.push(row.splice(Math.floor(Math.random() * row.length), 1)[0]);
        refillTier(game, tier);
      } else if (message.delta === -1) {
        const card = player.reservedCards.pop();
        if (!card) {
          ws.send(JSON.stringify({ type: 'error', message: '这个玩家没有预留卡' }));
          return;
        }
        const row = game.bank[`tier${card.tier}`];
        if (row.length < FACE_UP) row.push(card);
        else game.bank[`draw${card.tier}`].push(card);
      } else {
        return;
      }

      broadcastToRoomWithPlayerState(conn.roomId, {
        type: 'debug_update'
      }, game);
    }

    function handleListRooms() {
      const roomList = Array.from(rooms.values())
        .filter(r => !r.started)
        .map(r => ({
          id: r.id,
          playerCount: r.players.length,
          maxPlayers: 4,
          hostName: r.players.find(p => p.id === r.hostId)?.name || r.hostName || r.players[0]?.name,
          players: rosterOf(r)
        }));

      ws.send(JSON.stringify({
        type: 'room_list',
        rooms: roomList
      }));
    }
  });

  return wss;
}

function broadcastToRoom(roomId, message, exceptWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  const msg = JSON.stringify(message);
  room.players.forEach(p => {
    if (p.ws && p.ws !== exceptWs && p.ws.readyState === 1) { // WebSocket.OPEN
      p.ws.send(msg);
    }
  });
}

// 房间名单：大厅和等待室都读这一份，带 isAi / offline 界面才标得出真人/AI/掉线
function rosterOf(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    isAi: !!p.isAi,
    offline: !p.isAi && !!p.offline
  }));
}

function roomUpdate(room) {
  return {
    type: 'room_update',
    roomId: room.id,
    hostId: room.hostId,
    started: room.started,
    players: rosterOf(room)
  };
}

// 席位离开（主动退出、保席超时走同一条）。
function leaveSeat(roomId, playerId, reason = '离开') {
  const room = rooms.get(roomId);
  if (!room) return;
  const seat = room.players.find(p => p.id === playerId);
  if (!seat) return;
  clearGrace(roomId, playerId);
  seat.ws = null;
  seat.conn = null;
  seat.offline = false;
  // 掉线超时的席位留个认领标记：本人回来还能接回自己的进度；主动退出不留。
  seat.wasHuman = reason === '掉线';

  if (!room.started) {
    room.players = room.players.filter(p => p.id !== playerId);
  } else {
    // 已经开局就不能摘席位了：回合顺序和牌堆都是按这桌人数发的。改由 AI 代打，
    // 否则后面的人会干等一个页面早就关掉的客户端。
    seat.isAi = true;
  }

  // 一个真人都不剩（保席中的也算真人）：开过局的房间没人看了，销毁；还没开局的
  // 等待室先保号 —— 房号可能已经发给同学了，本人退出去一趟也得能回来。
  if (!room.players.some(p => !p.isAi)) {
    if (!room.started) {
      holdEmptyRoom(room);
      return;
    }
    clearRoomGrace(roomId);
    clearRoomHold(roomId);
    rooms.delete(roomId);
    return;
  }
  if (room.hostId === playerId) {
    const next = room.players.find(p => !p.isAi);
    room.hostId = next.id;
    room.hostName = next.name;
  }

  if (!room.started) {
    broadcastToRoom(roomId, roomUpdate(room));
  } else {
    broadcastToRoom(roomId, {
      type: 'player_left',
      playerId,
      playerName: seat.name,
      takenOverByAi: true,
      reason,
      hostId: room.hostId
    });
    // 名单也得重发：这席位现在是 AI、不再离线，客户端的「离线」徽标靠这条撤掉
    broadcastToRoom(roomId, roomUpdate(room));
    checkAndExecuteAiTurn(room);
  }
}

// 为每个玩家单独广播（包含各自的资源信息）
function broadcastToRoomWithPlayerState(roomId, messageTemplate, game) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.players.forEach(player => {
    if (player.ws && player.ws.readyState === 1) {
      const gameState = getSanitizedGameState(game);
      const message = {
        ...messageTemplate,
        gameState
      };
      player.ws.send(JSON.stringify(message));
    }
  });
}

// 检查并执行AI回合
function checkAndExecuteAiTurn(room) {
  if (!room || !rooms.has(room.id) || !room.game || room.game.gameOver) return;

  const game = room.game;
  const currentPlayer = game.players[game.currentPlayerIndex];
  const playerInfo = room.players.find(p => p.id === currentPlayer.id);

  if (playerInfo && playerInfo.isAi) {
    // AI回合，延迟1秒后执行（模拟思考时间）
    setTimeout(() => {
      // 最后一个真人退出时房间已经销毁，但排队中的这一发还在：不认房间就没了，
      // 这桌 AI 会自己一直打下去（每 500ms 一轮）直到打出个胜负，白烧 CPU
      if (!rooms.has(room.id) || !room.game || room.game.gameOver ||
          room.game.currentPlayerIndex !== game.currentPlayerIndex) return;
      // 排队这一秒里本人可能刚好重连认领回席位，开火前再确认一次还是 AI
      const now = room.players.find(p => p.id === room.game.players[room.game.currentPlayerIndex].id);
      if (!now || !now.isAi) return;
      const aiBroadcast = (roomId, message) => {
        if (message.gameState !== undefined) {
          const { gameState, ...template } = message;
          broadcastToRoomWithPlayerState(roomId, template, game);
        } else {
          broadcastToRoom(roomId, message);
        }
      };
      executeAiTurn(game, game.currentPlayerIndex, room, aiBroadcast);
      // 执行后继续检查下一个玩家是否是AI
      setTimeout(() => checkAndExecuteAiTurn(room), 500);
    }, 1000);
  }
}

function getSanitizedGameState(game) {
  return {
    players: game.players.map(p => ({
      id: p.id,
      name: p.name,
      // 筹码是公开信息（官方规则如此，splendor-chinese 也全量下发），对手面板要显示
      tokens: p.tokens,
      cards: p.cards,
      // 会士卡立在玩家面前，是公开信息
      nobles: p.nobles,
      // 预留卡是公开信息：我们的 reserveCard 只能从牌桌明面拿（没有「从牌堆盲抽
      // 预留」这个动作），这张卡本来就翻给所有人看过。splendor-chinese 的
      // hideReservedCardFaces 也只把 face-down（牌堆盲抽）那部分降级成 tier，
      // 从牌面预留的连 id/cost 原样下发 —— 对手框要拿真卡面来显示就靠这条。
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