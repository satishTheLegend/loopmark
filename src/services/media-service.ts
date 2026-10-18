import type {
  AccountSession,
  CollectionKey,
  MediaRef,
  SessionScope,
  UploadReservation,
} from '../domain/contracts'
import type { PlatformMedia } from '../platform/contracts'
import type { Repository } from '../repositories/contracts'
import type { MediaTransport } from '../sync/media-transport'
import type { WorkflowStore } from './workflow-store'
import { canonicalHash, canonicalJson } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import { uploadReservationSchema } from '../domain/schema'
import { limiter } from './concurrency'
import { verifyMediaBytes } from './media-codec'

interface UploadState {
  inputHash: string
  requestId: string
  reservation: UploadReservation | null
  verified: boolean
}
export interface RemoteMediaService {
  upload(
    input: {
      scope: SessionScope
      source: CollectionKey
      sourceRef: MediaRef
      ref: MediaRef
      epoch?: string
      candidateId?: string
      operationId: string
    },
    signal: AbortSignal,
  ): Promise<UploadReservation>
  ensureAvailable(
    ref: MediaRef,
    scope: SessionScope,
    signal: AbortSignal,
    snapshotId?: string,
  ): Promise<void>
}
export function createRemoteMediaService(options: {
  repository: Repository
  media: PlatformMedia
  transport: MediaTransport
  workflows: WorkflowStore
  current: () => AccountSession | null
  mediaConcurrency?: number
}): RemoteMediaService {
  const limit = limiter(options.mediaConcurrency ?? 2)
  async function check(scope: SessionScope, signal: AbortSignal) {
    signal.throwIfAborted()
    const session = options.current(),
      active = await options.repository.readActive()
    if (
      !session ||
      canonicalJson(active) !== canonicalJson(scope) ||
      canonicalJson(scope.key) !== canonicalJson(session.collection) ||
      canonicalJson(scope.device) !== canonicalJson(session.device)
    )
      throw new DomainError('ACCOUNT_CHANGED')
    signal.throwIfAborted()
    return session
  }
  return {
    upload: (input, signal) =>
      limit(async () => {
        const session = await check(input.scope, signal)
        const source = (await options.repository.listCollections()).find(
          (c) => canonicalJson(c.key) === canonicalJson(input.source),
        )
        if (!source || (source.kind === 'connected' && source.accountId !== session.accountId))
          throw new DomainError('ACCOUNT_CHANGED')
        const identity = {
          accountId: session.accountId,
          scope: input.scope.key,
          epoch: input.epoch ?? input.scope.key.epoch,
          ref: input.ref,
          candidateId: input.candidateId ?? null,
          operationId: input.operationId,
        }
        const inputHash = await canonicalHash(identity),
          id = `upload_${inputHash}`
        let row = await options.workflows.read<UploadState>(id)
        if (
          row &&
          (row.kind !== 'upload' ||
            row.accountId !== session.accountId ||
            row.value.inputHash !== inputHash)
        )
          throw new DomainError('OPERATION_REUSED')
        if (!row)
          row = await options.workflows.write(
            id,
            null,
            {
              kind: 'upload',
              accountId: session.accountId,
              collection: input.scope.key,
              value: {
                inputHash,
                requestId: crypto.randomUUID(),
                reservation: null,
                verified: false,
              },
            },
            input.scope,
          )
        let state = row.value
        if (state.reservation && !uploadReservationSchema.safeParse(state.reservation).success)
          throw new DomainError('LOCAL_STORAGE_FAILED')
        if (
          state.reservation &&
          state.reservation.deletionGeneration !== session.deletionGeneration
        )
          throw new DomainError('ACCOUNT_CHANGED')
        if (state.reservation && Date.parse(state.reservation.expiresAt) <= Date.now()) {
          state = { inputHash, requestId: crypto.randomUUID(), reservation: null, verified: false }
          row = await options.workflows.write(
            id,
            row.revision,
            { ...row, value: state },
            input.scope,
          )
        }
        if (!state.reservation) {
          const reservation = await options.transport.reserve(
            {
              action: 'reserve',
              requestId: state.requestId,
              upload: {
                collectionId: input.scope.key.collectionId,
                epoch: identity.epoch,
                media: input.ref,
              },
              ...(input.candidateId ? { candidateId: input.candidateId } : {}),
            },
            signal,
          )
          await check(input.scope, signal)
          if (
            reservation.deletionGeneration !== session.deletionGeneration ||
            Date.parse(reservation.expiresAt) <= Date.now()
          )
            throw new DomainError('SYNC_PAGE_INVALID')
          state = { ...state, reservation }
          row = await options.workflows.write(
            id,
            row.revision,
            { ...row, value: state },
            input.scope,
          )
        }
        if (!state.verified) {
          const stream = await options.media.open(input.sourceRef, input.source)
          const bytes = new Blob([await new Response(stream).arrayBuffer()], {
            type: input.sourceRef.mimeType,
          })
          await verifyMediaBytes(input.ref, bytes)
          await check(input.scope, signal)
          await options.transport.upload(state.reservation!.id, input.ref, bytes, signal)
          await check(input.scope, signal)
          await options.workflows.write(
            id,
            row.revision,
            { ...row, value: { ...state, verified: true } },
            input.scope,
          )
        }
        return state.reservation!
      }),
    ensureAvailable: (ref, scope, signal, snapshotId) =>
      limit(async () => {
        await check(scope, signal)
        try {
          const reader = (await options.media.open(ref, scope.key)).getReader()
          await reader.cancel()
          return
        } catch (error) {
          if (
            !(error instanceof DomainError) ||
            !['BACKUP_INCOMPLETE', 'MEDIA_INVALID'].includes(error.detail.code)
          )
            throw error
        }
        const bytes = await options.transport.download(
          {
            collectionId: scope.key.collectionId,
            epoch: scope.key.epoch,
            mediaId: ref.id,
            ...(snapshotId ? { snapshotId } : {}),
          },
          ref,
          signal,
        )
        await check(scope, signal)
        await options.media.storeVerified(ref, bytes, scope.key, scope.generation, {
          downloaded: true,
        })
      }),
  }
}
