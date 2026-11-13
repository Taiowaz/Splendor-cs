import { WebSocketServer } from 'ws';
import { randomBytes } from 'crypto';
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
import { verifyToken, guestToken, renameGuest, nameRegistered } from './accounts.js';

// 房间管理
const rooms = new Map();

// 在线连接登记：游客昵称不落 users.json，查重得看「谁正用着这个名字」——包括还没进房、
// 只在入口页/大厅挂着的人。连接一断就移除，名字随即释放给别人用。
const liveConns = new Set();

// 这个名字现在有没有人用着：注册账号（永久）＋在线连接＋房里保着的席位（掉线保席/
// 空房保号/被 AI 代打期间名字也给他留着，本人回来还要认领）。exceptUid 跳过本人，
// 刷新、改名、认领都不会被自己的名字挡下来。注册新账号时也用它查在线重名。
export function nameTaken(name, exceptUid = null) {
  if (!name) return false;
  if (nameRegistered(name)) return true;
  for (const c of liveConns) {
    if (c.identity && c.identity.id !== exceptUid && c.identity.name === name) return true;
  }
  for (const room of rooms.values()) {
    for (const p of room.players) {
      if ((!p.isAi || p.wasHuman) && p.id !== exceptUid && p.name === name) return true;
    }
  }
  return false;
}

// 掉线保席：刷新/断网不立刻把席位交给 AI，先留一段时间等本人回来。
// 测试可以用 GRACE_MS 缩短（见 probe-account.mjs 的超时用例）。
const GRACE_MS = Number(process.env.GRACE_MS || 120000);
const graceTimers = new Map(); // `${roomId}|${playerId}` -> timeout

// 空房保号：房里最后一个真人走了（等待室空了、或开局后全转成 AI 代打），房号和牌局
// 进度都先留着 —— 房号可能已经发给同学了，本人退出去一趟也得能回来。超时没人再回收。
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
    if (r && !r.players.some(p => !p.isAi)) {
      clearRoomGrace(r.id);
      rooms.delete(r.id);
      console.log(`Room ${r.id} (no humans) recycled after ${ROOM_HOLD_MS}ms`);
    }
  }, ROOM_HOLD_MS));
  console.log(`Room ${room.id} has no humans, held ${ROOM_HOLD_MS}ms`);
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
    // leftSeat：这条连接主动退过席。退席后改名之类的 hello 不该把他又拽回牌桌，
    // 想回去得走大厅「回到牌桌」或刷新（新连接不带这个标记）。
    const conn = { ws, identity: null, roomId: null, playerId: null, detached: false, leftSeat: false };
    liveConns.add(conn);

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
      // 先摘登记再走保席逻辑：被顶掉的旧连接、没进房的连接也得释放名字，别漏在集合里
      liveConns.delete(conn);
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
      const requested = String(message.name ?? '').trim();
      let nameError = null;

      if (!identity) {
        // 新游客：名字被占就退回随机游客名，并明说一声让他换（uid 是新的，不跳过任何人）
        let name = requested;
        if (nameTaken(name)) {
          nameError = `名字「${name}」已经有人用了，换一个吧`;
          name = '';
        }
        const g = guestToken(name);
        token = g.token;
        identity = verifyToken(token);
      } else if (identity.guest) {
        const oldName = identity.name;
        if (requested && requested !== oldName) {
          // 游客在入口页改了昵称：uid 不变重签一张，席位还是他的。重名就拒绝、保留原名
          //（exceptUid 跳过本人，自己的名字不会误挡）。
          if (nameTaken(requested, identity.id)) {
            nameError = `名字「${requested}」已经有人用了，换一个吧`;
          } else {
            const renamed = renameGuest(token, requested);
            if (renamed) {
              token = renamed;
              identity = verifyToken(token);
            }
          }
        } else if (nameRegistered(oldName)) {
          // 本人离线那会儿名字被人注册了：保留 uid（席位还认得他），换个随机游客名避开账号
          const renamed = renameGuest(token, `游客${randomBytes(2).toString('hex')}`);
          if (renamed) {
            token = renamed;
            identity = verifyToken(token);
          }
          nameError = `名字「${oldName}」已经被注册了，先给你换个游客名`;
        }
      }
      conn.identity = identity;
      ws.send(JSON.stringify({ type: 'welcome', token, player: identity }));
      if (nameError) ws.send(JSON.stringify({ type: 'error', message: nameError }));

      const found = findSeat(identity.id);
      if (!found) {
        // 房间只活在内存里：服务端重启后 token 还认得出人，但席位没了。明说一声，
        // 客户端好把上一局那张已经点不动的牌桌撤掉，而不是假装还在局里。
        ws.send(JSON.stringify({ type: 'session_lost' }));
        return;
      }
      const { room, seat } = found;

      // 这条连接刚主动退过席（退出对局回到大厅）：改名之类的 hello 不该把他又拽回牌桌。
      // 只拦「被 AI 代打的旧席位」——想回去得走大厅「回到牌桌」(join_room) 或刷新页面
      //（那是新连接，不带 leftSeat 标记）。掉线保席中的真人席不受影响，那不是主动退出。
      if (conn.leftSeat && seat.isAi) return;

      // 同账号在别的标签页/设备还连着：把旧连接请下去，避免两条连接操纵同一席位
      if (seat.conn && seat.conn !== conn && seat.conn.ws.readyState === 1) {
        seat.conn.detached = true;
        seat.conn.roomId = null;
        seat.conn.playerId = null;
        seat.conn.ws.send(JSON.stringify({ type: 'session_elsewhere' }));
      }

      resumeSeat(room, seat, ws, conn, identity);
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
      conn.leftSeat = false;

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

      const playerId = conn.identity.id;
      const existing = room.players.find(p => p.id === playerId);

      if (room.started) {
        // 开过局的房只认原席位本人回来认领（他的席位正由 AI 代打），别人不能中途加入
        if (existing && existing.isAi && existing.wasHuman) {
          clearRoomHold(room.id);
          resumeSeat(room, existing, ws, conn, conn.identity);
          return;
        }
        ws.send(JSON.stringify({ type: 'error', message: '游戏已开始，没法中途加入' }));
        return;
      }

      if (room.players.length >= 4) {
        ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
        return;
      }

      if (existing) {
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
      conn.leftSeat = false;

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
    // 清理逻辑；席位留认领标记，本人回来能从大厅「回到牌桌」接回自己的进度。
    function handleLeaveRoom() {
      if (!conn.roomId || !conn.playerId) return;
      const room = rooms.get(conn.roomId);
      if (!room) return;

      clearGrace(room.id, conn.playerId);
      leaveSeat(conn.roomId, conn.playerId, '离开');
      ws.send(JSON.stringify({ type: 'left_room' }));
      conn.roomId = null;
      conn.playerId = null;
      // 主动退席：这条连接后续的 hello（改名等）不再自动认领旧席位，回房走显式动作
      conn.leftSeat = true;
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
      const uid = conn.identity.id;
      // 未开局的房大家都能看；开过局的房只给「席位正由 AI 代打的原主人」看，让他能回来认领
      const mineToReclaim = r => r.started && r.players.some(p => p.id === uid && p.isAi && p.wasHuman);
      const roomList = Array.from(rooms.values())
        .filter(r => !r.started || mineToReclaim(r))
        .map(r => ({
          id: r.id,
          playerCount: r.players.length,
          maxPlayers: 4,
          hostName: r.players.find(p => p.id === r.hostId)?.name || r.hostName || r.players[0]?.name,
          players: rosterOf(r),
          started: r.started,
          rejoinable: mineToReclaim(r)
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

// 把席位接回一条活连接：刷新回房、掉线重连、退出后认领都走这里。reclaimed 表示
// 这席位之前是不是正由 AI 代打（是不是从 AI 手里接回来的）。
function resumeSeat(room, seat, ws, conn, identity) {
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
  conn.leftSeat = false;

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
  // 认领回来时若正轮到 AI，把暂停的 AI 回合续上（无真人时 checkAndExecuteAiTurn 会停）
  if (room.started) checkAndExecuteAiTurn(room);
  return reclaimed;
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

  if (!room.started) {
    room.players = room.players.filter(p => p.id !== playerId);
  } else {
    // 已经开局就不能摘席位了：回合顺序和牌堆都是按这桌人数发的。改由 AI 代打，
    // 否则后面的人会干等一个页面早就关掉的客户端。
    seat.isAi = true;
    // 不论主动退出还是掉线超时都留认领标记：本人回来还能接回自己的进度。
    seat.wasHuman = true;
  }

  // 一个真人都不剩（保席中的也算真人）：不管等待室还是开过局的房都先保号/保席 ——
  // 房号可能已经发给同学了、牌局进度也还留着，本人退出去一趟也得能回来。超时没人再回收。
  if (!room.players.some(p => !p.isAi)) {
    holdEmptyRoom(room);
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
  // 一个真人都不剩（全退出/掉线转 AI 了）：这桌先停，别让 AI 自己打出个胜负白烧 CPU。
  // 本人回来认领时 resumeSeat 会再调这里续上。
  if (!room.players.some(p => !p.isAi)) return;

  const game = room.game;
  const currentPlayer = game.players[game.currentPlayerIndex];
  const playerInfo = room.players.find(p => p.id === currentPlayer.id);

  if (playerInfo && playerInfo.isAi) {
    // AI回合，延迟1秒后执行（模拟思考时间）
    setTimeout(() => {
      // 排队这一发可能房间已回收、或本人已回来认领：开火前把房间、回合、真人、AI 都再确认一遍
      if (!rooms.has(room.id) || !room.game || room.game.gameOver ||
          room.game.currentPlayerIndex !== game.currentPlayerIndex) return;
      if (!room.players.some(p => !p.isAi)) return;
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