import { useState } from 'react'
import PlayerPanel from './PlayerPanel.jsx'
import ResourceTokens from './ResourceTokens.jsx'
import PaperCard from './PaperCard.jsx'
import NobleTile from './NobleTile.jsx'
import './GameBoard.css'

const TIER_NAMES = {
  1: '入门论文 (Workshop)',
  2: '期刊论文 (Journal)',
  3: '顶会论文 (Top Conference)'
}

const RESOURCE_INFO = {
  data: { icon: '📊', name: '数据' },
  compute: { icon: '💻', name: '算力' },
  citation: { icon: '📄', name: '引用' },
  collaborator: { icon: '🤝', name: '合作者' },
  funding: { icon: '💰', name: '经费' }
}

export default function GameBoard({
  gameState,
  myPlayerId,
  roomInfo,
  onTakeTokens,
  onBuyCard,
  onReserveCard,
  onRestart
}) {
  const [selectedTokens, setSelectedTokens] = useState({})
  const [showReserve, setShowReserve] = useState(false)
  const [reserveTarget, setReserveTarget] = useState(null)

  const myPlayer = gameState.players.find(p => p.id === myPlayerId)
  const isMyTurn = gameState.players[gameState.currentPlayerIndex]?.id === myPlayerId
  const tokenTypes = ['data', 'compute', 'citation', 'collaborator', 'funding']

  const handleTokenClick = (type) => {
    if (!isMyTurn) return
    // 咖啡（万能牌）不能直接拿取，只能通过预留卡牌获得
    if (type === 'coffee') return

    setSelectedTokens(prev => {
      const current = prev[type] || 0
      const totalSelected = Object.values(prev).reduce((a, b) => a + b, 0)
      const distinctTypes = Object.keys(prev).length
      const bankCount = gameState.bank.tokens[type]

      // 如果已经选择了这个类型
      if (current > 0) {
        // 如果选了2个相同的，点击取消1个（变成1个）
        if (current === 2) {
          return { ...prev, [type]: 1 }
        }
        // 如果选了1个，且只有这1种类型，取消选择
        if (distinctTypes === 1) {
          const newTokens = { ...prev }
          delete newTokens[type]
          return newTokens
        }
        // 如果有多种类型，取消这个类型（从3个不同中移除）
        const newTokens = { ...prev }
        delete newTokens[type]
        return newTokens
      }

      // 还没选择这个类型，尝试添加
      if (bankCount <= 0) return prev
      if (totalSelected >= 3) return prev

      // 如果已经有其他类型（说明在选3个不同），只能选1个
      const hasOtherTypes = Object.keys(prev).some(t => t !== type)
      if (hasOtherTypes) {
        return { ...prev, [type]: 1 }
      }

      // 没有其他类型，第一次选择
      return { ...prev, [type]: 1 }
    })
  }

  // 增加选择（+ 按钮）
  const handleIncrease = (type) => {
    if (!isMyTurn) return
    if (type === 'coffee') return

    setSelectedTokens(prev => {
      const current = prev[type] || 0
      const totalSelected = Object.values(prev).reduce((a, b) => a + b, 0)
      const distinctTypes = Object.keys(prev).length
      const bankCount = gameState.bank.tokens[type]

      if (bankCount <= 0) return prev
      if (totalSelected >= 3) return prev

      // 如果已经有其他类型，只能选1个
      const hasOtherTypes = Object.keys(prev).some(t => t !== type)
      if (hasOtherTypes) {
        if (current === 0) return { ...prev, [type]: 1 }
        return prev
      }

      // 没有其他类型
      if (current === 0) return { ...prev, [type]: 1 }
      if (current === 1 && bankCount >= 4) return { ...prev, [type]: 2 }
      return prev
    })
  }

  // 减少选择（- 按钮）
  const handleDecrease = (type) => {
    if (!isMyTurn) return

    setSelectedTokens(prev => {
      const current = prev[type] || 0
      if (current === 0) return prev

      if (current === 2) return { ...prev, [type]: 1 }
      if (current === 1) {
        const newTokens = { ...prev }
        delete newTokens[type]
        return newTokens
      }
      return prev
    })
  }

  // 双击资源可以选2个相同的（如果银行≥4）
  const handleTokenDoubleClick = (type) => {
    if (!isMyTurn) return
    // 咖啡（万能牌）不能直接拿取
    if (type === 'coffee') return

    setSelectedTokens(prev => {
      const current = prev[type] || 0
      const distinctTypes = Object.keys(prev).length
      const bankCount = gameState.bank.tokens[type]

      // 只有选了1个且没有其他类型时，才能选2个
      if (current === 1 && distinctTypes === 1 && bankCount >= 4) {
        return { ...prev, [type]: 2 }
      }
      return prev
    })
  }

  const handleConfirmTokens = () => {
    const totalSelected = Object.values(selectedTokens).reduce((a, b) => a + b, 0)
    if (totalSelected === 0) return

    // 验证选择
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
      <div className="game-over-overlay">
        <div className="game-over-card">
          <h1>🎉 游戏结束！</h1>
          <h2>{winner.name} 获胜！</h2>
          <p>最终声誉: {winner.prestige}</p>
          <div className="final-standings">
            {gameState.players
              .sort((a, b) => b.prestige - a.prestige)
              .map((p, i) => (
                <div key={p.id} className={`standing ${p.id === winner.id ? 'winner' : ''}`}>
                  <span>#{i + 1}</span>
                  <span>{p.name}</span>
                  <span>{p.prestige} 声誉</span>
                </div>
              ))}
          </div>
          <button className="btn btn-primary" onClick={onRestart}>
            再来一局
          </button>
        </div>
      </div>
    )
  }

  const opponents = gameState.players.filter(p => p.id !== myPlayerId)
  const totalSelected = Object.values(selectedTokens).reduce((a, b) => a + b, 0)

  return (
    <div className="game-board">
      {/* 左侧：玩家面板 */}
      <div className="left-sidebar">
        {opponents.map(player => (
          <PlayerPanel
            key={player.id}
            player={player}
            isMe={false}
            isCurrentTurn={player.id === gameState.players[gameState.currentPlayerIndex]?.id}
            myTokens={null}
            onBuyReserved={null}
          />
        ))}
        <div className="sidebar-divider"></div>
        {myPlayer && (
          <PlayerPanel
            key={myPlayer.id}
            player={myPlayer}
            isMe={true}
            isCurrentTurn={isMyTurn}
            myTokens={myPlayer.tokens}
            onBuyReserved={isMyTurn
              ? (card) => onBuyCard(card.id, card.tier, true)
              : null
            }
          />
        )}
      </div>

      {/* 中间：卡牌区 */}
      <div className="center-area">
        <div className="cards-section">
          {[3, 2, 1].map(tier => (
            <div key={tier} className={`tier-row tier-${tier}`}>
              <div className="tier-header">
                <span className="tier-badge">{TIER_NAMES[tier]}</span>
                <span className="tier-count">{gameState.bank[`tier${tier}`]?.length || 0} 张</span>
              </div>
              <div className="tier-cards">
                {gameState.bank[`tier${tier}`]?.map((card, index) => (
                  <PaperCard
                    key={card.id}
                    card={card}
                    tier={tier}
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
                  <div className="empty-tier">已空</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧：资源池 */}
      <div className="right-sidebar">
        <div className="token-pool">
          <h3>资源池</h3>
          <ResourceTokens
            tokens={gameState.bank.tokens}
            selectedTokens={selectedTokens}
            onIncrease={handleIncrease}
            onDecrease={handleDecrease}
            isBank={true}
            disabled={!isMyTurn}
            vertical={true}
          />
          {totalSelected > 0 && (
            <div className="token-actions">
              <button className="btn btn-primary" onClick={handleConfirmTokens}>
                确认 ({totalSelected})
              </button>
              <button className="btn btn-secondary" onClick={() => setSelectedTokens({})}>
                取消
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 最右：贵族 */}
      <div className="nobles-sidebar">
        <h3>学术大佬</h3>
        <div className="nobles-list">
          {gameState.bank.nobles.map(noble => (
            <NobleTile key={noble.id} noble={noble} />
          ))}
        </div>
      </div>

      {/* 底部：当前玩家资源栏 */}
      <div className="bottom-bar">
        <div className="player-badge">
          <span className="badge-avatar">🧑‍💻</span>
          <span className="badge-prestige">{myPlayer?.prestige || 0}</span>
        </div>
        <div className="bar-divider"></div>
        {/* 论文：方形卡牌槽 */}
        <div className="bar-cards">
          {myPlayer?.cards?.map(card => (
            <div key={card.id} className={`card-slot tier-${card.tier}`} title={`${card.name} ⭐${card.prestige} +1${RESOURCE_INFO[card.bonus]?.name}`}>
              <span>{RESOURCE_INFO[card.bonus]?.icon}</span>
            </div>
          ))}
        </div>
        <div className="bar-divider"></div>
        {/* 资源：圆形按类型分组 */}
        <div className="bar-tokens">
          <span className="bar-token-count">{myPlayer?.tokens ? Object.values(myPlayer.tokens).reduce((a, b) => a + b, 0) : 0}/10</span>
          {myPlayer?.tokens && ['data','compute','citation','collaborator','funding','coffee'].map(type => {
            const count = myPlayer.tokens[type] || 0
            if (count === 0) return null
            const icon = type === 'coffee' ? '☕' : RESOURCE_INFO[type]?.icon
            return (
              <div key={type} className="token-group" title={RESOURCE_INFO[type]?.name || '咖啡'}>
                <span className="token-group-icon">{icon}</span>
                <span className="token-group-count">{count}</span>
              </div>
            )
          })}
        </div>
        <div className="bar-divider"></div>
        {/* 预留 */}
        <div className="bar-reserved">
          {myPlayer?.reservedCards?.map(card => (
            <div key={card.id} className={`card-slot reserved tier-${card.tier}`} title={`${card.name} ⭐${card.prestige}`}>
              <span>{RESOURCE_INFO[card.bonus]?.icon}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 预留确认弹窗 */}
      {showReserve && reserveTarget && (
        <div className="modal-overlay" onClick={() => setShowReserve(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>确认预留？</h3>
            <p>预留卡牌将获得 1 杯咖啡（万能资源）</p>
            <div className="modal-buttons">
              <button className="btn btn-primary" onClick={() => handleReserveCard(reserveTarget.tier, reserveTarget.index)}>
                确认预留
              </button>
              <button className="btn btn-secondary" onClick={() => setShowReserve(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 回合指示 */}
      <div className={`turn-indicator ${isMyTurn ? 'my-turn' : ''}`}>
        {isMyTurn ? '你的回合！' : `等待 ${gameState.players[gameState.currentPlayerIndex]?.name}...`}
      </div>
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

    if (has < effectiveCost) {
      coffeeNeeded += effectiveCost - has
    }
  }

  return coffeeNeeded <= (player.tokens.coffee || 0)
}
