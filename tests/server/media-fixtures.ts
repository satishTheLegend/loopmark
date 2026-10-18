import { createHash, randomUUID } from 'node:crypto'
import type { MediaRef, UploadReservation } from '../../src/domain/contracts'
import { localEnvironment, request, type Actor } from './helpers'
export function audioFixture(
  sample = 1,
  bytes = 46,
): { ref: MediaRef; bytes: Uint8Array<ArrayBuffer> } {
  const buffer = Buffer.alloc(bytes)
  buffer.write('RIFF')
  buffer.writeUInt32LE(bytes - 8, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(8000, 24)
  buffer.writeUInt32LE(16000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(bytes - 44, 40)
  buffer.writeUInt16LE(sample, 44)
  return {
    ref: {
      id: randomUUID(),
      kind: 'voice',
      mimeType: 'audio/wav',
      bytes,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    },
    bytes: new Uint8Array(buffer),
  }
}
export async function reserve(
  a: Actor,
  ref: MediaRef,
  extra: { candidateId?: string; epoch?: string } = {},
) {
  return request(a.token, 'media-upload', {
    action: 'reserve',
    requestId: randomUUID(),
    upload: {
      collectionId: a.session.collection.collectionId,
      epoch: extra.epoch ?? a.session.collection.epoch,
      media: ref,
    },
    ...(extra.candidateId ? { candidateId: extra.candidateId } : {}),
  })
}
export async function upload(
  a: Actor,
  reservation: UploadReservation,
  bytes: Uint8Array<ArrayBuffer>,
) {
  const env = await localEnvironment()
  const response = await fetch(`${env.url}/functions/v1/media-upload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${a.token}`,
      apikey: env.publicKey,
      'content-type': 'application/octet-stream',
      'x-loopmark-reservation-id': reservation.id,
    },
    body: bytes,
  })
  return { status: response.status, body: await response.json() }
}
export async function download(
  a: Actor,
  ref: MediaRef,
  extra: { snapshotId?: string; epoch?: string } = {},
) {
  const env = await localEnvironment()
  const response = await fetch(`${env.url}/functions/v1/media-download`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${a.token}`,
      apikey: env.publicKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      collectionId: a.session.collection.collectionId,
      epoch: extra.epoch ?? a.session.collection.epoch,
      mediaId: ref.id,
      ...(extra.snapshotId ? { snapshotId: extra.snapshotId } : {}),
    }),
  })
  return {
    status: response.status,
    headers: response.headers,
    bytes: new Uint8Array(await response.arrayBuffer()),
  }
}
