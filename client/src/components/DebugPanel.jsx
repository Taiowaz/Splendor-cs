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

const GROUNDS = [
  ['ciqing', '瓷青', '#0a0f16'],
  ['xuanmo', '玄墨', '#120e0b'],
  ['daiqing', '黛青', '#051820'],
  ['songyan', '松烟', '#08160e'],
  ['zheqi', '赭漆', '#180e05'],
  ['qingdai', '青黛', '#0d1226'],
  ['zimo', '缁墨', '#0e0e0e'],
  ['tiehui', '铁灰', '#121518'],
  ['cangtai', '苍苔', '#13150a'],
  ['diancui', '点翠', '#061a2c'],
  ['xiekeqing', '蟹壳青', '#101511'],
  ['hupo', '琥珀', '#1d1805']
]

export const GROUND_KEY = 'splendor-ground'

export function applyGround(key) {
  document.documentElement.dataset.ground = key
}

export default function DebugPanel({ gameState, myPlayerId, onSetTokens, onSetReserved }) {
  const [open, setOpen] = useState(false)
  const [ground, setGround] = useState(() => localStorage.getItem(GROUND_KEY) || 'ciqing')
  // 敲进去的数在等服务端回包的那几十毫秒里得留在框里，否则状态一广播就把没敲完的
  // 值顶回旧数（想敲 12，敲完「1」就被顶回 1）
  const [draft, setDraft] = useState({})

  // 大厅里也挂这份开关：没有对局时只开放底色排，筹码编辑进桌后才出现
  const players = gameState?.players || null

  const bank = gameState?.bank?.tokens || {}

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
            <b>{players ? '测试：设置各玩家资源' : '测试：底色与资源'}</b>
            <span>
              {players
                ? '每色总数守恒（牌堆 + 所有玩家），设不进会弹提示；预留卡从牌桌明面发/收'
                : '底色随时可换并记住；筹码与预留卡编辑进牌桌后开放'}
            </span>
          </div>
          <div className="dbg-grounds" title="换整张牌桌的底色，立即生效并记住选择（入口/大厅同样换）">
            <span className="dbg-ground-label">底色</span>
            {GROUNDS.map(([key, name, swatch]) => (
              <button
                key={key}
                className={`dbg-ground ${ground === key ? 'on' : ''}`}
                style={{ '--swatch': swatch }}
                onClick={() => {
                  setGround(key)
                  localStorage.setItem(GROUND_KEY, key)
                  applyGround(key)
                }}
              >
                <i />{name}
              </button>
            ))}
          </div>
          {players && players.map(p => {
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
          {!players && (
            <div className="dbg-note">进牌桌后，这里会展开成逐个玩家的筹码 / 预留卡编辑行</div>
          )}
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
