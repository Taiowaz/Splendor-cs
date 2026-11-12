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

export default function DebugPanel({ gameState, myPlayerId, onSetTokens, onSetReserved }) {
  const [open, setOpen] = useState(false)
  // 敲进去的数在等服务端回包的那几十毫秒里得留在框里，否则状态一广播就把没敲完的
  // 值顶回旧数（想敲 12，敲完「1」就被顶回 1）
  const [draft, setDraft] = useState({})

  if (!gameState?.players) return null

  const bank = gameState.bank?.tokens || {}

  const commit = (player, type, raw) => {
    const key = `${player.id}:${type}`
    const n = parseInt(raw, 10)
    setDraft(prev => {
      const rest = { ...prev }
      delete rest[key]
      return rest
    })
    if (!Number.isInteger(n) || n < 0) return
    onSetTokens(player.id, { [type]: n })
  }

  const clearRow = player =>
    onSetTokens(player.id, Object.fromEntries(TYPES.map(([type]) => [type, 0])))

  return (
    <div className="dbg-dock">
      {open && (
        <div className="dbg-panel">
          <div className="dbg-head">
            <b>测试：设置各玩家资源</b>
            <span>每色总数守恒（牌堆 + 所有玩家），设不进会弹提示；预留卡从牌桌明面发/收</span>
          </div>
          {gameState.players.map(p => {
            const isMe = p.id === myPlayerId
            const reserved = p.reservedCards?.length || 0
            return (
              <div key={p.id} className="dbg-row">
                <span className={`dbg-name ${isMe ? 'me' : ''}`} title={p.name}>
                  {isMe && '▸ '}{p.name}
                </span>
                <div className="dbg-cells">
                  {TYPES.map(([type, label, gem]) => {
                    const key = `${p.id}:${type}`
                    const has = p.tokens?.[type] ?? 0
                    // 能设的上限 = 牌堆现有的 + 自己已经拿在手里的
                    const max = (bank[type] ?? 0) + has
                    return (
                      <label
                        key={type}
                        className="dbg-cell"
                        title={`${label}｜手里 ${has}｜牌堆 ${bank[type] ?? 0}｜最多能设到 ${max}`}
                      >
                        <img src={gem} alt="" />
                        <input
                          type="number"
                          min="0"
                          max={max}
                          value={draft[key] ?? has}
                          onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                          onBlur={e => commit(p, type, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        />
                      </label>
                    )
                  })}
                </div>
                <div className="dbg-res" title="预留卡：从牌桌明面发一张 / 收回最后一张（不送咖啡、不改回合）">
                  <button onClick={() => onSetReserved(p.id, -1)}>−</button>
                  <span>{reserved}/3</span>
                  <button onClick={() => onSetReserved(p.id, 1)}>＋</button>
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
        title={open ? '收起测试面板' : '展开测试面板，逐个玩家改手里的筹码和预留卡'}
      >
        {open ? '✕ 收起' : '🧪 测试'}
      </button>
    </div>
  )
}
