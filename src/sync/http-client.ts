import { z } from 'zod'
import { originSchema, isPublicAuthKey } from '../config'
import { DomainError, ConflictError, type ErrorCode } from '../domain/errors'
import { errorHelp } from '../help/errors'
import { baseSchema, id, projectRecordSchema, checkpointRecordSchema } from '../domain/schema'
export type FunctionName =
  | 'account-session'
  | 'sync-push'
  | 'sync-pull'
  | 'sync-snapshot'
  | 'media-upload'
  | 'media-download'
  | 'media-finalize'
  | 'collection-attach'
  | 'collection-replace'
  | 'account-delete'
  | 'deletion-status'
  | 'billing-config'
  | 'checkout'
  | 'purchase-restore'
  | 'purchase-recovery'
const conflictSchema = z
  .object({
    operationId: id,
    current: z.union([projectRecordSchema, checkpointRecordSchema, z.null()]),
    expected: baseSchema.nullable(),
  })
  .strict()
export interface FunctionClient {
  post(
    name: FunctionName,
    body: unknown,
    signal: AbortSignal,
    options?: { maxBytes?: number; anonymous?: boolean },
  ): Promise<unknown>
}
export async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new DomainError('SYNC_PAGE_INVALID')
  const reader = response.body?.getReader()
  if (!reader) throw new DomainError('SYNC_PAGE_INVALID')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new DomainError('SYNC_PAGE_INVALID')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
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
    throw new DomainError('SYNC_PAGE_INVALID')
  }
}
export function responseError(
  status: number,
  body: unknown,
  retryAfter: string | null = null,
): DomainError {
  const safe = typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined
  const code =
    typeof safe === 'object' &&
    safe !== null &&
    'code' in safe &&
    typeof safe.code === 'string' &&
    Object.hasOwn(errorHelp, safe.code)
      ? (safe.code as ErrorCode)
      : status === 401 || status === 403
        ? 'AUTH_REQUIRED'
        : status === 429
          ? 'RATE_LIMITED'
          : status === 413
            ? 'TECHNICAL_CAPACITY_REACHED'
            : status >= 500
              ? 'SERVICE_UNAVAILABLE'
              : 'VALIDATION'
  if (
    code === 'REVISION_CONFLICT' &&
    typeof body === 'object' &&
    body !== null &&
    'conflict' in body
  ) {
    const parsed = conflictSchema.safeParse(body.conflict)
    if (parsed.success) return new ConflictError(parsed.data)
  }
  const seconds = retryAfter ? Number(retryAfter) : NaN
  const retryAfterMs = Number.isFinite(seconds)
    ? seconds * 1000
    : retryAfter
      ? Date.parse(retryAfter) - Date.now()
      : undefined
  return new DomainError(code, {
    ...(retryAfterMs !== undefined && Number.isFinite(retryAfterMs) ? { retryAfterMs } : {}),
  })
}
export function createFunctionClient(options: {
  url: string
  publicKey: string
  token: () => Promise<string | null>
  fetch?: typeof fetch
}): FunctionClient {
  const origin = originSchema.parse(options.url)
  if (!isPublicAuthKey(options.publicKey)) throw new DomainError('CONFIG_INVALID')
  const request = options.fetch ?? fetch
  return {
    async post(name, body, signal, settings = {}) {
      signal.throwIfAborted()
      const token = settings.anonymous ? null : await options.token()
      signal.throwIfAborted()
      if (!settings.anonymous && !token) throw new DomainError('AUTH_REQUIRED')
      let response: Response
      try {
        response = await request(`${origin}/functions/v1/${name}`, {
          method: 'POST',
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          signal,
          headers: {
            'content-type': 'application/json',
            apikey: options.publicKey,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        })
      } catch (error) {
        if (signal.aborted) throw error
        throw new DomainError('OFFLINE')
      }
      const parsed = await boundedJson(response, settings.maxBytes ?? 512 * 1024)
      if (!response.ok)
        throw responseError(response.status, parsed, response.headers.get('retry-after'))
      return parsed
    },
  }
}
