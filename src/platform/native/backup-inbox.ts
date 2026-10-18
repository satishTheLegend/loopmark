import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { CollectionKey, SessionScope } from '../../domain/contracts'
import { DomainError, type ErrorCode } from '../../domain/errors'
import { canonicalJson, sha256Bytes } from '../../domain/canonical-json'
import { MAX_BACKUP_BYTES } from '../../domain/policy'
import { decodeBase64Bytes } from '../../media-validation'
import type { NativeRepository } from './repository'
import { activeScope } from './recovery-journal'

export interface IncomingBackup {
  id: string
  operationToken: string
  name: string
  bytes: number
  receivedAt: string
  state: 'ready' | 'already-handled' | 'failed'
  source?: SessionScope
  errorCode?: ErrorCode
  result?: CollectionKey
}
export interface NativeBackupInbox {
  initialize(listener: () => void): Promise<void>
  dispose(): Promise<void>
  pending(): Promise<IncomingBackup | null>
  read(id: string): Promise<Blob>
  bind(id: string, scope: SessionScope): Promise<IncomingBackup>
  finish(
    id: string,
    scope: SessionScope,
    outcome: { state: 'imported'; collection: CollectionKey } | { state: 'dismissed' },
  ): Promise<void>
}
interface InboxBridge {
  pending(): Promise<{ item: IncomingBackup | null }>
  read(input: { id: string; offset: number; length: number }): Promise<{ base64: string }>
  finish(input: { id: string }): Promise<void>
  addListener(event: 'changed', listener: () => void): Promise<PluginListenerHandle>
}
export const backupInboxBridge = registerPlugin<InboxBridge>('LoopmarkBackupInbox')
type Binding = {
  source?: SessionScope
  state: 'bound' | 'imported' | 'dismissed'
  result?: CollectionKey
}
const address = (id: string) => `native-backup-inbox:${id}`
const itemValid = (item: IncomingBackup) =>
  /^[a-f0-9]{64}$/.test(item.id) &&
  /^[a-f0-9-]{36}$/i.test(item.operationToken) &&
  typeof item.name === 'string' &&
  item.name.length <= 160 &&
  Number.isSafeInteger(item.bytes) &&
  item.bytes >= 0 &&
  item.bytes <= MAX_BACKUP_BYTES &&
  Number.isFinite(Date.parse(item.receivedAt)) &&
  ['ready', 'already-handled', 'failed'].includes(item.state)

/** Native OS intake owns private bytes; SQLite owns explicit review and completion receipts. */
export function createNativeBackupInbox(repository: NativeRepository): NativeBackupInbox {
  let handle: PluginListenerHandle | undefined, listener: (() => void) | undefined
  const notify = () => {
    try {
      listener?.()
    } catch {
      /* Isolate view observers. */
    }
  }
  const nativeItem = async () => {
    if (!Capacitor.isNativePlatform()) throw new DomainError('CAPABILITY_UNAVAILABLE')
    const { item } = await backupInboxBridge.pending()
    if (item && !itemValid(item)) throw new DomainError('VALIDATION')
    return item
  }
  const binding = async (id: string) =>
    repository.database.serial(async (db) => {
      const row = (await db.query('SELECT body FROM metadata WHERE key=?', [address(id)]))
        .values?.[0]
      return row ? (JSON.parse(row.body as string) as Binding) : null
    })
  const merged = (item: IncomingBackup, saved: Binding | null): IncomingBackup => ({
    ...item,
    ...(saved?.source ? { source: saved.source } : {}),
    ...(saved && saved.state !== 'bound' ? { state: 'already-handled' as const } : {}),
    ...(saved?.result ? { result: saved.result } : {}),
  })
  return {
    async initialize(next) {
      if (handle) throw new DomainError('CAPABILITY_UNAVAILABLE')
      listener = next
      handle = await backupInboxBridge.addListener('changed', notify)
      notify()
    },
    async dispose() {
      listener = undefined
      await handle?.remove()
      handle = undefined
    },
    async pending() {
      const item = await nativeItem()
      return item ? merged(item, await binding(item.id)) : null
    },
    async bind(id, scope) {
      const item = await nativeItem()
      if (!item || item.id !== id || item.state !== 'ready') throw new DomainError('NOT_AVAILABLE')
      const saved = await repository.database.transaction(async (db) => {
        if (canonicalJson(await activeScope(db)) !== canonicalJson(scope))
          throw new DomainError('ACCOUNT_CHANGED')
        const row = (await db.query('SELECT body FROM metadata WHERE key=?', [address(id)]))
          .values?.[0]
        const previous = row ? (JSON.parse(row.body as string) as Binding) : null
        if (previous && previous.state !== 'bound') return previous
        if (
          previous?.source &&
          (canonicalJson(previous.source.key) !== canonicalJson(scope.key) ||
            canonicalJson(previous.source.device) !== canonicalJson(scope.device) ||
            previous.source.generation > scope.generation)
        )
          throw new DomainError('ACCOUNT_CHANGED')
        const value: Binding = { source: structuredClone(scope), state: 'bound' }
        await db.run(
          'INSERT OR REPLACE INTO metadata(key,body) VALUES(?,?)',
          [address(id), canonicalJson(value)],
          false,
        )
        return value
      })
      return merged(item, saved)
    },
    async read(id) {
      const item = await nativeItem(),
        saved = await binding(id)
      if (
        !item ||
        item.id !== id ||
        item.state !== 'ready' ||
        saved?.state !== 'bound' ||
        !saved.source
      )
        throw new DomainError('NOT_AVAILABLE')
      if (canonicalJson(await repository.readActive()) !== canonicalJson(saved.source))
        throw new DomainError('ACCOUNT_CHANGED')
      const chunks: Uint8Array<ArrayBuffer>[] = []
      for (let offset = 0; offset < item.bytes; offset += 512 * 1024) {
        const length = Math.min(512 * 1024, item.bytes - offset)
        const chunk = decodeBase64Bytes(
          (await backupInboxBridge.read({ id, offset, length })).base64,
        )
        if (chunk.length !== length) throw new DomainError('BACKUP_INCOMPLETE')
        chunks.push(chunk)
      }
      const blob = new Blob(chunks, { type: 'application/json' })
      if (
        blob.size !== item.bytes ||
        (await sha256Bytes(new Uint8Array(await blob.arrayBuffer()))) !== id
      )
        throw new DomainError('MEDIA_INVALID')
      if (
        canonicalJson(await repository.readActive()) !== canonicalJson(saved.source) ||
        canonicalJson(await binding(id)) !== canonicalJson(saved)
      )
        throw new DomainError('ACCOUNT_CHANGED')
      return blob
    },
    async finish(id, scope, outcome) {
      // An unrelated notice can arrive after review. The durable source binding
      // authorizes imported completion; the native layer validates that exact ID.
      if (outcome.state === 'dismissed') {
        const item = await nativeItem()
        if (!item || item.id !== id) throw new DomainError('NOT_AVAILABLE')
      }
      await repository.database.transaction(async (db) => {
        if (canonicalJson(await activeScope(db)) !== canonicalJson(scope))
          throw new DomainError('ACCOUNT_CHANGED')
        const row = (await db.query('SELECT body FROM metadata WHERE key=?', [address(id)]))
          .values?.[0]
        const previous = row ? (JSON.parse(row.body as string) as Binding) : null
        if (outcome.state === 'imported') {
          if (
            previous?.state === 'imported' &&
            canonicalJson(previous.result) === canonicalJson(outcome.collection)
          ) {
            if (canonicalJson(previous.source) !== canonicalJson(scope))
              throw new DomainError('ACCOUNT_CHANGED')
            return
          }
          if (
            previous?.state !== 'bound' ||
            canonicalJson(previous.source) !== canonicalJson(scope)
          )
            throw new DomainError('ACCOUNT_CHANGED')
          const exists = (
            await db.query('SELECT key FROM collections WHERE key=?', [
              JSON.stringify([
                outcome.collection.namespace,
                outcome.collection.collectionId,
                outcome.collection.epoch,
              ]),
            ])
          ).values?.length
          if (!exists) throw new DomainError('NOT_AVAILABLE')
        }
        const value: Binding =
          previous?.state === 'imported'
            ? previous
            : {
                ...(previous?.source ? { source: previous.source } : {}),
                state: outcome.state,
                ...(outcome.state === 'imported' ? { result: outcome.collection } : {}),
              }
        await db.run(
          'INSERT OR REPLACE INTO metadata(key,body) VALUES(?,?)',
          [address(id), canonicalJson(value)],
          false,
        )
      })
      await backupInboxBridge.finish({ id })
      notify()
    },
  }
}
