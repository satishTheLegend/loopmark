import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { DomainError } from './generated/domain/errors.ts'

export async function authenticated(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1]
  if (!token) throw new DomainError('AUTH_REQUIRED')
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !key) throw new DomainError('SERVICE_UNAVAILABLE')
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  // Never derive authority by decoding an unverified JWT or trusting a body account ID.
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) throw new DomainError('AUTH_REQUIRED')
  return { client, user: data.user }
}
