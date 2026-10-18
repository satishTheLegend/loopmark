import {
  createClient,
  isAuthApiError,
  isAuthSessionMissingError,
} from 'npm:@supabase/supabase-js@2.118.0'
import { DomainError } from './generated/domain/errors.ts'

export async function authenticated(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1]
  if (!token) throw new DomainError('AUTH_REQUIRED')
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !key) throw new DomainError('SERVICE_UNAVAILABLE')
  const client = createClient(url, key, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      // A stalled identity provider must not stall every command indefinitely.
      // Keep this deadline specific to identity verification, not subsequent RPCs.
      fetch: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (url.pathname !== '/auth/v1/user') return fetch(input, init)
        const signal = init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000)
        return fetch(input, { ...init, signal })
      },
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  // Never derive authority by decoding an unverified JWT or trusting a body account ID.
  const { data, error } = await client.auth.getUser(token)
  if (error) {
    // Only an authoritative rejection invalidates identity. Network failures,
    // timeouts, 429 and provider 5xx keep the durable command retryable.
    if (
      isAuthSessionMissingError(error) ||
      (isAuthApiError(error) && [400, 401, 403, 404].includes(error.status))
    )
      throw new DomainError('AUTH_REQUIRED')
    throw new DomainError('SERVICE_UNAVAILABLE')
  }
  if (!data.user) throw new DomainError('SERVICE_UNAVAILABLE')
  return { client, user: data.user }
}
