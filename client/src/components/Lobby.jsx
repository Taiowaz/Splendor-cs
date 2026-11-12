import { useState } from 'react'
import './screens.css'

// 大厅：没开起来的房间列表 + 房号直达。服务端 list_rooms 只回未开始的房，
// 所以这里不用再过滤「已开始」。
export default function Lobby({
  playerName,
  account,
  connected,
  rooms,
  maxPlayers,
  onNameChange,
  onCreateRoom,
  onJoinRoom,
  onRefresh,
  onBackToTitle
}) {
  const [code, setCode] = useState('')
  const [keyword, setKeyword] = useState('')

  const kw = keyword.trim().toLowerCase()
  const shown = kw
    ? rooms.filter(r =>
        r.id.toLowerCase().includes(kw) ||
        (r.hostName || '').toLowerCase().includes(kw) ||
        (r.players || []).some(p => p.name.toLowerCase().includes(kw)))
    : rooms

  const join = (id) => { if (id) onJoinRoom(id) }

  return (
    <div className="sc sc-lobby">
      <header className="sc-head">
        <button className="sc-back" onClick={onBackToTitle}>← 返回</button>
        <h2>同学开的房间</h2>
        <button className="sc-icon-btn" onClick={onRefresh} title="刷新列表">⟳</button>
      </header>

      <div className="sc-panel wide">
        <div className="sc-row">
          {account && !account.guest ? (
            /* 账号名注册时就定死了，这里只回显，不给改（改了服务端也不认） */
            <div className="sc-field inline">
              <span>昵称</span>
              <div className="sc-locked">🎓 {account.name}<span className="badge acct">账号</span></div>
            </div>
          ) : (
            <label className="sc-field inline">
              <span>昵称</span>
              <input
                type="text"
                value={playerName}
                placeholder="没填会以「我」进场"
                maxLength={12}
                onChange={(e) => onNameChange(e.target.value)}
              />
            </label>
          )}
          <button className="sc-btn primary" onClick={onCreateRoom} disabled={!connected}>
            创建房间
          </button>
        </div>

        <div className="sc-row">
          <label className="sc-field inline">
            <span>房号</span>
            <input
              type="text"
              value={code}
              placeholder="6 位房号"
              maxLength={6}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') join(code) }}
            />
          </label>
          <button
            className="sc-btn"
            onClick={() => join(code)}
            disabled={!connected || !code.trim()}
          >
            按房号加入
          </button>
        </div>

        <input
          className="sc-search"
          type="search"
          value={keyword}
          placeholder="按房号、房主或玩家筛选"
          onChange={(e) => setKeyword(e.target.value)}
        />

        {shown.length === 0 ? (
          <p className="sc-empty">
            {rooms.length === 0
              ? '现在没人开房。点上面「创建房间」，把房号发给同学就能来。'
              : '没有符合条件的房间。'}
          </p>
        ) : (
          <table className="sc-table">
            <thead>
              <tr>
                <th>房号</th>
                <th>房主</th>
                <th>玩家</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const full = r.playerCount >= maxPlayers
                return (
                  <tr key={r.id} className={full ? 'full' : ''}>
                    <td className="room-code">{r.id}</td>
                    <td>{r.hostName || '—'}</td>
                    <td className="roster">
                      {(r.players || []).map(p => p.offline ? `${p.name}（离线）` : p.name).join('、') || '空'}
                      <span className="seats">{r.playerCount}/{maxPlayers}</span>
                    </td>
                    <td>
                      <button
                        className="sc-btn small"
                        onClick={() => join(r.id)}
                        disabled={!connected || full}
                      >
                        {full ? '已满' : '加入'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
