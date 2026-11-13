import { useState, useEffect, useCallback, useRef } from 'react'
import TitleScreen from './components/TitleScreen.jsx'
import Lobby from './components/Lobby.jsx'
import WaitingRoom from './components/WaitingRoom.jsx'
import GameBoard from './components/GameBoard.jsx'
import useWebSocket from './hooks/useWebSocket.js'
import { NAME_KEY, loadToken, saveToken, clearToken } from './session.js'
import './App.css'

// 名字记在本地，下次进来不用重新填
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
  // 账号（或游客）身份：welcome 回来时落定。退出登录要等 left_room 回执再换身份，
  // 不然新连接会把旧席位又认领回来。
  const [account, setAccount] = useState(null)
  const logoutResolveRef = useRef(null)

  const { connected, sendMessage, drainMessages, msgVersion, elsewhere, reconnectNow } = useWebSocket()

  // 每条提示都自带一个 3 秒清除定时器；不先把上一条的定时器清掉，旧定时器到点会把
  // 刚弹出来的新提示一起抹掉（连发几条时最后一条经常一闪就没）
  const notificationTimerRef = useRef(null)
  const showNotification = useCallback((message) => {
    setNotification(message)
    clearTimeout(notificationTimerRef.current)
    notificationTimerRef.current = setTimeout(() => setNotification(null), 3000)
  }, [])

  const renameTimerRef = useRef(null)
  const saveName = useCallback((name) => {
    const trimmed = name.slice(0, 12)
    setPlayerName(trimmed)
    localStorage.setItem(NAME_KEY, trimmed)
    // 游客改名要重签 token（uid 不变），顺便让服务端把席位上的名字也改掉；
    // 账号的名字在注册时就定死了，这里只改本地回显没意义，不发。
    // 打字时每个键都发一次 hello 会让全桌刷「回来了」，停手半秒再报。
    if (!account?.guest || !trimmed.trim()) return
    clearTimeout(renameTimerRef.current)
    renameTimerRef.current = setTimeout(() => {
      sendMessage({ type: 'hello', token: loadToken(), name: trimmed })
    }, 500)
  }, [account, sendMessage])

  // 没填名字就退回「我」，别让空名字建出一个匿名席位
  const currentName = useCallback(() => playerName.trim() || '我', [playerName])

  const requestRooms = useCallback(() => {
    if (connected) sendMessage({ type: 'list_rooms' })
  }, [connected, sendMessage])

  useEffect(() => {
    if (screen === 'lobby') requestRooms()
  }, [screen, requestRooms])

  // 处理 WebSocket 消息：一次把攒下的整批都处理掉。服务端握手时连发好几条，
  // 只处理「最后一条」会把 session_restored 漏掉（刷新就回不了房）。
  useEffect(() => {
    for (const m of drainMessages()) {
      switch (m.type) {
        case 'welcome':
          saveToken(m.token)
          setAccount(m.player)
          // 服务端是游客名字的权威：改名被拒（重名）时这条把输入框退回原名，所以总是
          // 同步，不再只在首次落名时写。welcome 只在握手/改名回执时到，而改名 hello 是
          // 停手 500ms 后才发的，不会打断正在输入。
          if (m.player.guest) {
            localStorage.setItem(NAME_KEY, m.player.name)
            setPlayerName(m.player.name)
          }
          break

        case 'session_restored': {
          // 已经在这一桌了（游客改名触发的二次 hello）就别重建牌桌、也别再弹提示，
          // 否则正在选的筹码和弹窗会被冲掉
          const sameSeat = room?.roomId === m.roomId && (screen === 'game' || screen === 'room')
          setMyPlayerId(m.playerId)
          setRoom({ roomId: m.roomId, hostId: m.hostId, started: m.started, players: m.players })
          if (m.started && m.gameState) {
            setGameState(m.gameState)
            if (!sameSeat || screen !== 'game') setGameSeq(s => s + 1)
            setScreen('game')
          } else {
            setScreen('room')
          }
          if (!sameSeat) {
            showNotification(m.reclaimed
              ? `🎓 已回到房间 ${m.roomId}，席位从 AI 手里接回来了`
              : `已回到房间 ${m.roomId}`)
          }
          break
        }

        case 'session_lost':
          // 服务端重启过，房间在内存里没了：牌桌已经点不动，退回大厅重开一局
          if (room) {
            setRoom(null)
            setGameState(null)
            setMyPlayerId(null)
            setScreen('lobby')
            showNotification('⚠️ 服务器重启过，刚才那一局没留住，重新开一局吧')
          }
          break

        case 'player_offline':
          showNotification(`⚠️ ${m.playerName} 掉线，席位保留 ${Math.round(m.graceMs / 1000)} 秒等他回来`)
          break

        case 'player_online':
          showNotification(`✅ ${m.playerName} 回来了`)
          break

        case 'player_reclaimed':
          showNotification(`🎓 ${m.playerName} 认领回了席位`)
          break

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
          setMyPlayerId(null)
          setScreen('lobby')
          // 退出登录在等这条回执：席位真退掉了才换身份重连
          if (logoutResolveRef.current) {
            logoutResolveRef.current()
            logoutResolveRef.current = null
          }
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
    }
  }, [msgVersion, drainMessages, sendMessage, showNotification, screen, room])

  // 换身份（登录/注册/退出）之前先把当前席位退掉，并等服务端回执。不等着就重连的话，
  // 新连接一 hello 又把旧席位认领回来了，等于没退。
  const releaseSeat = useCallback(() => {
    if (!room) return Promise.resolve()
    return new Promise((resolve) => {
      logoutResolveRef.current = resolve
      sendMessage({ type: 'leave_room' })
      setTimeout(resolve, 1200) // 回执丢了也不能把用户卡在按钮上
    }).finally(() => { logoutResolveRef.current = null })
  }, [room, sendMessage])

  const authRequest = async (path, name, password) => {
    let res
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password })
      })
    } catch {
      throw new Error('连不上服务器，检查一下网络')
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '服务器没答应，稍后再试')
    return data
  }

  const adoptAccount = async (data) => {
    await releaseSeat()
    saveToken(data.token)
    setAccount(data.user)
    setPlayerName(data.user.name)
    localStorage.setItem(NAME_KEY, data.user.name)
    setGameState(null)
    setMyPlayerId(null)
    setScreen('title')
    reconnectNow()
  }

  const handleLogin = async (name, password) => {
    await adoptAccount(await authRequest('/api/login', name, password))
  }

  const handleRegister = async (name, password) => {
    await adoptAccount(await authRequest('/api/register', name, password))
  }

  const handleLogout = async () => {
    await releaseSeat()
    clearToken()
    setAccount(null)
    setRoom(null)
    setGameState(null)
    setMyPlayerId(null)
    setScreen('title')
    reconnectNow()
  }

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
          account={account}
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
          account={account}
          connected={connected}
          onNameChange={saveName}
          onLogin={handleLogin}
          onRegister={handleRegister}
          onLogout={handleLogout}
          onQuickStart={handleQuickStart}
          onCreateRoom={handleCreateRoom}
          onEnterLobby={() => setScreen('lobby')}
        />
      )}

      {elsewhere && (
        <div className="sc-offline">
          <div className="sc-offline-box">
            <h3>这个身份在别处上线了</h3>
            <p>
              同一账号（或这台浏览器的游客身份）在另一个标签页 / 设备上进了桌。
              两边同时操作会打架，本页先暂停。
            </p>
            <button className="sc-btn primary" onClick={reconnectNow}>在此页继续</button>
            <p className="sc-offline-note">点了之后另一页会被请下线。</p>
          </div>
        </div>
      )}

      {screen !== 'title' && !connected && !elsewhere && (
        <div className="sc-offline">
          <div className="sc-offline-box">
            <h3>与实验室服务器失去连接</h3>
            <p>正在自动重连…你的席位先给你留着，连上就自动回到原来的房间和回合，进度不丢。</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
