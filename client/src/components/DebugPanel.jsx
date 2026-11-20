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
export const DEFAULT_GROUND = 'diancui'

export function applyGround(key) {
  document.documentElement.dataset.ground = key
}

// FC 面候选：auto 跟底色走，其余五档取传统点翠配材（绒胎/翠羽/松石/青金/鎏金）
const FCS = [
  ['auto', '随底', '#1a222c', '跟底色走：点翠底自动翠釉，其余底蓝灰漆'],
  ['xuanqi', '玄绒', '#171310', '黑丝绒帽胎：暖黑托底，金边最跳'],
  ['cuiyou', '翠羽', '#0a2a3c', '翠鸟背羽：同族翠蓝釉镶金'],
  ['songshi', '松石', '#0a2f26', '嵌松绿石：蓝底绿釉经典配'],
  ['qingjin', '青金', '#17244a', '嵌青金石：深蓝釉带金星'],
  ['zhejin', '鎏金', '#33280c', '铜镀金托：赭金漆互补暖面']
]

export const FC_KEY = 'splendor-fc'
export const DEFAULT_FC = 'qingjin'

export function applyFc(key) {
  document.documentElement.dataset.fc = key
}

export default function DebugPanel({ gameState, myPlayerId, onSetTokens, onSetReserved, onSetVc }) {
  const [open, setOpen] = useState(false)
  const [ground, setGround] = useState(() => localStorage.getItem(GROUND_KEY) || DEFAULT_GROUND)
  const [fc, setFc] = useState(() => localStorage.getItem(FC_KEY) || DEFAULT_FC)
  // 敲进去的数在等服务端回包的那几十毫秒里得留在框里，否则状态一广播就把没敲完的
  // 值顶回旧数（想敲 12，敲完「1」就被顶回 1）
  const [draft, setDraft] = useState({})

  // 大厅里也挂这份开关：没有对局时只开放底色排，筹码编辑进桌后才出现
  const players = gameState?.players || null

  const bank = gameState?.bank?.tokens || {}
  const drawTotal = ['draw1Count', 'draw2Count', 'draw3Count']
    .reduce((s, k) => s + (gameState?.bank?.[k] || 0), 0)

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

  const commitVc = (player, type, raw) => {
    const key = `${player.id}:vc:${type}`
    const n = parseInt(raw, 10)
    setDraft(prev => {
      const rest = { ...prev }
      delete rest[key]
      return rest
    })
    if (!Number.isInteger(n) || n < 0) return
    onSetVc(player.id, type, n)
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
                ? '每色总数守恒（牌堆 + 所有玩家），设不进会弹提示；预留卡从牌桌明面发/收；VC 按产出设张数（发真卡、立即判 FC）'
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
          <div className="dbg-fcs" title="换 FC（会士/院士旗卡）的匾额面，立即生效并记住；随底＝跟底色自动配">
            <span className="dbg-fc-label">FC面</span>
            {FCS.map(([key, name, swatch, note]) => (
              <button
                key={key}
                className={`dbg-ground ${fc === key ? 'on' : ''}`}
                style={{ '--swatch': swatch }}
                title={note}
                onClick={() => {
                  setFc(key)
                  localStorage.setItem(FC_KEY, key)
                  applyFc(key)
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
                <div className="dbg-who">
                  <span className={`dbg-name ${isMe ? 'me' : ''}`} title={p.name}>
                    {isMe && '▸ '}{p.name}
                  </span>
                  <span className="dbg-pre" title="声誉＝VC + FC 累计">声誉 {p.prestige ?? 0}</span>
                </div>
                <div className="dbg-lines">
                  <div className="dbg-line">
                    <span className="dbg-tag">AR</span>
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
                      <button onClick={() => onSetReserved(p.id, -1)} disabled={reserved === 0}>−</button>
                      <span className={reserved >= 3 ? 'full' : ''}>{reserved}/3</span>
                      <button
                        onClick={() => onSetReserved(p.id, 1)}
                        disabled={reserved >= 3}
                        title={reserved >= 3
                          ? `${p.name} 预留已满 3 张（规则上限，只锁这一行）：先−收回一张再加。注意 AI 回合买不起/拿不到时也会自己预留占额`
                          : '从牌桌明面发一张预留给他（不送咖啡、不改回合）'}
                      >＋</button>
                    </div>
                    <button className="dbg-clear" onClick={() => clearRow(p)}>清零</button>
                  </div>
                  <div
                    className="dbg-vc"
                    title="VC（已发表论文）产出：FC 只认这个口径，筹码凑不出来。设到几就发/收几张该产出的真卡，每发一张立即判 FC；已来的 FC 不收回"
                  >
                    <span className="dbg-tag">VC</span>
                    <div className="dbg-cells">
                      {TYPES.slice(0, 5).map(([type, label, gem]) => {
                        const key = `${p.id}:vc:${type}`
                        const has = p.bonus?.[type] ?? 0
                        const face = [1, 2, 3].reduce((s, t) => s + (gameState.bank[`tier${t}`] || []).filter(c => c.bonus === type).length, 0)
                        // 上限只是粗界：抽牌堆只下发总数、不下发按色明细，真发完会弹带名提示
                        const max = face + has + drawTotal
                        return (
                          <label
                            key={type}
                            className="dbg-cell"
                            title={`${label}产出｜已有 ${has}｜明面 ${face}｜最多能设到 ${max}（牌堆该色发完会弹提示）`}
                          >
                            <img src={gem} alt="" />
                            <input
                              type="number"
                              min="0"
                              max={max}
                              value={draft[key] ?? has}
                              onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                              onBlur={e => commitVc(p, type, e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                            />
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>
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
