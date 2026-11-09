import './NobleTile.css'
import ResourceIcon from './ResourceIcon.jsx'

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
            <div key={resource} className="requirement-item" data-res={resource}>
              <ResourceIcon resource={resource} className="requirement-icon" />
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
