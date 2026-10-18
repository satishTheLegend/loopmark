import { DomainError } from './generated/domain/errors.ts'
export async function boundedJson(
  request: Pick<Request, 'headers' | 'body'>,
  maximum = 256 * 1024,
): Promise<unknown> {
  if (
    !request.headers
      .get('content-type')
      ?.split(';')[0]
      .trim()
      .match(/^application\/json$/i)
  )
    throw new DomainError('VALIDATION')
  const declared = request.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum))
    throw new DomainError('VALIDATION')
  if (!request.body) throw new DomainError('VALIDATION')
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = []
  let size = 0,
    timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    void reader.cancel()
  }, 10_000)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (timedOut) throw new DomainError('SERVICE_UNAVAILABLE')
      if (done) break
      size += value.byteLength
      if (size > maximum) {
        await reader.cancel()
        throw new DomainError('VALIDATION')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      throw new DomainError('VALIDATION')
    }
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}
