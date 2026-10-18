import type { Repository, LocalCollectionReview } from '../../repositories/contracts'
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
  prepareResolution,
  completeReplacementState,
  type ConflictResolution,
  type StoredCollection,
} from '../../repositories/state'
import { NativeDatabase } from './database'
import { NativeMedia } from './files'
import { NativeDraftStore, type NativeDraft } from './drafts'
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
  async readActive(): Promise<SessionScope | null> {
    return this.database.serial(activeScope)
  }
  private async reviewIn(
    db: SQLiteDBConnection,
    key: CollectionKey,
  ): Promise<LocalCollectionReview> {
    const state = await getState(db, key),
      prefix = `draft:${scopeKey(key)}:`
    const rows =
      (
        await db.query('SELECT body FROM metadata WHERE substr(key,1,length(?))=?', [
          prefix,
          prefix,
        ])
      ).values ?? []
    return {
      key,
      revision: state.version,
      drafts: rows
        .map((row) => {
          const draft = JSON.parse(row.body as string) as NativeDraft
          return { key: draft.id, revision: draft.revision }
        })
        .sort((a, b) => a.key.localeCompare(b.key)),
    }
  }
  async reviewLocal(key: CollectionKey): Promise<LocalCollectionReview> {
    return this.database.serial((db) => this.reviewIn(db, key))
  }
  async transition(
    expected: SessionScope | null,
    target: Pick<SessionScope, 'key' | 'device'>,
    review?: LocalCollectionReview,
  ): Promise<SessionScope> {
    if (!id.safeParse(target.device.id).success || !id.safeParse(target.device.generation).success)
      throw new DomainError('VALIDATION')
    const result = await this.database.transaction(async (db) => {
      const current = await activeScope(db)
      if (canonicalJson(current) !== canonicalJson(expected))
        throw new DomainError('ACCOUNT_CHANGED')
      await getState(db, target.key)
      if (review && canonicalJson(await this.reviewIn(db, review.key)) !== canonicalJson(review))
        throw new DomainError('REVISION_CONFLICT')
      const generation = (current?.generation ?? -1) + 1
      if (!Number.isSafeInteger(generation)) throw new DomainError('INVARIANT_VIOLATION')
      const scope = { ...target, generation }
      await db.run(
        "INSERT OR REPLACE INTO metadata(key,body) VALUES('active',?)",
        [JSON.stringify(scope)],
        false,
      )
      return scope
    })
    this.publish()
    return result
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
  async readAcknowledged(key: CollectionKey): Promise<CollectionView> {
    return this.database.serial(async (db) => {
      const state = await getState(db, key)
      return viewOf({ ...state, pending: [], anchors: { projects: [], checkpoints: [] } })
    })
  }
  private async copyFiles(
    db: SQLiteDBConnection,
    source: CollectionKey,
    target: CollectionKey,
    refs: MediaRef[],
  ) {
    await assertMediaPresent(db, source, refs)
    const files: { ref: MediaRef; fileKey: string }[] = []
    for (const ref of refs) {
      const row = (
        await db.query('SELECT file_key FROM media WHERE scope=? AND id=?', [
          scopeKey(source),
          ref.id,
        ])
      ).values![0]
      const bytes = await durableFiles.read({ key: row.file_key as string })
      if (atob(bytes.base64).length !== ref.bytes) throw new DomainError('MEDIA_INVALID')
      const fileKey = await canonicalHash({ scope: target, id: ref.id })
      await db.run(
        'INSERT OR IGNORE INTO prepared_files(file_key,scope,media_id,created_at) VALUES(?,?,?,?)',
        [fileKey, scopeKey(target), ref.id, Date.now()],
      )
      await durableFiles.put({ key: fileKey, base64: bytes.base64, sha256: ref.sha256 })
      files.push({ ref, fileKey })
    }
    return files
  }
  async completeReplacement(
    key: CollectionKey,
    input: { operationId: string; receipt: Receipt; pages: SnapshotManifest[] },
    generation: number,
  ): Promise<SessionScope> {
    input = structuredClone(input)
    const fingerprint = await canonicalHash({
      operationId: input.operationId,
      receipt: input.receipt,
    })
    const receiptKey = `replacement-complete:${scopeKey(key)}:${input.operationId}`
    const result = await this.database.serial(async (db) => {
      const saved = (await db.query('SELECT body FROM metadata WHERE key=?', [receiptKey]))
        .values?.[0]
      if (saved) {
        const prior = JSON.parse(saved.body as string) as {
          fingerprint: string
          value: SessionScope
        }
        if (prior.fingerprint !== fingerprint) throw new DomainError('OPERATION_REUSED')
        if (canonicalJson(await activeScope(db)) !== canonicalJson(prior.value))
          throw new DomainError('ACCOUNT_CHANGED')
        return prior.value
      }
      await assertGeneration(db, key, generation, true)
      const active = (await activeScope(db))!
      const { old, next } = completeReplacementState(
        await getState(db, key),
        input.operationId,
        input.receipt,
        input.pages,
        active.device,
        Date.now(),
      )
      if (
        (await db.query('SELECT key FROM collections WHERE key=?', [scopeKey(next.info.key)]))
          .values?.length
      )
        throw new DomainError('REVISION_CONFLICT')
      const scope = { ...active, key: next.info.key, generation: active.generation + 1 }
      if (!Number.isSafeInteger(scope.generation)) throw new DomainError('INVARIANT_VIOLATION')
      const cached: MediaRef[] = []
      for (const ref of mediaRefs(next.checkpoints)) {
        const row = (
          await db.query('SELECT body FROM media WHERE scope=? AND id=?', [scopeKey(key), ref.id])
        ).values?.[0]
        if (row && canonicalJson(JSON.parse(row.body as string)) === canonicalJson(ref))
          cached.push(ref)
      }
      // Missing remote media stays unavailable; known local bytes are verified and published first.
      const files = await this.copyFiles(db, key, next.info.key, cached)
      await db.beginTransaction()
      try {
        if (canonicalJson(await activeScope(db)) !== canonicalJson(active))
          throw new DomainError('ACCOUNT_CHANGED')
        await putState(db, old)
        await putState(db, next)
        for (const { ref, fileKey } of files) {
          await db.run(
            'INSERT INTO media(scope,id,body,file_key,prepared_at) VALUES(?,?,?,?,?)',
            [scopeKey(next.info.key), ref.id, JSON.stringify(ref), fileKey, Date.now()],
            false,
          )
          await db.run('DELETE FROM prepared_files WHERE file_key=?', [fileKey], false)
        }
        await db.run(
          "UPDATE metadata SET body=? WHERE key='active'",
          [JSON.stringify(scope)],
          false,
        )
        await db.run(
          'INSERT INTO metadata(key,body) VALUES(?,?)',
          [receiptKey, JSON.stringify({ fingerprint, value: scope })],
          false,
        )
        await db.commitTransaction()
        return scope
      } catch (error) {
        await db.rollbackTransaction().catch(() => undefined)
        throw error
      }
    })
    this.publish()
    return result
  }
  async resolvePending(
    key: CollectionKey,
    resolution: ConflictResolution,
    generation: number,
  ): Promise<{ recovered: CollectionKey | null; commit: LocalCommit | null }> {
    const fingerprint = await canonicalHash(resolution)
    const receiptKey = `resolution:${scopeKey(key)}:${resolution.operationId}:${resolution.expectedRevision}`
    // Keep the local queue through durable copy and transaction; activation/GC cannot interleave.
    const result = await this.database.serial(async (db) => {
      await assertGeneration(db, key, generation, true)
      const previous = (await db.query('SELECT body FROM metadata WHERE key=?', [receiptKey]))
        .values?.[0]
      if (previous) {
        const receipt = JSON.parse(previous.body as string) as {
          fingerprint: string
          value: { recovered: CollectionKey | null; commit: LocalCommit | null }
        }
        if (receipt.fingerprint !== fingerprint) throw new DomainError('OPERATION_REUSED')
        return receipt.value
      }
      const state = await getState(db, key),
        scope = (await activeScope(db))!
      const preserved = prepareResolution(state, resolution)
      const recoveryKey: CollectionKey = {
        namespace: `guest_${crypto.randomUUID()}`,
        collectionId: crypto.randomUUID(),
        epoch: crypto.randomUUID(),
      }
      let recovered: StoredCollection | null = null
      if (preserved.projects.length) {
        recovered = emptyCollection({
          key: recoveryKey,
          name: resolution.recoveryName,
          kind: 'recovered',
          accountId: null,
          createdAt: new Date().toISOString(),
          legacyAccess: false,
        })
        recovered.projects = preserved.projects
        recovered.checkpoints = preserved.checkpoints
        recovered.version = localRevision(
          ...preserved.projects.map((p) => p.revision),
          ...preserved.checkpoints.map((c) => c.revision),
        )
        recovered.provenance = {
          kind: 'recovered',
          sourceId: key.collectionId,
          capturedAt: recovered.info.createdAt,
        }
        assertRecords(recovered.projects, recovered.checkpoints)
      }
      const intent = resolution.replacement
      if (intent) {
        const { createdAt: _createdAt, ...mutation } = intent
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
        applyIntent(state, intent, { upgraded: this.access(state.info) })
        state.pending.push({ intent, command, state: 'queued' })
        state.sequence = command.sequence
        state.sequences[deviceKey(scope.device)] = command.sequence
        state.operations[intent.operationId] = {
          hash: await canonicalHash(intent),
          savedAt: intent.createdAt,
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
      }
      state.version = nextRevision(state.version)
      const files = recovered
        ? await this.copyFiles(db, key, recoveryKey, mediaRefs(recovered.checkpoints))
        : []
      const value = {
        recovered: recovered ? recoveryKey : null,
        commit: intent
          ? { operationId: intent.operationId, savedAt: intent.createdAt, view: viewOf(state) }
          : null,
      }
      await db.beginTransaction()
      try {
        if (recovered) await putState(db, recovered)
        for (const { ref, fileKey } of files) {
          await db.run(
            'INSERT INTO media(scope,id,body,file_key,prepared_at) VALUES(?,?,?,?,?)',
            [scopeKey(recoveryKey), ref.id, JSON.stringify(ref), fileKey, Date.now()],
            false,
          )
          await db.run('DELETE FROM prepared_files WHERE file_key=?', [fileKey], false)
        }
        await putState(db, state)
        await db.run(
          'INSERT INTO metadata(key,body) VALUES(?,?)',
          [receiptKey, JSON.stringify({ fingerprint, value })],
          false,
        )
        await db.commitTransaction()
      } catch (error) {
        await db.rollbackTransaction().catch(() => undefined)
        throw error
      }
      return value
    })
    this.publish()
    return result
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
      await db.run(
        'DELETE FROM pins WHERE owner=? AND scope=?',
        [`operation-plan:${intent.operationId}`, scopeKey(key)],
        false,
      )
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
    options: {
      generation: number
      replace?: { key: CollectionKey; revision: string }
      mediaSource?: CollectionKey
    },
  ) {
    candidate = structuredClone(candidate)
    options = structuredClone(options)
    parseInfo(candidate.info)
    assertRecords(candidate.projects, candidate.checkpoints)
    if (
      candidate.info.kind === 'connected' ||
      (options.replace && scopeKey(options.replace.key) !== scopeKey(candidate.info.key)) ||
      (options.mediaSource && options.replace)
    )
      throw new DomainError('VALIDATION')
    if (options.mediaSource) {
      const source = options.mediaSource
      const result = await this.database.serial(async (db) => {
        await assertGeneration(db, source, options.generation, true)
        const absent = async () => {
          if (
            (
              await db.query('SELECT key FROM collections WHERE key=?', [
                scopeKey(candidate.info.key),
              ])
            ).values?.length
          )
            throw new DomainError('REVISION_CONFLICT')
        }
        await absent()
        const files = await this.copyFiles(
          db,
          source,
          candidate.info.key,
          mediaRefs(candidate.checkpoints),
        )
        await db.beginTransaction()
        try {
          await assertGeneration(db, source, options.generation, true)
          await absent()
          const state = emptyCollection({ ...candidate.info, legacyAccess: false })
          state.version = localRevision(
            ...candidate.projects.map((p) => p.revision),
            ...candidate.checkpoints.map((c) => c.revision),
          )
          state.projects = candidate.projects
          state.checkpoints = candidate.checkpoints
          state.provenance = candidate.provenance
          for (const { ref, fileKey } of files) {
            await db.run(
              'INSERT INTO media(scope,id,body,file_key,prepared_at) VALUES(?,?,?,?,?)',
              [scopeKey(candidate.info.key), ref.id, JSON.stringify(ref), fileKey, Date.now()],
              false,
            )
            await db.run('DELETE FROM prepared_files WHERE file_key=?', [fileKey], false)
          }
          await putState(db, state)
          await db.commitTransaction()
          return viewOf(state)
        } catch (error) {
          await db.rollbackTransaction().catch(() => undefined)
          throw error
        }
      })
      this.publish()
      return result
    }
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
      const view = viewOf(source)
      const draftPrefix = `draft:${scopeKey(key)}:`
      const drafts: NativeDraft[] = recovered
        ? []
        : (
            (
              await db.query('SELECT body FROM metadata WHERE substr(key,1,length(?))=?', [
                draftPrefix,
                draftPrefix,
              ])
            ).values ?? []
          ).map((row) => JSON.parse(row.body as string) as NativeDraft)
      const allRefs = new Map<string, MediaRef>()
      for (const ref of [
        ...mediaRefs(view.checkpoints),
        ...drafts.flatMap((draft) => draft.media),
      ]) {
        const previous = allRefs.get(ref.id)
        if (previous && canonicalJson(previous) !== canonicalJson(ref))
          throw new DomainError('MEDIA_INVALID')
        allRefs.set(ref.id, ref)
      }
      const refs = [...allRefs.values()]
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
      const files = await this.copyFiles(db, key, target, refs)
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
        for (const draft of drafts) {
          await db.run(
            'INSERT INTO metadata(key,body) VALUES(?,?)',
            [`draft:${scopeKey(target)}:${draft.id}`, JSON.stringify({ ...draft, scope: target })],
            false,
          )
          for (const ref of draft.media)
            await db.run(
              'INSERT INTO pins(owner,scope,media_id) VALUES(?,?,?)',
              [`draft:${draft.id}`, scopeKey(target), ref.id],
              false,
            )
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
        "DELETE FROM pins WHERE scope=? AND (owner LIKE 'draft:%' OR owner LIKE 'operation-plan:%')",
        [scopeKey(key)],
        false,
      )
      for (const kind of ['draft', 'operation-plan', 'resolution', 'replacement-complete'])
        await db.run(
          'DELETE FROM metadata WHERE substr(key,1,length(?))=?',
          [`${kind}:${scopeKey(key)}:`, `${kind}:${scopeKey(key)}:`],
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
