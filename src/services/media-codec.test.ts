import { expect, it } from 'vitest'
import { describeInline, verifyMediaBytes } from './media-codec'
import { decodeValidatedMedia, validMedia } from '../media-validation'

const wav = Buffer.from(
  'UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==',
  'base64',
)
it('preserves codec-bearing MIME, exact bytes and verification while rejecting changed bytes/type', async () => {
  const value = `data:audio/wav; codecs="pcm";base64,${wav.toString('base64')}`
  const prepared = await describeInline(value, 'voice')
  expect(prepared.ref.mimeType).toBe('audio/wav; codecs="pcm"')
  expect(new Uint8Array(await prepared.bytes.arrayBuffer())).toEqual(new Uint8Array(wav))
  await expect(verifyMediaBytes(prepared.ref, prepared.bytes)).resolves.toBeUndefined()
  const changed = Buffer.from(wav)
  changed[45] ^= 1
  await expect(
    verifyMediaBytes(prepared.ref, new Blob([changed], { type: prepared.bytes.type })),
  ).rejects.toMatchObject({ detail: { code: 'MEDIA_INVALID' } })
  await expect(
    verifyMediaBytes(prepared.ref, new Blob([wav], { type: 'image/png' })),
  ).rejects.toMatchObject({ detail: { code: 'MEDIA_INVALID' } })
  for (const invalid of [
    value.slice(0, -2),
    value + '=',
    value.replace('base64,', 'base64,!'),
    value.replace('audio/wav', 'image/png'),
  ]) {
    expect(validMedia(invalid, 'voice')).toBe(false)
    await expect(describeInline(invalid, 'voice')).rejects.toMatchObject({
      detail: { code: 'MEDIA_INVALID' },
    })
  }
})
it('decodes the maximum voice container without changing size, content, or over-limit rejection', async () => {
  const bytes = Buffer.alloc(8 * 1024 * 1024, 37)
  bytes.set(wav)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.writeUInt32LE(bytes.length - 44, 40)
  const value = `data:audio/wav;base64,${bytes.toString('base64')}`
  const decoded = decodeValidatedMedia(value, 'voice')
  expect(decoded?.bytes.byteLength).toBe(bytes.length)
  expect(Buffer.compare(Buffer.from(decoded!.bytes), bytes)).toBe(0)
  expect(
    decodeValidatedMedia(
      `data:audio/wav;base64,${Buffer.concat([bytes, Buffer.alloc(2)]).toString('base64')}`,
      'voice',
    ),
  ).toBeNull()
})
