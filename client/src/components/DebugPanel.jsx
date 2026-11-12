import { useState } from 'react'
import './DebugPanel.css'

// 筹码表跟 GameBoard / PlayerPanel 里各自那份同口径（这几个组件本来就各留一份画筹码
// 要用的表，抽成共享模块反而要多绕一层）
const TYPES = [
  ['data', '数据', '/images/tokens/WhiteToken.png'],
  ['compute', '算力', '/images/tokens/BlueToken.png'],
  ['citation', '引用', '/images/tokens/GreenToken.png'],
  ['collaborator', '合作者', '/images/tokens/BrownToken.png'],
  ['funding', '经费', '/images/tokens/RedToken.png'],
  ['coffee', '咖啡', '/images/tokens/GoldToken.png']
]

export default function DebugPanel({ gameState, myPlayerId, onSetTokens }) {
  const [open, setOpen] = useState(false)
  // 敲进去的数在等服务端回包的那几十毫秒里得留在框里，否则状态一广播就把没敲完的
  // 值顶回旧数（想敲 12，敲完「1」就被顶回 1）
  const [draft, setDraft] = useState({})

  if (!gameState?.players) return null

  const commit = (player, type, raw) => {
    const key = `${player.id}:${type}`
    const n = parseInt(raw, 10)
    setDraft(prev => {
      const rest = { ...prev }
      delete rest[key]
      return rest
    })
    if (!Number.isInteger(n) || n < 0) return
    onSetTokens(player.id, { [type]: Math.min(n, 99) })
  }

  const clearRow = player =>
    onSetTokens(player.id, Object.fromEntries(TYPES.map(([type]) => [type, 0])))

  return (
    <div className="dbg-dock">
      {open && (
        <div className="dbg-panel">
          <div className="dbg-head">
            <b>测试：设置各玩家资源</b>
            <span>差额跟公共牌堆进出，牌堆不够的部分直接生成（不改回合）</span>
          </div>
          {gameState.players.map(p => {
            const isMe = p.id === myPlayerId
            return (
              <div key={p.id} className="dbg-row">
                <span className={`dbg-name ${isMe ? 'me' : ''}`} title={p.name}>
                  {isMe && '▸ '}{p.name}
                </span>
                <div className="dbg-cells">
                  {TYPES.map(([type, label, gem]) => {
                    const key = `${p.id}:${type}`
                    const value = draft[key] ?? p.tokens?.[type] ?? 0
                    return (
                      <label key={type} className="dbg-cell" title={label}>
                        <img src={gem} alt="" />
                        <input
                          type="number"
                          min="0"
                          max="99"
                          value={value}
                          onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                          onBlur={e => commit(p, type, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        />
                      </label>
                    )
                  })}
                </div>
                <button className="dbg-clear" onClick={() => clearRow(p)}>清零</button>
              </div>
            )
          })}
        </div>
      )}
      <button
        className={`dbg-toggle ${open ? 'open' : ''}`}
        onClick={() => setOpen(prev => !prev)}
        title={open ? '收起测试面板' : '展开测试面板，逐个玩家改手里的筹码'}
      >
        {open ? '✕ 收起' : '🧪 测试'}
      </button>
    </div>
  )
}
