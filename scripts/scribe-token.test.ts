import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { scribeToken } from '../server/scribe-token.ts'

for (const scenario of ['missing key', 'method', 'success', 'rejected', 'network', 'malformed'] as const) {
  test(`speech token endpoint: ${scenario}`, async (t) => {
    const originalFetch = globalThis.fetch
    let upstreamCalls = 0
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
      upstreamCalls++
      assert.equal(new Headers(options.headers).get('xi-api-key'), 'test-server-key')
      if (scenario === 'network') throw new Error('test-server-key')
      if (scenario === 'rejected') return Response.json({ detail: 'test-server-key' }, { status: 401 })
      return Response.json(scenario === 'malformed' ? { token: {} } : { token: 'test-single-use-token' })
    })
    const server = createServer((req, res) => void scribeToken(req, res, scenario === 'missing key' ? '' : 'test-server-key'))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(() => server.close())
    const address = server.address() as { port: number }
    const response = await originalFetch(`http://127.0.0.1:${address.port}`, { method: scenario === 'method' ? 'GET' : 'POST' })
    const text = await response.text()
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.ok(!text.includes('test-server-key'))
    const expected = scenario === 'missing key' ? 503 : scenario === 'method' ? 405 : scenario === 'success' ? 200 : 502
    assert.equal(response.status, expected)
    assert.equal(upstreamCalls, scenario === 'missing key' || scenario === 'method' ? 0 : 1)
    if (scenario === 'success') assert.equal(JSON.parse(text).token, 'test-single-use-token')
  })
}
