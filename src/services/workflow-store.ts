import type { CollectionKey, SessionScope } from '../domain/contracts'
import { canonicalJson } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import { collectionKeySchema, id } from '../domain/schema'

export type WorkflowKind = 'upload' | 'candidate' | 'deletion' | 'purchase'
export interface WorkflowEntry<T> {
  kind: WorkflowKind
  accountId: string
  collection: CollectionKey | null
  value: T
}
export interface WorkflowRecord<T> extends WorkflowEntry<T> {
  id: string
  revision: string
}
/** Caller validates the value's specific wire schema. No credentials/provider secrets belong here. */
export interface WorkflowStore {
  read<T>(id: string): Promise<WorkflowRecord<T> | null>
  list<T>(kind: WorkflowKind): Promise<WorkflowRecord<T>[]>
  write<T>(
    id: string,
    previous: string | null,
    entry: WorkflowEntry<T>,
    scope?: SessionScope,
  ): Promise<WorkflowRecord<T>>
  remove(id: string, previous: string, scope?: SessionScope): Promise<void>
}
export function validateWorkflow(
  idValue: string,
  previous: string | null,
  entry: WorkflowEntry<unknown>,
) {
  if (
    !id.safeParse(idValue).success ||
    (previous !== null && !id.safeParse(previous).success) ||
    !id.safeParse(entry.accountId).success ||
    !['upload', 'candidate', 'deletion', 'purchase'].includes(entry.kind) ||
    (entry.collection !== null && !collectionKeySchema.safeParse(entry.collection).success)
  )
    throw new DomainError('VALIDATION')
  // Two complete bounded candidate metadata sets plus mapping and receipts fit within this bound.
  if (
    new TextEncoder().encode(canonicalJson(entry)).byteLength >
    (entry.kind === 'candidate' ? 20 * 1024 * 1024 : 64 * 1024)
  )
    throw new DomainError('TECHNICAL_CAPACITY_REACHED')
}
