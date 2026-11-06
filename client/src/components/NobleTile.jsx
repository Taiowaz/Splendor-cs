import './NobleTile.css'

const RESOURCE_INFO = {
  data: { icon: '📊' },
  compute: { icon: '💻' },
  citation: { icon: '📄' },
  collaborator: { icon: '🤝' },
  funding: { icon: '💰' }
}

export default function NobleTile({ noble }) {
  return (
    <div className="noble-tile">
      <div className="noble-header">
        <span className="noble-name">{noble.name}</span>
        <span className="noble-prestige">⭐ {noble.prestige}</span>
      </div>
      <div className="noble-requirements">
        {Object.entries(noble.requirement).map(([resource, count]) => (
          <div key={resource} className="requirement-item">
            <span>{RESOURCE_INFO[resource]?.icon}</span>
            <span>×{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
