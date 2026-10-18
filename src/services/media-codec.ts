import type { MediaKind, MediaRef, SessionScope } from '../domain/contracts'
import type { PlatformMedia } from '../platform/contracts'
import { sha256Bytes, canonicalHash } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import { decodeBase64Bytes, decodeValidatedMedia, validMediaBytes } from '../media-validation'
import { mediaRefSchema } from '../domain/schema'
export async function verifyMediaBytes(ref: MediaRef, blob: Blob): Promise<void> {
  if (
    !mediaRefSchema.safeParse(ref).success ||
    ref.bytes !== blob.size ||
    blob.type !== ref.mimeType
  )
    throw new DomainError('MEDIA_INVALID')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if ((await sha256Bytes(bytes)) !== ref.sha256 || !validMediaBytes(bytes, ref.mimeType, ref.kind))
    throw new DomainError('MEDIA_INVALID')
}
export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return `data:${mimeType};base64,${btoa(binary)}`
}
export function dataUrlToBlob(value: string): Blob {
  const split = value.indexOf(';base64,')
  if (!value.startsWith('data:') || split < 0) throw new DomainError('MEDIA_INVALID')
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = decodeBase64Bytes(value.slice(split + 8))
  } catch {
    throw new DomainError('MEDIA_INVALID')
  }
  return new Blob([bytes], { type: value.slice(5, split) })
}
export async function describeInline(
  value: string,
  kind: MediaKind,
): Promise<{ ref: MediaRef; bytes: Blob }> {
  const decoded = decodeValidatedMedia(value, kind)
  if (!decoded) throw new DomainError('MEDIA_INVALID')
  const bytes = new Blob([decoded.bytes], { type: decoded.mimeType }),
    sha256 = await sha256Bytes(new Uint8Array(await bytes.arrayBuffer()))
  return {
    ref: {
      id: `m_${await canonicalHash({ kind, mimeType: bytes.type, sha256 })}`,
      kind,
      mimeType: bytes.type,
      bytes: bytes.size,
      sha256,
    },
    bytes,
  }
}
export async function storeInline(
  value: string,
  kind: MediaKind,
  media: PlatformMedia,
  scope: SessionScope,
): Promise<MediaRef> {
  const { ref, bytes } = await describeInline(value, kind)
  await media.storeVerified(ref, bytes, scope.key, scope.generation)
  return ref
}
export async function inlineMedia(
  ref: MediaRef,
  media: PlatformMedia,
  scope: SessionScope,
): Promise<string> {
  const bytes = new Uint8Array(await new Response(await media.open(ref, scope.key)).arrayBuffer())
  if (bytes.byteLength !== ref.bytes || (await sha256Bytes(bytes)) !== ref.sha256)
    throw new DomainError('MEDIA_INVALID')
  return bytesToDataUrl(bytes, ref.mimeType)
}
