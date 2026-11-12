// 会话身份落在 localStorage：token 是服务端签名的（账号或游客），刷新/重连都带它，
// 席位按 token 里的 id 认，所以刷新不会丢房间。名字单独存一份给输入框回显。
export const TOKEN_KEY = 'mc-session-token'
export const NAME_KEY = 'academic-gems-name'

export const loadToken = () => localStorage.getItem(TOKEN_KEY) || null
export const saveToken = (token) => localStorage.setItem(TOKEN_KEY, token)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)