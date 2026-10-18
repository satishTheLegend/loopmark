import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { parseServerConfig } from './config.ts'
export function server(signal?: AbortSignal) {
  const config = parseServerConfig(Deno.env.toObject())
  const client = createClient(config.backendUrl, config.secrets.serviceRole.reveal(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: signal ?? AbortSignal.timeout(60_000) }),
    },
  })
  return { config, client }
}
