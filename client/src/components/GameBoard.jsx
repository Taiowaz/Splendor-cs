import { useEffect, useRef, useState } from 'react'
import PaperCard from './PaperCard.jsx'
import NobleTile from './NobleTile.jsx'
import DebugPanel from './DebugPanel.jsx'
import './GameBoard.css'

const TIER_NAMES = {
  1: 'CCF-C 论文',
  2: 'CCF-B 论文',
  3: 'CCF-A 论文'
}

const TIER_CCF = { 3: 'A', 2: 'B', 1: 'C' }

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

const INVENTORY_TYPES = ['data', 'compute', 'citation', 'collaborator', 'funding', 'coffee']
// 咖啡是万能筹码，不是任何论文的产出方向（venues.js 里 bonus 只有那 5 色），
// 所以咖啡那一格只有筹码、不配论文圈 —— 挂个永远 0 的空圈只会误导「这里能发论文」
const VC_TYPES = ['data', 'compute', 'citation', 'collaborator', 'funding']

export default function GameBoard({
  gameState,
  myPlayerId,
  room,
  onTakeTokens,
  onBuyCard,
  onReserveCard,
  onRestart,
  onExitRoom,
  onDebugSetTokens,
  onDebugSetReserved
}) {
  const [selectedTokens, setSelectedTokens] = useState({})
  const [showReserve, setShowReserve] = useState(false)
  const [reserveTarget, setReserveTarget] = useState(null)
  const [showReserved, setShowReserved] = useState(false)
  // 顶栏 ☰ 菜单：null 收起，'open' 展开，另两个值是它里面的二级弹窗
  const [menu, setMenu] = useState(null)

  // 牌桌有固定最小宽高（.gb-playing），窗口比它小时页面既不缩也不滚，只裁掉边角，
  // 所以量一下实际尺寸，摆不下就盖层提示说清楚差多少，别让人以为是布局坏了。
  const boardRef = useRef(null)
  const [tooSmall, setTooSmall] = useState(null)

  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const measure = () => {
      const need = { w: el.offsetWidth, h: el.offsetHeight }
      const have = { w: window.innerWidth, h: window.innerHeight }
      setTooSmall(have.w < need.w || have.h < need.h ? { need, have } : null)
    }
    measure()
    // 卡宽跟着 vmin/vh 走，字体图片加载完也会改自然宽，所以除了 resize 还盯元素本身
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [gameState.gameOver])

  const myPlayer = gameState.players.find(p => p.id === myPlayerId)
  const myReserved = myPlayer?.reservedCards || []
  const currentIndex = gameState.currentPlayerIndex
  const isMyTurn = gameState.players[currentIndex]?.id === myPlayerId
  const myOrder = gameState.players.findIndex(p => p.id === myPlayerId) + 1

  // 拿筹码的合法组合只有三种：3 个不同色、2 枚同色（银行该色 ≥4）、单独 1 枚咖啡。
  // 咖啡（万能）不占「3 个不同色」的名额，也不能凑 2 枚 —— 「拿 1 枚咖啡」本身就是
  // 一个完整行动，所以点咖啡会把已选的清掉只留咖啡，反过来选了咖啡再点别的色就换回
  // 普通选法。服务端 handleTakeTokens 按同一口径判。
  //
  // 「拿 2 枚同色」靠连点两次，不能用 dblclick：浏览器真双击必定先派发两次 click，
  // 旧的「单击 toggle + 双击升到 2」会被第二次 click 又清回 0，双击分支永远进不去。
  // 循环 0 → 1 → 2 → 0，2 只在「场上只有这一色且银行 ≥4」时给，并且握着 2 枚就不
  // 再加别色 —— 这样选出来的组合必然落在服务端认的那三种里。
  const handleTokenClick = (type) => {
    if (!isMyTurn) return

    setSelectedTokens(prev => {
      const current = prev[type] || 0
      const bankCount = gameState.bank.tokens[type]
      const values = Object.values(prev)
      const clear = key => {
        const next = { ...prev }
        delete next[key]
        return next
      }

      if (type === 'coffee') {
        if (current) return clear('coffee')
        if (bankCount <= 0) return prev
        return { coffee: 1 }
      }

      if (prev.coffee) {
        const next = clear('coffee')
        return bankCount > 0 ? { ...next, [type]: 1 } : next
      }

      if (current === 2) return clear(type)

      if (current === 1) {
        if (values.length === 1 && bankCount >= 4) return { [type]: 2 }
        return clear(type)
      }

      if (values.some(n => n >= 2)) return prev
      if (bankCount <= 0) return prev
      if (values.reduce((a, b) => a + b, 0) >= 3) return prev
      return { ...prev, [type]: 1 }
    })
  }

  const handleConfirmTokens = () => {
    const totalSelected = Object.values(selectedTokens).reduce((a, b) => a + b, 0)
    if (totalSelected === 0) return
    const types = Object.keys(selectedTokens)
    const soloCoffee = totalSelected === 1 && types[0] === 'coffee'
    const threeDiff = totalSelected === 3 && types.length === 3 && !selectedTokens.coffee
    const pairSame = totalSelected === 2 && types.length === 1 && gameState.bank.tokens[types[0]] >= 4
    if (!soloCoffee && !threeDiff && !pairSame) return
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
    const isHost = room?.hostId === myPlayerId
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
          {/* 重开由房主发起（服务端只认房主），其他人这条只能等 */}
          {isHost
            ? <button className="gb-btn gb-btn-gold" onClick={onRestart}>再来一局</button>
            : <p className="gb-restart-hint">等房主点「再来一局」…</p>}
          <button className="gb-btn gb-btn-ghost" onClick={onExitRoom}>回大厅</button>
        </div>
      </div>
    )
  }

  const opponents = gameState.players.filter(p => p.id !== myPlayerId)
  const totalSelected = Object.values(selectedTokens).reduce((a, b) => a + b, 0)
  // 掉线保席中的人还在名单里（roster 带 offline），牌桌上要标出来，
  // 不然大家只看到「等待 X」却不知道为什么一直不动
  const seatOf = (id) => room?.players?.find(p => p.id === id)
  const currentOffline = seatOf(gameState.players[currentIndex]?.id)?.offline

  return (
    <div className="gb gb-root gb-playing" ref={boardRef}>
      {/* ☰ 菜单：规则和出口以前压根没有，想换人重开只能刷新页面。挂在 .gb-root 上
          而不是顶栏里——顶栏是个 z-index 5 的层叠上下文，菜单在里面永远压不过牌桌。 */}
      <div className="gb-menu">
        <button
          className={`gb-menu-btn ${menu ? 'active' : ''}`}
          onClick={() => setMenu(menu ? null : 'open')}
          title="菜单"
        >☰</button>
        {/* 弹层只在菜单本身打开时出现：规则和退出确认是盖在上面的整屏遮罩，
            菜单条跟着留着会亮在遮罩外面，像是还能点。 */}
        {menu === 'open' && (
          <div className="gb-menu-pop">
            <button onClick={() => setMenu('rules')}>规则说明</button>
            <div className="gb-menu-room">
              <span>房间号</span>
              <strong>{room?.roomId || '单机'}</strong>
            </div>
            <button className="danger" onClick={() => setMenu('exit')}>退出房间</button>
          </div>
        )}
      </div>

      {/* 顶部标题栏 */}
      <div className="gb-topbar">
        <div className="gb-title">学术宝石</div>
        <div className={`gb-turnpill ${isMyTurn ? 'mine' : ''} ${currentOffline ? 'waiting' : ''}`}>
          {isMyTurn
            ? '轮到你行动'
            : currentOffline
              ? `${gameState.players[currentIndex]?.name} 掉线了，等他重连…`
              : `等待 ${gameState.players[currentIndex]?.name}`}
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

          {/* 公共筹码（AR）：排在 VC + FC 整块下面，我的资源条上面。
              6 色全在这里 —— 之前只渲染 5 色，银行那 5 枚咖啡根本摸不到，只能靠
              预留卡换 1 枚。咖啡走「单独拿 1 枚」那条行动，见 handleTokenClick。 */}
          <div className="gb-tokenpool">
            {INVENTORY_TYPES.map(type => {
              const info = RESOURCE_INFO[type]
              const bankCount = gameState.bank.tokens[type] || 0
              const sel = selectedTokens[type] || 0
              return (
                <div
                  key={type}
                  className={`pool-gem ${sel > 0 ? 'selected' : ''} ${bankCount === 0 ? 'empty' : ''}`}
                  onClick={() => handleTokenClick(type)}
                  title={type === 'coffee'
                    ? `${info.name}｜银行 ${bankCount}｜只能单独拿 1 枚，不与其他色混拿；预留 1 张卡也会送 1 枚`
                    : `${info.name}｜银行 ${bankCount}｜单击选 1，再点一下选 2（只有这一色且银行 ≥4），第三次取消`}
                >
                  <div className="gem-circle" style={{ backgroundImage: `url(${info.gem})` }} />
                  <span className="gem-num">{bankCount}</span>
                  {sel > 0 && <span className="gem-badge">{sel}</span>}
                </div>
              )
            })}

            {/* 资源选择确认条：贴在筹码行右侧的空 felt 上，竖排紧凑版，整条落在
                对手列左缘以内，后期对手框长高也压不到（几何见 .gb-actionbar） */}
            {totalSelected > 0 && (
              <div className="gb-actionbar">
                <span className="action-summary">已选 {totalSelected} 个资源</span>
                <div className="action-buttons">
                  <button className="gb-btn gb-btn-gold" onClick={handleConfirmTokens}>确认拿取</button>
                  <button className="gb-btn gb-btn-ghost" onClick={() => setSelectedTokens({})}>取消</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：其他玩家。声誉章在框左上角，下面按本人资源条那套形式组织：
            每个方向一格「筹码圆片 + 该方向论文卡背」，常驻、0 也带角标、空位压暗，
            和底部完全同一个口径（论文数 = 买卡时该色的折价，明细在 tooltip 里）。
            咖啡没有论文方向，那一格只有筹码。
            6 格排两列三行（框只有 216 宽，三格一行会把角标挤到一起），所以框比原来
            高一些，表头那一行也按章的直径留出一整条带，免得第一格圆片压在章上；
            预留是右下角那块空 felt 上的真卡面小摞（绝对定位，不给框加高），
            再下面是会士缩小旗面。 */}
        <div className="gb-players">
          {opponents.map(player => {
            const order = gameState.players.findIndex(p => p.id === player.id) + 1
            const isTurn = player.id === gameState.players[currentIndex]?.id
            const cards = player.cards || []
            const reserved = player.reservedCards || []
            const fcs = player.nobles || []
            return (
              <div key={player.id} className={`opp-panel ${isTurn ? 'active' : ''}`}>
                <div className="opp-prestige"><span>{player.prestige}</span></div>
                <div className="opp-identity">
                  <span className="opp-name">{player.name}</span>
                  {seatOf(player.id)?.offline && <span className="opp-offline">离线</span>}
                  <span className="opp-order">第 {order} 位</span>
                </div>

                {/* 6 格 = 6 个方向，每格「筹码 + 该方向论文卡背」，和底部 .mc-type 同一套
                    （咖啡只有筹码，没有论文方向） */}
                <div className="opp-res">
                  {INVENTORY_TYPES.map(type => {
                    const info = RESOURCE_INFO[type]
                    const n = player.tokens?.[type] || 0
                    const hasVC = VC_TYPES.includes(type)
                    const papers = cards.filter(c => c.bonus === type)
                    const bestTier = papers.length ? Math.max(...papers.map(c => c.tier)) : 1
                    const byTier = papers.reduce((a, c) => { a[c.tier] = (a[c.tier] || 0) + 1; return a }, {})
                    const breakdown = [3, 2, 1].filter(t => byTier[t]).map(t => `CCF-${TIER_CCF[t]}×${byTier[t]}`).join(' ')
                    return (
                      <div key={type} className={`opp-cell ${type === 'coffee' ? 'opp-cell-coffee' : ''}`}
                        title={hasVC
                          ? `${info.name}｜筹码 ${n}｜论文 ${papers.length} 篇${breakdown ? `（${breakdown}）` : ''}`
                          : `${info.name}｜筹码 ${n}｜万能筹码，没有对应方向的论文`}>
                        <div className={`inv-gem ${n === 0 ? 'empty' : ''}`}>
                          <div className="gem-circle" style={{ backgroundImage: `url(${info.gem})` }} />
                          <span className="gem-num">{n}</span>
                        </div>
                        {hasVC && (
                          <div className={`vc-mark ${papers.length === 0 ? 'empty' : ''}`}>
                            <img src={TIER_DECK[bestTier]} alt="" />
                            <span className="vc-count">{papers.length}</span>
                          </div>
                        )}
                        {/* 预留：只能从牌桌明面拿，这信息本来就翻给所有人看过，所以直接上
                            真卡面（服务端已不再只发 tier），和本人那一摞同一个形式。
                            挂在咖啡格里、绝对定位贴格的右上角 —— 顶边就跟着这一行走，
                            和左边那张论文卡背齐平（几何见 .opp-reserved）。 */}
                        {type === 'coffee' && reserved.length > 0 && (
                          <div className="opp-reserved" title={`预留 ${reserved.length} 张（公开）｜悬停摊开看卡面`}>
                            {reserved.map(c => (
                              <div key={c.id} className="opp-reserved-slot">
                                <PaperCard card={c} isMyTurn={false} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="opp-inventory">
                  {fcs.length > 0 && (
                    <div className="opp-fcs" title={`会士卡 ${fcs.length} 张`}>
                      {fcs.map(n => (
                        <div key={n.id} className="opp-fc" data-tier={n.tier}
                          title={`${n.cn}｜声誉 ${n.prestige}`}>
                          {n.logo ? <img src={n.logo} alt="" /> : <span>{n.name}</span>}
                        </div>
                      ))}
                    </div>
                  )}
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
          // 该方向的已发表论文：张数 == player.bonus[type]（服务端买卡时 ++），
          // 这里直接从 cards 派生，筹码和论文各占一个图标，不再叠在同一枚圆片上
          const papers = (myPlayer?.cards || []).filter(c => c.bonus === type)
          const hasVC = VC_TYPES.includes(type)
          // 6 色 11 格一律常驻，0 也显示角标 —— 原来 0 就整列不渲染，买第一张卡时
          // 资源条会突然变宽、所有列横移。空位按公共筹码那套压暗（.empty）。
          // 卡背按该方向最好的一篇选档（tier 数字越大越高级：3 = CCF-A），0 篇借 tier-1
          const bestTier = papers.length ? Math.max(...papers.map(c => c.tier)) : 1
          const byTier = papers.reduce((a, c) => { a[c.tier] = (a[c.tier] || 0) + 1; return a }, {})
          const breakdown = [3, 2, 1].filter(t => byTier[t]).map(t => `CCF-${TIER_CCF[t]}×${byTier[t]}`).join(' ')
          return (
            <div key={type} className="mc-type">
              <div className={`inv-gem ${tokens === 0 ? 'empty' : ''}`} title={`${info.name}｜筹码 ${tokens}`}>
                <div className="gem-circle" style={{ backgroundImage: `url(${info.gem})` }} />
                <span className="gem-num">{tokens}</span>
              </div>
              {hasVC && (
                <div
                  className={`vc-mark ${papers.length === 0 ? 'empty' : ''}`}
                  title={papers.length
                    ? `${info.name}方向论文 ${papers.length} 篇（${breakdown}）｜买卡时 ${info.name} 便宜 ${papers.length}`
                    : `${info.name}方向论文 0 篇`}
                >
                  <img src={TIER_DECK[bestTier]} alt="" />
                  <span className="vc-count">{papers.length}</span>
                </div>
              )}
            </div>
          )
        })}

        {/* 预留区：挂在自己库存末尾 —— 真卡面竖着站、等比缩到底条内容高度，
            整排不超出资源条；只当"有几张、什么档"的提醒，买哪张在弹窗里挑，
            见下面的 .gb-reserved-modal。尺寸在 .mc-reserved-slot 里给。 */}
        {myReserved.length > 0 && (
          <div
            className="mc-reserved"
            title={`预留 ${myReserved.length} 张｜点开挑一张买`}
            onClick={() => setShowReserved(true)}
          >
            {myReserved.map(card => (
              <div key={card.id} className="mc-reserved-slot">
                <PaperCard card={card} isMyTurn={false} />
              </div>
            ))}
          </div>
        )}
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

      {/* 从预留区买卡：参考实现也是把「买预留」收在弹窗里、由玩家挑那一张
          （taketurn.js:220-238 把预留那一列搬进 #buy-card-modal），牌桌上那摞
          只用来瞄一眼。这里没做支付选择弹窗 —— 服务端自动结算，所以弹窗里
          每张只给「买这张」。 */}
      {showReserved && myReserved.length > 0 && (
        <div className="gb-modal-overlay" onClick={() => setShowReserved(false)}>
          <div className="gb-modal gb-reserved-modal" onClick={e => e.stopPropagation()}>
            <h3>从预留区购买</h3>
            <p>买预留卡就是你这一回合的行动，买下的那张当场结算产出筹码。</p>
            <div className="reserved-list">
              {myReserved.map(card => {
                const affordable = isMyTurn && canAfford(myPlayer, card)
                return (
                  <div key={card.id} className="reserved-item">
                    <PaperCard
                      card={card}
                      isMyTurn={true}
                      canAfford={affordable}
                      onBuy={() => {
                        onBuyCard(card.id, card.tier, true)
                        setShowReserved(false)
                      }}
                    />
                    {!affordable && <span className="reserved-hint">{isMyTurn ? '资源不够' : '还没轮到你'}</span>}
                  </div>
                )
              })}
            </div>
            <div className="gb-modal-buttons">
              <button className="gb-btn gb-btn-ghost" onClick={() => setShowReserved(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 菜单里的二级弹窗：规则小抄 / 退出确认 */}
      {menu === 'rules' && (
        <div className="gb-modal-overlay" onClick={() => setMenu('open')}>
          <div className="gb-modal gb-rules-modal" onClick={e => e.stopPropagation()}>
            <h3>学术宝石 · 规则</h3>
            <div className="rules-body">
              <section>
                <h4>每回合做一件事</h4>
                <ul>
                  <li><b>取筹码</b>：3 枚不同色，或 2 枚同色（公共堆该色得有 ≥4），或单独取 1 枚咖啡。</li>
                  <li><b>买论文</b>：按卡面付筹码，咖啡能顶任何缺口；买下来当场拿走这张卡的 1 枚产出筹码。</li>
                  <li><b>预留论文</b>：从牌面挑一张压进自己的预留区（最多 3 张），立刻换 1 枚咖啡，以后再来买。</li>
                </ul>
              </section>
              <section>
                <h4>筹码</h4>
                <p>
                  手里最多 10 枚，会超就不能这么取。六色里只有咖啡是万能筹码，
                  它不对应任何论文方向，所以不能拿 2 枚同色咖啡。
                </p>
              </section>
              <section>
                <h4>会士卡与胜负</h4>
                <p>
                  论文卡在某一方向攒够数，对应的会士就来访，给你声誉。
                  桌上会士人数比玩家多 1 位。谁先到 15 声誉，本轮打完就结算，声誉最高者胜。
                </p>
              </section>
            </div>
            <div className="gb-modal-buttons">
              <button className="gb-btn gb-btn-ghost" onClick={() => setMenu('open')}>知道了</button>
            </div>
          </div>
        </div>
      )}

      {menu === 'exit' && (
        <div className="gb-modal-overlay" onClick={() => setMenu('open')}>
          <div className="gb-modal" onClick={e => e.stopPropagation()}>
            <h3>退出房间？</h3>
            <p>你的席位会交给 AI 代打，进度留着。回到大厅点「回到牌桌」，或直接刷新，就能接回来继续。</p>
            <div className="gb-modal-buttons">
              <button className="gb-btn gb-btn-ghost" onClick={() => setMenu('open')}>继续玩</button>
              <button className="gb-btn gb-btn-gold" onClick={onExitRoom}>退出</button>
            </div>
          </div>
        </div>
      )}

      {/* 测试开关：右下角点开，逐个玩家改手里的筹码和预留卡 */}
      <DebugPanel
        gameState={gameState}
        myPlayerId={myPlayerId}
        onSetTokens={onDebugSetTokens}
        onSetReserved={onDebugSetReserved}
      />

      {tooSmall && (
        <div className="gb-toosmall">
          <div className="gb-toosmall-card">
            <div className="ts-icon">🖥️</div>
            <h3>窗口太小，牌桌摆不开</h3>
            <div className="ts-sizes">
              <div>
                <span>需要</span>
                <strong>{tooSmall.need.w} × {tooSmall.need.h}</strong>
              </div>
              <div>
                <span>当前</span>
                <strong className="short">{tooSmall.have.w} × {tooSmall.have.h}</strong>
              </div>
            </div>
            <p className="ts-hint">拖大浏览器窗口，或按 <kbd>F11</kbd> 全屏。</p>
          </div>
        </div>
      )}
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
