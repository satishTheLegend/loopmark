import { DomainError } from './generated/domain/errors.ts'
export async function rawBody(request: Request, maximum = 256 * 1024) {
  if (
    !request.body ||
    request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json'
  )
    throw new DomainError('VALIDATION')
  const declared = request.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum))
    throw new DomainError('VALIDATION')
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = []
  let size = 0,
    expired = false
  const timeout = setTimeout(() => {
    expired = true
    void reader.cancel()
  }, 10_000)
  try {
    while (true) {
      const next = await reader.read()
      if (expired) throw new DomainError('SERVICE_UNAVAILABLE')
      if (next.done) break
      size += next.value.byteLength
      if (size > maximum) {
        await reader.cancel()
        throw new DomainError('VALIDATION')
      }
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally {
    clearTimeout(timeout)
    reader.releaseLock()
  }
}
