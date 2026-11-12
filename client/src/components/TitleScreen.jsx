import { useState } from 'react'
import './screens.css'

// 入口页。名字、身份（游客 / 账号）和玩法都在这里选。
// 游客身份记在本浏览器，刷新能回房；注册账号之后换设备也能回到同一席位。
export default function TitleScreen({
  playerName,
  account,
  connected,
  onNameChange,
  onLogin,
  onRegister,
  onLogout,
  onQuickStart,
  onCreateRoom,
  onEnterLobby
}) {
  const [tab, setTab] = useState('guest')
  const [authName, setAuthName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const loggedIn = account && !account.guest

  const switchTab = (next) => {
    setTab(next)
    setError('')
    if (next !== 'guest' && !authName) setAuthName(playerName.trim())
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const name = authName.trim()
    if (name.length < 2 || name.length > 12) return setError('账号名要 2-12 个字符')
    if (password.length < 4) return setError('密码至少 4 位')
    if (tab === 'register' && password !== confirm) return setError('两次输入的密码不一样')

    setError('')
    setBusy(true)
    try {
      await (tab === 'login' ? onLogin(name, password) : onRegister(name, password))
      setPassword('')
      setConfirm('')
    } catch (err) {
      setError(err.message || '没连上服务器')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc sc-title">
      <div className="sc-decks">
        <img className="sc-deck c" src="/images/decks/crest-C.jpg" alt="" />
        <img className="sc-deck b" src="/images/decks/crest-B.jpg" alt="" />
        <img className="sc-deck a" src="/images/decks/crest-A.jpg" alt="" />
      </div>

      <h1 className="sc-logo">码上顶会</h1>
      <p className="sc-tagline">攒资源 · 发论文 · 当院士</p>

      <div className="sc-panel">
        {loggedIn ? (
          <div className="sc-idcard">
            <span className="sc-idavatar">🎓</span>
            <span className="sc-idname">{account.name}</span>
            <span className="badge acct">已登录</span>
            <button className="sc-mini-btn" onClick={onLogout} disabled={busy}>退出登录</button>
          </div>
        ) : (
          <>
            <div className="sc-tabs">
              <button className={tab === 'guest' ? 'on' : ''} onClick={() => switchTab('guest')}>游客试玩</button>
              <button className={tab === 'login' ? 'on' : ''} onClick={() => switchTab('login')}>登录</button>
              <button className={tab === 'register' ? 'on' : ''} onClick={() => switchTab('register')}>注册</button>
            </div>

            {tab === 'guest' ? (
              <>
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
                <p className="sc-note">游客身份记在这台浏览器：刷新照样回房，换设备要先登录。</p>
              </>
            ) : (
              /* 登录/注册的提交按钮单独放在 .sc-auth 里，和下面三个玩法按钮分开 */
              <form className="sc-auth" onSubmit={submit}>
                <label className="sc-field">
                  <span>账号名</span>
                  <input
                    type="text"
                    value={authName}
                    placeholder="2-12 个字符，同学间认得出来就行"
                    maxLength={12}
                    autoComplete="username"
                    onChange={(e) => setAuthName(e.target.value)}
                  />
                </label>
                <div className="sc-row">
                  <label className="sc-field inline">
                    <span>密码{tab === 'register' ? '（至少 4 位）' : ''}</span>
                    <input
                      type="password"
                      value={password}
                      placeholder="••••••"
                      maxLength={64}
                      autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  {tab === 'register' && (
                    <label className="sc-field inline">
                      <span>再输一遍</span>
                      <input
                        type="password"
                        value={confirm}
                        placeholder="••••••"
                        maxLength={64}
                        autoComplete="new-password"
                        onChange={(e) => setConfirm(e.target.value)}
                      />
                    </label>
                  )}
                </div>
                {error && <p className="sc-auth-err">{error}</p>}
                <button className="sc-btn primary" type="submit" disabled={busy || !connected}>
                  {busy ? '处理中…' : tab === 'login' ? '登录' : '注册并登录'}
                </button>
                <p className="sc-note">
                  {tab === 'login'
                    ? '登录后换电脑、换浏览器都能回到原来的房间和进度。'
                    : '只存在这台服务器上，密码是哈希，别用你在别处的真密码。'}
                </p>
              </form>
            )}
          </>
        )}

        {loggedIn && (
          <p className="sc-note">这个账号的席位跟着你走：刷新、断网、换设备都能回到原来的房间。</p>
        )}

        {/* 说明小字放在按钮下面单独一行：塞在按钮里会把主标题挤得偏左，
            按钮看着不居中。挪出来后按钮只剩一行居中的标题。 */}
        <div className="sc-divider"><span>开始玩</span></div>
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
