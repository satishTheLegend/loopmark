import { z } from 'zod'
import type {
  AccountSession,
  CollectionKey,
  Command,
  LocalIntent,
  MediaRef,
  Receipt,
  SessionScope,
} from '../domain/contracts'
import type { Repository } from '../repositories/contracts'
import type { SyncTransport } from '../platform/contracts'
import type { RemoteMediaService } from './media-service'
import type { WorkflowRecord, WorkflowStore } from './workflow-store'
import { canonicalHash, canonicalJson } from '../domain/canonical-json'
import { DomainError, safeError, type SafeError } from '../domain/errors'
import { id, mediaRefSchema, commandSchema, receiptSchema } from '../domain/schema'
import { intentCommand, keyOf } from '../repositories/state'
import { errorHelp } from '../help/errors'

interface Work {
  version: 1
  type: 'attachment'
  checkpointOperationId: string
  checkpointId: string
  projectId: string
  ref: MediaRef
  intent: LocalIntent | null
  command: Command | null
  receipt: Receipt | null
  state: 'pending' | 'queued' | 'complete' | 'cancelled' | 'failed'
  error: SafeError | null
}
const schema = z
  .object({
    version: z.literal(1),
    type: z.literal('attachment'),
    checkpointOperationId: id,
    checkpointId: id,
    projectId: id,
    ref: mediaRefSchema,
    intent: z
      .custom<LocalIntent>((value) => {
        try {
          return (
            (value as LocalIntent).kind === 'media.attach' && !!intentCommand(value as LocalIntent)
          )
        } catch {
          return false
        }
      })
      .nullable(),
    command: commandSchema.nullable(),
    receipt: receiptSchema.nullable(),
    state: z.enum(['pending', 'queued', 'complete', 'cancelled', 'failed']),
    error: z
      .custom<SafeError>(
        (value) =>
          !!value &&
          typeof value === 'object' &&
          'code' in value &&
          Object.hasOwn(errorHelp, String(value.code)),
      )
      .nullable(),
  })
  .strict()
export interface AttachmentItem {
  id: string
  checkpointId: string
  kind: 'photo' | 'voice'
  state: Work['state']
  error: SafeError | null
}
export interface AttachmentQueue {
  owns(command: Command): boolean
  prepareCommand(scope: SessionScope, command: Command, signal: AbortSignal): Promise<void>
  run(scope: SessionScope, signal: AbortSignal, only?: string[]): Promise<void>
  resumeAfterAuthentication(scope: SessionScope): Promise<void>
  list(key: CollectionKey): Promise<AttachmentItem[]>
}
/** Journals byte transfer before checkpoint metadata can be acknowledged. Commands are never rewritten. */
export function createAttachmentQueue(options: {
  repository: Repository
  transport: SyncTransport
  media: RemoteMediaService
  workflows: WorkflowStore
  current: () => AccountSession | null
}): AttachmentQueue {
  const { repository, workflows, transport } = options
  async function check(scope: SessionScope, signal: AbortSignal) {
    signal.throwIfAborted()
    const session = options.current()
    if (
      !session ||
      canonicalJson(session.collection) !== canonicalJson(scope.key) ||
      canonicalJson(session.device) !== canonicalJson(scope.device) ||
      canonicalJson(await repository.readActive()) !== canonicalJson(scope)
    )
      throw new DomainError('ACCOUNT_CHANGED')
    return session
  }
  async function rows(key: CollectionKey) {
    const session = options.current()
    if (!session) throw new DomainError('AUTH_REQUIRED')
    return (await workflows.list<Work>('upload'))
      .filter(
        (row) =>
          row.id.startsWith('attachment_') &&
          row.accountId === session.accountId &&
          row.collection &&
          keyOf(row.collection) === keyOf(key),
      )
      .map((row) => {
        if (!schema.safeParse(row.value).success) throw new DomainError('VALIDATION')
        return row
      })
  }
  async function save(row: WorkflowRecord<Work>, scope: SessionScope, patch: Partial<Work>) {
    return workflows.write(
      row.id,
      row.revision,
      { ...row, value: { ...row.value, ...patch } },
      scope,
    )
  }
  return {
    owns: (command) =>
      command.kind === 'media.attach' && command.operationId.startsWith('attachment_'),
    async prepareCommand(scope, command, signal) {
      const session = await check(scope, signal)
      if (command.kind !== 'checkpoint.create') return
      for (const ref of [command.payload.checkpoint.photo, command.payload.checkpoint.voice]) {
        if (!ref) continue
        const workId = `attachment_${(await canonicalHash({ key: scope.key, operation: command.operationId, ref })).slice(0, 48)}`
        const previous = await workflows.read<Work>(workId)
        if (previous) {
          if (
            previous.accountId !== session.accountId ||
            !schema.safeParse(previous.value).success ||
            canonicalJson(previous.value.ref) !== canonicalJson(ref)
          )
            throw new DomainError('OPERATION_REUSED')
          continue
        }
        await check(scope, signal)
        await workflows.write<Work>(
          workId,
          null,
          {
            kind: 'upload',
            accountId: session.accountId,
            collection: scope.key,
            value: {
              version: 1,
              type: 'attachment',
              checkpointOperationId: command.operationId,
              checkpointId: command.payload.checkpoint.id,
              projectId: command.payload.checkpoint.projectId,
              ref,
              intent: null,
              command: null,
              receipt: null,
              state: 'pending',
              error: null,
            },
          },
          scope,
        )
      }
    },
    async resumeAfterAuthentication(scope) {
      await check(scope, new AbortController().signal)
      for (const row of await rows(scope.key)) {
        if (row.value.error?.code !== 'AUTH_REQUIRED') continue
        const command = row.value.command
        if (
          command &&
          (command.deviceId !== scope.device.id ||
            command.deviceGeneration !== scope.device.generation)
        )
          continue
        await save(row, scope, { error: null, state: command ? 'queued' : 'pending' })
      }
    },
    async list(key) {
      return (await rows(key)).map(({ id, value }) => ({
        id,
        checkpointId: value.checkpointId,
        kind: value.ref.kind,
        state: value.state,
        error: value.error,
      }))
    },
    async run(scope, signal, only) {
      await check(scope, signal)
      const work = await rows(scope.key)
      if (
        only &&
        (new Set(only).size !== only.length ||
          only.some((id) => !work.some((row) => row.id === id && row.value.error?.retryable)))
      )
        throw new DomainError('VALIDATION')
      for (let row of work) {
        if (
          ['complete', 'cancelled'].includes(row.value.state) ||
          (!row.value.receipt && row.value.error && !row.value.error.retryable) ||
          (only && !only.includes(row.id))
        )
          continue
        await check(scope, signal)
        try {
          if (row.value.receipt) {
            await repository.acknowledge(scope.key, row.value.receipt, scope.generation)
            await save(row, scope, { state: 'complete', error: null })
            continue
          }
          const pending = await repository.pending(scope.key)
          if (pending.some((item) => item.intent.operationId === row.value.checkpointOperationId))
            continue
          const acknowledged = await repository.readAcknowledged(scope.key)
          const checkpoint = acknowledged.checkpoints.find(
            (c) => c.id === row.value.checkpointId && c.projectId === row.value.projectId,
          )
          if (
            !checkpoint ||
            canonicalJson(checkpoint[row.value.ref.kind] ?? null) !== canonicalJson(row.value.ref)
          ) {
            await save(row, scope, { state: 'cancelled', error: null })
            continue
          }
          if (row.value.intent) {
            const queued = pending.find(
              (p) => p.intent.operationId === row.value.intent!.operationId,
            )
            if (!queued && row.value.command) {
              await save(row, scope, { state: 'cancelled', error: null })
              continue
            }
            if (queued?.error && !queued.error.retryable) {
              await save(row, scope, { state: 'failed', error: queued.error })
              continue
            }
          } else {
            // Finish earlier edits to this project before adding a checkpoint-CAS attachment intent.
            if (
              pending.some((p) =>
                p.command.kind === 'project.create'
                  ? p.command.payload.project.id === row.value.projectId
                  : p.command.kind === 'checkpoint.create'
                    ? p.command.payload.checkpoint.projectId === row.value.projectId
                    : p.command.kind === 'collection.replace' ||
                      p.command.payload.projectId === row.value.projectId,
              )
            )
              continue
            const reservation = await options.media.upload(
              {
                scope,
                source: scope.key,
                sourceRef: row.value.ref,
                ref: row.value.ref,
                operationId: row.id,
              },
              signal,
            )
            await check(scope, signal)
            const fresh = await repository.readAcknowledged(scope.key),
              current = fresh.checkpoints.find((c) => c.id === row.value.checkpointId)
            if (
              !current ||
              canonicalJson(current[row.value.ref.kind] ?? null) !== canonicalJson(row.value.ref)
            ) {
              await save(row, scope, { state: 'cancelled', error: null })
              continue
            }
            row = await save(row, scope, {
              intent: {
                operationId: row.id,
                kind: 'media.attach',
                base: { revision: current.revision },
                createdAt: new Date().toISOString(),
                payload: {
                  projectId: row.value.projectId,
                  checkpointId: row.value.checkpointId,
                  reservationId: reservation.id,
                  media: row.value.ref,
                },
              },
              error: null,
            })
          }
          await repository.commitLocal(scope.key, row.value.intent!, scope.generation)
          if (!row.value.command) {
            const queued = (await repository.pending(scope.key)).find(
              (p) => p.intent.operationId === row.id,
            )
            if (!queued) throw new DomainError('SYNC_REBASE_REQUIRED')
            row = await save(row, scope, { command: queued.command, state: 'queued', error: null })
          }
          await repository.markAttempt(scope.key, row.id, scope.generation)
          const receipt = await transport.push(row.value.command!, signal)
          await check(scope, signal)
          // Persist receipt before acknowledgement so a restart never guesses readiness from a ref.
          row = await save(row, scope, { receipt })
          await repository.acknowledge(scope.key, receipt, scope.generation)
          await save(row, scope, { state: 'complete', error: null })
        } catch (error) {
          signal.throwIfAborted()
          await check(scope, signal)
          const detail = safeError(error)
          if (
            row.value.command &&
            (await repository.pending(scope.key)).some((p) => p.intent.operationId === row.id)
          )
            await repository.markFailure(scope.key, row.id, detail, scope.generation)
          await save(row, scope, { state: 'failed', error: detail })
          if (
            [
              'AUTH_REQUIRED',
              'ACCOUNT_CHANGED',
              'OFFLINE',
              'RATE_LIMITED',
              'SERVICE_UNAVAILABLE',
            ].includes(detail.code)
          )
            throw error
        }
      }
    },
  }
}
