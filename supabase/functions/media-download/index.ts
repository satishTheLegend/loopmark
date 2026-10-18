import { transportEndpoint, rpc } from '../_shared/command.ts'
import { boundedJson } from '../_shared/limits.ts'
import { mediaDownloadRequestSchema } from '../_shared/generated/domain/remote-schema.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
import { server } from '../_shared/server.ts'
import { verifyMedia } from '../_shared/media.ts'
Deno.serve(
  transportEndpoint(async (request, identity) => {
    if (!identity) throw new DomainError('AUTH_REQUIRED')
    const parsed = mediaDownloadRequestSchema.safeParse(await boundedJson(request))
    if (!parsed.success) throw new DomainError('VALIDATION')
    const admitted = await rpc(identity.client, 'loopmark_media_download', { request: parsed.data })
    const downloaded = await server()
      .client.storage.from('loopmark-private')
      .download(admitted.objectKey)
    if (downloaded.error || !downloaded.data) throw new DomainError('MEDIA_INVALID')
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer())
    await verifyMedia(bytes, admitted.media)
    // A deletion committed during Storage I/O also denies the response.
    await rpc(identity.client, 'loopmark_media_download', { request: parsed.data })
    return new Response(bytes, {
      headers: {
        'Content-Type': admitted.media.mimeType,
        'Content-Length': String(bytes.length),
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }),
)
