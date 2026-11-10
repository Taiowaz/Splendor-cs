import { useState } from 'react'
import PaperCard from './PaperCard.jsx'
import NobleTile from './NobleTile.jsx'
import './GameBoard.css'

const TIER_NAMES = {
  1: 'CCF-C 论文',
  2: 'CCF-B 论文',
  3: 'CCF-A 论文'
}

// 卡背是自制学院纹章（盾徽+书+月桂+绶带），三档只换徽记墨色：A 金 / B 蓝 / C 绿
// 源图 400x600 = 2:3，和 .gb-deck img 的 aspect-ratio 一致，不会再被拉扁
const TIER_DECK = {
  3: '/images/decks/crest-A.jpg',
  2: '/images/decks/crest-B.jpg',
  1: '/images/decks/crest-C.jpg'
}

// CS 资源映射到宝石视觉
// gem 用 *Token.png（中间宝石换成我们的线稿符号那版），和 VC 卡面 / FC 需求圈同一套
const RESOURCE_INFO = {
  data: { icon: '📊', name: '数据', gem: '/images/tokens/WhiteToken.png' },
  compute: { icon: '💻', name: '算力', gem: '/images/tokens/BlueToken.png' },
  citation: { icon: '📄', name: '引用', gem: '/images/tokens/GreenToken.png' },
  collaborator: { icon: '🤝', name: '合作者', gem: '/images/tokens/BrownToken.png' },
  funding: { icon: '💰', name: '经费', gem: '/images/tokens/RedToken.png' },
  coffee: { icon: '☕', name: '咖啡', gem: '/images/tokens/GoldToken.png' }
}

const TOKEN_TYPES = ['data', 'compute', 'citation', 'collaborator', 'funding']
const INVENTORY_TYPES = [...TOKEN_TYPES, 'coffee']

export default function GameBoard({
  gameState,
  myPlayerId,
  roomInfo,
  onTakeTokens,
  onBuyCard,
  onReserveCard,
  onRestart,
  onDebugRandom
}) {
  const [selectedTokens, setSelectedTokens] = useState({})
  const [showReserve, setShowReserve] = useState(false)
  const [reserveTarget, setReserveTarget] = useState(null)

  const myPlayer = gameState.players.find(p => p.id === myPlayerId)
  const currentIndex = gameState.currentPlayerIndex
  const isMyTurn = gameState.players[currentIndex]?.id === myPlayerId
  const myOrder = gameState.players.findIndex(p => p.id === myPlayerId) + 1

  const handleTokenClick = (type) => {
    if (!isMyTurn) return
    if (type === 'coffee') return

    setSelectedTokens(prev => {
      const current = prev[type] || 0
      const totalSelected = Object.values(prev).reduce((a, b) => a + b, 0)
      const bankCount = gameState.bank.tokens[type]

      if (current > 0) {
        if (current === 2) return { ...prev, [type]: 1 }
        const newTokens = { ...prev }
        delete newTokens[type]
        return newTokens
      }

      if (bankCount <= 0) return prev
      if (totalSelected >= 3) return prev
      return { ...prev, [type]: 1 }
    })
  }

  const handleTokenDoubleClick = (type) => {
    if (!isMyTurn) return
    if (type === 'coffee') return

    setSelectedTokens(prev => {
      const current = prev[type] || 0
      const distinctTypes = Object.keys(prev).length
      const bankCount = gameState.bank.tokens[type]
      if (current === 1 && distinctTypes === 1 && bankCount >= 4) {
        return { ...prev, [type]: 2 }
      }
      return prev
    })
  }

  const handleConfirmTokens = () => {
    const totalSelected = Object.values(selectedTokens).reduce((a, b) => a + b, 0)
    if (totalSelected === 0) return
    const types = Object.keys(selectedTokens)
    if (totalSelected === 3 && types.length !== 3) return
    if (totalSelected === 2 && (types.length !== 1 || gameState.bank.tokens[types[0]] < 4)) return
    onTakeTokens(selectedTokens)
    setSelectedTokens({})
  }

  const handleBuyCard = (card, tier) => {
    if (!isMyTurn) return
    onBuyCard(card.id, tier)
  }

  const handleReserveCard = (tier, cardIndex) => {
    if (!isMyTurn) return
    onReserveCard(tier, cardIndex)
    setShowReserve(false)
    setReserveTarget(null)
  }

  if (gameState.gameOver) {
    const winner = gameState.winner
    return (
      <div className="gb gb-root">
        <div className="gb-gameover">
          <h1>游戏结束</h1>
          <h2>{winner.name} 获胜！</h2>
          <div className="gb-standings">
            {gameState.players
              .slice()
              .sort((a, b) => b.prestige - a.prestige)
              .map((p, i) => (
                <div key={p.id} className={`gb-standing ${p.id === winner.id ? 'winner' : ''}`}>
                  <span className="standing-rank">#{i + 1}</span>
                  <span className="standing-name">{p.name}</span>
                  <span className="standing-score">{p.prestige}</span>
                </div>
              ))}
          </div>
          <button className="gb-btn gb-btn-gold" onClick={onRestart}>再来一局</button>
        </div>
      </div>
    )
  }

  const opponents = gameState.players.filter(p => p.id !== myPlayerId)
  const totalSelected = Object.values(selectedTokens).reduce((a, b) => a + b, 0)

  return (
    <div className="gb gb-root">
      {/* 顶部标题栏 */}
      <div className="gb-topbar">
        <div className="gb-title">学术宝石</div>
        <div className={`gb-turnpill ${isMyTurn ? 'mine' : ''}`}>
          {isMyTurn ? '轮到你行动' : `等待 ${gameState.players[currentIndex]?.name}`}
        </div>
      </div>

      <div className="gb-main">
        {/* 中间：牌桌 */}
        <div className="gb-board">
          {/* 发展卡（论文） */}
          <div className="gb-cards">
            {[3, 2, 1].map(tier => (
              <div key={tier} className={`gb-tier-row tier-${tier}`}>
                <div className="gb-deck" title={`${TIER_NAMES[tier]} 抽牌堆`}>
                  <img src={TIER_DECK[tier]} alt={`tier${tier}`} />
                  <span className="deck-count">{gameState.bank[`draw${tier}Count`] ?? 0}</span>
                </div>
                <div className="gb-tier-cards">
                  {gameState.bank[`tier${tier}`]?.map((card, index) => (
                    <PaperCard
                      key={card.id}
                      card={card}
                      canAfford={isMyTurn && canAfford(myPlayer, card)}
                      onBuy={() => handleBuyCard(card, tier)}
                      onReserve={() => {
                        setReserveTarget({ tier, index })
                        setShowReserve(true)
                      }}
                      isMyTurn={isMyTurn}
                    />
                  ))}
                  {(!gameState.bank[`tier${tier}`] || gameState.bank[`tier${tier}`].length === 0) && (
                    <div className="gb-empty-tier">牌库已空</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 学术大佬 */}
          <div className="gb-nobles">
            {gameState.bank.nobles.map(noble => (
              <NobleTile key={noble.id} noble={noble} />
            ))}
          </div>

          {/* 公共筹码（AR）：排在 VC + FC 整块下面，我的资源条上面 */}
          <div className="gb-tokenpool">
            {TOKEN_TYPES.map(type => {
              const info = RESOURCE_INFO[type]
              const bankCount = gameState.bank.tokens[type] || 0
              const sel = selectedTokens[type] || 0
              return (
                <div
                  key={type}
                  className={`pool-gem ${sel > 0 ? 'selected' : ''} ${bankCount === 0 ? 'empty' : ''}`}
                  onClick={() => handleTokenClick(type)}
                  onDoubleClick={() => handleTokenDoubleClick(type)}
                  title={`${info.name}｜银行 ${bankCount}｜单击选1，双击选2（银行≥4）`}
                >
                  <div className="gem-circle" style={{ backgroundImage: `url(${info.gem})` }}>
                    <span className="gem-num">{bankCount}</span>
                  </div>
                  {sel > 0 && <span className="gem-badge">{sel}</span>}
                </div>
              )
            })}

            {/* 资源选择确认条：贴在筹码行右侧，不另占一行 */}
            {totalSelected > 0 && (
              <div className="gb-actionbar">
                <span className="action-summary">已选 {totalSelected} 个资源</span>
                <button className="gb-btn gb-btn-gold" onClick={handleConfirmTokens}>确认拿取</button>
                <button className="gb-btn gb-btn-ghost" onClick={() => setSelectedTokens({})}>取消</button>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：其他玩家 */}
        <div className="gb-players">
          {opponents.map(player => {
            const order = gameState.players.findIndex(p => p.id === player.id) + 1
            const isTurn = player.id === gameState.players[currentIndex]?.id
            return (
              <div key={player.id} className={`opp-panel ${isTurn ? 'active' : ''}`}>
                <div className="opp-prestige"><span>{player.prestige}</span></div>
                <div className="opp-identity">
                  <p className="opp-name">{player.name}</p>
                  <span className="opp-order">第 {order} 位</span>
                </div>
                <div className="opp-stats">
                  <span title="论文数">📄 {player.cards?.length || 0}</span>
                  <span title="预留数">🔖 {player.reservedCards?.length || 0}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 底部中间：本人资源池 + 我的卡牌（横排） */}
      <div className="gb-my-cards">
        <div className="mc-me">
          <div className="mc-prestige"><span>{myPlayer?.prestige ?? 0}</span></div>
          <div className="mc-id">
            <p className="inv-name">{myPlayer?.name}</p>
            <span className="inv-order">第 {myOrder} 位</span>
          </div>
        </div>
        {INVENTORY_TYPES.map(type => {
          const info = RESOURCE_INFO[type]
          const tokens = myPlayer?.tokens?.[type] || 0
          const bonus = type === 'coffee' ? 0 : (myPlayer?.bonus?.[type] || 0)
          const ownedCount = (myPlayer?.cards || []).filter(c => c.bonus === type).length
          const reserved = (myPlayer?.reservedCards || []).filter(c => c.bonus === type)
          if (tokens === 0 && bonus === 0 && ownedCount === 0 && reserved.length === 0) return null
          const buyReserved = () => {
            if (!isMyTurn) return
            const target = reserved.find(c => canAfford(myPlayer, c)) || reserved[0]
            if (target) onBuyCard(target.id, target.tier, true)
          }
          return (
            <div key={type} className="mc-type">
              <div className="inv-gem" title={`${info.name}｜资源 ${tokens}${bonus ? `｜论文 +${bonus}` : ''}`}>
                <div className="gem-circle" style={{ backgroundImage: `url(${info.gem})` }}>
                  <span className="gem-num">{tokens}</span>
                </div>
                {bonus > 0 && <span className="gem-badge">{bonus}</span>}
              </div>
              <div className="mc-counts">
                {ownedCount > 0 && (
                  <div className="cnt-chip" title={`${info.name}论文 ×${ownedCount}`}>
                    <span className="cnt-icon">📄</span>
                    <span className="cnt-num">{ownedCount}</span>
                  </div>
                )}
                {reserved.length > 0 && (
                  <div
                    className="cnt-chip reserved"
                    title={`预留 ${reserved.length}（点击购买最便宜可负担的一张）`}
                    onClick={buyReserved}
                  >
                    <span className="cnt-icon">🔖</span>
                    <span className="cnt-num">{reserved.length}</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 预留确认弹窗 */}
      {showReserve && reserveTarget && (
        <div className="gb-modal-overlay" onClick={() => setShowReserve(false)}>
          <div className="gb-modal" onClick={e => e.stopPropagation()}>
            <h3>确认预留？</h3>
            <p>预留卡牌将获得 1 杯咖啡（万能资源）</p>
            <div className="gb-modal-buttons">
              <button className="gb-btn gb-btn-gold" onClick={() => handleReserveCard(reserveTarget.tier, reserveTarget.index)}>确认预留</button>
              <button className="gb-btn gb-btn-ghost" onClick={() => setShowReserve(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 调试按钮 */}
      <button className="btn-debug" onClick={onDebugRandom}>🎲 随机资源</button>
    </div>
  )
}

function canAfford(player, card) {
  if (!player || !player.tokens) return false
  let coffeeNeeded = 0
  const resources = ['data', 'compute', 'citation', 'collaborator', 'funding']

  for (const resource of resources) {
    const cost = card.cost[resource] || 0
    const has = player.tokens[resource] || 0
    const bonus = player.bonus?.[resource] || 0
    const effectiveCost = Math.max(0, cost - bonus)
    if (has < effectiveCost) coffeeNeeded += effectiveCost - has
  }

  return coffeeNeeded <= (player.tokens.coffee || 0)
}
