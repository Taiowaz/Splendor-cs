import { useState, useEffect, useRef, useCallback } from 'react'
import { loadToken, NAME_KEY } from '../session.js'

export default function useWebSocket() {
  const [connected, setConnected] = useState(false)
  // 同账号在别的标签页/设备上线时服务端会把这条连接请下去：停自动重连，
  // 盖一层「已在别处上线」的遮罩，等用户点「在此页继续」再抢回来
  const [elsewhere, setElsewhere] = useState(false)
  // 消息走 ref 队列 + 计数器，不用单个 lastMessage 状态槽：握手时服务端一口气连发
  // welcome / session_restored / room_update / player_online，React 会把这几次
  // setState 合成一次渲染，状态槽被最后一条覆盖，中间那条就永远没人处理
  //（刷新回房正是死在 session_restored 被 room_update 盖掉上）。
  const queueRef = useRef([])
  const [msgVersion, setMsgVersion] = useState(0)
  const wsRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const pausedRef = useRef(false)

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsUrl = `${protocol}//${host}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('WebSocket connected')
      setConnected(true)
      // 一连上就报身份：有 token 验 token（刷新回房靠这条），没有就领游客 token
      ws.send(JSON.stringify({
        type: 'hello',
        token: loadToken(),
        name: localStorage.getItem(NAME_KEY) || ''
      }))
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
      setConnected(false)
      // 被顶掉的旧连接、或已被替换的连接不再排重连，避免两条连接抢同一个席位
      if (pausedRef.current || wsRef.current !== ws) return
      reconnectTimeoutRef.current = setTimeout(connect, 3000)
    }

    ws.onerror = (err) => {
      console.error('WebSocket error:', err)
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'session_elsewhere') {
          pausedRef.current = true
          setElsewhere(true)
          ws.close()
          return
        }
        if (message.type === 'welcome') setElsewhere(false)
        queueRef.current.push(message)
        setMsgVersion(v => v + 1)
      } catch (err) {
        console.error('Failed to parse message:', err)
      }
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connect])

  const sendMessage = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  // 取走这一批消息，取完即清空：同一条不会被处理两次，也不再需要去重 ref
  const drainMessages = useCallback(() => {
    const batch = queueRef.current
    queueRef.current = []
    return batch
  }, [])

  // 登录/注册/退出/「在此页继续」换了身份，立刻重连报新 token，不等 3 秒自动重连
  const reconnectNow = useCallback(() => {
    pausedRef.current = false
    setElsewhere(false)
    // 旧身份攒下还没处理的消息一并丢掉，别拿上一个身份的席位往新身份上套
    queueRef.current = []
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
    const old = wsRef.current
    wsRef.current = null
    if (old) old.close()
    connect()
  }, [connect])

  return { connected, sendMessage, drainMessages, msgVersion, elsewhere, reconnectNow }
}
