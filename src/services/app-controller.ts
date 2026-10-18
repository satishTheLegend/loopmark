import type { AccountSession, CollectionKey, LocalIntent, SessionScope } from '../domain/contracts'
import type { Repository, LocalCollectionReview } from '../repositories/contracts'
import type { AccountAuth } from '../auth/auth-service'
import type { SyncCoordinator } from '../sync/coordinator'
import { canonicalJson } from '../domain/canonical-json'
import { DomainError, safeError } from '../domain/errors'
import { keyOf } from '../repositories/state'
import type {
  AppController,
  AttachPreview,
  CollectionSummary,
  ControllerState,
  LocalWorkCounts,
} from './controller-contract'
export interface CollectionConnections {
  preview(
    source: CollectionKey,
    destination: AccountSession,
    email: string,
    scope: SessionScope,
  ): Promise<AttachPreview>
  confirm(preview: AttachPreview, destination: AccountSession, scope: SessionScope): Promise<void>
}
export interface AppControllerOptions {
  repository: Repository
  auth?: AccountAuth
  sync?: SyncCoordinator
  connections?: CollectionConnections
}
/** Root completes migration/guest activation before initialize. No implicit upload on sign-in. */
export function createAppController(options: AppControllerOptions): AppController {
  const { repository, auth, sync } = options,
    listeners = new Set<() => void>()
  let state: ControllerState = {
    phase: 'starting',
    scope: null,
    collections: [],
    view: null,
    account: null,
    auth: 'guest',
    sync: { state: 'idle', pending: 0, lastSyncedAt: null },
    error: null,
  }
  let session: AccountSession | null = null,
    disposed = false,
    queue: Promise<void> = Promise.resolve(),
    refreshVersion = 0,
    busy = false,
    authenticating = false,
    authVersion = 0
  let cancel = new AbortController(),
    review: {
      accountId: string
      scope: SessionScope
      collections: LocalCollectionReview[]
      counts: LocalWorkCounts
    } | null = null
  const publish = (patch: Partial<ControllerState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const bound = () => {
    if (!state.scope || disposed || busy) throw new DomainError('ACCOUNT_CHANGED')
    return structuredClone(state.scope)
  }
  const serial = <T>(work: () => Promise<T>) => {
    const result = queue.then(async () => {
      if (disposed) throw new DomainError('ACCOUNT_CHANGED')
      busy = true
      try {
        return await work()
      } catch (error) {
        publish({ error: safeError(error) })
        throw error
      } finally {
        ;((busy = false), (authenticating = false))
      }
    })
    queue = result.then(
      () => {},
      () => {},
    )
    return result
  }
  const check = async (scope: SessionScope) => {
    if (canonicalJson(await repository.readActive()) !== canonicalJson(scope))
      throw new DomainError('ACCOUNT_CHANGED')
    if (disposed) throw new DomainError('ACCOUNT_CHANGED')
  }
  async function refresh(scope = state.scope) {
    const version = ++refreshVersion
    if (!scope) return
    const active = await repository.readActive()
    if (canonicalJson(active) !== canonicalJson(scope)) {
      sync?.stop()
      cancel.abort()
      cancel = new AbortController()
      if (version === refreshVersion && !busy)
        publish({
          phase: 'error',
          view: null,
          scope: null,
          error: new DomainError('ACCOUNT_CHANGED').detail,
        })
      return
    }
    const all = await repository.listCollections(),
      summaries: CollectionSummary[] = []
    for (const info of all) {
      if (info.kind === 'connected' && info.accountId !== session?.accountId) continue
      const view = await repository.readView(info.key),
        local = await repository.reviewLocal(info.key)
      summaries.push({
        ...info,
        projects: view.projects.length,
        checkpoints: view.checkpoints.length,
        drafts: local.drafts.length,
      })
    }
    const view = await repository.readView(scope.key)
    await check(scope)
    if (version !== refreshVersion) return
    if (view.info.kind === 'connected' && view.info.accountId !== session?.accountId)
      throw new DomainError('ACCOUNT_CHANGED')
    const syncStatus = sync?.getSnapshot()
    publish({
      scope,
      collections: summaries,
      view,
      phase: 'ready',
      sync: syncStatus
        ? { ...syncStatus, pending: view.pending.length }
        : {
            state: view.pending.some((p) => p.state === 'conflict')
              ? 'conflict'
              : view.pending.length
                ? 'pending'
                : 'idle',
            pending: view.pending.length,
            lastSyncedAt: null,
          },
    })
  }
  async function guest() {
    const all = await repository.listCollections(),
      existing = all.find((c) => c.kind === 'guest')
    if (existing) return existing
    const collection = {
      key: {
        namespace: `guest_${crypto.randomUUID()}`,
        collectionId: crypto.randomUUID(),
        epoch: crypto.randomUUID(),
      },
      name: 'My device projects',
      kind: 'guest' as const,
      accountId: null,
      legacyAccess: false,
      createdAt: new Date().toISOString(),
    }
    await repository.createCollection(collection)
    return collection
  }
  async function acceptSession(value: AccountSession, signal: AbortSignal) {
    const identity = await auth!.verifiedIdentity()
    signal.throwIfAborted()
    if (!identity || identity.accountId !== value.accountId) throw new DomainError('AUTH_REQUIRED')
    const all = await repository.listCollections()
    if (!all.some((c) => keyOf(c.key) === keyOf(value.collection)))
      await repository.createCollection({
        key: value.collection,
        kind: 'connected',
        name: 'Account projects',
        accountId: value.accountId,
        legacyAccess: false,
        createdAt: new Date().toISOString(),
      })
    session = value
    publish({ account: identity, auth: 'authenticated', error: null })
  }
  const unsubscribe = repository.subscribe(() => {
    if (!busy && !disposed) void refresh().catch((error) => publish({ error: safeError(error) }))
  })
  const unsubSync = sync?.subscribe(() => {
    if (!disposed) {
      const value = sync.getSnapshot()
      publish({ sync: value, error: value.error })
    }
  })
  const unsubAuth = auth?.subscribeIdentity((accountId) => {
    if (disposed || authenticating || !session || session.accountId === accountId) return
    authVersion++
    sync?.stop()
    cancel.abort()
    cancel = new AbortController()
    const previous = state.scope
    session = null
    review = null
    refreshVersion++
    publish({ account: null, auth: 'expired', scope: null, view: null, phase: 'starting' })
    void serial(async () => {
      if (!previous) return
      const active = await repository.readActive()
      if (canonicalJson(active) !== canonicalJson(previous))
        throw new DomainError('ACCOUNT_CHANGED')
      const local = await guest(),
        next = await repository.transition(previous, {
          key: local.key,
          device: { id: crypto.randomUUID(), generation: crypto.randomUUID() },
        })
      await refresh(next)
    }).catch((error) => publish({ phase: 'error', error: safeError(error) }))
  })
  const api: AppController = {
    async initialize() {
      return serial(async () => {
        let scope = await repository.readActive()
        if (!scope) throw new DomainError('LOCAL_STORAGE_FAILED')
        if (auth) {
          const cached = await auth.cachedSession()
          if (cached) {
            session = cached.session
            publish({ account: cached.identity, auth: 'expired' })
          }
        }
        const selected = await repository.readView(scope.key)
        if (selected.info.kind === 'connected' && selected.info.accountId !== session?.accountId) {
          const local = await guest()
          scope = await repository.transition(scope, {
            key: local.key,
            device: { id: crypto.randomUUID(), generation: crypto.randomUUID() },
          })
        } else if (
          selected.info.kind === 'connected' &&
          session &&
          canonicalJson(scope.device) !== canonicalJson(session.device)
        )
          scope = await repository.transition(scope, { key: scope.key, device: session.device })
        await refresh(scope)
        if (auth) {
          const version = authVersion,
            signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(10000)]),
            initialScope = scope
          // Local restart is ready before any network work. Late verification cannot change a new session.
          void auth
            .currentSession(signal)
            .then((value) =>
              serial(async () => {
                if (disposed || signal.aborted || version !== authVersion) return
                await check(initialScope)
                if (value) await acceptSession(value, signal)
                else {
                  session = null
                  publish({ account: null, auth: 'guest' })
                }
                let selected = initialScope
                const current = await repository.readView(selected.key)
                if (
                  current.info.kind === 'connected' &&
                  current.info.accountId !== session?.accountId
                )
                  selected = await repository.transition(selected, {
                    key: (await guest()).key,
                    device: { id: crypto.randomUUID(), generation: crypto.randomUUID() },
                  })
                else if (
                  current.info.kind === 'connected' &&
                  session &&
                  canonicalJson(selected.device) !== canonicalJson(session.device)
                )
                  selected = await repository.transition(selected, {
                    key: selected.key,
                    device: session.device,
                  })
                await refresh(selected)
              }),
            )
            .catch((error) => {
              if (!disposed && version === authVersion)
                publish({ auth: 'expired', error: safeError(error) })
            })
        }
      })
    },
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async requestCode(email) {
      authVersion++
      if (!auth) throw new DomainError('CAPABILITY_UNAVAILABLE')
      publish({ auth: 'sending-code', error: null })
      try {
        const result = await auth.requestCode(email, cancel.signal)
        publish({ auth: 'code-sent' })
        return result
      } catch (error) {
        publish({ auth: session ? 'authenticated' : 'guest', error: safeError(error) })
        throw error
      }
    },
    verifyCode(email, code) {
      authVersion++
      return serial(async () => {
        if (!auth) throw new DomainError('CAPABILITY_UNAVAILABLE')
        const scope = state.scope
        if (!scope) throw new DomainError('ACCOUNT_CHANGED')
        const signal = cancel.signal
        authenticating = true
        let value: AccountSession
        try {
          value = await auth.verifyCode(email, code, signal)
          await check(scope)
          await acceptSession(value, signal)
        } finally {
          authenticating = false
        }
        const selected = await repository.readView(scope.key)
        // A different account must never inherit the previous account's selected cache.
        if (selected.info.kind === 'connected' && selected.info.accountId !== value.accountId) {
          const local = await guest(),
            next = await repository.transition(scope, {
              key: local.key,
              device: { id: crypto.randomUUID(), generation: crypto.randomUUID() },
            })
          await refresh(next)
        } else await refresh(scope)
      })
    },
    chooseCollection(key) {
      return serial(async () => {
        const previous = state.scope
        if (!previous) throw new DomainError('ACCOUNT_CHANGED')
        const view = await repository.readView(key)
        if (view.info.kind === 'connected' && view.info.accountId !== session?.accountId)
          throw new DomainError('AUTH_REQUIRED')
        sync?.stop()
        cancel.abort()
        cancel = new AbortController()
        review = null
        const scope = await repository.transition(previous, {
          key,
          device: view.info.kind === 'connected' ? session!.device : previous.device,
        })
        await refresh(scope)
      })
    },
    async prepareSignOut() {
      const scope = bound()
      if (!session) throw new DomainError('AUTH_REQUIRED')
      const accountId = session.accountId,
        all = await repository.listCollections(),
        collections: LocalCollectionReview[] = []
      const counts: LocalWorkCounts = {
        drafts: 0,
        unsentProjectChanges: 0,
        unsentCheckpoints: 0,
        pendingAttachments: 0,
        failedAttachments: 0,
        recoveredCollections: all.filter((c) => c.kind === 'recovered').length,
      }
      for (const info of all.filter((c) => c.kind === 'connected' && c.accountId === accountId)) {
        const view = await repository.readView(info.key),
          local = await repository.reviewLocal(info.key)
        if (view.revision !== local.revision) throw new DomainError('REVISION_CONFLICT')
        collections.push(local)
        counts.drafts += local.drafts.length
        for (const pending of view.pending) {
          if (pending.intent.kind.startsWith('project.')) counts.unsentProjectChanges++
          if (pending.intent.kind === 'checkpoint.create') counts.unsentCheckpoints++
          const media =
            pending.intent.kind === 'checkpoint.create'
              ? [
                  pending.intent.payload.checkpoint.photo,
                  pending.intent.payload.checkpoint.voice,
                ].filter(Boolean).length
              : pending.intent.kind === 'media.attach'
                ? 1
                : 0
          if (pending.error) counts.failedAttachments += media
          else counts.pendingAttachments += media
        }
      }
      await check(scope)
      review = { accountId, scope, collections, counts }
      return structuredClone(counts)
    },
    signOut(settings) {
      authVersion++
      sync?.stop()
      cancel.abort()
      cancel = new AbortController()
      return serial(async () => {
        if (!session || !auth || !review || review.accountId !== session.accountId)
          throw new DomainError('REVISION_CONFLICT')
        const captured = review,
          counts = captured.counts
        if (
          !settings.keepLocal &&
          !settings.discardUniqueWork &&
          counts.drafts +
            counts.unsentProjectChanges +
            counts.unsentCheckpoints +
            counts.pendingAttachments +
            counts.failedAttachments >
            0
        )
          throw new DomainError('VALIDATION')
        let scope = await repository.transition(
          captured.scope,
          { key: captured.scope.key, device: captured.scope.device },
          captured.collections.find((c) => keyOf(c.key) === keyOf(captured.scope.key)),
        )
        refreshVersion++
        const retained: CollectionKey[] = []
        try {
          for (const local of captured.collections) {
            if (canonicalJson(await repository.reviewLocal(local.key)) !== canonicalJson(local))
              throw new DomainError('REVISION_CONFLICT')
            if (keyOf(scope.key) !== keyOf(local.key))
              scope = await repository.transition(
                scope,
                { key: local.key, device: scope.device },
                local,
              )
            if (settings.keepLocal)
              retained.push(
                await repository.retainLocal(
                  local.key,
                  'Kept on this device',
                  local.revision,
                  scope.generation,
                ),
              )
          }
          authenticating = true
          try {
            await auth.signOut()
          } finally {
            authenticating = false
          }
          session = null
          publish({ account: null, auth: 'guest' })
          for (const local of captured.collections) {
            if (keyOf(scope.key) !== keyOf(local.key))
              scope = await repository.transition(
                scope,
                { key: local.key, device: scope.device },
                local,
              )
            await repository.removeLocal(local.key, local.revision, scope.generation)
          }
          const target = retained[0] ?? (await guest()).key
          scope = await repository.transition(scope, {
            key: target,
            device: { id: crypto.randomUUID(), generation: crypto.randomUUID() },
          })
          review = null
          await refresh(scope)
        } catch (error) {
          // Fence scope was intentionally never published. Recover to a valid visible local scope.
          const active = await repository.readActive()
          if (active && canonicalJson(active) === canonicalJson(scope)) {
            const target = (await guest()).key
            const safe = await repository.transition(active, {
              key: target,
              device: { id: crypto.randomUUID(), generation: crypto.randomUUID() },
            })
            await refresh(safe)
          }
          review = null
          throw error
        }
      })
    },
    async runSync() {
      const scope = bound()
      if (!sync) throw new DomainError('CAPABILITY_UNAVAILABLE')
      await sync.run(scope)
      await refresh(scope)
    },
    async retryOperations(ids) {
      const scope = bound()
      if (!sync) throw new DomainError('CAPABILITY_UNAVAILABLE')
      await sync.run(scope, ids)
      await refresh(scope)
    },
    async loadConflict(operationId) {
      const scope = bound(),
        view = await repository.readView(scope.key),
        acknowledged = await repository.readAcknowledged(scope.key)
      await check(scope)
      if (
        view.revision !== acknowledged.revision ||
        !view.pending.some((p) => p.intent.operationId === operationId)
      )
        throw new DomainError('REVISION_CONFLICT')
      return { view, acknowledged }
    },
    resolveConflict(operationId, expectedRevision, choice) {
      if (choice.action === 'later') return Promise.resolve()
      return serial(async () => {
        const scope = state.scope
        if (!scope) throw new DomainError('ACCOUNT_CHANGED')
        sync?.stop()
        const view = await repository.readView(scope.key),
          shadow = await repository.readAcknowledged(scope.key),
          pending = view.pending.find((p) => p.intent.operationId === operationId)
        if (!pending || view.revision !== expectedRevision || shadow.revision !== view.revision)
          throw new DomainError('REVISION_CONFLICT')
        let replacement: LocalIntent | undefined
        if (choice.action !== 'cloud') {
          const intent = pending.intent
          if (intent.kind === 'project.create' || intent.kind === 'collection.replace')
            throw new DomainError('REVISION_CONFLICT')
          const projectId =
            intent.kind === 'checkpoint.create'
              ? intent.payload.checkpoint.projectId
              : intent.payload.projectId
          const project = shadow.projects.find((p) => p.id === projectId)
          if (!project) throw new DomainError('REVISION_CONFLICT')
          const timestamp = new Date(
            Math.max(Date.now(), Date.parse(project.updatedAt) + 1),
          ).toISOString()
          if (choice.action === 'merged')
            replacement = {
              kind: 'project.update',
              operationId: crypto.randomUUID(),
              createdAt: timestamp,
              base: { revision: project.revision },
              payload: { projectId, fields: choice.fields, updatedAt: timestamp },
            }
          else {
            const target =
              intent.kind === 'media.attach'
                ? shadow.checkpoints.find((c) => c.id === intent.payload.checkpointId)
                : project
            if (!target) throw new DomainError('REVISION_CONFLICT')
            replacement = structuredClone({
              ...intent,
              operationId: crypto.randomUUID(),
              createdAt: timestamp,
              base: { revision: target.revision },
            })
            if (
              replacement.kind === 'project.update' ||
              replacement.kind === 'project.status' ||
              replacement.kind === 'checkpoint.create'
            )
              replacement.payload.updatedAt = timestamp
          }
        }
        await repository.resolvePending(
          scope.key,
          {
            operationId,
            expectedRevision,
            recoveryName: `Recovered ${view.info.name}`.slice(0, 100),
            ...(replacement ? { replacement } : {}),
          },
          scope.generation,
        )
        await refresh(scope)
      })
    },
    async previewAttach(source) {
      const scope = bound()
      if (!options.connections || !session || !state.account)
        throw new DomainError('CAPABILITY_UNAVAILABLE')
      return options.connections.preview(source, session, state.account.email, scope)
    },
    confirmAttach(preview) {
      return serial(async () => {
        const scope = state.scope
        if (!scope || !options.connections || !session)
          throw new DomainError('CAPABILITY_UNAVAILABLE')
        await options.connections.confirm(preview, session, scope)
        await refresh(scope)
      })
    },
    async dispose() {
      disposed = true
      cancel.abort()
      sync?.dispose()
      auth?.dispose()
      unsubscribe()
      unsubSync?.()
      unsubAuth?.()
      listeners.clear()
      await queue
    },
  }
  return api
}
