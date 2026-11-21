import test from 'node:test'
import assert from 'node:assert/strict'

for (const [label, backend, apiTarget, wsTarget] of [
  ['default Node backend', undefined, 'http://localhost:3000', 'ws://localhost:3000'],
  ['blank override', '', 'http://localhost:3000', 'ws://localhost:3000'],
  ['local Cloudflare backend', 'http://127.0.0.1:8787', 'http://127.0.0.1:8787', 'ws://127.0.0.1:8787']
]) {
  test(`Vite proxies use ${label}`, async t => {
    const previous = process.env.DEV_BACKEND_URL
    if (backend === undefined) delete process.env.DEV_BACKEND_URL
    else process.env.DEV_BACKEND_URL = backend
    t.after(() => {
      if (previous === undefined) delete process.env.DEV_BACKEND_URL
      else process.env.DEV_BACKEND_URL = previous
    })
    const { default: config } = await import(`./vite.config.js?test=${encodeURIComponent(label)}`)
    assert.equal(config.server.proxy['/api'], apiTarget)
    assert.equal(config.server.proxy['/ws'].target, wsTarget)
    assert.equal(config.server.proxy['/ws'].ws, true)
  })
}
