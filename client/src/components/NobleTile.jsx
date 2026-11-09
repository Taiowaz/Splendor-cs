import './NobleTile.css'

const TOKEN_IMG = {
  data: '/images/tokens/WhiteToken.jpg',
  compute: '/images/tokens/BlueToken.jpg',
  citation: '/images/tokens/GreenToken.jpg',
  collaborator: '/images/tokens/BrownToken.jpg',
  funding: '/images/tokens/RedToken.jpg'
}

export default function NobleTile({ noble }) {
  return (
    <div className="noble-flag" data-tier={noble.tier} title={`${noble.cn} · ${noble.prestige} 声誉`}>
      <div className="noble-tile">
        <div className="noble-head">
          {noble.logo && <img className="noble-mark" src={noble.logo} alt="" />}
          <div className="noble-name">{noble.name}</div>
        </div>
        <div className="noble-sub">{noble.sub}</div>
        <div className="noble-requirements">
          {Object.entries(noble.requirement).map(([resource, count]) => (
            <div key={resource} className="requirement-item">
              <img className="requirement-token" src={TOKEN_IMG[resource]} alt={resource} />
              <span className="requirement-count">{count}</span>
            </div>
          ))}
        </div>
        <div className="noble-prestige">
          <span>{noble.prestige}</span>
        </div>
      </div>
    </div>
  )
}
