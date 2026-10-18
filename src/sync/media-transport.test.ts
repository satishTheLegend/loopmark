import { expect, it, vi } from 'vitest'
import { describeInline } from '../services/media-codec'
import { png } from '../repositories/browser/fixtures.test-support'
import { createMediaTransport, readMediaResponse } from './media-transport'
it('rejects truncated, oversized and hash-mismatched binary downloads regardless of declared length', async () => {
  const { ref, bytes } = await describeInline(png, 'photo'),
    data = new Uint8Array(await bytes.arrayBuffer())
  for (const body of [data.slice(1), new Uint8Array(ref.bytes + 1), new Uint8Array(ref.bytes)]) {
    await expect(
      readMediaResponse(new Response(body, { headers: { 'content-type': ref.mimeType } }), ref),
    ).rejects.toMatchObject({ detail: { code: 'MEDIA_INVALID' } })
  }
  expect(
    await (
      await readMediaResponse(
        new Response(data, {
          headers: { 'content-type': ref.mimeType, 'content-length': String(ref.bytes) },
        }),
        ref,
      )
    ).arrayBuffer(),
  ).toEqual(await bytes.arrayBuffer())
})
it('uses fixed authenticated binary endpoint, verifies upload proof and denies mismatched reservation descriptors', async () => {
  const { ref, bytes } = await describeInline(png, 'photo')
  const request = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ reservationId: 'reservation', verified: true })),
  )
  const client = {
    post: vi.fn(async () => ({
      id: 'reservation',
      collectionId: 'wrong',
      epoch: 'epoch',
      media: ref,
      expiresAt: '2030-01-01T00:00:00.000Z',
      deletionGeneration: '0',
    })),
  }
  const transport = createMediaTransport({
    url: 'http://127.0.0.1:56621',
    publicKey: 'sb_publishable_1234567890abcdef',
    token: async () => 'token',
    fetch: request,
    client,
  })
  await transport.upload('reservation', ref, bytes, new AbortController().signal)
  expect(request.mock.calls[0]).toMatchObject([
    'http://127.0.0.1:56621/functions/v1/media-upload',
    {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        'x-loopmark-reservation-id': 'reservation',
        'content-type': 'application/octet-stream',
        authorization: 'Bearer token',
      },
    },
  ])
  await expect(
    transport.reserve(
      {
        action: 'reserve',
        requestId: 'request',
        upload: { collectionId: 'collection', epoch: 'epoch', media: ref },
      },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ detail: { code: 'SYNC_PAGE_INVALID' } })
})
