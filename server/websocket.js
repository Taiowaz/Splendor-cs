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
  RESOURCE_TYPES
} from './gameLogic.js';
import { executeAiTurn } from './ai.js';

// 房间管理
const rooms = new Map();

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let currentRoom = null;
    let currentPlayerId = null;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        console.log('Received:', message);

        switch (message.type) {
          case 'create_room':
            handleCreateRoom(ws, message);
            break;
          case 'join_room':
            handleJoinRoom(ws, message);
            break;
          case 'add_ai':
            handleAddAi(ws, message);
            break;
          case 'start_game':
            handleStartGame(ws, message);
            break;
          case 'take_tokens':
            handleTakeTokens(ws, message);
            break;
          case 'buy_card':
            handleBuyCard(ws, message);
            break;
          case 'reserve_card':
            handleReserveCard(ws, message);
            break;
          case 'list_rooms':
            handleListRooms(ws);
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
      // 清理：玩家断开连接
      if (currentRoom && currentPlayerId) {
        const room = rooms.get(currentRoom);
        if (room) {
          broadcastToRoom(currentRoom, {
            type: 'player_left',
            playerId: currentPlayerId,
            playerName: room.game.players.find(p => p.id === currentPlayerId)?.name
          });
          // 可选：删除房间或让AI接管
        }
      }
    });

    function handleCreateRoom(ws, message) {
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const playerId = `player_${Date.now()}`;

      const room = {
        id: roomId,
        hostId: playerId,
        players: [{ id: playerId, name: message.playerName, ws }],
        game: null,
        started: false
      };

      rooms.set(roomId, room);
      currentRoom = roomId;
      currentPlayerId = playerId;

      ws.send(JSON.stringify({
        type: 'room_created',
        roomId,
        playerId,
        players: room.players.map(p => ({ id: p.id, name: p.name }))
      }));

      console.log(`Room created: ${roomId} by ${message.playerName}`);
    }

    function handleJoinRoom(ws, message) {
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

      const playerId = `player_${Date.now()}`;
      room.players.push({ id: playerId, name: message.playerName, ws });
      currentRoom = message.roomId;
      currentPlayerId = playerId;

      // 通知新玩家
      ws.send(JSON.stringify({
        type: 'joined_room',
        roomId: message.roomId,
        playerId,
        players: room.players.map(p => ({ id: p.id, name: p.name }))
      }));

      // 广播给房间内所有人
      broadcastToRoom(message.roomId, {
        type: 'player_joined',
        playerId,
        playerName: message.playerName,
        players: room.players.map(p => ({ id: p.id, name: p.name }))
      });

      console.log(`${message.playerName} joined room ${message.roomId}`);
    }

    function handleAddAi(ws, message) {
      const room = rooms.get(currentRoom);

      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
        return;
      }

      if (room.hostId !== currentPlayerId) {
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

      broadcastToRoom(currentRoom, {
        type: 'player_joined',
        playerId: aiId,
        playerName: aiName,
        players: room.players.map(p => ({ id: p.id, name: p.name }))
      });

      console.log(`AI ${aiName} added to room ${currentRoom}`);
    }

    function handleStartGame(ws, message) {
      const room = rooms.get(currentRoom);

      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
        return;
      }

      if (room.hostId !== currentPlayerId) {
        ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始游戏' }));
        return;
      }

      if (room.players.length < 2) {
        ws.send(JSON.stringify({ type: 'error', message: '至少需要2名玩家' }));
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
            gameState: getSanitizedGameState(game, player.id)
          }));
        }
      });

      console.log(`Game started in room ${currentRoom}`);

      // 如果第一个玩家是AI，自动执行
      checkAndExecuteAiTurn(room);
    }

    function handleTakeTokens(ws, message) {
      const room = rooms.get(currentRoom);
      if (!room || !room.game) return;

      const game = room.game;
      const playerIndex = game.players.findIndex(p => p.id === currentPlayerId);

      if (playerIndex !== game.currentPlayerIndex) {
        ws.send(JSON.stringify({ type: 'error', message: '不是你的回合' }));
        return;
      }

      const player = game.players[playerIndex];
      const { tokens } = message;

      // 验证：要么拿3个不同颜色，要么拿2个相同颜色
      const tokenTypes = Object.keys(tokens);
      const totalTokens = Object.values(tokens).reduce((a, b) => a + b, 0);

      if (totalTokens === 3 && tokenTypes.length === 3) {
        // 拿3个不同颜色
        const result = takeTokens(player, tokens, game.bank.tokens);
        if (result.success) {
          broadcastToRoom(currentRoom, {
            type: 'tokens_taken',
            playerId: currentPlayerId,
            tokens,
            gameState: getSanitizedGameState(game, currentPlayerId)
          });
          endTurn(game);
          broadcastToRoomWithPlayerState(currentRoom, {
            type: 'turn_changed',
            currentPlayerIndex: game.currentPlayerIndex
          }, game);
          checkAndExecuteAiTurn(room);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: result.error }));
        }
      } else if (totalTokens === 2 && tokenTypes.length === 1 && game.bank.tokens[tokenTypes[0]] >= 4) {
        // 拿2个相同颜色（银行该颜色至少4个）
        const result = takeTokens(player, tokens, game.bank.tokens);
        if (result.success) {
          broadcastToRoom(currentRoom, {
            type: 'tokens_taken',
            playerId: currentPlayerId,
            tokens,
            gameState: getSanitizedGameState(game, currentPlayerId)
          });
          endTurn(game);
          broadcastToRoomWithPlayerState(currentRoom, {
            type: 'turn_changed',
            currentPlayerIndex: game.currentPlayerIndex
          }, game);
          checkAndExecuteAiTurn(room);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: result.error }));
        }
      } else {
        ws.send(JSON.stringify({ type: 'error', message: '无效的token选择' }));
      }
    }

    function handleBuyCard(ws, message) {
      const room = rooms.get(currentRoom);
      if (!room || !room.game) return;

      const game = room.game;
      const playerIndex = game.players.findIndex(p => p.id === currentPlayerId);

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
        const card = player.reservedCards[reservedIndex];
        if (!canAffordCard(player, card)) {
          ws.send(JSON.stringify({ type: 'error', message: '资源不足' }));
          return;
        }
        result = buyCard(game, playerIndex, cardId, tier);
        if (result.success) {
          player.reservedCards.splice(reservedIndex, 1);
        }
      } else {
        result = buyCard(game, playerIndex, cardId, tier);
      }

      if (result.success) {
        // 检查贵族访问
        const noble = checkNobleVisit(player, game.bank.nobles);
        if (noble) {
          player.prestige += noble.prestige;
          game.bank.nobles = game.bank.nobles.filter(n => n.id !== noble.id);
          broadcastToRoom(currentRoom, {
            type: 'noble_visit',
            playerId: currentPlayerId,
            noble,
            message: `${noble.name} 认可了你的学术成就！+${noble.prestige} 声誉`
          });
        }

        broadcastToRoom(currentRoom, {
          type: 'card_bought',
          playerId: currentPlayerId,
          card: result.card,
          gameState: getSanitizedGameState(game, currentPlayerId)
        });

        endTurn(game);

        if (game.gameOver) {
          broadcastToRoom(currentRoom, {
            type: 'game_over',
            winner: game.winner,
            gameState: getSanitizedGameState(game, null)
          });
        } else {
          broadcastToRoomWithPlayerState(currentRoom, {
            type: 'turn_changed',
            currentPlayerIndex: game.currentPlayerIndex
          }, game);
          checkAndExecuteAiTurn(room);
        }
      } else {
        ws.send(JSON.stringify({ type: 'error', message: result.error }));
      }
    }

    function handleReserveCard(ws, message) {
      const room = rooms.get(currentRoom);
      if (!room || !room.game) return;

      const game = room.game;
      const playerIndex = game.players.findIndex(p => p.id === currentPlayerId);

      if (playerIndex !== game.currentPlayerIndex) {
        ws.send(JSON.stringify({ type: 'error', message: '不是你的回合' }));
        return;
      }

      const { tier, cardIndex } = message;
      const result = reserveCard(game, playerIndex, tier, cardIndex);

      if (result.success) {
        broadcastToRoom(currentRoom, {
          type: 'card_reserved',
          playerId: currentPlayerId,
          card: result.card,
          gameState: getSanitizedGameState(game, currentPlayerId)
        });

        endTurn(game);
        broadcastToRoomWithPlayerState(currentRoom, {
          type: 'turn_changed',
          currentPlayerIndex: game.currentPlayerIndex
        }, game);
        checkAndExecuteAiTurn(room);
      } else {
        ws.send(JSON.stringify({ type: 'error', message: result.error }));
      }
    }

    function handleListRooms(ws) {
      const roomList = Array.from(rooms.values())
        .filter(r => !r.started)
        .map(r => ({
          id: r.id,
          playerCount: r.players.length,
          maxPlayers: 4,
          hostName: r.players[0]?.name
        }));

      ws.send(JSON.stringify({
        type: 'room_list',
        rooms: roomList
      }));
    }
  });

  return wss;
}

function broadcastToRoom(roomId, message) {
  const room = rooms.get(roomId);
  if (!room) return;

  const msg = JSON.stringify(message);
  room.players.forEach(p => {
    if (p.ws && p.ws.readyState === 1) { // WebSocket.OPEN
      p.ws.send(msg);
    }
  });
}

// 为每个玩家单独广播（包含各自的资源信息）
function broadcastToRoomWithPlayerState(roomId, messageTemplate, game) {
  const room = rooms.get(roomId);
  if (!room) return;

  console.log('broadcastToRoomWithPlayerState:', messageTemplate.type, 'players:', room.players.length);

  room.players.forEach(player => {
    if (player.ws && player.ws.readyState === 1) {
      const gameState = getSanitizedGameState(game, player.id);
      console.log('  ->', player.name, 'tokens:', gameState.players.find(p => p.id === player.id)?.tokens);
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
  if (!room || !room.game || room.game.gameOver) return;

  const game = room.game;
  const currentPlayer = game.players[game.currentPlayerIndex];
  const playerInfo = room.players.find(p => p.id === currentPlayer.id);

  if (playerInfo && playerInfo.isAi) {
    // AI回合，延迟1秒后执行（模拟思考时间）
    setTimeout(() => {
      if (room.game && !room.game.gameOver && room.game.currentPlayerIndex === game.currentPlayerIndex) {
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
      }
    }, 1000);
  }
}

function getSanitizedGameState(game, requestingPlayerId) {
  return {
    players: game.players.map(p => ({
      id: p.id,
      name: p.name,
      tokens: requestingPlayerId === p.id ? p.tokens : null, // 只给自己看完整资源
      publicTokens: requestingPlayerId && requestingPlayerId !== p.id ? {
        coffee: p.tokens.coffee // 其他玩家只能看到咖啡数量
      } : null,
      cards: p.cards,
      reservedCards: requestingPlayerId === p.id ? p.reservedCards : [],
      prestige: p.prestige,
      bonus: p.bonus
    })),
    bank: {
      tokens: game.bank.tokens,
      tier1Count: game.bank.tier1.length,
      tier2Count: game.bank.tier2.length,
      tier3Count: game.bank.tier3.length,
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
