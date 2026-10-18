import { expect, it } from 'vitest'
import { validMedia, validMediaBytes } from './media-validation'

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQmcAAAAASUVORK5CYII=',
    'base64',
  ),
)
const wav = Uint8Array.from(
  Buffer.from('UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==', 'base64'),
)
it('validates raw container bytes with the same type, codec and truncation rules as portable media', () => {
  for (const [bytes, mime, kind] of [
    [png, 'image/png', 'photo'],
    [wav, 'audio/wav; codecs="pcm"', 'voice'],
  ] as const) {
    const portable = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
    expect(validMedia(portable, kind)).toBe(true)
    expect(validMediaBytes(bytes, mime, kind)).toBe(true)
    expect(validMediaBytes(bytes.subarray(0, -2), mime, kind)).toBe(false)
    expect(validMediaBytes(bytes, mime, kind === 'photo' ? 'voice' : 'photo')).toBe(false)
    expect(validMediaBytes(bytes, `${mime};arbitrary=value`, kind)).toBe(false)
  }
  expect(validMediaBytes(wav, 'audio/webm', 'voice')).toBe(false)
  expect(validMediaBytes(new Uint8Array(), 'image/png', 'photo')).toBe(false)
})
it('accepts a complete 8 MiB WAV and rejects an over-limit raw container', () => {
  const bytes = Buffer.alloc(8 * 1024 * 1024)
  bytes.set(wav)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.writeUInt32LE(bytes.length - 44, 40)
  expect(validMediaBytes(bytes, 'audio/wav', 'voice')).toBe(true)
  expect(validMediaBytes(Buffer.concat([bytes, Buffer.alloc(2)]), 'audio/wav', 'voice')).toBe(false)
})
