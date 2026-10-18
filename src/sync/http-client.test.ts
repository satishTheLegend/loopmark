import { expect, it, vi } from 'vitest'
import { boundedJson, createFunctionClient, responseError } from './http-client'
import { createSyncTransport } from './transport'
import { receipt } from '../repositories/browser/fixtures.test-support'
it('limits streamed JSON independently of untrusted content-length and cancels the reader', async () => {
  let cancelled = false
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('x'.repeat(100)))
    },
    cancel() {
      cancelled = true
    },
  })
  await expect(
    boundedJson(new Response(body, { headers: { 'content-length': '1' } }), 10),
  ).rejects.toMatchObject({ detail: { code: 'SYNC_PAGE_INVALID' } })
  expect(cancelled).toBe(true)
})
it('uses scoped bearer authentication, no cookies/cache/redirects and redacts provider errors', async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', problem: 'secret' } }), {
        status: 429,
        headers: { 'retry-after': '7' },
      }),
  )
  const client = createFunctionClient({
    url: 'http://127.0.0.1:56621',
    publicKey: 'sb_publishable_1234567890abcdef',
    token: async () => 'secret',
    fetch: fetcher,
  })
  await expect(client.post('sync-pull', {}, new AbortController().signal)).rejects.toMatchObject({
    detail: { code: 'RATE_LIMITED', retryAfterMs: 7000 },
  })
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    headers: { authorization: 'Bearer secret' },
  })
  expect(
    responseError(503, { error: { code: 'unknown', problem: 'secret' } }).message,
  ).not.toContain('secret')
})
it('refuses wrong-scope pull pages before any repository mutation', async () => {
  const transport = createSyncTransport({
    post: async () => ({
      protocolVersion: 2,
      collectionId: 'other',
      epoch: 'epoch',
      afterCursor: '0',
      nextCursor: '1',
      hasMore: false,
      entries: [receipt('op', '1'.repeat(64))],
    }),
  })
  await expect(
    transport.pull(
      {
        collectionId: 'collection',
        epoch: 'epoch',
        afterCursor: '0',
        deviceId: 'device',
        deviceGeneration: 'gen',
      },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ detail: { code: 'SYNC_PAGE_INVALID' } })
})
