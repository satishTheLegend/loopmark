import type {
  AccountSession,
  CollectionKey,
  CollectionView,
  LocalIntent,
  SessionScope,
  SnapshotManifest,
} from '../domain/contracts'
import { z } from 'zod'
import type {
  AttachPreview,
  CandidateMetadata,
  CandidatePreparation,
} from '../domain/remote-contracts'
import type { Repository } from '../repositories/contracts'
import type { SyncTransport } from '../platform/contracts'
import type { FunctionClient } from '../sync/http-client'
import type { RemoteMediaService } from './media-service'
import type { WorkflowRecord, WorkflowStore } from './workflow-store'
import type { CollectionConnections } from './app-controller'
import { canonicalHash, canonicalJson } from '../domain/canonical-json'
import { DomainError, safeError } from '../domain/errors'
import {
  candidateMetadataSchema,
  candidatePortableBytes,
  mergeCandidate,
  verifyCandidatePreparation,
  cancelledReservationSchema,
  attachPreviewSchema,
  candidatePreparationSchema,
} from '../domain/remote-schema'
import {
  emptyCollection,
  hydrateState,
  keyOf,
  mediaRefs,
  intentCommand,
} from '../repositories/state'
import { collectionKeySchema, hashSchema, id, timestamp } from '../domain/schema'
import { collectSnapshot, releaseSnapshotQuietly } from '../sync/snapshots'
import { mapBounded } from './concurrency'

interface CandidateWorkflow {
  version: 1
  mode: 'attach' | 'replace'
  requestId: string
  sourceSnapshotId: string
  sourceCandidate: CandidateMetadata
  preview: AttachPreview
  expectedHash: string
  preparation: CandidatePreparation | null
  intent: LocalIntent | null
  completed: SessionScope | null
  phase: 'preview' | 'prepared' | 'queued' | 'complete' | 'cancelled'
}
const workflowSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(['attach', 'replace']),
    requestId: id,
    sourceSnapshotId: id,
    sourceCandidate: candidateMetadataSchema,
    preview: attachPreviewSchema,
    expectedHash: hashSchema,
    preparation: candidatePreparationSchema.nullable(),
    intent: z
      .custom<LocalIntent>((value) => {
        try {
          const intent = value as LocalIntent
          return (
            intent.kind === 'collection.replace' &&
            timestamp.safeParse(intent.createdAt).success &&
            !!intentCommand(intent)
          )
        } catch {
          return false
        }
      })
      .nullable(),
    completed: z
      .object({
        key: collectionKeySchema,
        generation: z.number().int().nonnegative(),
        device: z.object({ id, generation: id }).strict(),
      })
      .strict()
      .nullable(),
    phase: z.enum(['preview', 'prepared', 'queued', 'complete', 'cancelled']),
  })
  .strict()
  .refine(
    (value) =>
      (value.phase !== 'queued' || (!!value.preparation && !!value.intent)) &&
      (value.phase !== 'complete' || !!value.completed),
  )
export interface ReplacementService extends CollectionConnections {
  previewReplacement(
    source: CollectionKey,
    destination: AccountSession,
    email: string,
    scope: SessionScope,
    signal?: AbortSignal,
  ): Promise<AttachPreview>
  cancel(previewId: string, scope: SessionScope, signal: AbortSignal): Promise<void>
  list(): Promise<
    Array<{ preview: AttachPreview; mode: 'attach' | 'replace'; phase: CandidateWorkflow['phase'] }>
  >
}
function metadata(view: Pick<CollectionView, 'projects' | 'checkpoints'>): CandidateMetadata {
  return candidateMetadataSchema.parse({
    projects: view.projects.map(({ revision: _revision, sample: _sample, ...p }) => p),
    checkpoints: view.checkpoints.map(({ revision: _revision, ...c }) => c),
  })
}
export function createReplacementService(options: {
  repository: Repository
  transport: SyncTransport
  client: FunctionClient
  media: RemoteMediaService
  workflows: WorkflowStore
  current: () => AccountSession | null
  mediaConcurrency?: number
}): ReplacementService {
  const { repository, transport, client, workflows } = options
  const owned = (accountId: string) => options.current()?.accountId === accountId
  async function check(scope: SessionScope, session: AccountSession, signal: AbortSignal) {
    signal.throwIfAborted()
    const current = options.current()
    if (
      !current ||
      current.accountId !== session.accountId ||
      current.deletionGeneration !== session.deletionGeneration ||
      canonicalJson(current.device) !== canonicalJson(session.device) ||
      canonicalJson(await repository.readActive()) !== canonicalJson(scope)
    )
      throw new DomainError('ACCOUNT_CHANGED')
  }
  async function read(id: string, session: AccountSession) {
    const row = await workflows.read<CandidateWorkflow>(`candidate_${id}`)
    if (
      !row ||
      row.kind !== 'candidate' ||
      row.accountId !== session.accountId ||
      !workflowSchema.safeParse(row.value).success
    )
      throw new DomainError('NOT_AVAILABLE')
    return row
  }
  async function save(
    row: WorkflowRecord<CandidateWorkflow>,
    patch: Partial<CandidateWorkflow>,
    scope?: SessionScope,
  ) {
    return workflows.write(
      row.id,
      row.revision,
      {
        kind: 'candidate',
        accountId: row.accountId,
        collection: row.collection,
        value: { ...row.value, ...patch },
      },
      scope,
    )
  }
  async function preview(
    mode: 'attach' | 'replace',
    source: CollectionKey,
    session: AccountSession,
    email: string,
    scope: SessionScope,
    signal: AbortSignal = new AbortController().signal,
  ) {
    await check(scope, session, signal)
    const sourceView = await repository.readView(source),
      destination = await repository.readView(session.collection)
    if (
      sourceView.info.kind === 'connected' ||
      destination.info.accountId !== session.accountId ||
      destination.info.kind !== 'connected'
    )
      throw new DomainError('VALIDATION')
    // Reuse the exact confirmed/partially completed workflow after a restart.
    for (const row of await workflows.list<CandidateWorkflow>('candidate')) {
      if (
        row.accountId === session.accountId &&
        workflowSchema.safeParse(row.value).success &&
        row.value.mode === mode &&
        row.value.phase !== 'complete' &&
        row.value.phase !== 'cancelled' &&
        keyOf(row.value.preview.source.key) === keyOf(source) &&
        keyOf(row.value.preview.destination.key) === keyOf(session.collection)
      )
        return row.value.preview
    }
    if (destination.pending.length) throw new DomainError('SYNC_REBASE_REQUIRED')
    const snapshot = await repository.snapshot(source),
      requestId = crypto.randomUUID()
    let pages: SnapshotManifest[] = []
    try {
      pages = await collectSnapshot(
        transport,
        {
          collectionId: session.collection.collectionId,
          purpose: 'hydrate',
          epoch: session.collection.epoch,
        },
        signal,
        () => check(scope, session, signal),
        () => owned(session.accountId),
      )
      const validated = emptyCollection(destination.info)
      hydrateState(validated, pages, Date.now())
      const sourceCandidate = metadata(snapshot.view),
        merged = await mergeCandidate(mode, requestId, sourceCandidate, metadata(validated))
      const value: AttachPreview = {
        id: requestId,
        source: { key: source, name: sourceView.info.name, revision: snapshot.view.revision },
        destination: {
          key: session.collection,
          name: destination.info.name,
          revision: pages[0].revision,
          email,
        },
        additions: merged.additions,
        matches: merged.matches,
        copies: merged.copies,
        mappings: merged.mappings,
        resulting: {
          projects: merged.candidate.projects.length,
          activeProjects: merged.candidate.projects.filter((p) => p.status === 'active').length,
          checkpoints: merged.candidate.checkpoints.length,
          portableBytes: candidatePortableBytes(merged.candidate),
        },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }
      await check(scope, session, signal)
      await workflows.write(
        `candidate_${requestId}`,
        null,
        {
          kind: 'candidate',
          accountId: session.accountId,
          collection: source,
          value: {
            version: 1,
            mode,
            requestId,
            sourceSnapshotId: snapshot.id,
            sourceCandidate,
            preview: value,
            expectedHash: await canonicalHash(merged.candidate),
            preparation: null,
            intent: null,
            completed: null,
            phase: 'preview',
          } satisfies CandidateWorkflow,
        },
        scope,
      )
      return value
    } catch (error) {
      await repository.releaseSnapshot(snapshot.id)
      throw error
    } finally {
      if (pages[0])
        await releaseSnapshotQuietly(transport, pages[0].snapshotId, () => owned(session.accountId))
    }
  }
  const service: ReplacementService = {
    preview: (source, session, email, scope, signal) =>
      preview('attach', source, session, email, scope, signal),
    previewReplacement: (source, session, email, scope, signal) =>
      preview('replace', source, session, email, scope, signal),
    async confirm(input, session, initialScope, signal = new AbortController().signal) {
      await check(initialScope, session, signal)
      let row = await read(input.id, session),
        scope = initialScope
      if (canonicalJson(row.value.preview) !== canonicalJson(input))
        throw new DomainError('REVISION_CONFLICT')
      if (row.value.phase === 'cancelled') throw new DomainError('NOT_AVAILABLE')
      if (row.value.phase === 'complete') {
        if (
          !row.value.completed ||
          canonicalJson(await repository.readActive()) !== canonicalJson(row.value.completed)
        )
          throw new DomainError('ACCOUNT_CHANGED')
        return row.value.completed
      }
      if (!row.value.preparation && Date.parse(input.expiresAt) <= Date.now())
        throw new DomainError('REVISION_CONFLICT')
      if (
        !row.value.intent &&
        (await repository.readView(input.source.key)).revision !== input.source.revision
      )
        throw new DomainError('REVISION_CONFLICT')
      if (
        session.collection.namespace !== input.destination.key.namespace ||
        session.collection.collectionId !== input.destination.key.collectionId ||
        (session.collection.epoch !== input.destination.key.epoch &&
          session.collection.epoch !== row.value.preparation?.nextEpoch)
      )
        throw new DomainError('ACCOUNT_CHANGED')
      const local = await repository.readView(input.destination.key)
      if (local.pending.some((p) => p.intent.operationId !== row.value.intent?.operationId))
        throw new DomainError('SYNC_REBASE_REQUIRED')
      const alreadyCompleted =
        scope.key.collectionId === input.destination.key.collectionId &&
        scope.key.namespace === input.destination.key.namespace &&
        scope.key.epoch === row.value.preparation?.nextEpoch
      if (!alreadyCompleted && keyOf(scope.key) !== keyOf(input.destination.key))
        scope = await repository.transition(
          scope,
          { key: input.destination.key, device: session.device },
          await repository.reviewLocal(input.destination.key),
        )
      await check(scope, session, signal)
      const endpoint = row.value.mode === 'attach' ? 'collection-attach' : 'collection-replace'
      if (!row.value.preparation) {
        let pages: SnapshotManifest[] = []
        try {
          pages = await collectSnapshot(
            transport,
            { collectionId: scope.key.collectionId, purpose: 'hydrate', epoch: scope.key.epoch },
            signal,
            () => check(scope, session, signal),
            () => owned(session.accountId),
          )
          if (pages[0].revision !== input.destination.revision)
            throw new DomainError('REVISION_CONFLICT')
          await repository.hydrate(scope.key, pages, scope.generation)
        } finally {
          if (pages[0])
            await releaseSnapshotQuietly(transport, pages[0].snapshotId, () =>
              owned(session.accountId),
            )
        }
        // Source metadata is sent only after the maker confirmed the locally calculated preview.
        const preparation = await verifyCandidatePreparation(
          await client.post(
            endpoint,
            {
              action: 'prepare',
              requestId: row.value.requestId,
              ...(row.value.mode === 'attach' ? { source: input.source } : {}),
              destination: {
                collectionId: input.destination.key.collectionId,
                epoch: input.destination.key.epoch,
                revision: input.destination.revision,
              },
              candidate: row.value.sourceCandidate,
            },
            signal,
            { maxBytes: 8 * 1024 * 1024 },
          ),
        )
        if (
          preparation.mode !== row.value.mode ||
          preparation.replacement.candidateSha256 !== row.value.expectedHash ||
          preparation.replacement.collectionId !== scope.key.collectionId ||
          preparation.replacement.epoch !== scope.key.epoch ||
          preparation.replacement.revision !== input.destination.revision
        )
          throw new DomainError('REVISION_CONFLICT')
        await check(scope, session, signal)
        row = await save(row, { preparation, phase: 'prepared' }, scope)
      } else {
        const latest = await verifyCandidatePreparation(
          await client.post(
            endpoint,
            { action: 'status', reservationId: row.value.preparation.replacement.reservationId },
            signal,
            { maxBytes: 8 * 1024 * 1024 },
          ),
        )
        if (
          latest.replacement.candidateSha256 !== row.value.expectedHash ||
          latest.replacement.reservationId !== row.value.preparation.replacement.reservationId
        )
          throw new DomainError('SYNC_PAGE_INVALID')
        row = await save(row, { preparation: latest }, scope)
      }
      const preparation = row.value.preparation!
      if (!preparation.receipt) {
        if (alreadyCompleted || session.collection.epoch !== input.destination.key.epoch)
          throw new DomainError('SYNC_REBASE_REQUIRED')
        const sourceRefs = new Map(
          mediaRefs(
            row.value.sourceCandidate.checkpoints.map((c) => ({ ...c, revision: '0' })),
          ).map((ref) => [ref.id, ref]),
        )
        await mapBounded(
          preparation.requiredMedia,
          async (ref) => {
            const mapping = preparation.mediaMappings.find((m) => m.destination.id === ref.id),
              sourceRef = mapping ? sourceRefs.get(mapping.sourceId) : undefined
            if (!sourceRef) throw new DomainError('BACKUP_INCOMPLETE')
            await options.media.upload(
              {
                scope,
                source: input.source.key,
                sourceRef,
                ref,
                epoch: preparation.nextEpoch,
                candidateId: preparation.replacement.reservationId,
                operationId: row.value.requestId,
              },
              signal,
            )
          },
          options.mediaConcurrency ?? 2,
        )
        if (!row.value.intent)
          row = await save(
            row,
            {
              intent: {
                kind: 'collection.replace',
                operationId: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
                base: { revision: preparation.replacement.revision },
                payload: {
                  reservationId: preparation.replacement.reservationId,
                  candidateSha256: preparation.replacement.candidateSha256,
                  nextEpoch: preparation.nextEpoch,
                },
              },
              phase: 'queued',
            },
            scope,
          )
        await repository.commitLocal(scope.key, row.value.intent!, scope.generation)
        const pending = (await repository.pending(scope.key)).find(
          (p) => p.intent.operationId === row.value.intent!.operationId,
        )
        if (!pending) throw new DomainError('INVARIANT_VIOLATION')
        await repository.markAttempt(scope.key, pending.intent.operationId, scope.generation)
        try {
          const receipt = await transport.push(pending.command, signal)
          await check(scope, session, signal)
          row = await save(row, { preparation: { ...preparation, receipt } }, scope)
        } catch (error) {
          await check(scope, session, signal)
          await repository.markFailure(
            scope.key,
            pending.intent.operationId,
            safeError(error),
            scope.generation,
          )
          throw error
        }
      }
      const receipt = row.value.preparation!.receipt
      if (!receipt || !row.value.intent || receipt.operationId !== row.value.intent.operationId)
        throw new DomainError('SYNC_PAGE_INVALID')
      let pages: SnapshotManifest[] = []
      try {
        pages = await collectSnapshot(
          transport,
          {
            collectionId: scope.key.collectionId,
            purpose: 'hydrate',
            epoch: preparation.nextEpoch,
          },
          signal,
          () => check(scope, session, signal),
          () => owned(session.accountId),
        )
        const completed = await repository.completeReplacement(
          input.destination.key,
          { operationId: row.value.intent.operationId, receipt, pages },
          scope.generation,
        )
        row = await save(row, { phase: 'complete', completed })
        await repository.releaseSnapshot(row.value.sourceSnapshotId)
        return completed
      } finally {
        if (pages[0])
          await releaseSnapshotQuietly(transport, pages[0].snapshotId, () =>
            owned(session.accountId),
          )
      }
    },
    async resume(session, scope, signal) {
      for (const row of await workflows.list<CandidateWorkflow>('candidate')) {
        if (
          row.accountId !== session.accountId ||
          !workflowSchema.safeParse(row.value).success ||
          row.value.phase !== 'queued' ||
          !row.value.intent
        )
          continue
        const destination = row.value.preview.destination.key
        if (
          destination.namespace === scope.key.namespace &&
          destination.collectionId === scope.key.collectionId &&
          (destination.epoch === scope.key.epoch ||
            row.value.preparation?.nextEpoch === scope.key.epoch)
        )
          return service.confirm(row.value.preview, session, scope, signal)
      }
      return null
    },
    async cancel(id, scope, signal) {
      const session = options.current()
      if (!session) throw new DomainError('AUTH_REQUIRED')
      await check(scope, session, signal)
      let row = await read(id, session)
      if (row.value.phase === 'complete' || row.value.phase === 'cancelled') return
      if (row.value.intent && keyOf(scope.key) !== keyOf(row.value.preview.destination.key))
        throw new DomainError('ACCOUNT_CHANGED')
      if (row.value.preparation) {
        const status = await verifyCandidatePreparation(
          await client.post(
            row.value.mode === 'attach' ? 'collection-attach' : 'collection-replace',
            { action: 'status', reservationId: row.value.preparation.replacement.reservationId },
            signal,
            { maxBytes: 8 * 1024 * 1024 },
          ),
        )
        if (status.receipt) throw new DomainError('SYNC_REBASE_REQUIRED')
      }
      if (
        row.value.preparation &&
        !cancelledReservationSchema.safeParse(
          await client.post(
            row.value.mode === 'attach' ? 'collection-attach' : 'collection-replace',
            { action: 'cancel', reservationId: row.value.preparation.replacement.reservationId },
            signal,
          ),
        ).success
      )
        throw new DomainError('SYNC_PAGE_INVALID')
      if (
        row.value.intent &&
        (await repository.pending(scope.key)).some(
          (p) => p.intent.operationId === row.value.intent!.operationId,
        )
      ) {
        await repository.markFailure(
          scope.key,
          row.value.intent.operationId,
          new DomainError('SYNC_REBASE_REQUIRED').detail,
          scope.generation,
        )
        await repository.resolvePending(
          scope.key,
          {
            operationId: row.value.intent.operationId,
            expectedRevision: (await repository.readView(scope.key)).revision,
            recoveryName: 'Cancelled replacement',
          },
          scope.generation,
        )
      }
      row = await save(row, { phase: 'cancelled' }, scope)
      await repository.releaseSnapshot(row.value.sourceSnapshotId)
    },
    async list() {
      const session = options.current()
      if (!session) return []
      return (await workflows.list<CandidateWorkflow>('candidate'))
        .filter(
          (row) =>
            row.accountId === session.accountId && workflowSchema.safeParse(row.value).success,
        )
        .map((row) => ({
          preview: row.value.preview,
          mode: row.value.mode,
          phase: row.value.phase,
        }))
    },
  }
  return service
}
