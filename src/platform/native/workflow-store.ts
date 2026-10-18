import type { SessionScope } from '../../domain/contracts'
import { canonicalJson } from '../../domain/canonical-json'
import { DomainError } from '../../domain/errors'
import {
  validateWorkflow,
  type WorkflowRecord,
  type WorkflowStore,
} from '../../services/workflow-store'
import { activeScope } from './recovery-journal'
import type { NativeRepository } from './repository'

type DB = NativeRepository['database']['connection']
const address = (id: string) => `workflow:${id}`
async function read<T>(db: DB, id: string): Promise<WorkflowRecord<T> | null> {
  const row = (await db.query('SELECT body FROM metadata WHERE key=?', [address(id)])).values?.[0]
  return row ? (JSON.parse(row.body as string) as WorkflowRecord<T>) : null
}
async function fence(db: DB, scope?: SessionScope) {
  if (scope && canonicalJson((await activeScope(db)) ?? null) !== canonicalJson(scope))
    throw new DomainError('ACCOUNT_CHANGED')
}
/** Durable continuation metadata. Candidate bytes remain protected by repository snapshot pins. */
export function createNativeWorkflowStore(repository: NativeRepository): WorkflowStore {
  return {
    read: (id) => repository.database.serial((db) => read(db, id)),
    list: (kind) =>
      repository.database.serial(async (db) => {
        const rows =
          (await db.query("SELECT body FROM metadata WHERE key LIKE 'workflow:%'")).values ?? []
        return rows
          .map((row) => JSON.parse(row.body as string) as WorkflowRecord<never>)
          .filter((row) => row.kind === kind)
      }),
    async write(id, previous, entry, scope) {
      validateWorkflow(id, previous, entry)
      const value = { ...structuredClone(entry), id, revision: crypto.randomUUID() }
      const expected = scope ? structuredClone(scope) : undefined
      return repository.database.transaction(async (db) => {
        await fence(db, expected)
        const row = await read(db, id)
        if ((row?.revision ?? null) !== previous) throw new DomainError('REVISION_CONFLICT')
        if (
          row &&
          (row.accountId !== value.accountId ||
            row.kind !== value.kind ||
            canonicalJson(row.collection) !== canonicalJson(value.collection))
        )
          throw new DomainError('OPERATION_REUSED')
        await db.run(
          'INSERT OR REPLACE INTO metadata(key,body) VALUES(?,?)',
          [address(id), canonicalJson(value)],
          false,
        )
        return value
      })
    },
    async remove(id, previous, scope) {
      const expected = scope ? structuredClone(scope) : undefined
      await repository.database.transaction(async (db) => {
        await fence(db, expected)
        const row = await read(db, id)
        if (!row) return
        if (row.revision !== previous) throw new DomainError('REVISION_CONFLICT')
        await db.run('DELETE FROM metadata WHERE key=?', [address(id)], false)
      })
    },
  }
}
