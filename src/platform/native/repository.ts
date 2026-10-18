import type { Repository } from '../../repositories/contracts'
import type {
  CollectionInfo,
  CollectionKey,
  CollectionView,
  LocalCollectionCandidate,
  LocalIntent,
  LocalCommit,
  LocalSnapshot,
  SessionScope,
  PullPage,
  Receipt,
  SnapshotManifest,
  RecoveryReason,
  MediaRef,
} from '../../domain/contracts'
import type { SafeError } from '../../domain/errors'
import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import { DomainError } from '../../domain/errors'
import { canonicalHash, canonicalJson } from '../../domain/canonical-json'
import { signCommand, parsePullPage, id } from '../../domain/schema'
import {
  emptyCollection,
  deviceKey,
  localRevision,
  nextRevision,
  viewOf,
  applyIntent,
  applyReceipt,
  hydrateState,
  assertRecords,
  mediaRefs,
  parseInfo,
  type StoredCollection,
} from '../../repositories/state'
import { NativeDatabase } from './database'
import { NativeMedia } from './files'
import { NativeDraftStore } from './drafts'
import { activeScope, assertGeneration, scopeKey } from './recovery-journal'
import { durableFiles } from './files-bridge'

export interface NativeRepositoryOptions {
  databaseName?: string
  access?: (info: CollectionInfo) => boolean
}
const getState = async (db: SQLiteDBConnection, key: CollectionKey): Promise<StoredCollection> => {
  const row = (await db.query('SELECT body FROM collections WHERE key=?', [scopeKey(key)]))
    .values?.[0]
  if (!row) throw new DomainError('NOT_AVAILABLE')
  return JSON.parse(row.body as string) as StoredCollection
}
const putState = async (db: SQLiteDBConnection, state: StoredCollection) => {
  await db.run(
    'INSERT OR REPLACE INTO collections(key,body) VALUES(?,?)',
    [scopeKey(state.info.key), JSON.stringify(state)],
    false,
  )
}
async function assertMediaPresent(db: SQLiteDBConnection, key: CollectionKey, refs: MediaRef[]) {
  for (const ref of refs) {
    const row = (
      await db.query('SELECT body FROM media WHERE scope=? AND id=?', [scopeKey(key), ref.id])
    ).values?.[0]
    if (!row || canonicalJson(JSON.parse(row.body as string)) !== canonicalJson(ref))
      throw new DomainError('BACKUP_INCOMPLETE')
  }
}
export class NativeRepository implements Repository {
  readonly media: NativeMedia
  readonly drafts: NativeDraftStore
  private listeners = new Set<() => void>()
  constructor(
    readonly database: NativeDatabase,
    private access: (info: CollectionInfo) => boolean = () => false,
  ) {
    this.media = new NativeMedia(database)
    this.drafts = new NativeDraftStore(database)
  }
  private publish() {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        /* Isolate observers. */
      }
    }
  }
  async listCollections(): Promise<CollectionInfo[]> {
    return this.database.serial(async (db) =>
      ((await db.query('SELECT body FROM collections')).values ?? []).map(
        (row) => (JSON.parse(row.body as string) as StoredCollection).info,
      ),
    )
  }
  async createCollection(info: CollectionInfo) {
    const state = emptyCollection(info)
    await this.database.transaction(async (db) => {
      if (
        (await db.query('SELECT key FROM collections WHERE key=?', [scopeKey(info.key)])).values
          ?.length
      )
        throw new DomainError('REVISION_CONFLICT')
      await putState(db, state)
    })
    this.publish()
  }
  async activate(scope: SessionScope) {
    if (
      !Number.isSafeInteger(scope.generation) ||
      scope.generation < 0 ||
      !id.safeParse(scope.device.id).success ||
      !id.safeParse(scope.device.generation).success
    )
      throw new DomainError('VALIDATION')
    await this.database.transaction(async (db) => {
      await getState(db, scope.key)
      const current = await activeScope(db)
      if (
        current &&
        (scope.generation < current.generation ||
          (scope.generation === current.generation &&
            canonicalJson(scope) !== canonicalJson(current)))
      )
        throw new DomainError('ACCOUNT_CHANGED')
      await db.run(
        "INSERT OR REPLACE INTO metadata(key,body) VALUES('active',?)",
        [JSON.stringify(scope)],
        false,
      )
    })
    this.publish()
  }
  async readView(key: CollectionKey): Promise<CollectionView> {
    return this.database.serial(async (db) => viewOf(await getState(db, key)))
  }
  async commitLocal(
    key: CollectionKey,
    intent: LocalIntent,
    generation: number,
  ): Promise<LocalCommit> {
    const hash = await canonicalHash(intent)
    const result = await this.database.transaction(async (db) => {
      await assertGeneration(db, key, generation, true)
      const scope = (await activeScope(db))!
      const state = await getState(db, key)
      const prior = Object.hasOwn(state.operations, intent.operationId)
        ? state.operations[intent.operationId]
        : undefined
      if (prior) {
        if (prior.hash !== hash) throw new DomainError('OPERATION_REUSED')
        return { operationId: intent.operationId, savedAt: prior.savedAt, view: viewOf(state) }
      }
      const { createdAt: _createdAt, ...mutation } = intent
      // SQLite remains open across local cryptographic work only; never network calls.
      const command = await signCommand({
        ...mutation,
        protocolVersion: 2,
        payloadVersion: 1,
        collectionId: key.collectionId,
        epoch: key.epoch,
        deviceId: scope.device.id,
        deviceGeneration: scope.device.generation,
        sequence: nextRevision(state.sequences[deviceKey(scope.device)] ?? '0'),
      })
      const before = viewOf(state)
      applyIntent(state, intent, { upgraded: this.access(state.info) })
      if (state.info.kind === 'connected') state.pending.push({ intent, command, state: 'queued' })
      else {
        const view = viewOf(state)
        state.receipts[intent.operationId] = {
          operationId: intent.operationId,
          sha256: command.sha256,
          epoch: key.epoch,
          revision: nextRevision(state.version),
          cursor: state.cursor,
          resultId: intent.operationId,
          changes: [
            ...view.projects
              .filter((value) => value.revision === nextRevision(state.version))
              .map((value) => ({ kind: 'project.put' as const, value })),
            ...view.checkpoints
              .filter((value) => value.revision === nextRevision(state.version))
              .map((value) => ({ kind: 'checkpoint.put' as const, value })),
            ...before.projects
              .filter((value) => !view.projects.some((p) => p.id === value.id))
              .map((value) => ({
                kind: 'project.delete' as const,
                id: value.id,
                revision: nextRevision(state.version),
              })),
            ...before.checkpoints
              .filter((value) => !view.checkpoints.some((c) => c.id === value.id))
              .map((value) => ({
                kind: 'checkpoint.delete' as const,
                id: value.id,
                projectId: value.projectId,
                revision: nextRevision(state.version),
              })),
          ],
        }
      }
      await assertMediaPresent(
        db,
        key,
        intent.kind === 'checkpoint.create'
          ? mediaRefs([{ ...intent.payload.checkpoint, revision: '0' }])
          : intent.kind === 'media.attach'
            ? [intent.payload.media]
            : [],
      )
      state.version = nextRevision(state.version)
      state.sequence = command.sequence
      state.sequences[deviceKey(scope.device)] = command.sequence
      state.operations[intent.operationId] = { hash, savedAt: intent.createdAt }
      await putState(db, state)
      return { operationId: intent.operationId, savedAt: intent.createdAt, view: viewOf(state) }
    })
    this.publish()
    return result
  }
  private async change(
    key: CollectionKey,
    generation: number,
    work: (state: StoredCollection) => void,
  ) {
    await this.database.transaction(async (db) => {
      await assertGeneration(db, key, generation, true)
      const state = await getState(db, key)
      work(state)
      state.version = nextRevision(state.version)
      await putState(db, state)
    })
    this.publish()
  }
  async acknowledge(key: CollectionKey, receipt: Receipt, generation: number) {
    await this.change(key, generation, (state) => {
      applyReceipt(state, receipt)
    })
  }
  async applyPage(key: CollectionKey, input: PullPage, generation: number) {
    const page = parsePullPage(input)
    await this.change(key, generation, (state) => {
      if (page.collectionId !== key.collectionId || page.epoch !== key.epoch)
        throw new DomainError('SYNC_REBASE_REQUIRED')
      if (page.afterCursor !== state.cursor) throw new DomainError('SYNC_PAGE_INVALID')
      for (const receipt of page.entries) applyReceipt(state, receipt)
      state.cursor = page.nextCursor
    })
  }
  async hydrate(key: CollectionKey, pages: SnapshotManifest[], generation: number) {
    await this.change(key, generation, (state) => {
      hydrateState(state, pages, Date.now())
    })
  }
  async pending(key: CollectionKey) {
    return (await this.readView(key)).pending
  }
  async markAttempt(key: CollectionKey, operationId: string, generation: number) {
    await this.change(key, generation, (state) => {
      const pending = state.pending.find((p) => p.command.operationId === operationId)
      if (pending) pending.state = 'attempted'
    })
  }
  async markFailure(key: CollectionKey, operationId: string, error: SafeError, generation: number) {
    await this.change(key, generation, (state) => {
      const pending = state.pending.find((p) => p.command.operationId === operationId)
      if (pending) {
        pending.error = error
        pending.state =
          error.code === 'REVISION_CONFLICT' ? 'conflict' : error.retryable ? 'queued' : 'rejected'
      }
    })
  }
  async importLocal(
    candidate: LocalCollectionCandidate,
    options: { generation: number; replace?: { key: CollectionKey; revision: string } },
  ) {
    parseInfo(candidate.info)
    assertRecords(candidate.projects, candidate.checkpoints)
    if (
      candidate.info.kind === 'connected' ||
      (options.replace && scopeKey(options.replace.key) !== scopeKey(candidate.info.key))
    )
      throw new DomainError('VALIDATION')
    const result = await this.database.transaction(async (db) => {
      await assertGeneration(db, candidate.info.key, options.generation)
      const previous = await getState(db, candidate.info.key)
      if (
        previous.info.kind === 'connected' ||
        (options.replace
          ? previous.version !== options.replace.revision
          : previous.version !== '0' ||
            previous.projects.length > 0 ||
            previous.checkpoints.length > 0)
      )
        throw new DomainError('REVISION_CONFLICT')
      await assertMediaPresent(db, candidate.info.key, mediaRefs(candidate.checkpoints))
      const state = emptyCollection({
        ...candidate.info,
        legacyAccess: candidate.provenance.kind === 'legacy' && candidate.info.legacyAccess,
      })
      state.version = localRevision(
        previous.version,
        ...candidate.projects.map((p) => p.revision),
        ...candidate.checkpoints.map((c) => c.revision),
      )
      state.projects = candidate.projects
      state.checkpoints = candidate.checkpoints
      state.provenance = candidate.provenance
      await putState(db, state)
      return viewOf(state)
    })
    this.publish()
    return result
  }
  private async copyLocal(
    key: CollectionKey,
    name: string,
    revision: string,
    generation: number,
    recovered?: RecoveryReason,
  ): Promise<CollectionKey> {
    const target = {
      namespace: `guest_${crypto.randomUUID()}`,
      collectionId: crypto.randomUUID(),
      epoch: crypto.randomUUID(),
    }
    // Serialize with generation activation and GC; publish files before opening SQL transaction.
    await this.database.serial(async (db) => {
      await assertGeneration(db, key, generation, true)
      const source = await getState(db, key)
      if (source.version !== revision) throw new DomainError('REVISION_CONFLICT')
      const view = viewOf(source),
        refs = mediaRefs(view.checkpoints)
      await assertMediaPresent(db, key, refs)
      const copied = emptyCollection({
        ...source.info,
        key: target,
        accountId: null,
        name,
        kind: recovered ? 'recovered' : 'retained',
        legacyAccess: source.info.kind !== 'connected' && source.info.legacyAccess,
        createdAt: new Date().toISOString(),
      })
      copied.projects = view.projects
      copied.checkpoints = view.checkpoints
      copied.version = localRevision(
        ...view.projects.map((p) => p.revision),
        ...view.checkpoints.map((c) => c.revision),
      )
      copied.provenance = {
        kind: recovered ? 'recovered' : 'retained',
        sourceId: key.collectionId,
        capturedAt: copied.info.createdAt,
      }
      const files: { ref: MediaRef; fileKey: string }[] = []
      for (const ref of refs) {
        const row = (
          await db.query('SELECT file_key FROM media WHERE scope=? AND id=?', [
            scopeKey(key),
            ref.id,
          ])
        ).values![0]
        const bytes = await durableFiles.read({ key: row.file_key as string })
        const fileKey = await canonicalHash({ scope: target, id: ref.id })
        await db.run(
          'INSERT INTO prepared_files(file_key,scope,media_id,created_at) VALUES(?,?,?,?)',
          [fileKey, scopeKey(target), ref.id, Date.now()],
        )
        await durableFiles.put({ key: fileKey, base64: bytes.base64, sha256: ref.sha256 })
        files.push({ ref, fileKey })
      }
      await db.beginTransaction()
      try {
        await putState(db, copied)
        for (const { ref, fileKey } of files) {
          await db.run(
            'INSERT INTO media(scope,id,body,file_key,prepared_at) VALUES(?,?,?,?,?)',
            [scopeKey(target), ref.id, JSON.stringify(ref), fileKey, Date.now()],
            false,
          )
          await db.run('DELETE FROM prepared_files WHERE file_key=?', [fileKey], false)
        }
        if (recovered) {
          source.pending = []
          source.anchors = { projects: [], checkpoints: [] }
          source.version = nextRevision(source.version)
          await putState(db, source)
        }
        await db.commitTransaction()
      } catch (error) {
        await db.rollbackTransaction()
        throw error
      }
    })
    this.publish()
    return target
  }
  async retainLocal(key: CollectionKey, name: string, revision: string, generation: number) {
    return this.copyLocal(key, name, revision, generation)
  }
  async recoverPending(key: CollectionKey, reason: RecoveryReason) {
    const { scope, state } = await this.database.serial(async (db) => ({
      scope: await activeScope(db),
      state: await getState(db, key),
    }))
    if (!scope || scopeKey(scope.key) !== scopeKey(key)) throw new DomainError('ACCOUNT_CHANGED')
    return this.copyLocal(
      key,
      `Recovered ${state.info.name}`.slice(0, 100),
      state.version,
      scope.generation,
      reason,
    )
  }
  async removeLocal(key: CollectionKey, revision: string, generation: number) {
    await this.database.transaction(async (db) => {
      await assertGeneration(db, key, generation, true)
      const state = await getState(db, key)
      if (state.version !== revision) throw new DomainError('REVISION_CONFLICT')
      await db.run(
        'DELETE FROM pins WHERE scope=? AND owner LIKE ?',
        [scopeKey(key), 'draft:%'],
        false,
      )
      await db.run(
        'DELETE FROM metadata WHERE substr(key,1,length(?))=?',
        [`draft:${scopeKey(key)}:`, `draft:${scopeKey(key)}:`],
        false,
      )
      await db.run('DELETE FROM collections WHERE key=?', [scopeKey(key)], false)
    })
    this.publish()
  }
  async snapshot(key: CollectionKey): Promise<LocalSnapshot> {
    return this.database.transaction(async (db) => {
      const view = viewOf(await getState(db, key)),
        refs = mediaRefs(view.checkpoints)
      await assertMediaPresent(db, key, refs)
      const snapshot = {
        id: crypto.randomUUID(),
        view,
        media: refs,
        createdAt: new Date().toISOString(),
      }
      for (const ref of refs)
        await db.run(
          'INSERT INTO pins(owner,scope,media_id) VALUES(?,?,?)',
          [`snapshot:${snapshot.id}`, scopeKey(key), ref.id],
          false,
        )
      await db.run(
        'INSERT INTO metadata(key,body) VALUES(?,?)',
        [`snapshot:${snapshot.id}`, JSON.stringify(snapshot)],
        false,
      )
      return snapshot
    })
  }
  async releaseSnapshot(id: string) {
    await this.database.transaction(async (db) => {
      await db.run('DELETE FROM pins WHERE owner=?', [`snapshot:${id}`], false)
      await db.run('DELETE FROM metadata WHERE key=?', [`snapshot:${id}`], false)
    })
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  async close() {
    this.listeners.clear()
    await this.database.close()
  }
}
export async function openNativeRepository(options: NativeRepositoryOptions = {}) {
  return new NativeRepository(await NativeDatabase.open(options.databaseName), options.access)
}
