import './screens.css'

// 入口页。原来是页面一打开就自动建房 + 塞 AI + 开局，等于没有入口；
// 现在名字和玩法都在这里选，快速开局保留一键进桌的方便。
export default function TitleScreen({
  playerName,
  connected,
  onNameChange,
  onQuickStart,
  onCreateRoom,
  onEnterLobby
}) {
  return (
    <div className="sc sc-title">
      <div className="sc-decks">
        <img className="sc-deck c" src="/images/decks/crest-C.jpg" alt="" />
        <img className="sc-deck b" src="/images/decks/crest-B.jpg" alt="" />
        <img className="sc-deck a" src="/images/decks/crest-A.jpg" alt="" />
      </div>

      <h1 className="sc-logo">学术宝石</h1>
      <p className="sc-tagline">攒资源 · 发论文 · 当院士</p>

      <div className="sc-panel">
        <label className="sc-field">
          <span>怎么称呼你</span>
          <input
            type="text"
            value={playerName}
            placeholder="比如：小王师兄"
            maxLength={12}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && connected) onQuickStart() }}
          />
        </label>

        {/* 说明小字放在按钮下面单独一行：塞在按钮里会把主标题挤得偏左，
            按钮看着不居中。挪出来后按钮只剩一行居中的标题。 */}
        <div className="sc-buttons">
          <button className="sc-btn primary" onClick={onQuickStart} disabled={!connected}>
            快速开局
          </button>
          <p className="sc-btn-note">你 + 3 个 AI</p>
          <button className="sc-btn" onClick={onCreateRoom} disabled={!connected}>
            创建房间
          </button>
          <p className="sc-btn-note">开房号，等同学进来</p>
          <button className="sc-btn" onClick={onEnterLobby} disabled={!connected}>
            加入同学的房间
          </button>
          <p className="sc-btn-note">看房间列表 / 输房号</p>
        </div>

        <div className="sc-status">
          <span className={`sc-dot ${connected ? 'on' : 'off'}`}></span>
          {connected ? '已连上实验室服务器' : '连接中…'}
        </div>
      </div>
    </div>
  )
}
