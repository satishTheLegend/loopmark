import type { Repository, LocalCollectionReview } from '../contracts'
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
} from '../../domain/contracts'
import type { SafeError } from '../../domain/errors'
import { DomainError } from '../../domain/errors'
import { canonicalHash, canonicalJson } from '../../domain/canonical-json'
import { signCommand, parsePullPage, id } from '../../domain/schema'
import {
  emptyCollection,
  keyOf,
  nextRevision,
  localRevision,
  deviceKey,
  viewOf,
  applyIntent,
  prepareResolution,
  type ConflictResolution,
  applyReceipt,
  hydrateState,
  assertRecords,
  mediaRefs,
  parseInfo,
  type StoredCollection,
} from '../state'
import {
  openDatabase,
  transaction,
  getState,
  putState,
  assertGeneration,
  activeScope,
  requestResult,
  mediaKey,
  type CollectionRow,
  type SnapshotRow,
  type MediaRow,
  BROWSER_DATABASE,
} from './schema'
import { BrowserMediaStore, assertMediaPresent, verifyBytes } from './media-store'

export interface BrowserRepositoryOptions {
  databaseName?: string
  factory?: IDBFactory
  /** Local UX only. Supply only a verified account/environment-scoped entitlement cache.
   * The server independently enforces every connected mutation. */
  access?: (info: CollectionInfo) => boolean
}
export class BrowserRepository implements Repository {
  readonly media: BrowserMediaStore
  private readonly listeners = new Set<() => void>()
  private readonly channel?: BroadcastChannel
  constructor(
    readonly database: IDBDatabase,
    private readonly access: (info: CollectionInfo) => boolean = () => false,
  ) {
    this.media = new BrowserMediaStore(database)
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`${database.name}-changes`)
      this.channel.onmessage = () => this.dispatch()
    }
  }
  private dispatch(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        /* Isolate subscribers. */
      }
    }
  }
  private publish(): void {
    this.dispatch()
    this.channel?.postMessage('changed')
  }
  async readActive(): Promise<SessionScope | null> {
    return transaction(this.database, 'readonly', async (tx) => (await activeScope(tx)) ?? null)
  }
  private async reviewIn(tx: IDBTransaction, key: CollectionKey): Promise<LocalCollectionReview> {
    const state = await getState(tx, key)
    const rows = await requestResult<
      Array<{ scope: CollectionKey; value: { key: string; revision: string } }>
    >(tx.objectStore('drafts').getAll())
    return {
      key,
      revision: state.version,
      drafts: rows
        .filter((row) => keyOf(row.scope) === keyOf(key))
        .map((row) => ({ key: row.value.key, revision: row.value.revision }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    }
  }
  async reviewLocal(key: CollectionKey): Promise<LocalCollectionReview> {
    return transaction(this.database, 'readonly', (tx) => this.reviewIn(tx, key))
  }
  async transition(
    expected: SessionScope | null,
    target: Pick<SessionScope, 'key' | 'device'>,
    review?: LocalCollectionReview,
  ): Promise<SessionScope> {
    if (!id.safeParse(target.device.id).success || !id.safeParse(target.device.generation).success)
      throw new DomainError('VALIDATION')
    const result = await transaction(this.database, 'readwrite', async (tx) => {
      const active = (await activeScope(tx)) ?? null
      if (canonicalJson(active) !== canonicalJson(expected))
        throw new DomainError('ACCOUNT_CHANGED')
      await getState(tx, target.key)
      if (review && canonicalJson(await this.reviewIn(tx, review.key)) !== canonicalJson(review))
        throw new DomainError('REVISION_CONFLICT')
      const generation = (active?.generation ?? -1) + 1
      if (!Number.isSafeInteger(generation)) throw new DomainError('INVARIANT_VIOLATION')
      const scope = { ...target, generation }
      tx.objectStore('meta').put({ key: 'active', value: scope })
      return scope
    })
    this.publish()
    return result
  }
  async listCollections(): Promise<CollectionInfo[]> {
    return transaction(this.database, 'readonly', async (tx) =>
      (await requestResult<CollectionRow[]>(tx.objectStore('collections').getAll())).map(
        (row) => row.value.info,
      ),
    )
  }
  async createCollection(info: CollectionInfo): Promise<void> {
    const value = emptyCollection(info)
    await transaction(this.database, 'readwrite', async (tx) => {
      if (await requestResult(tx.objectStore('collections').get(keyOf(info.key))))
        throw new DomainError('REVISION_CONFLICT')
      putState(tx, value)
    })
    this.publish()
  }
  async activate(scope: SessionScope): Promise<void> {
    if (
      !Number.isSafeInteger(scope.generation) ||
      scope.generation < 0 ||
      !id.safeParse(scope.device.id).success ||
      !id.safeParse(scope.device.generation).success
    )
      throw new DomainError('VALIDATION')
    await transaction(this.database, 'readwrite', async (tx) => {
      await getState(tx, scope.key)
      const active = await activeScope(tx)
      if (
        active &&
        (scope.generation < active.generation ||
          (scope.generation === active.generation &&
            canonicalJson(active) !== canonicalJson(scope)))
      )
        throw new DomainError('ACCOUNT_CHANGED')
      tx.objectStore('meta').put({ key: 'active', value: scope })
    })
    this.publish()
  }
  async readView(key: CollectionKey): Promise<CollectionView> {
    return transaction(this.database, 'readonly', async (tx) => viewOf(await getState(tx, key)))
  }
  async readAcknowledged(key: CollectionKey): Promise<CollectionView> {
    return transaction(this.database, 'readonly', async (tx) => {
      const state = await getState(tx, key)
      return viewOf({ ...state, pending: [], anchors: { projects: [], checkpoints: [] } })
    })
  }
  async resolvePending(
    key: CollectionKey,
    resolution: ConflictResolution,
    generation: number,
  ): Promise<{ recovered: CollectionKey | null; commit: LocalCommit | null }> {
    const fingerprint = await canonicalHash(resolution)
    const receiptKey = JSON.stringify([
      'resolution',
      keyOf(key),
      resolution.operationId,
      resolution.expectedRevision,
    ])
    type ResolutionReceipt = {
      key: string
      fingerprint: string
      value: { recovered: CollectionKey | null; commit: LocalCommit | null }
    }
    const { state, scope, previous } = await transaction(this.database, 'readonly', async (tx) => ({
      state: await getState(tx, key),
      scope: await assertGeneration(tx, key, generation),
      previous: await requestResult<ResolutionReceipt | undefined>(
        tx.objectStore('meta').get(receiptKey),
      ),
    }))
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new DomainError('OPERATION_REUSED')
      return previous.value
    }
    const observedVersion = state.version
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
    if (resolution.replacement) {
      const intent = resolution.replacement,
        { createdAt: _createdAt, ...mutation } = intent
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
    }
    state.version = nextRevision(state.version)
    const value = {
      recovered: recovered ? recoveryKey : null,
      commit: resolution.replacement
        ? {
            operationId: resolution.replacement.operationId,
            savedAt: resolution.replacement.createdAt,
            view: viewOf(state),
          }
        : null,
    }
    const result = await transaction(this.database, 'readwrite', async (tx) => {
      await assertGeneration(tx, key, generation)
      const existing = await requestResult<ResolutionReceipt | undefined>(
        tx.objectStore('meta').get(receiptKey),
      )
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new DomainError('OPERATION_REUSED')
        return existing.value
      }
      const current = await getState(tx, key)
      if (current.version !== observedVersion) throw new DomainError('REVISION_CONFLICT')
      if (recovered) {
        const refs = mediaRefs(recovered.checkpoints)
        await assertMediaPresent(tx, key, refs)
        for (const ref of refs) {
          const row = await requestResult<MediaRow>(
            tx.objectStore('media').get(mediaKey(key, ref.id)),
          )
          tx.objectStore('media').add({
            ...row,
            key: mediaKey(recoveryKey, ref.id),
            scope: recoveryKey,
          })
        }
        putState(tx, recovered)
      }
      const intent = resolution.replacement
      if (intent) {
        const refs =
          intent.kind === 'checkpoint.create'
            ? mediaRefs([{ ...intent.payload.checkpoint, revision: '0' }])
            : intent.kind === 'media.attach'
              ? [intent.payload.media]
              : []
        await assertMediaPresent(tx, key, refs)
      }
      putState(tx, state)
      tx.objectStore('meta').add({
        key: receiptKey,
        fingerprint,
        value,
      } satisfies ResolutionReceipt)
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
    const intentHash = await canonicalHash(intent)
    for (let attempt = 0; attempt < 12; attempt++) {
      const { state, scope } = await transaction(this.database, 'readonly', async (tx) => ({
        scope: await assertGeneration(tx, key, generation),
        state: await getState(tx, key),
      }))
      const prior = Object.hasOwn(state.operations, intent.operationId)
        ? state.operations[intent.operationId]
        : undefined
      if (prior) {
        if (prior.hash !== intentHash) throw new DomainError('OPERATION_REUSED')
        return { operationId: intent.operationId, savedAt: prior.savedAt, view: viewOf(state) }
      }
      const observedVersion = state.version
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
      const before = viewOf(state)
      applyIntent(state, intent, { upgraded: this.access(state.info) })
      if (state.info.kind === 'connected') state.pending.push({ intent, command, state: 'queued' })
      else {
        // Local receipts permit dependent intents without manufacturing network outbox entries.
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
      state.version = nextRevision(state.version)
      state.sequence = command.sequence
      state.sequences[deviceKey(scope.device)] = command.sequence
      state.operations[intent.operationId] = { hash: intentHash, savedAt: intent.createdAt }
      const committed = await transaction(this.database, 'readwrite', async (tx) => {
        await assertGeneration(tx, key, generation)
        const current = await getState(tx, key)
        if (
          current.version !== observedVersion ||
          (current.sequences[deviceKey(scope.device)] ?? '0') !==
            (BigInt(command.sequence) - 1n).toString()
        )
          return false
        const refs =
          intent.kind === 'checkpoint.create'
            ? mediaRefs([{ ...intent.payload.checkpoint, revision: '0' }])
            : intent.kind === 'media.attach'
              ? [intent.payload.media]
              : []
        await assertMediaPresent(tx, key, refs)
        putState(tx, state)
        return true
      })
      if (committed) {
        this.publish()
        return { operationId: intent.operationId, savedAt: intent.createdAt, view: viewOf(state) }
      }
    }
    throw new DomainError('REVISION_CONFLICT')
  }
  private async change(
    key: CollectionKey,
    generation: number,
    work: (state: StoredCollection, tx: IDBTransaction) => void | Promise<void>,
  ): Promise<void> {
    await transaction(this.database, 'readwrite', async (tx) => {
      await assertGeneration(tx, key, generation)
      const state = await getState(tx, key)
      await work(state, tx)
      state.version = nextRevision(state.version)
      putState(tx, state)
    })
    this.publish()
  }
  async acknowledge(key: CollectionKey, receipt: Receipt, generation: number): Promise<void> {
    await this.change(key, generation, (state) => {
      if (state.info.kind !== 'connected') throw new DomainError('VALIDATION')
      applyReceipt(state, receipt)
    })
  }
  async applyPage(key: CollectionKey, input: PullPage, generation: number): Promise<void> {
    const page = parsePullPage(input)
    await this.change(key, generation, (state) => {
      if (state.info.kind !== 'connected') throw new DomainError('VALIDATION')
      if (page.collectionId !== key.collectionId || page.epoch !== key.epoch)
        throw new DomainError('SYNC_REBASE_REQUIRED')
      if (page.afterCursor !== state.cursor) throw new DomainError('SYNC_PAGE_INVALID')
      for (const receipt of page.entries) applyReceipt(state, receipt)
      state.cursor = page.nextCursor
    })
  }
  async hydrate(key: CollectionKey, pages: SnapshotManifest[], generation: number): Promise<void> {
    await this.change(key, generation, (state) => {
      if (state.info.kind !== 'connected') throw new DomainError('VALIDATION')
      hydrateState(state, pages, Date.now())
    })
  }
  async pending(key: CollectionKey) {
    return (await this.readView(key)).pending
  }
  async markAttempt(key: CollectionKey, operationId: string, generation: number): Promise<void> {
    await this.change(key, generation, (state) => {
      const pending = state.pending.find((p) => p.command.operationId === operationId)
      if (pending) pending.state = 'attempted'
    })
  }
  async markFailure(
    key: CollectionKey,
    operationId: string,
    error: SafeError,
    generation: number,
  ): Promise<void> {
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
  ): Promise<CollectionView> {
    parseInfo(candidate.info)
    assertRecords(candidate.projects, candidate.checkpoints)
    if (candidate.info.kind === 'connected') throw new DomainError('VALIDATION')
    if (options.replace && keyOf(options.replace.key) !== keyOf(candidate.info.key))
      throw new DomainError('VALIDATION')
    if (options.mediaSource) {
      if (options.replace || keyOf(options.mediaSource) === keyOf(candidate.info.key))
        throw new DomainError('VALIDATION')
      const source = options.mediaSource,
        refs = mediaRefs(candidate.checkpoints)
      const prepared = await transaction(this.database, 'readonly', async (tx) => {
        const scope = await assertGeneration(tx, source, options.generation)
        const rows: MediaRow[] = []
        for (const ref of refs) {
          const row = await requestResult<MediaRow | undefined>(
            tx.objectStore('media').get(mediaKey(source, ref.id)),
          )
          if (!row || canonicalJson(row.ref) !== canonicalJson(ref))
            throw new DomainError('BACKUP_INCOMPLETE')
          rows.push(row)
        }
        return { scope, rows }
      })
      for (const row of prepared.rows)
        await verifyBytes(row.ref, new Blob([row.bytes], { type: row.ref.mimeType }))
      const result = await transaction(this.database, 'readwrite', async (tx) => {
        const scope = await assertGeneration(tx, source, options.generation)
        if (canonicalJson(scope) !== canonicalJson(prepared.scope))
          throw new DomainError('ACCOUNT_CHANGED')
        if (await requestResult(tx.objectStore('collections').get(keyOf(candidate.info.key))))
          throw new DomainError('REVISION_CONFLICT')
        const next = emptyCollection({ ...candidate.info, legacyAccess: false })
        next.projects = candidate.projects
        next.checkpoints = candidate.checkpoints
        next.provenance = candidate.provenance
        next.version = localRevision(
          ...candidate.projects.map((p) => p.revision),
          ...candidate.checkpoints.map((c) => c.revision),
        )
        for (const row of prepared.rows) {
          const current = await requestResult<MediaRow | undefined>(
            tx.objectStore('media').get(mediaKey(source, row.ref.id)),
          )
          const before = new Uint8Array(row.bytes),
            after = current ? new Uint8Array(current.bytes) : null
          if (
            !current ||
            canonicalJson(current.ref) !== canonicalJson(row.ref) ||
            !after ||
            after.byteLength !== before.byteLength ||
            before.some((byte, index) => byte !== after[index])
          )
            throw new DomainError('BACKUP_INCOMPLETE')
          tx.objectStore('media').add({
            ...row,
            key: mediaKey(candidate.info.key, row.ref.id),
            scope: candidate.info.key,
          })
        }
        putState(tx, next)
        return viewOf(next)
      })
      this.publish()
      return result
    }
    const result = await transaction(this.database, 'readwrite', async (tx) => {
      await assertGeneration(tx, candidate.info.key, options.generation, false)
      const previous = await getState(tx, candidate.info.key)
      if (
        previous.info.kind === 'connected' ||
        (options.replace
          ? previous.version !== options.replace.revision
          : previous.version !== '0' ||
            previous.projects.length > 0 ||
            previous.checkpoints.length > 0)
      )
        throw new DomainError('REVISION_CONFLICT')
      await assertMediaPresent(tx, candidate.info.key, mediaRefs(candidate.checkpoints))
      const next = emptyCollection({
        ...candidate.info,
        legacyAccess:
          previous.info.legacyAccess ||
          (candidate.provenance.kind === 'legacy' && candidate.info.legacyAccess),
      })
      next.version = localRevision(
        previous.version,
        ...candidate.projects.map((p) => p.revision),
        ...candidate.checkpoints.map((c) => c.revision),
      )
      next.projects = candidate.projects
      next.checkpoints = candidate.checkpoints
      next.provenance = candidate.provenance
      putState(tx, next)
      return viewOf(next)
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
    const target: CollectionKey = {
      namespace: `guest_${crypto.randomUUID()}`,
      collectionId: crypto.randomUUID(),
      epoch: crypto.randomUUID(),
    }
    await transaction(this.database, 'readwrite', async (tx) => {
      await assertGeneration(tx, key, generation)
      const source = await getState(tx, key)
      if (source.version !== revision) throw new DomainError('REVISION_CONFLICT')
      const view = viewOf(source)
      const drafts = recovered
        ? []
        : (
            await requestResult<
              Array<{
                key: string
                scope: CollectionKey
                value: { key: string; revision: string }
                media?: import('../../domain/contracts').MediaRef[]
              }>
            >(tx.objectStore('drafts').getAll())
          ).filter((row) => keyOf(row.scope) === keyOf(key))
      const refs = [
        ...new Map(
          [...mediaRefs(view.checkpoints), ...drafts.flatMap((row) => row.media ?? [])].map(
            (ref) => [ref.id, ref],
          ),
        ).values(),
      ]
      await assertMediaPresent(tx, key, refs)
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
      copied.provenance = {
        kind: recovered ? 'recovered' : 'retained',
        sourceId: source.info.key.collectionId,
        capturedAt: copied.info.createdAt,
      }
      copied.version = localRevision(
        ...view.projects.map((p) => p.revision),
        ...view.checkpoints.map((c) => c.revision),
      )
      for (const ref of refs) {
        const row = await requestResult<MediaRow>(
          tx.objectStore('media').get(mediaKey(key, ref.id)),
        )
        tx.objectStore('media').add({ ...row, key: mediaKey(target, ref.id), scope: target })
      }
      for (const draft of drafts)
        tx.objectStore('drafts').add({
          ...draft,
          key: JSON.stringify([keyOf(target), draft.value.key]),
          scope: target,
        })
      putState(tx, copied)
      if (recovered) {
        source.pending = []
        source.anchors = { projects: [], checkpoints: [] }
        source.version = nextRevision(source.version)
        putState(tx, source)
      }
    })
    this.publish()
    return target
  }
  async retainLocal(
    key: CollectionKey,
    name: string,
    expectedRevision: string,
    generation: number,
  ): Promise<CollectionKey> {
    return this.copyLocal(key, name, expectedRevision, generation)
  }
  async recoverPending(key: CollectionKey, reason: RecoveryReason): Promise<CollectionKey> {
    const { scope, state } = await transaction(this.database, 'readonly', async (tx) => ({
      scope: await activeScope(tx),
      state: await getState(tx, key),
    }))
    if (!scope || keyOf(scope.key) !== keyOf(key)) throw new DomainError('ACCOUNT_CHANGED')
    return this.copyLocal(
      key,
      `Recovered ${state.info.name}`.slice(0, 100),
      state.version,
      scope.generation,
      reason,
    )
  }
  async removeLocal(
    key: CollectionKey,
    expectedRevision: string,
    generation: number,
  ): Promise<void> {
    await transaction(this.database, 'readwrite', async (tx) => {
      await assertGeneration(tx, key, generation)
      const state = await getState(tx, key)
      if (state.version !== expectedRevision) throw new DomainError('REVISION_CONFLICT')
      const snapshots = await requestResult<SnapshotRow[]>(tx.objectStore('snapshots').getAll())
      const pinned = new Set(
        snapshots
          .filter((s) => keyOf(s.scope) === keyOf(key))
          .flatMap((s) => s.value.media.map((r) => r.id)),
      )
      const rows = await requestResult<MediaRow[]>(tx.objectStore('media').getAll())
      for (const row of rows)
        if (keyOf(row.scope) === keyOf(key) && !pinned.has(row.ref.id))
          tx.objectStore('media').delete(row.key)
      const drafts = await requestResult<Array<{ key: string; scope: CollectionKey }>>(
        tx.objectStore('drafts').getAll(),
      )
      for (const draft of drafts)
        if (keyOf(draft.scope) === keyOf(key)) tx.objectStore('drafts').delete(draft.key)
      const metadata = await requestResult<Array<{ key: string; scope?: CollectionKey }>>(
        tx.objectStore('meta').getAll(),
      )
      for (const row of metadata)
        if (row.scope && keyOf(row.scope) === keyOf(key)) tx.objectStore('meta').delete(row.key)
      tx.objectStore('collections').delete(keyOf(key))
      // Preserve the generation fence even when the selected device copy is gone.
    })
    this.publish()
  }
  async snapshot(key: CollectionKey): Promise<LocalSnapshot> {
    return transaction(this.database, 'readwrite', async (tx) => {
      const view = viewOf(await getState(tx, key)),
        refs = mediaRefs(view.checkpoints)
      await assertMediaPresent(tx, key, refs)
      const snapshot = {
        id: crypto.randomUUID(),
        view,
        media: refs,
        createdAt: new Date().toISOString(),
      }
      tx.objectStore('snapshots').add({
        key: snapshot.id,
        scope: key,
        value: snapshot,
      } satisfies SnapshotRow)
      return snapshot
    })
  }
  async releaseSnapshot(id: string): Promise<void> {
    await transaction(this.database, 'readwrite', async (tx) => {
      const row = await requestResult<SnapshotRow | undefined>(tx.objectStore('snapshots').get(id))
      tx.objectStore('snapshots').delete(id)
      if (row && !(await requestResult(tx.objectStore('collections').get(keyOf(row.scope))))) {
        const remaining = await requestResult<SnapshotRow[]>(tx.objectStore('snapshots').getAll())
        for (const ref of row.value.media)
          if (
            !remaining.some(
              (s) =>
                keyOf(s.scope) === keyOf(row.scope) && s.value.media.some((r) => r.id === ref.id),
            )
          )
            tx.objectStore('media').delete(mediaKey(row.scope, ref.id))
      }
    })
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  async close(): Promise<void> {
    this.channel?.close()
    this.listeners.clear()
    this.database.close()
  }
}
export async function openBrowserRepository(
  options: BrowserRepositoryOptions = {},
): Promise<BrowserRepository> {
  return new BrowserRepository(
    await openDatabase(options.databaseName ?? BROWSER_DATABASE, options.factory),
    options.access,
  )
}
