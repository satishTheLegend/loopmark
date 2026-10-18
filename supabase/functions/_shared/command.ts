import { z } from 'npm:zod@4.6.7'
import { authenticated } from './auth.ts'
import { boundedJson } from './limits.ts'
import { ConflictError, DomainError, safeError } from './generated/domain/errors.ts'
import {
  baseSchema,
  checkpointRecordSchema,
  id,
  projectRecordSchema,
} from './generated/domain/schema.ts'
import { errorHelp } from './generated/help/errors.ts'

const conflictSchema = z
  .object({
    operationId: id,
    current: z.union([projectRecordSchema, checkpointRecordSchema]).nullable(),
    expected: baseSchema.nullable(),
  })
  .strict()
export function databaseError(error: { message: string; details?: string; code?: string }): never {
  if (error.message === 'REVISION_CONFLICT' && error.details) {
    try {
      const conflict = conflictSchema.safeParse(JSON.parse(error.details))
      if (conflict.success) throw new ConflictError(conflict.data)
    } catch (caught) {
      if (caught instanceof ConflictError) throw caught
    }
  }
  if (Object.hasOwn(errorHelp, error.message))
    throw new DomainError(
      error.message as keyof typeof errorHelp,
      error.message === 'RATE_LIMITED' ? { retryAfterMs: 1000 } : {},
    )
  throw new DomainError(error.code === '42501' ? 'NOT_AVAILABLE' : 'SERVICE_UNAVAILABLE')
}
export async function rpc(
  client: Awaited<ReturnType<typeof authenticated>>['client'],
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, args)
  if (error) databaseError(error)
  if (data?.failure) databaseError({ message: data.failure.code, details: data.failure.detail })
  return data
}
export function endpoint(
  action: (body: unknown, identity: Awaited<ReturnType<typeof authenticated>>) => Promise<unknown>,
) {
  return async (request: Request) => {
    const origin = request.headers.get('origin'),
      allowedOrigin = Deno.env.get('LOOPMARK_APP_ORIGIN')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      Vary: 'Origin',
    }
    if (origin && origin === allowedOrigin) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info'
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    }
    if (origin && origin !== allowedOrigin)
      return new Response(JSON.stringify({ error: new DomainError('NOT_AVAILABLE').detail }), {
        status: 403,
        headers,
      })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST')
      return new Response(JSON.stringify({ error: new DomainError('VALIDATION').detail }), {
        status: 405,
        headers,
      })
    try {
      const identity = await authenticated(request)
      const result = await action(await boundedJson(request), identity)
      return new Response(JSON.stringify(result), { status: 200, headers })
    } catch (error) {
      const detail = safeError(error)
      const status =
        detail.code === 'AUTH_REQUIRED'
          ? 401
          : detail.code === 'RATE_LIMITED'
            ? 429
            : detail.retryable
              ? 503
              : ['REVISION_CONFLICT', 'OPERATION_REUSED', 'SYNC_REBASE_REQUIRED'].includes(
                    detail.code,
                  )
                ? 409
                : detail.code === 'NOT_AVAILABLE'
                  ? 404
                  : 400
      if (detail.retryAfterMs !== undefined)
        headers['Retry-After'] = String(Math.ceil(detail.retryAfterMs / 1000))
      return new Response(
        JSON.stringify({
          error: detail,
          ...(error instanceof ConflictError ? { conflict: error.conflict } : {}),
        }),
        { status, headers },
      )
    }
  }
}
