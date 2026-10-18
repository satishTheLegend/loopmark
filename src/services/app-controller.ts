import type { AccountSession, CollectionKey, LocalIntent, SessionScope } from '../domain/contracts'
import type { Repository, LocalCollectionReview } from '../repositories/contracts'
import type { AccountAuth } from '../auth/auth-service'
import type { SyncCoordinator } from '../sync/coordinator'
import type { AttachmentQueue } from './attachment-queue'
import type { PlatformMedia } from '../platform/contracts'
import { canonicalJson } from '../domain/canonical-json'
import { DomainError, safeError } from '../domain/errors'
import { keyOf, mediaRefs } from '../repositories/state'
import type {
  AppController,
  AttachPreview,
  CollectionSummary,
  ControllerState,
  LocalWorkCounts,
} from './controller-contract'
export interface CollectionConnections {
  resume?(
    destination: AccountSession,
    scope: SessionScope,
    signal?: AbortSignal,
  ): Promise<SessionScope | null>
  preview(
    source: CollectionKey,
    destination: AccountSession,
    email: string,
    scope: SessionScope,
    signal?: AbortSignal,
  ): Promise<AttachPreview>
  confirm(
    preview: AttachPreview,
    destination: AccountSession,
    scope: SessionScope,
    signal?: AbortSignal,
  ): Promise<SessionScope>
}
export interface AppControllerOptions {
  repository: Repository
  auth?: AccountAuth
  sync?: SyncCoordinator
  connections?: CollectionConnections
  media?: PlatformMedia
  attachments?: AttachmentQueue
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
    let awaitingReplacement = false
    for (const collection of all.filter(
      (c) =>
        c.kind === 'connected' &&
        c.accountId === value.accountId &&
        c.key.collectionId === value.collection.collectionId,
    ))
      if (
        (await repository.pending(collection.key)).some(
          (p) =>
            p.intent.kind === 'collection.replace' &&
            p.intent.payload.nextEpoch === value.collection.epoch,
        )
      )
        awaitingReplacement = true
    if (!awaitingReplacement && !all.some((c) => keyOf(c.key) === keyOf(value.collection)))
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
  async function resumeAuthenticated(scope: SessionScope) {
    if (session && state.auth === 'authenticated' && options.connections?.resume)
      scope = (await options.connections.resume(session, scope, cancel.signal)) ?? scope
    if (
      session &&
      state.auth === 'authenticated' &&
      keyOf(scope.key) === keyOf(session.collection) &&
      canonicalJson(scope.device) === canonicalJson(session.device)
    ) {
      await repository.resumeAfterAuthentication(scope.key, scope.generation)
      await options.attachments?.resumeAfterAuthentication(scope)
    }
    return scope
  }
  function authenticate(work: (auth: AccountAuth, signal: AbortSignal) => Promise<AccountSession>) {
    authVersion++
    return serial(async () => {
      if (!auth) throw new DomainError('CAPABILITY_UNAVAILABLE')
      const scope = state.scope
      if (!scope) throw new DomainError('ACCOUNT_CHANGED')
      const signal = cancel.signal
      authenticating = true
      let value: AccountSession
      try {
        value = await work(auth, signal)
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
      } else {
        await refresh(await resumeAuthenticated(scope))
      }
    })
  }
  function leaveAccount(
    settings: {
      keepLocal: boolean
      discardUniqueWork?: boolean
      allowMissingAttachments?: boolean
    },
    revoke?: (scope: SessionScope) => Promise<void>,
  ) {
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
      if (
        settings.keepLocal &&
        (counts.missingAttachments === null ||
          (counts.missingAttachments > 0 && !settings.allowMissingAttachments))
      )
        throw new DomainError('BACKUP_INCOMPLETE')
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
                {
                  allowMissingMedia:
                    counts.missingAttachments !== null &&
                    counts.missingAttachments > 0 &&
                    settings.allowMissingAttachments === true,
                },
              ),
            )
        }
        authenticating = true
        try {
          if (revoke) {
            for (const local of captured.collections)
              if (canonicalJson(await repository.reviewLocal(local.key)) !== canonicalJson(local))
                throw new DomainError('REVISION_CONFLICT')
            await revoke(scope)
            await check(scope)
          }
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
          if (canonicalJson(await repository.reviewLocal(local.key)) !== canonicalJson(local))
            throw new DomainError('REVISION_CONFLICT')
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
  }
  const api: AppController = {
    async initialize() {
      return serial(async () => {
        let scope = await repository.readActive()
        if (!scope) throw new DomainError('LOCAL_STORAGE_FAILED')
        if (auth) {
          try {
            const cached = await auth.cachedSession()
            if (cached) {
              session = cached.session
              publish({ account: cached.identity, auth: 'expired' })
            }
          } catch (error) {
            session = null
            publish({ account: null, auth: 'expired', error: safeError(error) })
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
                await refresh(await resumeAuthenticated(selected))
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
    getSession: () =>
      !disposed && session && state.account?.accountId === session.accountId
        ? structuredClone(session)
        : null,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refreshAuthentication() {
      const expected = session?.accountId
      if (!expected) return Promise.reject(new DomainError('AUTH_REQUIRED'))
      return authenticate(async (auth, signal) => {
        const verified = await auth.currentSession(signal)
        if (!verified || verified.accountId !== expected) throw new DomainError('ACCOUNT_CHANGED')
        return verified
      })
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
      return authenticate((auth, signal) => auth.verifyCode(email, code, signal))
    },
    completeCallback(url) {
      return authenticate((auth, signal) => auth.completeCallback(url, signal))
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
        await refresh(await resumeAuthenticated(scope))
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
        missingAttachments: 0,
        recoveredCollections: all.filter((c) => c.kind === 'recovered').length,
      }
      for (const info of all.filter((c) => c.kind === 'connected' && c.accountId === accountId)) {
        const view = await repository.readView(info.key),
          local = await repository.reviewLocal(info.key)
        if (view.revision !== local.revision) throw new DomainError('REVISION_CONFLICT')
        collections.push(local)
        counts.drafts += local.drafts.length
        const refs = mediaRefs(view.checkpoints)
        if (!options.media && refs.length) counts.missingAttachments = null
        else if (options.media && counts.missingAttachments !== null) {
          for (const ref of refs) {
            try {
              await (await options.media.open(ref, info.key)).cancel()
            } catch (error) {
              if (!(error instanceof DomainError) || error.detail.code !== 'BACKUP_INCOMPLETE')
                throw error
              counts.missingAttachments++
            }
          }
        }
        const attachmentStates = new Map<string, boolean>()
        for (const item of (await options.attachments?.list(info.key)) ?? []) {
          if (!['complete', 'cancelled'].includes(item.state))
            attachmentStates.set(`${item.checkpointId}:${item.kind}`, !!item.error)
        }
        for (const pending of view.pending) {
          if (pending.intent.kind.startsWith('project.')) counts.unsentProjectChanges++
          if (pending.intent.kind === 'checkpoint.create') counts.unsentCheckpoints++
          const checkpoint =
            pending.intent.kind === 'checkpoint.create' ? pending.intent.payload.checkpoint : null
          if (checkpoint)
            for (const ref of [checkpoint.photo, checkpoint.voice])
              if (ref)
                attachmentStates.set(
                  `${checkpoint.id}:${ref.kind}`,
                  !!pending.error || attachmentStates.get(`${checkpoint.id}:${ref.kind}`) === true,
                )
          if (pending.intent.kind === 'media.attach')
            attachmentStates.set(
              `${pending.intent.payload.checkpointId}:${pending.intent.payload.media.kind}`,
              !!pending.error ||
                attachmentStates.get(
                  `${pending.intent.payload.checkpointId}:${pending.intent.payload.media.kind}`,
                ) === true,
            )
        }
        for (const failed of attachmentStates.values()) {
          if (failed) counts.failedAttachments++
          else counts.pendingAttachments++
        }
      }
      await check(scope)
      review = { accountId, scope, collections, counts }
      return structuredClone(counts)
    },
    signOut(settings) {
      return leaveAccount(settings)
    },
    deleteAccount(settings, revoke) {
      return leaveAccount(settings, revoke)
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
    async listAttachments() {
      const scope = bound()
      return options.attachments?.list(scope.key) ?? []
    },
    async retryAttachments(ids) {
      const scope = bound()
      if (!sync) throw new DomainError('CAPABILITY_UNAVAILABLE')
      await sync.retryAttachments(scope, ids)
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
      return options.connections.preview(source, session, state.account.email, scope, cancel.signal)
    },
    confirmAttach(preview) {
      return serial(async () => {
        const scope = state.scope
        if (!scope || !options.connections || !session)
          throw new DomainError('CAPABILITY_UNAVAILABLE')
        sync?.stop()
        try {
          const selected = await options.connections.confirm(preview, session, scope, cancel.signal)
          session = { ...session, collection: selected.key }
          await refresh(selected)
        } catch (error) {
          const active = await repository.readActive()
          if (active) {
            const view = await repository.readView(active.key)
            if (view.info.kind !== 'connected' || view.info.accountId === session.accountId) {
              if (
                view.info.kind === 'connected' &&
                active.key.collectionId === session.collection.collectionId
              )
                session = { ...session, collection: active.key }
              await refresh(active)
            }
          }
          throw error
        }
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
