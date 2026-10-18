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
import { observe } from './observability.ts'

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
  maximum = 256 * 1024,
) {
  return transportEndpoint(async (request, identity) =>
    action(await boundedJson(request, maximum), identity!),
  )
}
export function transportEndpoint(
  action: (
    request: Request,
    identity: Awaited<ReturnType<typeof authenticated>> | null,
  ) => Promise<unknown>,
  requiresAuthentication = true,
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
    // These are the exact Capacitor WebView origins verified in both native runtimes.
    // CORS is transport policy; verified JWT ownership remains required below.
    const allowedOrigins = new Set([allowedOrigin, 'capacitor://localhost', 'https://localhost'])
    if (origin && allowedOrigins.has(origin)) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Access-Control-Allow-Headers'] =
        'authorization, apikey, content-type, x-client-info, x-loopmark-reservation-id'
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    }
    if (origin && !allowedOrigins.has(origin))
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
    let identity: Awaited<ReturnType<typeof authenticated>> | null = null
    const started = performance.now(),
      path = new URL(request.url).pathname.split('/').at(-1),
      route = path?.startsWith('media-')
        ? 'media'
        : path &&
            ['checkout', 'purchase-restore', 'purchase-recovery', 'entitlement-status'].includes(
              path,
            )
          ? 'billing'
          : null
    try {
      identity = requiresAuthentication ? await authenticated(request) : null
      const result = await action(request, identity)
      if (identity && route)
        await observe(identity.user.id, route, 'success', null, performance.now() - started)
      if (result instanceof Response) {
        const responseHeaders = new Headers(headers)
        for (const [key, value] of result.headers) responseHeaders.set(key, value)
        return new Response(result.body, { status: result.status, headers: responseHeaders })
      }
      return new Response(JSON.stringify(result), { status: 200, headers })
    } catch (error) {
      const detail = safeError(error)
      if (identity && route)
        await observe(identity.user.id, route, 'error', null, performance.now() - started)
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
