import { z } from 'npm:zod@4.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { sha256Bytes } from '../_shared/generated/domain/canonical-json.ts'
import { endpoint, rpc } from '../_shared/command.ts'
import { id } from '../_shared/generated/domain/schema.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
const reauthentication = z
  .object({ action: z.literal('reauthenticate'), code: z.string().regex(/^[0-9]{6}$/) })
  .strict()
const schema = z
  .object({ deviceId: id, deviceGeneration: id.optional(), reregister: z.boolean().optional() })
  .strict()
Deno.serve(
  endpoint(async (body, { client, user }) => {
    const fresh = reauthentication.safeParse(body)
    if (fresh.success) {
      if (!user.email) throw new DomainError('REAUTH_REQUIRED')
      const verified = await client.auth.verifyOtp({
        email: user.email,
        token: fresh.data.code,
        type: 'email',
      })
      if (verified.error || verified.data.user?.id !== user.id)
        throw new DomainError('AUTH_CODE_EXPIRED')
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
        url = Deno.env.get('SUPABASE_URL')
      if (!key || !url) throw new DomainError('SERVICE_UNAVAILABLE')
      const admin = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const challengeId = crypto.randomUUID(),
        proof = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('')
      const hash = await sha256Bytes(new TextEncoder().encode(proof))
      const expiresAt = await rpc(admin, 'loopmark_issue_reauthentication', {
        p_owner: user.id,
        p_challenge: challengeId,
        p_hash: hash,
      })
      return { challengeId, proof, expiresAt }
    }

    const request = schema.safeParse(body)
    if (!request.success) throw new DomainError('VALIDATION')
    return await rpc(client, 'loopmark_session', {
      p_device_id: request.data.deviceId,
      p_device_generation: request.data.deviceGeneration ?? null,
      p_reregister: request.data.reregister ?? false,
    })
  }),
)
