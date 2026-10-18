import { z } from 'zod'
import { originSchema, isPublicAuthKey } from '../config'
import { DomainError, ConflictError, type ErrorCode } from '../domain/errors'
import { errorHelp } from '../help/errors'
import { baseSchema, id, projectRecordSchema, checkpointRecordSchema } from '../domain/schema'
export type FunctionName =
  | 'account-session'
  | 'account-usage'
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
export interface AuthenticatedRequestOptions {
  url: string
  publicKey: string
  token: () => Promise<string | null>
  fetch?: typeof fetch
}
export function createAuthenticatedRequest(options: AuthenticatedRequestOptions) {
  const origin = originSchema.parse(options.url)
  if (!isPublicAuthKey(options.publicKey)) throw new DomainError('CONFIG_INVALID')
  const request = options.fetch ?? fetch
  return async (
    name: FunctionName,
    body: BodyInit,
    signal: AbortSignal,
    settings: {
      anonymous?: boolean
      contentType?: string
      headers?: Record<string, string>
    } = {},
  ): Promise<Response> => {
    signal.throwIfAborted()
    const token = settings.anonymous
      ? null
      : await new Promise<string | null>((resolve, reject) => {
          const aborted = () => reject(signal.reason)
          signal.addEventListener('abort', aborted, { once: true })
          options
            .token()
            .then(resolve, reject)
            .finally(() => signal.removeEventListener('abort', aborted))
        })
    signal.throwIfAborted()
    if (!settings.anonymous && !token) throw new DomainError('AUTH_REQUIRED')
    try {
      return await request(`${origin}/functions/v1/${name}`, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal,
        headers: {
          ...settings.headers,
          'content-type': settings.contentType ?? 'application/json',
          apikey: options.publicKey,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body,
      })
    } catch (error) {
      if (signal.aborted) throw error
      throw new DomainError('OFFLINE')
    }
  }
}
export async function withRequestDeadline<T>(
  signal: AbortSignal,
  milliseconds: number,
  work: (bounded: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController(),
    bounded = AbortSignal.any([signal, controller.signal])
  const timer = setTimeout(
    () => controller.abort(new DomainError('SERVICE_UNAVAILABLE')),
    milliseconds,
  )
  try {
    return await work(bounded)
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (controller.signal.aborted) throw new DomainError('SERVICE_UNAVAILABLE')
    throw error
  } finally {
    clearTimeout(timer)
  }
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
export function createFunctionClient(options: AuthenticatedRequestOptions): FunctionClient {
  const request = createAuthenticatedRequest(options)
  return {
    async post(name, body, signal, settings = {}) {
      return withRequestDeadline(signal, 15000, async (bounded) => {
        const response = await request(name, JSON.stringify(body), bounded, settings)
        if (!response.ok) {
          const parsed = await boundedJson(response, 512 * 1024).catch(() => null)
          bounded.throwIfAborted()
          throw responseError(response.status, parsed, response.headers.get('retry-after'))
        }
        return boundedJson(response, settings.maxBytes ?? 512 * 1024)
      })
    },
  }
}
