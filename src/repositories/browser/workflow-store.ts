import type { SessionScope } from '../../domain/contracts'
import { canonicalJson } from '../../domain/canonical-json'
import { DomainError } from '../../domain/errors'
import {
  validateWorkflow,
  type WorkflowRecord,
  type WorkflowStore,
} from '../../services/workflow-store'
import { activeScope, requestResult, transaction } from './schema'
import type { BrowserRepository } from './repository'

const address = (id: string) => JSON.stringify(['workflow', id])
async function check(tx: IDBTransaction, scope?: SessionScope) {
  if (scope && canonicalJson((await activeScope(tx)) ?? null) !== canonicalJson(scope))
    throw new DomainError('ACCOUNT_CHANGED')
}
export function createBrowserWorkflowStore(repository: BrowserRepository): WorkflowStore {
  return {
    read: (id) =>
      transaction(
        repository.database,
        'readonly',
        async (tx) =>
          (
            await requestResult<{ value: WorkflowRecord<never> } | undefined>(
              tx.objectStore('meta').get(address(id)),
            )
          )?.value ?? null,
      ),
    list: (kind) =>
      transaction(repository.database, 'readonly', async (tx) =>
        (
          await requestResult<Array<{ key: string; value?: WorkflowRecord<never> }>>(
            tx.objectStore('meta').getAll(),
          )
        )
          .filter((row) => row.key.startsWith('["workflow",') && row.value?.kind === kind)
          .map((row) => row.value!),
      ),
    async write(id, previous, entry, scope) {
      validateWorkflow(id, previous, entry)
      const value = { ...structuredClone(entry), id, revision: crypto.randomUUID() }
      return transaction(repository.database, 'readwrite', async (tx) => {
        await check(tx, scope)
        const key = address(id),
          row = await requestResult<{ value: WorkflowRecord<unknown> } | undefined>(
            tx.objectStore('meta').get(key),
          )
        if ((row?.value.revision ?? null) !== previous) throw new DomainError('REVISION_CONFLICT')
        if (
          row &&
          (row.value.accountId !== entry.accountId ||
            row.value.kind !== entry.kind ||
            canonicalJson(row.value.collection) !== canonicalJson(entry.collection))
        )
          throw new DomainError('OPERATION_REUSED')
        tx.objectStore('meta').put({
          key,
          ...(entry.collection ? { scope: entry.collection } : {}),
          value,
        })
        return value
      })
    },
    async remove(id, previous, scope) {
      await transaction(repository.database, 'readwrite', async (tx) => {
        await check(tx, scope)
        const key = address(id),
          row = await requestResult<{ value: WorkflowRecord<unknown> } | undefined>(
            tx.objectStore('meta').get(key),
          )
        if (!row) return
        if (row.value.revision !== previous) throw new DomainError('REVISION_CONFLICT')
        tx.objectStore('meta').delete(key)
      })
    },
  }
}
