import type { CollectionKey, SessionScope } from '../../domain/contracts'
import { DomainError } from '../../domain/errors'
import { keyOf } from '../state'
import { transaction, requestResult, assertGeneration } from './schema'
import type { BrowserRepository } from './repository'

import type { DraftRecord as StoredDraft, DraftStore } from '../drafts'
const draftKey = (scope: CollectionKey, key: string) => JSON.stringify([keyOf(scope), key])
/** Each instance is permanently bound to the opening collection and session generation. */
export function createBrowserDraftStore(
  repository: BrowserRepository,
  scope: SessionScope,
): DraftStore {
  const bound = structuredClone(scope)
  return {
    async read<T>(key: string) {
      return transaction(repository.database, 'readonly', async (tx) => {
        await assertGeneration(tx, bound.key, bound.generation)
        const row = await requestResult<{ value: StoredDraft<T> } | undefined>(
          tx.objectStore('drafts').get(draftKey(bound.key, key)),
        )
        return row?.value
      })
    },
    async write<T>(key: string, previous: string | undefined, draft?: StoredDraft<T>) {
      if (!key || key.length > 100 || (draft && (draft.key !== key || !draft.revision)))
        throw new DomainError('VALIDATION')
      await transaction(repository.database, 'readwrite', async (tx) => {
        await assertGeneration(tx, bound.key, bound.generation)
        const address = draftKey(bound.key, key)
        const row = await requestResult<{ value: StoredDraft<T> } | undefined>(
          tx.objectStore('drafts').get(address),
        )
        if (row?.value.revision !== previous) throw new DomainError('REVISION_CONFLICT')
        if (draft) tx.objectStore('drafts').put({ key: address, scope: bound.key, value: draft })
        else tx.objectStore('drafts').delete(address)
      })
    },
    async removeProjectDrafts(projectId: string) {
      await transaction(repository.database, 'readwrite', async (tx) => {
        await assertGeneration(tx, bound.key, bound.generation)
        for (const key of [`edit:${projectId}`, `checkpoint:${projectId}`])
          tx.objectStore('drafts').delete(draftKey(bound.key, key))
      })
    },
  }
}
