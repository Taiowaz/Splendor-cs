import './ResourceTokens.css'

const TOKEN_INFO = {
  data: { icon: '📊', name: '数据', color: '#e8e8e8' },
  compute: { icon: '💻', name: '算力', color: '#4fc3f7' },
  citation: { icon: '📄', name: '引用', color: '#81c784' },
  collaborator: { icon: '🤝', name: '合作者', color: '#e57373' },
  funding: { icon: '💰', name: '经费', color: '#fff176' },
  coffee: { icon: '☕', name: '咖啡', color: '#a1887f' }
}

export default function ResourceTokens({ tokens, selectedTokens = {}, onIncrease, onDecrease, isBank = false, disabled = false, vertical = false }) {
  const types = ['data', 'compute', 'citation', 'collaborator', 'funding', 'coffee']

  return (
    <div className={`resource-tokens ${vertical ? 'vertical' : ''}`}>
      {types.map(type => {
        const info = TOKEN_INFO[type]
        const count = tokens[type] || 0
        const selected = selectedTokens[type] || 0

        return (
          <div
            key={type}
            className={`token ${isBank ? 'bank-token' : 'player-token'} ${selected > 0 ? 'selected' : ''} ${disabled || count === 0 ? 'disabled' : ''}`}
            style={{ borderColor: info.color }}
          >
            <span className="token-icon">{info.icon}</span>
            <span className="token-count">{count}</span>
            {selected > 0 && <span className="token-selected">{selected}</span>}
            <span className="token-name">{info.name}</span>
            {isBank && type !== 'coffee' && (
              <div className="token-controls">
                <button
                  className="btn-decrease"
                  onClick={() => onDecrease && onDecrease(type)}
                  disabled={disabled || selected === 0}
                >
                  -
                </button>
                <span className="selected-count">{selected}</span>
                <button
                  className="btn-increase"
                  onClick={() => onIncrease && onIncrease(type)}
                  disabled={disabled || count === 0}
                >
                  +
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
