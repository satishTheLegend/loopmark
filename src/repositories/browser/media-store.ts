import type { PlatformMedia, MediaInput, PreparedMedia } from '../../platform/contracts'
import type { CollectionKey, MediaRef } from '../../domain/contracts'
import { sha256Bytes, canonicalJson } from '../../domain/canonical-json'
import { DomainError } from '../../domain/errors'
import { mediaRefs, keyOf, viewOf } from '../state'
import {
  transaction,
  assertGeneration,
  mediaKey,
  requestResult,
  type MediaRow,
  type SnapshotRow,
  type CollectionRow,
} from './schema'

export { bytesToDataUrl, dataUrlToBlob } from '../../services/media-codec'
import { verifyMediaBytes as verifyBytes } from '../../services/media-codec'
export { verifyMediaBytes as verifyBytes } from '../../services/media-codec'
export async function assertMediaPresent(
  tx: IDBTransaction,
  scope: CollectionKey,
  refs: MediaRef[],
): Promise<void> {
  for (const ref of refs) {
    const row = await requestResult<MediaRow | undefined>(
      tx.objectStore('media').get(mediaKey(scope, ref.id)),
    )
    if (!row || canonicalJson(row.ref) !== canonicalJson(ref) || row.bytes.byteLength !== ref.bytes)
      throw new DomainError('BACKUP_INCOMPLETE')
  }
}
export async function referenced(
  tx: IDBTransaction,
  scope: CollectionKey,
  id: string,
): Promise<boolean> {
  const row = await requestResult<CollectionRow | undefined>(
    tx.objectStore('collections').get(keyOf(scope)),
  )
  if (
    row &&
    mediaRefs([...row.value.checkpoints, ...viewOf(row.value).checkpoints]).some((r) => r.id === id)
  )
    return true
  const snapshots = await requestResult<SnapshotRow[]>(tx.objectStore('snapshots').getAll())
  if (
    snapshots.some((s) => keyOf(s.scope) === keyOf(scope) && s.value.media.some((r) => r.id === id))
  )
    return true
  const plans = await requestResult<
    Array<{ scope?: CollectionKey; media?: MediaRef[]; value?: { operationId?: string } }>
  >(tx.objectStore('meta').getAll())
  if (
    plans.some(
      (plan) =>
        plan.scope &&
        keyOf(plan.scope) === keyOf(scope) &&
        plan.value?.operationId &&
        !Object.hasOwn(row?.value.operations ?? {}, plan.value.operationId) &&
        plan.media?.some((ref) => ref.id === id),
    )
  )
    return true
  const drafts = await requestResult<Array<{ scope: CollectionKey; media?: MediaRef[] }>>(
    tx.objectStore('drafts').getAll(),
  )
  return drafts.some((d) => keyOf(d.scope) === keyOf(scope) && d.media?.some((r) => r.id === id))
}
export class BrowserMediaStore implements PlatformMedia {
  constructor(readonly database: IDBDatabase) {}
  async prepare(
    input: MediaInput,
    scope: CollectionKey,
    generation: number,
  ): Promise<PreparedMedia> {
    const ref: MediaRef = {
      id: crypto.randomUUID(),
      kind: input.kind,
      mimeType: input.bytes.type,
      bytes: input.bytes.size,
      sha256: await sha256Bytes(new Uint8Array(await input.bytes.arrayBuffer())),
    }
    await this.storeVerified(ref, input.bytes, scope, generation)
    return { ref, scope, preparedAt: new Date().toISOString() }
  }
  async storeVerified(
    ref: MediaRef,
    bytes: Blob,
    scope: CollectionKey,
    generation: number,
  ): Promise<void> {
    await verifyBytes(ref, bytes)
    // Binary buffers avoid WebKit's unreliable Blob-file staging path in IndexedDB.
    const storedBytes = await bytes.arrayBuffer()
    await transaction(this.database, 'readwrite', async (tx) => {
      await assertGeneration(tx, scope, generation, false)
      const key = mediaKey(scope, ref.id)
      const existing = await requestResult<MediaRow | undefined>(tx.objectStore('media').get(key))
      if (existing && canonicalJson(existing.ref) !== canonicalJson(ref))
        throw new DomainError('MEDIA_INVALID')
      if (!existing)
        tx.objectStore('media').add({
          key,
          scope,
          ref,
          bytes: storedBytes,
          preparedAt: new Date().toISOString(),
        } satisfies MediaRow)
    })
  }
  async open(ref: MediaRef, scope: CollectionKey): Promise<ReadableStream<Uint8Array>> {
    const row = await transaction(this.database, 'readonly', (tx) =>
      requestResult<MediaRow | undefined>(tx.objectStore('media').get(mediaKey(scope, ref.id))),
    )
    if (!row || canonicalJson(row.ref) !== canonicalJson(ref))
      throw new DomainError('BACKUP_INCOMPLETE')
    const blob = new Blob([row.bytes], { type: row.ref.mimeType })
    await verifyBytes(ref, blob)
    return blob.stream()
  }
  async release(ref: MediaRef, scope: CollectionKey, generation: number): Promise<void> {
    await transaction(this.database, 'readwrite', async (tx) => {
      await assertGeneration(tx, scope, generation, false)
      if (await referenced(tx, scope, ref.id)) return
      const row = await requestResult<MediaRow | undefined>(
        tx.objectStore('media').get(mediaKey(scope, ref.id)),
      )
      if (row && canonicalJson(row.ref) !== canonicalJson(ref))
        throw new DomainError('MEDIA_INVALID')
      tx.objectStore('media').delete(mediaKey(scope, ref.id))
    })
  }
}
