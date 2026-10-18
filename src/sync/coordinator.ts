import type { SessionScope, SnapshotManifest, PendingIntent } from '../domain/contracts'
import type {
  Repository,
  LocalCollectionReview,
  RebaseInput,
  RebaseResult,
} from '../repositories/contracts'
import type { SyncTransport } from '../platform/contracts'
import { canonicalJson } from '../domain/canonical-json'
import { DomainError, safeError, type SafeError } from '../domain/errors'
import type { TabLease } from './tab-lease'
import type { AttachmentQueue } from '../services/attachment-queue'
import { collectSnapshot, releaseSnapshotQuietly } from './snapshots'
export interface SyncStatus {
  state: 'offline' | 'idle' | 'syncing' | 'pending' | 'conflict' | 'error'
  pending: number
  pendingAttachments?: number
  failedAttachments?: number
  lastSyncedAt: string | null
  error: SafeError | null
}
export interface SyncCoordinator {
  rebase(
    scope: SessionScope,
    review: LocalCollectionReview,
    input: Omit<RebaseInput, 'pages'>,
  ): Promise<RebaseResult>

  run(scope: SessionScope, operationIds?: string[]): Promise<void>
  retryAttachments(scope: SessionScope, ids: string[]): Promise<void>
  stop(): void
  getSnapshot(): SyncStatus
  subscribe(listener: () => void): () => void
  dispose(): void
}
export interface SyncClock {
  now(): number
  random(): number
  sleep(ms: number, signal: AbortSignal): Promise<void>
}
const clock: SyncClock = {
  now: Date.now,
  random: Math.random,
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      signal.throwIfAborted()
      const abort = () => {
        clearTimeout(timer)
        reject(signal.reason)
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort)
        resolve()
      }, ms)
      signal.addEventListener('abort', abort, { once: true })
    }),
}
export function createSyncCoordinator(options: {
  repository: Repository
  transport: SyncTransport
  lease: TabLease
  clock?: SyncClock
  online?: () => boolean
  currentAccountId?: () => string | null
  attachments?: AttachmentQueue
}): SyncCoordinator {
  const { repository, transport, lease } = options,
    time = options.clock ?? clock
  const listeners = new Set<() => void>()
  let status: SyncStatus = { state: 'idle', pending: 0, lastSyncedAt: null, error: null },
    current: AbortController | undefined,
    running: Promise<unknown> | undefined,
    disposed = false
  const publish = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch }
    for (const listener of listeners) listener()
  }
  const check = async (scope: SessionScope, signal: AbortSignal) => {
    signal.throwIfAborted()
    if (canonicalJson(await repository.readActive()) !== canonicalJson(scope))
      throw new DomainError('ACCOUNT_CHANGED')
    signal.throwIfAborted()
  }
  const retryable = (p: PendingIntent) =>
    p.state !== 'rejected' && p.state !== 'conflict' && (!p.error || p.error.retryable)
  async function cycle(
    scope: SessionScope,
    only: string[] | undefined,
    signal: AbortSignal,
    attachmentOnly?: string[],
  ) {
    const started = time.now(),
      deadline = started + 60000
    async function retry<T>(work: () => Promise<T>): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        await check(scope, signal)
        try {
          return await work()
        } catch (error) {
          signal.throwIfAborted()
          const detail = safeError(error)
          if (!detail.retryable || attempt >= 4) throw error
          const delay = Math.max(
            detail.retryAfterMs ?? 0,
            Math.min(60000, 1000 * 2 ** attempt) * (0.75 + time.random() * 0.5),
          )
          if (time.now() + delay >= deadline) throw error
          await time.sleep(delay, signal)
        }
      }
    }
    const view = await repository.readView(scope.key)
    if (view.info.kind !== 'connected') return
    const pending = await repository.pending(scope.key)
    if (
      only &&
      (new Set(only).size !== only.length ||
        only.some(
          (id) =>
            !pending.some((p) => p.intent.operationId === id && p.error?.retryable && retryable(p)),
        ))
    )
      throw new DomainError('VALIDATION')
    publish({ state: 'syncing', pending: pending.length, error: null })
    if (view.hydration !== 'ready') {
      // A nonempty unhydrated overlay requires explicit recovery, never silent replacement.
      if (pending.length) throw new DomainError('SYNC_REBASE_REQUIRED')
      const pages: SnapshotManifest[] = [],
        seen = new Set<string>()
      let page = await retry(() =>
        transport.snapshot(
          { action: 'create', collectionId: scope.key.collectionId, purpose: 'hydrate' },
          signal,
        ),
      )
      const snapshotId = page.snapshotId
      try {
        for (let n = 0; ; n++) {
          if (
            n >= 200 ||
            page.epoch !== scope.key.epoch ||
            page.collectionId !== scope.key.collectionId
          )
            throw new DomainError('SYNC_PAGE_INVALID')
          pages.push(page)
          if (page.nextPage === null) break
          if (seen.has(page.nextPage)) throw new DomainError('SYNC_PAGE_INVALID')
          seen.add(page.nextPage)
          const request = {
            action: 'page' as const,
            snapshotId: page.snapshotId,
            after: page.nextPage,
          }
          page = await retry(() => transport.snapshot(request, signal))
        }
        await check(scope, signal)
        await repository.hydrate(scope.key, pages, scope.generation)
      } finally {
        // Releasing cannot roll back already applied metadata. Failed cleanup expires server-side.
        await releaseSnapshotQuietly(transport, snapshotId, async () => {
          if (options.currentAccountId) return options.currentAccountId() === view.info.accountId
          const active = await repository.readActive()
          return (
            !!active &&
            (await repository.readView(active.key)).info.accountId === view.info.accountId
          )
        })
      }
    }
    for (const item of pending) {
      if (time.now() >= deadline) break
      if (
        item.intent.kind === 'collection.replace' ||
        attachmentOnly ||
        options.attachments?.owns(item.command)
      )
        continue
      if (!retryable(item) || (only && !only.includes(item.intent.operationId))) continue
      const latest = await repository.pending(scope.key)
      if (!latest.some((p) => p.intent.operationId === item.intent.operationId)) continue
      if (
        item.command.base &&
        'afterOperationId' in item.command.base &&
        latest.some(
          (p) =>
            p.intent.operationId ===
            (item.command.base as { afterOperationId: string }).afterOperationId,
        )
      )
        continue
      try {
        await check(scope, signal)
        await options.attachments?.prepareCommand(scope, item.command, signal)
        await repository.markAttempt(scope.key, item.intent.operationId, scope.generation)
        const receipt = await retry(() => transport.push(item.command, signal))
        await check(scope, signal)
        await repository.acknowledge(scope.key, receipt, scope.generation)
      } catch (error) {
        signal.throwIfAborted()
        await check(scope, signal)
        const detail = safeError(error)
        await repository.markFailure(scope.key, item.intent.operationId, detail, scope.generation)
        if (
          [
            'AUTH_REQUIRED',
            'ACCOUNT_CHANGED',
            'SYNC_REBASE_REQUIRED',
            'OFFLINE',
            'RATE_LIMITED',
            'SERVICE_UNAVAILABLE',
          ].includes(detail.code)
        )
          throw error
      }
    }
    // Always reconcile the contiguous feed, even when there are no local mutations.
    let more = true
    for (let n = 0; more && n < 200 && time.now() < deadline; n++) {
      const local = await repository.readView(scope.key)
      const request = {
        collectionId: scope.key.collectionId,
        epoch: scope.key.epoch,
        afterCursor: local.cursor,
        deviceId: scope.device.id,
        deviceGeneration: scope.device.generation,
      }
      const page = await retry(() => transport.pull(request, signal))
      await check(scope, signal)
      await repository.applyPage(scope.key, page, scope.generation)
      more = page.hasMore
    }
    if (!more && time.now() < deadline)
      await options.attachments?.run(scope, signal, attachmentOnly)
    const attachments = (await options.attachments?.list(scope.key)) ?? [],
      pendingAttachments = attachments.filter((item) =>
        ['pending', 'queued'].includes(item.state),
      ).length,
      failedAttachments = attachments.filter((item) => item.state === 'failed').length
    const remaining = await repository.pending(scope.key)
    publish({
      pendingAttachments,
      failedAttachments,
      state: remaining.some((p) => p.state === 'conflict')
        ? 'conflict'
        : failedAttachments || remaining.some((p) => p.state === 'rejected')
          ? 'error'
          : remaining.length || more || pendingAttachments
            ? 'pending'
            : 'idle',
      pending: remaining.length,
      lastSyncedAt:
        remaining.length === 0 && !more && !pendingAttachments && !failedAttachments
          ? new Date(time.now()).toISOString()
          : status.lastSyncedAt,
      error:
        remaining.find((p) => p.error)?.error ??
        attachments.find((item) => item.error)?.error ??
        null,
    })
  }
  async function run(scope: SessionScope, only?: string[], attachmentOnly?: string[]) {
    if (disposed) throw new DomainError('ACCOUNT_CHANGED')
    if (running) {
      await running
      return
    }
    if (options.online && !options.online()) {
      publish({ state: 'offline', error: new DomainError('OFFLINE').detail })
      return
    }
    const controller = new AbortController()
    current = controller
    const timeout = setTimeout(
      () => controller.abort(new DomainError('SERVICE_UNAVAILABLE')),
      60000,
    )
    running = (async () => {
      try {
        await lease.run(structuredClone(scope), controller.signal, () =>
          cycle(scope, only, controller.signal, attachmentOnly),
        )
      } catch (error) {
        if (
          controller.signal.aborted &&
          controller.signal.reason instanceof DomainError &&
          controller.signal.reason.detail.code === 'ACCOUNT_CHANGED'
        )
          return
        const detail = safeError(controller.signal.aborted ? controller.signal.reason : error)
        const attachments = (await options.attachments?.list(scope.key).catch(() => [])) ?? []
        publish({
          pendingAttachments: attachments.filter((item) =>
            ['pending', 'queued'].includes(item.state),
          ).length,
          failedAttachments: attachments.filter((item) => item.state === 'failed').length,
        })
        publish({ state: detail.code === 'OFFLINE' ? 'offline' : 'error', error: detail })
        throw error
      } finally {
        clearTimeout(timeout)
        if (current === controller) current = undefined
        running = undefined
      }
    })()
    await running
  }
  return {
    async rebase(scope, review, input) {
      current?.abort(new DomainError('ACCOUNT_CHANGED'))
      await running?.catch(() => {})
      if (disposed) throw new DomainError('ACCOUNT_CHANGED')
      const controller = new AbortController()
      current = controller
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)])
      const owned = async () =>
        options.currentAccountId
          ? options.currentAccountId() === input.session.accountId
          : (await repository.readView((await repository.readActive())!.key)).info.accountId ===
            input.session.accountId
      let completed: RebaseResult | undefined
      const work = (async () => {
        await lease.run(scope, signal, async () => {
          await check(scope, signal)
          if (!(await owned())) throw new DomainError('ACCOUNT_CHANGED')
          const pages = await collectSnapshot(
            transport,
            {
              collectionId: input.session.collection.collectionId,
              epoch: input.session.collection.epoch,
              purpose: 'hydrate',
            },
            signal,
            () => check(scope, signal),
            owned,
          )
          try {
            await check(scope, signal)
            if (!(await owned())) throw new DomainError('ACCOUNT_CHANGED')
            completed = await repository.completeRebase(scope, review, { ...input, pages })
            publish({
              state: 'idle',
              pending: 0,
              pendingAttachments: 0,
              failedAttachments: 0,
              error: null,
              lastSyncedAt: null,
            })
          } finally {
            await releaseSnapshotQuietly(transport, pages[0].snapshotId, owned)
          }
        })
        if (!completed) throw new DomainError('SERVICE_UNAVAILABLE')
        return completed
      })()
      running = work
      try {
        return await work
      } finally {
        if (running === work) running = undefined
        if (current === controller) current = undefined
      }
    },
    getSnapshot: () => status,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    run,
    retryAttachments: (scope, ids) => {
      if (!options.attachments || !ids.length) return Promise.reject(new DomainError('VALIDATION'))
      return run(scope, undefined, ids)
    },
    stop() {
      current?.abort(new DomainError('ACCOUNT_CHANGED'))
    },
    dispose() {
      disposed = true
      current?.abort(new DomainError('ACCOUNT_CHANGED'))
      listeners.clear()
    },
  }
}
