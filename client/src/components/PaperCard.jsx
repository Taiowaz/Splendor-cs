import './PaperCard.css'

// 筹码图按官方宝石色命名，和资源一一对应（同 NobleTile / card-preview.html）
const DISC = {
  data: 'White',
  compute: 'Blue',
  citation: 'Green',
  collaborator: 'Brown',
  funding: 'Red',
  coffee: 'Gold'
}

// 卡面上的资源短名（"合作者" 三个字在窄卡面上会挤掉数字，一律缩成两字）
const RES_CN = {
  data: '数据',
  compute: '算力',
  citation: '引用',
  collaborator: '合作',
  funding: '经费'
}

const disc = (r) => ({ backgroundImage: `url(/images/tokens/${DISC[r]}Token.png)` })

export default function PaperCard({ card, canAfford, onBuy, onReserve, isMyTurn, onInspect }) {
  const tierClass = card.ccf === 'B' ? ' tierB' : card.ccf === 'C' ? ' tierC' : ''

  return (
    <div
      className={`paper-card${tierClass}${canAfford ? ' affordable' : ''}${onInspect ? ' tappable' : ''}`}
      title={`${card.fullName} · ${card.cn}`}
      onClick={onInspect}
    >
      <div className="prestige"><span>{card.prestige}</span></div>
      <div className="ribbon"><span className="dot" />CCF-{card.ccf}<span className="dot" /></div>

      <div className="title">{card.name}</div>
      <div className="card-sub">{card.cn}</div>

      <div className={`card-art${card.art?.tone === 'light' ? ' tone-light' : ''}`}>
        {card.art && <img src={card.art.src} alt="" />}
      </div>

      <div className="body">
        <div className="bonus">
          <div className="gem" style={disc(card.bonus)}><span className="plus">+1</span></div>
          <span className="cap">产出 {RES_CN[card.bonus]}</span>
        </div>
        <div className="cost">
          {Object.entries(card.cost).map(([resource, count]) => (
            <div className="row" key={resource} title={`${RES_CN[resource]} ×${count}`}>
              <div className="mini" style={disc(resource)} />
              <span className="n">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {isMyTurn && (
        <div className="foot">
          {canAfford && <button className="btn buy" onClick={e => { e.stopPropagation(); onBuy() }}>购买</button>}
          {/* 预留区里的卡不能再预留自己，所以调用方不传 onReserve 时这条就不出现 */}
          {onReserve && <button className="btn" onClick={e => { e.stopPropagation(); onReserve() }}>预留</button>}
        </div>
      )}
    </div>
  )
}
