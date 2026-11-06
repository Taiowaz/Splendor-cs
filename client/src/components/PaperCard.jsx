import './PaperCard.css'

const RESOURCE_INFO = {
  data: { icon: '📊', name: '数据' },
  compute: { icon: '💻', name: '算力' },
  citation: { icon: '📄', name: '引用' },
  collaborator: { icon: '🤝', name: '合作者' },
  funding: { icon: '💰', name: '经费' }
}

const TIER_COLORS = {
  1: '#4caf50',
  2: '#2196f3',
  3: '#9c27b0'
}

export default function PaperCard({ card, tier, canAfford, onBuy, onReserve, isMyTurn }) {
  const tierColor = TIER_COLORS[tier]

  return (
    <div className={`paper-card tier-${tier} ${canAfford ? 'affordable' : ''}`}>
      <div className="card-header" style={{ backgroundColor: tierColor }}>
        <span className="card-prestige">⭐ {card.prestige}</span>
        <span className="card-tier">T{tier}</span>
      </div>

      <div className="card-body">
        <div className="card-name">{card.name}</div>
        <div className="card-bonus">
          <span className="bonus-icon">{RESOURCE_INFO[card.bonus]?.icon}</span>
          <span className="bonus-text">+1 {RESOURCE_INFO[card.bonus]?.name}</span>
        </div>
      </div>

      <div className="card-cost">
        {Object.entries(card.cost).map(([resource, amount]) => (
          <div key={resource} className="cost-item">
            <span>{RESOURCE_INFO[resource]?.icon}</span>
            <span>{amount}</span>
          </div>
        ))}
      </div>

      {isMyTurn && (
        <div className="card-actions">
          {canAfford && (
            <button className="btn-buy" onClick={onBuy}>购买</button>
          )}
          <button className="btn-reserve" onClick={onReserve}>预留</button>
        </div>
      )}
    </div>
  )
}
