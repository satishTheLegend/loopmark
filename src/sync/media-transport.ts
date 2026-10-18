import type { MediaRef, UploadReservation } from '../domain/contracts'
import type { MediaDownloadRequest, MediaUploadRequest } from '../domain/remote-contracts'
import { DomainError } from '../domain/errors'
import { canonicalJson } from '../domain/canonical-json'
import { uploadReservationSchema } from '../domain/schema'
import {
  cancelledReservationSchema,
  mediaDownloadRequestSchema,
  mediaUploadRequestSchema,
  mediaUploadVerifiedSchema,
} from '../domain/remote-schema'
import { verifyMediaBytes } from '../services/media-codec'
import {
  boundedJson,
  createAuthenticatedRequest,
  responseError,
  withRequestDeadline,
  type AuthenticatedRequestOptions,
  type FunctionClient,
} from './http-client'

export interface MediaTransport {
  reserve(
    input: Extract<MediaUploadRequest, { action: 'reserve' }>,
    signal: AbortSignal,
  ): Promise<UploadReservation>
  upload(reservationId: string, ref: MediaRef, bytes: Blob, signal: AbortSignal): Promise<void>
  cancel(reservationId: string, signal: AbortSignal): Promise<void>
  download(input: MediaDownloadRequest, ref: MediaRef, signal: AbortSignal): Promise<Blob>
}
export async function readMediaResponse(response: Response, ref: MediaRef): Promise<Blob> {
  if (
    response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== ref.mimeType ||
    (response.headers.has('content-length') &&
      Number(response.headers.get('content-length')) !== ref.bytes)
  )
    throw new DomainError('MEDIA_INVALID')
  const reader = response.body?.getReader()
  if (!reader) throw new DomainError('MEDIA_INVALID')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > ref.bytes) {
        await reader.cancel()
        throw new DomainError('MEDIA_INVALID')
      }
      chunks.push(new Uint8Array(value))
    }
  } finally {
    reader.releaseLock()
  }
  const blob = new Blob(chunks, { type: ref.mimeType })
  await verifyMediaBytes(ref, blob)
  return blob
}
export function createMediaTransport(
  options: AuthenticatedRequestOptions & { client: FunctionClient },
): MediaTransport {
  const request = createAuthenticatedRequest(options)
  async function checked(response: Response) {
    if (!response.ok) {
      const parsed = await boundedJson(response, 512 * 1024).catch(() => null)
      throw responseError(response.status, parsed, response.headers.get('retry-after'))
    }
    return response
  }
  return {
    async reserve(input, signal) {
      const parsed = mediaUploadRequestSchema.safeParse(input)
      if (!parsed.success) throw new DomainError('VALIDATION')
      const result = uploadReservationSchema.safeParse(
        await options.client.post('media-upload', parsed.data, signal),
      )
      if (
        !result.success ||
        result.data.collectionId !== input.upload.collectionId ||
        result.data.epoch !== input.upload.epoch ||
        canonicalJson(result.data.media) !== canonicalJson(input.upload.media)
      )
        throw new DomainError('SYNC_PAGE_INVALID')
      return result.data
    },
    async upload(reservationId, ref, bytes, signal) {
      await verifyMediaBytes(ref, bytes)
      await withRequestDeadline(signal, 60000, async (bounded) => {
        const response = await checked(
          await request('media-upload', bytes, bounded, {
            contentType: 'application/octet-stream',
            headers: { 'x-loopmark-reservation-id': reservationId },
          }),
        )
        const parsed = mediaUploadVerifiedSchema.safeParse(await boundedJson(response, 8192))
        if (!parsed.success || parsed.data.reservationId !== reservationId)
          throw new DomainError('SYNC_PAGE_INVALID')
      })
    },
    async cancel(reservationId, signal) {
      if (
        !cancelledReservationSchema.safeParse(
          await options.client.post('media-upload', { action: 'cancel', reservationId }, signal),
        ).success
      )
        throw new DomainError('SYNC_PAGE_INVALID')
    },
    async download(input, ref, signal) {
      if (!mediaDownloadRequestSchema.safeParse(input).success || input.mediaId !== ref.id)
        throw new DomainError('VALIDATION')
      return withRequestDeadline(signal, 60000, async (bounded) =>
        readMediaResponse(
          await checked(await request('media-download', JSON.stringify(input), bounded)),
          ref,
        ),
      )
    },
  }
}
