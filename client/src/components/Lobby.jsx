import { useState } from 'react'

export default function Lobby({ connected, roomInfo, onCreateRoom, onJoinRoom, onStartGame, onAddAi }) {
  const [playerName, setPlayerName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [mode, setMode] = useState('menu') // menu, create, join, waiting

  const handleCreate = () => {
    if (!playerName.trim()) return
    onCreateRoom(playerName.trim())
    setMode('waiting')
  }

  const handleJoin = () => {
    if (!playerName.trim() || !roomId.trim()) return
    onJoinRoom(playerName.trim(), roomId.trim().toUpperCase())
    setMode('waiting')
  }

  if (mode === 'waiting' && roomInfo) {
    const isHost = roomInfo.players[0]?.name === playerName
    return (
      <div className="lobby">
        <div className="lobby-card waiting">
          <h2>🎓 等待室</h2>
          <div className="room-info">
            <p>房间号: <strong>{roomInfo.roomId}</strong></p>
            <p className="hint">把这个号码告诉实验室同学</p>
          </div>

          <div className="player-list">
            <h3>玩家 ({roomInfo.players.length}/4)</h3>
            {roomInfo.players.map((p, i) => (
              <div key={p.id} className="player-item">
                <span className="player-avatar">👨‍🎓</span>
                <span>{p.name}</span>
                {i === 0 && <span className="host-badge">房主</span>}
              </div>
            ))}
          </div>

          {isHost && (
            <div className="host-controls">
              <button
                className="btn btn-secondary"
                onClick={() => onAddAi(`AI玩家${roomInfo.players.length}`)}
                disabled={roomInfo.players.length >= 4}
                style={{ marginRight: '10px' }}
              >
                + 添加AI
              </button>
              <button
                className="btn btn-primary"
                onClick={onStartGame}
                disabled={roomInfo.players.length < 2}
              >
                {roomInfo.players.length < 2 ? '等待更多玩家...' : '开始游戏'}
              </button>
            </div>
          )}

          {!isHost && (
            <p className="hint">等待房主开始游戏...</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>🎓 学术宝石</h1>
        <p className="subtitle">Splendor CS - 研究生版</p>

        <div className="connection-status">
          <span className={`dot ${connected ? 'connected' : 'disconnected'}`}></span>
          {connected ? '已连接' : '连接中...'}
        </div>

        {mode === 'menu' && (
          <div className="menu-buttons">
            <button className="btn btn-primary" onClick={() => setMode('create')}>
              创建房间
            </button>
            <button className="btn btn-secondary" onClick={() => setMode('join')}>
              加入房间
            </button>
          </div>
        )}

        {mode === 'create' && (
          <div className="form">
            <input
              type="text"
              placeholder="输入你的名字"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              maxLength={12}
              autoFocus
            />
            <button className="btn btn-primary" onClick={handleCreate} disabled={!playerName.trim()}>
              创建
            </button>
            <button className="btn btn-link" onClick={() => setMode('menu')}>
              返回
            </button>
          </div>
        )}

        {mode === 'join' && (
          <div className="form">
            <input
              type="text"
              placeholder="输入你的名字"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              maxLength={12}
              autoFocus
            />
            <input
              type="text"
              placeholder="输入房间号"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              maxLength={6}
              style={{ marginTop: '10px' }}
            />
            <button
              className="btn btn-primary"
              onClick={handleJoin}
              disabled={!playerName.trim() || !roomId.trim()}
            >
              加入
            </button>
            <button className="btn btn-link" onClick={() => setMode('menu')}>
              返回
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
