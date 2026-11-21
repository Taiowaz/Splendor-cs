import test from 'node:test'
import assert from 'node:assert/strict'
import { getApiUrl, getWebSocketUrl, resolveEndpoints } from './endpoints.js'

const page = 'https://game.example'

test('blank public configuration uses same-origin API and /ws', () => {
  const endpoints = resolveEndpoints({ VITE_API_BASE_URL: ' ', VITE_WS_URL: '' }, page)
  assert.equal(endpoints.apiUrl('/api/login'), '/api/login')
  assert.equal(endpoints.apiUrl('/api/register'), '/api/register')
  assert.equal(endpoints.wsUrl, 'wss://game.example/ws')
})

test('local defaults match the Vite /api and /ws proxies', () => {
  const endpoints = resolveEndpoints({}, 'http://localhost:5173')
  assert.equal(endpoints.apiUrl('/api/login'), '/api/login')
  assert.equal(endpoints.wsUrl, 'ws://localhost:5173/ws')
})

test('browser helpers work without Vite globals', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: page } })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'location', previous)
    else delete globalThis.location
  })
  assert.equal(getApiUrl('/api/login'), '/api/login')
  assert.equal(getWebSocketUrl(), 'wss://game.example/ws')
})

test('API origin is normalized and supplies the default WebSocket origin', () => {
  const endpoints = resolveEndpoints({ VITE_API_BASE_URL: ' https://API.example:443/ ' }, page)
  assert.equal(endpoints.apiUrl('/api/login'), 'https://api.example/api/login')
  assert.equal(endpoints.wsUrl, 'wss://api.example/ws')
})

test('explicit secure WebSocket URL can use a separate host, port and path', () => {
  const endpoints = resolveEndpoints({
    VITE_API_BASE_URL: 'https://api.example:8443',
    VITE_WS_URL: ' wss://socket.example:9443/game/ws?version=1 '
  }, page)
  assert.equal(endpoints.apiUrl('/api/register'), 'https://api.example:8443/api/register')
  assert.equal(endpoints.wsUrl, 'wss://socket.example:9443/game/ws?version=1')
})

test('WebSocket override leaves same-origin API unchanged', () => {
  const endpoints = resolveEndpoints({ VITE_WS_URL: 'wss://socket.example/ws' }, page)
  assert.equal(endpoints.apiUrl('/api/login'), '/api/login')
  assert.equal(endpoints.wsUrl, 'wss://socket.example/ws')
})

for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '[::1]']) {
  test(`local HTTP API supports ${host}`, () => {
    const endpoints = resolveEndpoints({ VITE_API_BASE_URL: `http://${host}:8787` }, 'http://localhost:5173')
    assert.equal(endpoints.apiUrl('/api/login'), `http://${host}:8787/api/login`)
    assert.equal(endpoints.wsUrl, `ws://${host}:8787/ws`)
  })
}

test('local WebSocket override supports Cloudflare development', () => {
  const endpoints = resolveEndpoints({ VITE_WS_URL: 'ws://127.0.0.1:8787/ws' }, 'http://localhost:5173')
  assert.equal(endpoints.wsUrl, 'ws://127.0.0.1:8787/ws')
})

for (const value of [
  'https://api.example/api',
  'https://api.example//',
  'https://api.example/path/..',
  'https://api.example/%2e',
  'https://api.example?version=1',
  'https://api.example?',
  'https://api.example/#fragment',
  'https://api.example#',
  'https://user:secret@api.example',
  'https://@api.example',
  'http://api.example',
  'http://localhost.example:8787',
  'http://192.168.1.10:8787',
  'ws://api.example',
  'ftp://api.example',
  'javascript:alert(1)',
  '//api.example',
  'https:api.example',
  'not-a-url',
  'https://api.example:99999',
  'https://api.\nexample',
  'https://api.example\\'
]) {
  test(`rejects invalid API origin ${JSON.stringify(value)}`, () => {
    assert.throws(() => resolveEndpoints({ VITE_API_BASE_URL: value }, 'http://localhost:5173'), /VITE_API_BASE_URL/)
  })
}

for (const value of [
  'https://socket.example/ws',
  'http://socket.example/ws',
  'ftp://socket.example/ws',
  '//socket.example/ws',
  '/ws',
  'wss:socket.example/ws',
  'wss://user:secret@socket.example/ws',
  'wss://@socket.example/ws',
  'wss://socket.example/ws#fragment',
  'wss://socket.example/ws#',
  'wss://socket.example\\ws',
  'wss://socket.\nexample/ws'
]) {
  test(`rejects invalid WebSocket URL ${JSON.stringify(value)}`, () => {
    assert.throws(() => resolveEndpoints({ VITE_WS_URL: value }, page), /VITE_WS_URL/)
  })
}

test('HTTPS pages reject plaintext WebSockets including localhost', () => {
  for (const wsUrl of ['ws://socket.example/ws', 'ws://localhost:8787/ws']) {
    assert.throws(() => resolveEndpoints({ VITE_WS_URL: wsUrl }, page), /HTTPS/)
  }
})

test('HTTPS pages also reject plaintext API requests to localhost', () => {
  assert.throws(() => resolveEndpoints({ VITE_API_BASE_URL: 'http://127.0.0.1:8787' }, page), /HTTPS/)
})

test('configuration can be resolved without a browser when an API origin is supplied', () => {
  assert.equal(resolveEndpoints({ VITE_API_BASE_URL: 'https://api.example' }).wsUrl, 'wss://api.example/ws')
  assert.throws(() => resolveEndpoints({}), /origin/)
})

test('API helper does not accept cross-origin or ambiguous paths', () => {
  const endpoints = resolveEndpoints({}, page)
  for (const path of ['//other.example/api/login', 'https://other.example/api/login', 'api/login', '/\\other.example', '/api/\nlogin', '/api/login#fragment', null]) {
    assert.throws(() => endpoints.apiUrl(path), /API/)
  }
})
