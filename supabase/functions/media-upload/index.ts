import { transportEndpoint, rpc } from '../_shared/command.ts'
import { boundedJson } from '../_shared/limits.ts'
import { mediaUploadRequestSchema } from '../_shared/generated/domain/remote-schema.ts'
import { id } from '../_shared/generated/domain/schema.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
import { server } from '../_shared/server.ts'
import { readMedia, verifyMedia } from '../_shared/media.ts'
Deno.serve(
  transportEndpoint(async (request, identity) => {
    if (!identity) throw new DomainError('AUTH_REQUIRED')
    if (request.headers.get('content-type')?.toLowerCase() === 'application/octet-stream') {
      const parsed = id.safeParse(request.headers.get('x-loopmark-reservation-id'))
      if (!parsed.success) throw new DomainError('VALIDATION')
      const deadline = Date.now() + 60_000
      const signal = AbortSignal.timeout(60_000)
      const admitted = await rpc(identity.client, 'loopmark_media_admit', { p_id: parsed.data })
      const bytes = await readMedia(
        request,
        admitted.reservation.media,
        Math.max(1, deadline - Date.now()),
      )
      const admin = server(signal).client
      if (!admitted.alreadyVerified) {
        await rpc(admin, 'loopmark_media_check', {
          p_owner: identity.user.id,
          p_id: parsed.data,
          p_fence: admitted.fence,
        })
        const uploaded = await admin.storage
          .from('loopmark-private')
          .upload(admitted.objectKey, bytes, {
            upsert: false,
            contentType: admitted.reservation.media.mimeType,
            cacheControl: '0',
          })
        if (uploaded.error) {
          // A crash after immutable upload but before marking verified can retry the same key.
          const previous = await admin.storage.from('loopmark-private').download(admitted.objectKey)
          if (previous.error || !previous.data) throw new DomainError('SERVICE_UNAVAILABLE')
          await verifyMedia(
            new Uint8Array(await previous.data.arrayBuffer()),
            admitted.reservation.media,
          )
        }
        await rpc(admin, 'loopmark_media_verified', {
          p_owner: identity.user.id,
          p_id: parsed.data,
          p_fence: admitted.fence,
        })
      } else {
        // Recheck active state even for a duplicate verified stream.
        await rpc(identity.client, 'loopmark_media_admit', { p_id: parsed.data })
      }
      return { reservationId: parsed.data, verified: true }
    }
    const parsed = mediaUploadRequestSchema.safeParse(await boundedJson(request))
    if (!parsed.success) throw new DomainError('VALIDATION')
    return parsed.data.action === 'cancel'
      ? await rpc(identity.client, 'loopmark_media_cancel', { p_id: parsed.data.reservationId })
      : await rpc(identity.client, 'loopmark_media_reserve', { request: parsed.data })
  }),
)
