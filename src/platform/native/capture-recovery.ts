import { App, type RestoredListenerEvent } from '@capacitor/app'
import type { SessionScope } from '../../domain/contracts'
import type { MediaInput } from '../contracts'
import { DomainError } from '../../domain/errors'
import { canonicalHash, canonicalJson } from '../../domain/canonical-json'
import { mediaRefSchema } from '../../domain/schema'
import { readFile } from '../../media'
import { dataUrlToBlob } from '../../services/media-codec'
import type { NativeRepository } from './repository'
import { activeScope, assertGeneration, scopeKey } from './recovery-journal'
import { durableFiles } from './files-bridge'
import { normalizeNativePhoto } from './camera'
import type { NativeDraft } from './drafts'

export interface NativeCaptureSource {
  scope: SessionScope
  draftKey: string
  draftRevision?: string
}
export interface PendingNativeCapture {
  id: string
  source: NativeCaptureSource
  state: 'waiting' | 'ready' | 'failed'
  createdAt: string
}
interface StoredCapture extends PendingNativeCapture {
  fileKey?: string
  sha256?: string
  bytes?: number
}
const ROW = 'native-camera-continuation'
type DB = NativeRepository['database']['connection']
async function read(db: DB): Promise<StoredCapture | null> {
  const row = (await db.query('SELECT body FROM metadata WHERE key=?', [ROW])).values?.[0]
  return row ? (JSON.parse(row.body as string) as StoredCapture) : null
}
async function write(db: DB, value: StoredCapture) {
  await db.run(
    'INSERT OR REPLACE INTO metadata(key,body) VALUES(?,?)',
    [ROW, JSON.stringify(value)],
    false,
  )
}
async function sameSource(db: DB, scope: SessionScope, source: NativeCaptureSource) {
  if (scopeKey(source.scope.key) !== scopeKey(scope.key)) return false
  if (canonicalJson(source.scope.device) === canonicalJson(scope.device)) return true
  const row = (await db.query('SELECT body FROM collections WHERE key=?', [scopeKey(scope.key)]))
    .values?.[0]
  return !!row && JSON.parse(row.body as string).info.kind !== 'connected'
}
async function fence(db: DB, scope: SessionScope, source?: NativeCaptureSource) {
  await assertGeneration(db, scope.key, scope.generation, true)
  if (canonicalJson(await activeScope(db)) !== canonicalJson(scope))
    throw new DomainError('ACCOUNT_CHANGED')
  // A process relaunch may increment generation. The collection epoch and enrolled device must still match.
  if (source && !(await sameSource(db, scope, source))) throw new DomainError('ACCOUNT_CHANGED')
}
/** Durable Android activity continuation. A restored result is offered for explicit draft recovery. */
export class NativeCaptureRecovery {
  constructor(private repository: NativeRepository) {}
  async begin(source: NativeCaptureSource): Promise<string> {
    source = structuredClone(source)
    if (!source.draftKey || source.draftKey.length > 100 || source.draftKey.includes('\0'))
      throw new DomainError('VALIDATION')
    return this.repository.database.transaction(async (db) => {
      await fence(db, source.scope)
      if (await read(db)) throw new DomainError('CAPABILITY_UNAVAILABLE')
      const draft = (
        await db.query('SELECT body FROM metadata WHERE key=?', [
          `draft:${scopeKey(source.scope.key)}:${source.draftKey}`,
        ])
      ).values?.[0]
      if ((draft ? JSON.parse(draft.body as string).revision : undefined) !== source.draftRevision)
        throw new DomainError('REVISION_CONFLICT')
      const id = crypto.randomUUID()
      await write(db, { id, source, state: 'waiting', createdAt: new Date().toISOString() })
      return id
    })
  }
  /** Normal promise delivery owns cleanup. A process-recreated callback uses restore() instead. */
  async finish(id: string): Promise<void> {
    await this.repository.database.transaction(async (db) => {
      if ((await read(db))?.id === id)
        await db.run('DELETE FROM metadata WHERE key=?', [ROW], false)
    })
  }
  async pending(scope: SessionScope): Promise<PendingNativeCapture | null> {
    return this.repository.database.serial(async (db) => {
      await fence(db, scope)
      const value = await read(db)
      if (!value || !(await sameSource(db, scope, value.source))) return null
      return { id: value.id, source: value.source, state: value.state, createdAt: value.createdAt }
    })
  }
  async photo(id: string, scope: SessionScope): Promise<MediaInput> {
    return this.repository.database.serial(async (db) => {
      const value = await read(db)
      if (!value || value.id !== id || value.state !== 'ready' || !value.fileKey || !value.sha256)
        throw new DomainError('NOT_AVAILABLE')
      await fence(db, scope, value.source)
      const file = await durableFiles.read({ key: value.fileKey })
      const bytes = dataUrlToBlob(`data:image/jpeg;base64,${file.base64}`)
      const digest = await crypto.subtle.digest('SHA-256', await bytes.arrayBuffer())
      const hash = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(
        '',
      )
      if (hash !== value.sha256 || bytes.size !== value.bytes)
        throw new DomainError('MEDIA_INVALID')
      return { kind: 'photo', bytes }
    })
  }
  /** Call only after the source-bound draft CAS succeeds, or after explicit discard. */
  async acknowledge(id: string, scope: SessionScope): Promise<void> {
    await this.repository.database.transaction(async (db) => {
      const value = await read(db)
      if (!value || value.id !== id) return
      await fence(db, scope, value.source)
      await db.run('DELETE FROM metadata WHERE key=?', [ROW], false)
    })
    // The ordinary orphan grace period removes the now-unreferenced staging file.
  }
  /** Explicit confirmation only: durable media, draft CAS, pins, and continuation retirement. */
  async applyToDraft(id: string, scope: SessionScope): Promise<{ key: string; revision: string }> {
    const input = await this.photo(id, scope)
    const prepared = await this.repository.media.prepare(input, scope.key, scope.generation)
    return this.repository.database.transaction(async (db) => {
      const capture = await read(db)
      if (!capture || capture.id !== id || capture.state !== 'ready')
        throw new DomainError('NOT_AVAILABLE')
      await fence(db, scope, capture.source)
      const key = `draft:${scopeKey(scope.key)}:${capture.source.draftKey}`
      const row = (await db.query('SELECT body FROM metadata WHERE key=?', [key])).values?.[0]
      const draft = row ? (JSON.parse(row.body as string) as NativeDraft) : null
      if (!draft || draft.revision !== capture.source.draftRevision)
        throw new DomainError('REVISION_CONFLICT')
      if (!draft.value || typeof draft.value !== 'object' || Array.isArray(draft.value))
        throw new DomainError('VALIDATION')
      const value = { ...draft.value, photo: prepared.ref } as Record<string, unknown>
      const refs = ['photo', 'voice']
        .filter((kind) => value[kind] !== undefined)
        .map((kind) => {
          const ref = mediaRefSchema.parse(value[kind])
          if (ref.kind !== kind) throw new DomainError('MEDIA_INVALID')
          return ref
        })
      for (const ref of refs) {
        const media = (
          await db.query('SELECT body FROM media WHERE scope=? AND id=?', [
            scopeKey(scope.key),
            ref.id,
          ])
        ).values?.[0]
        if (!media || canonicalJson(JSON.parse(media.body as string)) !== canonicalJson(ref))
          throw new DomainError('MEDIA_INVALID')
      }
      const revision = crypto.randomUUID()
      await db.run(
        'UPDATE metadata SET body=? WHERE key=?',
        [
          JSON.stringify({
            ...draft,
            value,
            media: refs,
            revision,
            updatedAt: new Date().toISOString(),
          }),
          key,
        ],
        false,
      )
      await db.run(
        'DELETE FROM pins WHERE owner=? AND scope=?',
        [`draft:${draft.id}`, scopeKey(scope.key)],
        false,
      )
      for (const ref of refs)
        await db.run(
          'INSERT INTO pins(owner,scope,media_id) VALUES(?,?,?)',
          [`draft:${draft.id}`, scopeKey(scope.key), ref.id],
          false,
        )
      await db.run('DELETE FROM metadata WHERE key=?', [ROW], false)
      return { key: draft.id, revision }
    })
  }
  async restore(event: RestoredListenerEvent): Promise<string | null> {
    if (event.pluginId !== 'Camera' || event.methodName !== 'getPhoto') return null
    return this.repository.database.serial(async (db) => {
      const value = await read(db)
      if (!value || value.state !== 'waiting') return null
      if (
        !(
          await db.query('SELECT key FROM collections WHERE key=?', [
            scopeKey(value.source.scope.key),
          ])
        ).values?.length
      )
        return null
      try {
        if (!event.success) throw new DomainError('MEDIA_INVALID')
        const input = await normalizeNativePhoto(event.data)
        const digest = await crypto.subtle.digest('SHA-256', await input.bytes.arrayBuffer())
        const sha256 = Array.from(new Uint8Array(digest), (n) =>
          n.toString(16).padStart(2, '0'),
        ).join('')
        const fileKey = await canonicalHash({
          nativeCapture: value.id,
          scope: value.source.scope.key,
        })
        // Journal before durable write; GC protects this exact key even across a partial failure.
        await write(db, { ...value, fileKey, sha256, bytes: input.bytes.size })
        const data = await readFile(input.bytes)
        await durableFiles.put({ key: fileKey, base64: data.slice(data.indexOf(',') + 1), sha256 })
        await write(db, { ...value, fileKey, sha256, bytes: input.bytes.size, state: 'ready' })
      } catch {
        const latest = await read(db)
        if (latest?.id === value.id) await write(db, { ...latest, state: 'failed' })
      }
      return value.id
    })
  }
  async subscribe(listener: (id: string) => void): Promise<() => Promise<void>> {
    let active = true
    const handle = await App.addListener('appRestoredResult', (event) => {
      void this.restore(event)
        .then((id) => {
          if (id && active) listener(id)
        })
        .catch(() => undefined)
    })
    return async () => {
      active = false
      await handle.remove()
    }
  }
}
