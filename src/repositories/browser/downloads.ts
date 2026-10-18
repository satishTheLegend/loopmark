import type { CollectionKey, MediaRef, SessionScope } from '../../domain/contracts'
import { canonicalJson } from '../../domain/canonical-json'
import { DomainError } from '../../domain/errors'
import { keyOf } from '../state'
import { candidateBlocksRebase } from '../rebase'
import { removableDownloads, workflowDownloadPins } from '../downloads'
import {
  activeScope,
  getState,
  mediaKey,
  requestResult,
  transaction,
  type MediaRow,
  type SnapshotRow,
} from './schema'

export async function removeBrowserDownloads(
  database: IDBDatabase,
  scope: SessionScope,
  projectId: string,
) {
  return transaction(database, 'readwrite', async (tx) => {
    if (canonicalJson((await activeScope(tx)) ?? null) !== canonicalJson(scope))
      throw new DomainError('ACCOUNT_CHANGED')
    const state = await getState(tx, scope.key)
    const snapshots = await requestResult<SnapshotRow[]>(tx.objectStore('snapshots').getAll())
    const drafts = await requestResult<Array<{ scope: CollectionKey; media?: MediaRef[] }>>(
      tx.objectStore('drafts').getAll(),
    )
    const metadata = await requestResult<
      Array<{ key: string; scope?: CollectionKey; media?: MediaRef[]; value?: unknown }>
    >(tx.objectStore('meta').getAll())
    const cached = (await requestResult<MediaRow[]>(tx.objectStore('media').getAll())).filter(
      (row) => keyOf(row.scope) === keyOf(scope.key),
    )
    const pinned = new Set<string>()
    for (const snapshot of snapshots)
      if (keyOf(snapshot.scope) === keyOf(scope.key))
        for (const ref of snapshot.value.media) pinned.add(ref.id)
    for (const row of [
      ...drafts,
      ...metadata.filter((row) => {
        const operationId = (row.value as { operationId?: string } | undefined)?.operationId
        return (
          row.key.startsWith('["rebase-archive",') ||
          (!!operationId && !Object.hasOwn(state.operations, operationId))
        )
      }),
    ])
      if (row.scope && keyOf(row.scope) === keyOf(scope.key))
        for (const ref of row.media ?? []) pinned.add(ref.id)
    if (metadata.some((row) => candidateBlocksRebase(row, scope.key)))
      for (const row of cached) pinned.add(row.ref.id)
    for (const row of metadata)
      if (row.scope && keyOf(row.scope) === keyOf(scope.key))
        for (const ref of workflowDownloadPins(row.value)) pinned.add(ref.id)
    const result = removableDownloads(state, projectId, cached, pinned)
    if (!result.remove.length) throw new DomainError('DOWNLOADS_PROTECTED')
    for (const ref of result.remove) tx.objectStore('media').delete(mediaKey(scope.key, ref.id))
    return { removed: result.remove.length, retained: result.retained }
  })
}
