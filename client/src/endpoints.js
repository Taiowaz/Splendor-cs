function parseUrl(value, name, protocols) {
  if (/[\s\\]/.test(value) || !/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    throw new Error(`${name} 必须是完整 URL`)
  }
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} 不是有效 URL`)
  }
  if (!protocols.includes(url.protocol)) {
    throw new Error(`${name} 不支持此协议`)
  }
  if (url.username || url.password || value.split('/')[2].includes('@')) {
    throw new Error(`${name} 不能包含用户名或密码`)
  }
  return url
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

export function resolveEndpoints(env = import.meta.env ?? {}, pageOrigin = globalThis.location?.origin) {
  const apiConfig = (env.VITE_API_BASE_URL || '').trim()
  const wsConfig = (env.VITE_WS_URL || '').trim()
  const page = pageOrigin ? parseUrl(pageOrigin, '页面地址', ['http:', 'https:']) : null
  let apiBaseUrl = ''

  if (apiConfig) {
    const api = parseUrl(apiConfig, 'VITE_API_BASE_URL', ['http:', 'https:'])
    if (!/^https?:\/\/[^/?#]+\/?$/i.test(apiConfig)) {
      throw new Error('VITE_API_BASE_URL 只能包含 origin，不能包含路径、查询参数或片段')
    }
    if (api.protocol === 'http:' && (!isLoopback(api.hostname) || page?.protocol === 'https:')) {
      throw new Error('VITE_API_BASE_URL 必须使用 HTTPS，HTTP 仅限本地 HTTP 页面开发')
    }
    apiBaseUrl = api.origin
  }

  let ws
  if (wsConfig) {
    ws = parseUrl(wsConfig, 'VITE_WS_URL', ['ws:', 'wss:'])
    if (wsConfig.includes('#')) throw new Error('VITE_WS_URL 不能包含片段')
  } else {
    const origin = apiBaseUrl || page?.origin
    if (!origin) throw new Error('缺少 API origin 或页面地址，无法确定 WebSocket 地址')
    ws = new URL('/ws', origin)
    ws.protocol = ws.protocol === 'https:' ? 'wss:' : 'ws:'
  }
  if (page?.protocol === 'https:' && ws.protocol !== 'wss:') {
    throw new Error('HTTPS 页面必须使用安全的 wss:// WebSocket 地址')
  }

  return {
    apiUrl(path) {
      if (typeof path !== 'string' || !/^\/(?!\/)/.test(path) || /[\s\\#]/.test(path)) {
        throw new Error('API 路径必须是站内绝对路径')
      }
      return `${apiBaseUrl}${path}`
    },
    wsUrl: ws.href
  }
}

export const getApiUrl = path => resolveEndpoints().apiUrl(path)
export const getWebSocketUrl = () => resolveEndpoints().wsUrl
