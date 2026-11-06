import { useState } from 'react'
import ResourceTokens from './ResourceTokens.jsx'
import './PlayerPanel.css'

const RESOURCE_INFO = {
  data: { icon: '📊', name: '数据' },
  compute: { icon: '💻', name: '算力' },
  citation: { icon: '📄', name: '引用' },
  collaborator: { icon: '🤝', name: '合作者' },
  funding: { icon: '💰', name: '经费' }
}

export default function PlayerPanel({ player, isMe, isCurrentTurn, myTokens, onBuyReserved }) {
  const [expanded, setExpanded] = useState(isMe)

  const totalTokens = myTokens
    ? Object.values(myTokens).reduce((a, b) => a + b, 0)
    : 0

  return (
    <div className={`player-panel ${isMe ? 'me' : ''} ${isCurrentTurn ? 'current-turn' : ''}`}>
      <div className="panel-header" onClick={() => setExpanded(!expanded)}>
        <div className="player-info">
          <span className="player-avatar">{isMe ? '🧑‍💻' : '👨‍🎓'}</span>
          <span className="player-name">{player.name}</span>
          {isMe && <span className="me-badge">我</span>}
        </div>
        <div className="player-stats">
          <span className="prestige">⭐ {player.prestige}</span>
          {!isMe && <span className="token-count">🪙 {player.tokens?.coffee || 0}</span>}
        </div>
      </div>

      {expanded && (
        <div className="panel-body">
          {/* 永久加成 */}
          <div className="bonus-section">
            <h4>学术加成</h4>
            <div className="bonus-list">
              {Object.entries(player.bonus).map(([resource, count]) => (
                count > 0 && (
                  <div key={resource} className="bonus-item">
                    <span>{RESOURCE_INFO[resource]?.icon}</span>
                    <span>×{count}</span>
                  </div>
                )
              ))}
              {Object.values(player.bonus).every(v => v === 0) && (
                <span className="no-bonus">暂无</span>
              )}
            </div>
          </div>

          {/* 我的资源 */}
          {isMe && myTokens && (
            <div className="tokens-section">
              <h4>我的资源 ({totalTokens}/10)</h4>
              <ResourceTokens tokens={myTokens} selectedTokens={{}} onTokenClick={() => {}} />
            </div>
          )}

          {/* 已发论文 */}
          <div className="cards-section">
            <h4>已发论文 ({player.cards.length})</h4>
            <div className="mini-cards">
              {player.cards.map(card => (
                <div key={card.id} className={`mini-card tier-${card.tier}`}>
                  <span className="mini-name">{card.name}</span>
                  <span className="mini-prestige">⭐{card.prestige}</span>
                </div>
              ))}
              {player.cards.length === 0 && <span className="no-cards">暂无论文</span>}
            </div>
          </div>

          {/* 预留卡牌 */}
          {isMe && player.reservedCards && player.reservedCards.length > 0 && (
            <div className="reserved-section">
              <h4>预留论文 ({player.reservedCards.length}/3)</h4>
              <div className="mini-cards">
                {player.reservedCards.map(card => (
                  <div key={card.id} className={`mini-card reserved tier-${card.tier}`}>
                    <span className="mini-name">{card.name}</span>
                    <span className="mini-prestige">⭐{card.prestige}</span>
                    {onBuyReserved && (
                      <button
                        className="btn-buy-mini"
                        onClick={() => onBuyReserved(card)}
                        disabled={!canAffordReserved(player, card)}
                      >
                        购买
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function canAffordReserved(player, card) {
  if (!player.tokens) return false
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
