import { useState } from 'react'
import './screens.css'

// 等待室：房主凑人（真人靠房号进来，AI 随手补位），其他人等房主开局。
export default function WaitingRoom({
  room,
  myPlayerId,
  maxPlayers,
  onAddAi,
  onRemoveAi,
  onStartGame,
  onLeave
}) {
  const [copied, setCopied] = useState(false)
  const isHost = room.hostId === myPlayerId
  const full = room.players.length >= maxPlayers

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.roomId)
    } catch {
      // http 或非安全上下文下 clipboard 不可用，房号本来就显示在屏幕上，不算失败
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="sc sc-waiting">
      <div className="sc-panel wide">
        <h2>等待室</h2>

        <div className="sc-code">
          <span className="label">房号</span>
          <strong>{room.roomId}</strong>
          <button className="sc-btn small" onClick={copyCode}>{copied ? '已复制' : '复制'}</button>
        </div>
        <p className="sc-hint">同学在他的入口页选「加入同学的房间」，输这个房号就能进来。</p>

        <div className="sc-roster">
          <h3>玩家 {room.players.length}/{maxPlayers}</h3>
          {room.players.map(p => (
            <div key={p.id} className={`sc-seat ${p.id === myPlayerId ? 'me' : ''}`}>
              <span className="avatar">{p.isAi ? '🤖' : '🎓'}</span>
              <span className="name">{p.name}{p.id === myPlayerId && '（你）'}</span>
              {p.id === room.hostId && <span className="badge host">房主</span>}
              {p.isAi && <span className="badge ai">AI</span>}
              {isHost && p.isAi && (
                <button className="sc-mini-btn" onClick={() => onRemoveAi(p.id)} title="移除这个AI">✕</button>
              )}
            </div>
          ))}
        </div>

        <div className="sc-actions">
          {isHost ? (
            <>
              <button className="sc-btn" onClick={onAddAi} disabled={full}>
                补一个 AI
              </button>
              <button className="sc-btn primary" onClick={onStartGame} disabled={room.players.length < 2}>
                {room.players.length < 2 ? '至少要有 2 名玩家' : '开始游戏'}
              </button>
            </>
          ) : (
            <p className="sc-hint waiting">等房主点开始…</p>
          )}
          <button className="sc-btn danger" onClick={onLeave}>退出房间</button>
        </div>
      </div>
    </div>
  )
}
