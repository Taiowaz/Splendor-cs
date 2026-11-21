import { useState, useEffect, useRef, useCallback } from 'react'
import { loadToken, NAME_KEY } from '../session.js'
import { getWebSocketUrl } from '../endpoints.js'

export default function useWebSocket() {
  const [connected, setConnected] = useState(false)
  const [elsewhere, setElsewhere] = useState(false)
  const [connectionError, setConnectionError] = useState(null)
  const queueRef = useRef([])
  const [msgVersion, setMsgVersion] = useState(0)
  const wsRef = useRef(null)
  const readyRef = useRef(false)
  const activeRef = useRef(false)
  const reconnectTimeoutRef = useRef(null)
  const pausedRef = useRef(false)

  const closeSocket = useCallback(() => {
    const ws = wsRef.current
    wsRef.current = null
    readyRef.current = false
    if (ws) {
      ws.onopen = null
      ws.onclose = null
      ws.onmessage = null
      ws.onerror = null
      ws.close()
    }
  }, [])

  const connect = useCallback(() => {
    if (!activeRef.current || pausedRef.current) return
    clearTimeout(reconnectTimeoutRef.current)
    reconnectTimeoutRef.current = null
    closeSocket()
    setConnected(false)
    setConnectionError(null)

    let ws
    try {
      ws = new WebSocket(getWebSocketUrl())
    } catch (err) {
      pausedRef.current = true
      setConnectionError(err.message || '无法建立连接，请检查服务器地址配置')
      return
    }
    wsRef.current = ws
    let lastError = ''
    const isCurrent = () => activeRef.current && wsRef.current === ws

    ws.onopen = () => {
      if (!isCurrent() || pausedRef.current) return
      ws.send(JSON.stringify({
        type: 'hello',
        token: loadToken(),
        name: localStorage.getItem(NAME_KEY) || ''
      }))
    }

    ws.onclose = (event) => {
      if (!isCurrent()) return
      wsRef.current = null
      readyRef.current = false
      setConnected(false)
      if (pausedRef.current) return
      if (event.code === 1008) {
        pausedRef.current = true
        setConnectionError(lastError || event.reason || '身份已过期或连接被拒绝，请重新连接后登录')
        return
      }
      const timeout = setTimeout(() => {
        if (reconnectTimeoutRef.current !== timeout) return
        reconnectTimeoutRef.current = null
        connect()
      }, 3000)
      reconnectTimeoutRef.current = timeout
    }

    ws.onerror = (err) => {
      if (isCurrent()) console.error('WebSocket error:', err)
    }

    ws.onmessage = (event) => {
      if (!isCurrent() || pausedRef.current) return
      let message
      try {
        message = JSON.parse(event.data)
      } catch (err) {
        console.error('Failed to parse message:', err)
        return
      }
      if (!message || typeof message.type !== 'string') return
      if (message.type === 'session_elsewhere') {
        pausedRef.current = true
        setConnected(false)
        setElsewhere(true)
        queueRef.current = []
        closeSocket()
        return
      }
      if (message.type === 'auth_expired' || (message.type === 'error' && message.code === 'auth_expired')) {
        pausedRef.current = true
        setConnected(false)
        setConnectionError(message.message || '身份已过期，请重新连接后登录')
        queueRef.current = []
        closeSocket()
        return
      }
      if (message.type === 'error') lastError = message.message || ''
      if (message.type === 'welcome') {
        readyRef.current = true
        lastError = ''
        setConnected(true)
        setElsewhere(false)
        setConnectionError(null)
      }
      queueRef.current.push(message)
      setMsgVersion(v => v + 1)
    }
  }, [closeSocket])

  useEffect(() => {
    activeRef.current = true
    pausedRef.current = false
    connect()
    return () => {
      activeRef.current = false
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
      queueRef.current = []
      closeSocket()
    }
  }, [connect, closeSocket])

  const sendMessage = useCallback((message) => {
    const ws = wsRef.current
    if (!activeRef.current || pausedRef.current || !readyRef.current || ws?.readyState !== WebSocket.OPEN) {
      return false
    }
    ws.send(JSON.stringify(message))
    return true
  }, [])

  const drainMessages = useCallback(() => {
    const batch = queueRef.current
    queueRef.current = []
    return batch
  }, [])

  const reconnectNow = useCallback(() => {
    if (!activeRef.current) return
    pausedRef.current = false
    setElsewhere(false)
    queueRef.current = []
    connect()
  }, [connect])

  return { connected, sendMessage, drainMessages, msgVersion, elsewhere, connectionError, reconnectNow }
}
