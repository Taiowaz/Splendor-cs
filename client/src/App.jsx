import { useState, useEffect, useCallback, useRef } from 'react'
import Lobby from './components/Lobby.jsx'
import GameBoard from './components/GameBoard.jsx'
import useWebSocket from './hooks/useWebSocket.js'
import './App.css'

function App() {
  const [gameState, setGameState] = useState(null)
  const [myPlayerId, setMyPlayerId] = useState(null)
  const [roomInfo, setRoomInfo] = useState(null)
  const [notification, setNotification] = useState(null)
  const autoStartRef = useRef(false)

  const { connected, sendMessage, lastMessage } = useWebSocket()

  // 自动创建房间并开始游戏（开发模式）
  useEffect(() => {
    if (connected && !autoStartRef.current && !gameState && !roomInfo) {
      autoStartRef.current = true
      // 创建房间
      sendMessage({ type: 'create_room', playerName: '我' })
    }
  }, [connected, gameState, roomInfo, sendMessage])

  // 处理 WebSocket 消息
  useEffect(() => {
    if (!lastMessage) return

    switch (lastMessage.type) {
      case 'room_created':
      case 'joined_room':
        setMyPlayerId(lastMessage.playerId)
        setRoomInfo({
          roomId: lastMessage.roomId,
          players: lastMessage.players
        })
        // 房间创建后，添加 3 个 AI
        setTimeout(() => sendMessage({ type: 'add_ai', aiName: 'AI玩家1' }), 100)
        setTimeout(() => sendMessage({ type: 'add_ai', aiName: 'AI玩家2' }), 200)
        setTimeout(() => sendMessage({ type: 'add_ai', aiName: 'AI玩家3' }), 300)
        // 开始游戏
        setTimeout(() => sendMessage({ type: 'start_game' }), 500)
        break

      case 'player_joined':
        setRoomInfo(prev => ({
          ...prev,
          players: lastMessage.players
        }))
        break

      case 'player_left':
        setRoomInfo(prev => ({
          ...prev,
          players: prev.players.filter(p => p.id !== lastMessage.playerId)
        }))
        break

      case 'game_started':
        setGameState(lastMessage.gameState)
        break

      case 'tokens_taken':
      case 'card_bought':
      case 'card_reserved':
      case 'turn_changed':
        console.log('Received:', lastMessage.type, 'gameState players:', lastMessage.gameState?.players?.map(p => ({ id: p.id, name: p.name, tokens: p.tokens })))
        setGameState(lastMessage.gameState)
        break

      case 'noble_visit':
        showNotification(lastMessage.message)
        break

      case 'game_over':
        setGameState(lastMessage.gameState)
        showNotification(`🎉 游戏结束！${lastMessage.winner.name} 获胜！`)
        break

      case 'error':
        showNotification(`❌ ${lastMessage.message}`)
        break
    }
  }, [lastMessage])

  const showNotification = useCallback((message) => {
    setNotification(message)
    setTimeout(() => setNotification(null), 3000)
  }, [])

  const handleTakeTokens = (tokens) => {
    sendMessage({ type: 'take_tokens', tokens })
  }

  const handleBuyCard = (cardId, tier, fromReserved = false) => {
    sendMessage({ type: 'buy_card', cardId, tier, fromReserved })
  }

  const handleReserveCard = (tier, cardIndex) => {
    sendMessage({ type: 'reserve_card', tier, cardIndex })
  }

  const handleRestart = () => {
    setGameState(null)
    setRoomInfo(null)
    setMyPlayerId(null)
    autoStartRef.current = false
  }

  return (
    <div className="app">
      {notification && (
        <div className="notification">{notification}</div>
      )}

      {!gameState ? (
        <Lobby
          connected={connected}
          roomInfo={roomInfo}
          onCreateRoom={() => {}}
          onJoinRoom={() => {}}
          onStartGame={() => {}}
          onAddAi={() => {}}
        />
      ) : (
        <GameBoard
          gameState={gameState}
          myPlayerId={myPlayerId}
          roomInfo={roomInfo}
          onTakeTokens={handleTakeTokens}
          onBuyCard={handleBuyCard}
          onReserveCard={handleReserveCard}
          onRestart={handleRestart}
        />
      )}
    </div>
  )
}

export default App
