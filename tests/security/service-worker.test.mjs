import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile('dist/sw.js', 'utf8')
function worker() {
  const handlers = {},
    matches = [],
    fetched = []
  runInNewContext(source, {
    URL,
    location: { origin: 'https://loopmark.example.test' },
    self: {
      addEventListener: (name, callback) => {
        handlers[name] = callback
      },
    },
    fetch: async (request) => {
      fetched.push(request.url)
      throw new Error('offline fixture')
    },
    caches: {
      match: async (key) => {
        matches.push(key)
        return 'static shell'
      },
    },
  })
  return { handlers, matches, fetched }
}
test('built worker never intercepts private API, auth, upload or foreign-origin requests', () => {
  const { handlers } = worker()
  for (const path of [
    '/api/private',
    '/auth/callback?code=synthetic',
    '/rest/v1/projects',
    '/storage/v1/object/private',
    '/functions/v1/checkout',
  ]) {
    let intercepted = false
    handlers.fetch({
      request: { url: `https://loopmark.example.test${path}`, method: 'GET', mode: 'navigate' },
      respondWith() {
        intercepted = true
      },
    })
    assert.equal(intercepted, false, path)
  }
  for (const request of [
    { url: 'https://backend.example.test/functions/v1/sync', method: 'GET' },
    { url: 'https://loopmark.example.test/projects', method: 'POST' },
  ])
    handlers.fetch({
      request,
      respondWith() {
        assert.fail('Private request intercepted')
      },
    })
})
test('offline payment return uses only the static shell and never caches the return URL', async () => {
  const { handlers, matches } = worker()
  let response
  handlers.fetch({
    request: {
      url: 'https://loopmark.example.test/purchase/return?razorpay_signature=synthetic',
      method: 'GET',
      mode: 'navigate',
    },
    respondWith(value) {
      response = value
    },
  })
  assert.equal(await response, 'static shell')
  assert.deepEqual(matches, ['/index.html'])
})
test('built precache contains no test harness, provider callback or private route', () => {
  const assets = JSON.parse(source.match(/const ASSETS=(\[[^\n]+\]);/)[1])
  assert.ok(assets.includes('/index.html'))
  assert.ok(assets.length > 10)
  assert.equal(
    assets.some((path) => /(?:^\/(?:tests|auth|api|functions|storage|purchase)\/|\?)/.test(path)),
    false,
  )
})
