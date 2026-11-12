import { useState, useEffect, useCallback, useRef } from 'react'
import TitleScreen from './components/TitleScreen.jsx'
import Lobby from './components/Lobby.jsx'
import WaitingRoom from './components/WaitingRoom.jsx'
import GameBoard from './components/GameBoard.jsx'
import useWebSocket from './hooks/useWebSocket.js'
import './App.css'

// 名字记在本地，下次进来不用重新填
const NAME_KEY = 'academic-gems-name'
const MAX_PLAYERS = 4

function App() {
  // title 填名字 → lobby 挑/建/进房 → room 等待室凑人 → game 牌桌
  const [screen, setScreen] = useState('title')
  const [playerName, setPlayerName] = useState(() => localStorage.getItem(NAME_KEY) || '')
  const [myPlayerId, setMyPlayerId] = useState(null)
  const [room, setRoom] = useState(null)
  const [roomList, setRoomList] = useState([])
  const [gameState, setGameState] = useState(null)
  const [notification, setNotification] = useState(null)
  // 每开一局换一次 key：牌桌那些内部状态（选中筹码、预留弹窗）得跟着新一局清空
  const [gameSeq, setGameSeq] = useState(0)
  // 快速开局＝建房 + 塞 3 个 AI + 直接开始。房号要等 room_created 回来才有，
  // 所以把「房建好之后接着干什么」记在这儿。
  const intentRef = useRef(null)

  const { connected, sendMessage, lastMessage } = useWebSocket()

  const showNotification = useCallback((message) => {
    setNotification(message)
    setTimeout(() => setNotification(null), 3000)
  }, [])

  const saveName = useCallback((name) => {
    const trimmed = name.slice(0, 12)
    setPlayerName(trimmed)
    localStorage.setItem(NAME_KEY, trimmed)
  }, [])

  // 没填名字就退回「我」，别让空名字建出一个匿名席位
  const currentName = useCallback(() => playerName.trim() || '我', [playerName])

  const requestRooms = useCallback(() => {
    if (connected) sendMessage({ type: 'list_rooms' })
  }, [connected, sendMessage])

  useEffect(() => {
    if (screen === 'lobby') requestRooms()
  }, [screen, requestRooms])

  // 处理 WebSocket 消息
  useEffect(() => {
    if (!lastMessage) return
    const m = lastMessage

    switch (m.type) {
      case 'room_created':
      case 'joined_room': {
        setMyPlayerId(m.playerId)
        setRoom({ roomId: m.roomId, hostId: m.hostId, started: false, players: m.players })
        if (intentRef.current === 'quick') {
          intentRef.current = null
          for (let i = 1; i < MAX_PLAYERS; i++) {
            sendMessage({ type: 'add_ai', aiName: `AI玩家${i}` })
          }
          sendMessage({ type: 'start_game' })
          break
        }
        setScreen('room')
        break
      }

      case 'room_update':
        setRoom({ roomId: m.roomId, hostId: m.hostId, started: m.started, players: m.players })
        break

      case 'room_list':
        setRoomList(m.rooms)
        break

      case 'left_room':
        setRoom(null)
        setGameState(null)
        setScreen('lobby')
        break

      case 'game_started':
        setGameState(m.gameState)
        setGameSeq(s => s + 1)
        setScreen('game')
        break

      case 'player_left':
        // 局中掉线的那席位服务端已经转成 AI 代打，名单不用动，只提示 + 同步房主
        if (m.takenOverByAi) {
          showNotification(`⚠️ ${m.playerName} 掉线，该席位由 AI 代打`)
          setRoom(prev => (prev ? { ...prev, hostId: m.hostId } : prev))
        }
        break

      case 'tokens_taken':
      case 'card_bought':
      case 'card_reserved':
      case 'turn_changed':
      case 'debug_update':
        setGameState(m.gameState)
        break

      case 'noble_visit':
        showNotification(m.message)
        break

      case 'game_over':
        setGameState(m.gameState)
        break

      case 'error':
        showNotification(`❌ ${m.message}`)
        break
    }
  }, [lastMessage, sendMessage, showNotification])

  const handleQuickStart = () => {
    intentRef.current = 'quick'
    sendMessage({ type: 'create_room', playerName: currentName() })
  }

  const handleCreateRoom = () => {
    intentRef.current = null
    sendMessage({ type: 'create_room', playerName: currentName() })
  }

  const handleJoinRoom = (code) => {
    intentRef.current = null
    sendMessage({ type: 'join_room', roomId: code.toUpperCase(), playerName: currentName() })
  }

  const handleLeaveRoom = () => sendMessage({ type: 'leave_room' })

  const handleAddAi = () =>
    sendMessage({ type: 'add_ai', aiName: `AI玩家${(room?.players.length || 0) + 1}` })

  const handleRemoveAi = (playerId) => sendMessage({ type: 'remove_ai', playerId })

  const handleStartGame = () => sendMessage({ type: 'start_game' })

  const handleTakeTokens = (tokens) => {
    sendMessage({ type: 'take_tokens', tokens })
  }

  const handleBuyCard = (cardId, tier, fromReserved = false) => {
    sendMessage({ type: 'buy_card', cardId, tier, fromReserved })
  }

  const handleReserveCard = (tier, cardIndex) => {
    sendMessage({ type: 'reserve_card', tier, cardIndex })
  }

  return (
    <div className="app">
      {notification && (
        <div className="notification">{notification}</div>
      )}

      {screen === 'game' && gameState ? (
        <GameBoard
          key={gameSeq}
          gameState={gameState}
          myPlayerId={myPlayerId}
          room={room}
          onTakeTokens={handleTakeTokens}
          onBuyCard={handleBuyCard}
          onReserveCard={handleReserveCard}
          onRestart={handleStartGame}
          onExitRoom={handleLeaveRoom}
          onDebugSetTokens={(playerId, tokens) => sendMessage({ type: 'debug_set_tokens', playerId, tokens })}
          onDebugSetReserved={(playerId, delta) => sendMessage({ type: 'debug_reserved', playerId, delta })}
        />
      ) : screen === 'room' && room ? (
        <WaitingRoom
          room={room}
          myPlayerId={myPlayerId}
          maxPlayers={MAX_PLAYERS}
          onAddAi={handleAddAi}
          onRemoveAi={handleRemoveAi}
          onStartGame={handleStartGame}
          onLeave={handleLeaveRoom}
        />
      ) : screen === 'lobby' ? (
        <Lobby
          playerName={playerName}
          connected={connected}
          rooms={roomList}
          maxPlayers={MAX_PLAYERS}
          onNameChange={saveName}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onRefresh={requestRooms}
          onBackToTitle={() => setScreen('title')}
        />
      ) : (
        <TitleScreen
          playerName={playerName}
          connected={connected}
          onNameChange={saveName}
          onQuickStart={handleQuickStart}
          onCreateRoom={handleCreateRoom}
          onEnterLobby={() => setScreen('lobby')}
        />
      )}

      {screen !== 'title' && !connected && (
        <div className="sc-offline">
          <div className="sc-offline-box">
            <h3>与实验室服务器失去连接</h3>
            <p>正在自动重连，稍等几秒；一直回不来就刷新页面。</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
