import type { MediaRef } from './generated/domain/contracts.ts'
import { sha256Bytes } from './generated/domain/canonical-json.ts'
import { validMediaBytes } from './generated/media-validation.ts'
import { DomainError } from './generated/domain/errors.ts'

export async function readMedia(
  request: Request,
  expected: MediaRef,
  timeoutMs = 60_000,
): Promise<Uint8Array> {
  const declared = request.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) !== expected.bytes))
    throw new DomainError('MEDIA_INVALID')
  if (!request.body) throw new DomainError('MEDIA_INVALID')
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = []
  let count = 0,
    timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    void reader.cancel()
  }, timeoutMs)
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (timedOut) throw new DomainError('SERVICE_UNAVAILABLE')
      if (done) break
      count += value.length
      if (count > expected.bytes) {
        await reader.cancel()
        throw new DomainError('MEDIA_INVALID')
      }
      chunks.push(value)
    }
    if (count !== expected.bytes) throw new DomainError('MEDIA_INVALID')
    const bytes = new Uint8Array(count)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    await verifyMedia(bytes, expected)
    return bytes
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}
export async function verifyMedia(bytes: Uint8Array, expected: MediaRef): Promise<void> {
  if (bytes.length !== expected.bytes || (await sha256Bytes(bytes)) !== expected.sha256)
    throw new DomainError('MEDIA_INVALID')
  // Reuse complete-container checks directly; no base64 expansion or second byte copy.
  // This preserves portable compatibility without claiming a full codec decode.
  if (!validMediaBytes(bytes, expected.mimeType, expected.kind))
    throw new DomainError('MEDIA_INVALID')
}
