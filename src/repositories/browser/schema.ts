import type { CollectionKey, LocalSnapshot, MediaRef, SessionScope } from '../../domain/contracts'
import type { StoredCollection } from '../state'
import { DomainError } from '../../domain/errors'
import { keyOf } from '../state'

export const BROWSER_DATABASE = 'loopmark-v2'
export const BROWSER_SCHEMA_VERSION = 1
export const STORES = ['collections', 'media', 'meta', 'snapshots', 'drafts', 'migrations'] as const
export type StoreName = (typeof STORES)[number]
export interface MediaRow {
  key: string
  scope: CollectionKey
  ref: MediaRef
  bytes: ArrayBuffer
  preparedAt: string
}
export interface SnapshotRow {
  key: string
  scope: CollectionKey
  value: LocalSnapshot
}
export interface CollectionRow {
  key: string
  value: StoredCollection
}
export interface MetaRow {
  key: string
  value: unknown
}
export const mediaKey = (scope: CollectionKey, id: string) => JSON.stringify([keyOf(scope), id])
export const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
function storageError(error: unknown): Error {
  if (error instanceof DomainError) return error
  return new DomainError(
    error instanceof DOMException && error.name === 'QuotaExceededError'
      ? 'LOCAL_STORAGE_FULL'
      : 'LOCAL_STORAGE_FAILED',
  )
}
export async function openDatabase(
  name = BROWSER_DATABASE,
  factory: IDBFactory = indexedDB,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, BROWSER_SCHEMA_VERSION)
    let failed = false
    request.onupgradeneeded = () => {
      for (const store of STORES)
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store, { keyPath: 'key' })
    }
    request.onerror = () => reject(storageError(request.error))
    request.onblocked = () => {
      failed = true
      reject(new DomainError('LOCAL_STORAGE_FAILED'))
    }
    request.onsuccess = () => {
      if (failed) request.result.close()
      else {
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
    }
  })
}
/** The callback may await IDB requests only. Hashing, file reads, and all I/O happen before this transaction. */
export async function transaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [...STORES],
      mode,
      mode === 'readwrite' ? { durability: 'strict' } : undefined,
    )
    let result: T,
      failure: unknown,
      finished = false
    tx.oncomplete = () => {
      finished = true
      resolve(result)
    }
    tx.onerror = () => {
      failure ??= tx.error
    }
    tx.onabort = () => {
      finished = true
      reject(storageError(failure ?? tx.error))
    }
    Promise.resolve()
      .then(() => work(tx))
      .then(
        (value) => {
          result = value
        },
        (error) => {
          failure = error
          try {
            tx.abort()
          } catch {
            if (!finished) reject(storageError(error))
          }
        },
      )
  })
}
export async function getState(tx: IDBTransaction, key: CollectionKey): Promise<StoredCollection> {
  const row = await requestResult<CollectionRow | undefined>(
    tx.objectStore('collections').get(keyOf(key)),
  )
  if (!row) throw new DomainError('NOT_AVAILABLE')
  return row.value
}
export function putState(tx: IDBTransaction, value: StoredCollection): void {
  tx.objectStore('collections').put({ key: keyOf(value.info.key), value } satisfies CollectionRow)
}
export async function activeScope(tx: IDBTransaction): Promise<SessionScope | undefined> {
  const row = await requestResult<MetaRow | undefined>(tx.objectStore('meta').get('active'))
  return row?.value as SessionScope | undefined
}
export async function assertGeneration(
  tx: IDBTransaction,
  key: CollectionKey,
  generation: number,
  selected = true,
): Promise<SessionScope> {
  const active = await activeScope(tx)
  if (!active || active.generation !== generation || (selected && keyOf(active.key) !== keyOf(key)))
    throw new DomainError('ACCOUNT_CHANGED')
  if (!selected) {
    const target = await getState(tx, key)
    if (target.info.kind === 'connected') {
      const source = await getState(tx, active.key)
      if (target.info.accountId !== source.info.accountId) throw new DomainError('ACCOUNT_CHANGED')
    }
  }
  return active
}
