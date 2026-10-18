import { Capacitor } from '@capacitor/core'
import { loadPublicConfig, type PublicConfig } from './config'
import { installDataAdapter } from './data'
import { installDraftStoreFactory } from './drafts'
import { accountUsageSchema } from './domain/remote-schema'
import { canonicalJson } from './domain/canonical-json'
import { DomainError, safeError } from './domain/errors'
import type { SessionScope, CollectionInfo } from './domain/contracts'
import { createEntitlementCache, type EntitlementCache } from './billing/entitlement-cache'
import { createUpgradePrompts } from './billing/upgrade-prompts'
import type { Repository } from './repositories/contracts'
import type { DraftStore } from './repositories/drafts'
import type { PlatformMedia, CredentialStore, SharePort } from './platform/contracts'
import type { OperationPlanStore } from './services/operation-plans'
import type { DeviceStore } from './auth/auth-service'
import type { NativeLifecycleEvent } from './platform/native/lifecycle'
import type { NativeAudioOptions } from './platform/native/audio'
import type { NativeCaptureRecovery, NativeCaptureSource } from './platform/native/capture-recovery'
import type { AppController } from './services/controller-contract'
import type { ReplacementService } from './services/replacement-service'
import type { WorkflowStore } from './services/workflow-store'
import { createAppController } from './services/app-controller'
import { createLocalDataAdapter } from './services/local-data-service'
import { createDeletionService } from './services/deletion-service'
import { createBackupService } from './services/backup-service'
import { prepareBrowserStorage, prepareNativeStorage } from './services/startup'
import { createSyncCoordinator } from './sync/coordinator'
import { createSyncTransport } from './sync/transport'
import { createTabLease } from './sync/tab-lease'
import { parseProjectLink, type ProjectLink } from './links/link-service'
import { createProjectContinuation } from './links/project-continuation'
import { mapBounded } from './services/concurrency'
import { mediaRefs } from './repositories/state'

interface Storage {
  repository: Repository
  media: PlatformMedia
  plans: OperationPlanStore
  devices: DeviceStore
  drafts(scope: SessionScope): DraftStore
  credentials?: CredentialStore
  share?: SharePort
  workflows: WorkflowStore
  captureRecovery?: NativeCaptureRecovery
}
async function openStorage(
  native: boolean,
  access: (info: CollectionInfo) => boolean,
): Promise<Storage> {
  if (native) {
    const [repositoryModule, plans, drafts, devices, credentials, sharing, workflows, recovery] =
      await Promise.all([
        import('./platform/native/repository'),
        import('./platform/native/operation-plans'),
        import('./platform/native/drafts'),
        import('./platform/native/device-store'),
        import('./platform/native/session-storage'),
        import('./platform/native/share'),
        import('./platform/native/workflow-store'),
        import('./platform/native/capture-recovery'),
      ])
    const repository = await repositoryModule.openNativeRepository({ access })
    await prepareNativeStorage(repository)
    return {
      repository,
      workflows: workflows.createNativeWorkflowStore(repository),
      captureRecovery: new recovery.NativeCaptureRecovery(repository),
      media: repository.media,
      plans: plans.createNativeOperationPlanStore(repository),
      devices: devices.createNativeDeviceStore(repository),
      drafts: (scope) => drafts.createNativeDraftStore(repository, scope),
      credentials: new credentials.NativeCredentialStore(),
      share: new sharing.NativeShare(),
    }
  }
  const [repositoryModule, plans, drafts, devices, workflows] = await Promise.all([
    import('./repositories/browser/repository'),
    import('./repositories/browser/operation-plans'),
    import('./repositories/browser/draft-store'),
    import('./repositories/browser/device-store'),
    import('./repositories/browser/workflow-store'),
  ])
  const repository = await repositoryModule.openBrowserRepository({ access })
  await prepareBrowserStorage(repository)
  return {
    repository,
    workflows: workflows.createBrowserWorkflowStore(repository),
    media: repository.media,
    plans: plans.createBrowserOperationPlanStore(repository),
    devices: devices.createBrowserDeviceStore(repository),
    drafts: (scope) => drafts.createBrowserDraftStore(repository, scope),
  }
}

/** One runtime per document. Forms remount on generation changes and capture their own draft store. */
export async function createRuntime(environment: Readonly<Record<string, unknown>>) {
  let access: EntitlementCache | undefined
  const native = Capacitor.isNativePlatform(),
    { config, errors } = loadPublicConfig(environment),
    storage = await openStorage(native, (info) => access?.hasAccess(info) ?? false),
    { repository } = storage
  let online = navigator.onLine,
    foreground = document.visibilityState !== 'hidden'
  const auth = config.cloud.enabled
    ? (await import('./auth/auth-service')).createAccountAuth({
        config,
        devices: storage.devices,
        credentials: storage.credentials,
      })
    : undefined
  let controller: AppController
  const current = () => controller?.getSession() ?? null
  const transport = auth ? createSyncTransport(auth.functions) : undefined
  const cloudModules = auth
    ? await Promise.all([
        import('./sync/media-transport'),
        import('./services/media-service'),
        import('./services/replacement-service'),
        import('./sync/realtime-hints'),
        import('./services/attachment-queue'),
      ])
    : undefined
  const remoteMedia =
    auth && config.cloud.enabled && cloudModules
      ? cloudModules[1].createRemoteMediaService({
          repository,
          media: storage.media,
          workflows: storage.workflows,
          current,
          mediaConcurrency: config.mediaConcurrency,
          transport: cloudModules[0].createMediaTransport({
            url: config.cloud.url,
            publicKey: config.cloud.publicKey,
            token: auth.accessToken,
            client: auth.functions,
          }),
        })
      : undefined
  const replacement =
    auth && transport && cloudModules && remoteMedia
      ? cloudModules[2].createReplacementService({
          repository,
          transport,
          client: auth.functions,
          media: remoteMedia,
          workflows: storage.workflows,
          current,
          mediaConcurrency: config.mediaConcurrency,
        })
      : undefined
  const connectionListeners = new Set<() => void>()
  const connectionChanged = () => {
    for (const listener of connectionListeners) listener()
  }
  const connections: ReplacementService | undefined = replacement
    ? {
        ...replacement,
        async preview(...args) {
          try {
            return await replacement.preview(...args)
          } finally {
            connectionChanged()
          }
        },
        async previewReplacement(...args) {
          try {
            return await replacement.previewReplacement(...args)
          } finally {
            connectionChanged()
          }
        },
        async confirm(...args) {
          try {
            return await replacement.confirm(...args)
          } finally {
            connectionChanged()
          }
        },
        async resume(...args) {
          try {
            return (await replacement.resume?.(...args)) ?? null
          } finally {
            connectionChanged()
          }
        },
        async cancel(...args) {
          try {
            await replacement.cancel(...args)
          } finally {
            connectionChanged()
          }
        },
      }
    : undefined
  const attachments =
    transport && remoteMedia && cloudModules
      ? cloudModules[4].createAttachmentQueue({
          repository,
          transport,
          media: remoteMedia,
          workflows: storage.workflows,
          current,
        })
      : undefined
  const sync = transport
    ? createSyncCoordinator({
        repository,
        transport,
        lease: createTabLease(),
        online: () => online,
        currentAccountId: () => current()?.accountId ?? null,
        attachments,
      })
    : undefined
  controller = createAppController({
    repository,
    auth,
    sync,
    connections,
    attachments,
    media: storage.media,
  })
  await controller.initialize()
  const scope = () => {
    const value = controller.getSnapshot().scope
    if (!value) throw new DomainError('ACCOUNT_CHANGED')
    return structuredClone(value)
  }
  const projectContinuation = createProjectContinuation({
    repository,
    workflows: storage.workflows,
    current: () => ({
      scope: scope(),
      accountId: controller.getSnapshot().account?.accountId ?? null,
    }),
    hydrate: () => controller.runSync(),
  })
  await projectContinuation.initialize()
  const projectOpenings = new Map<string, Promise<'account' | `project=${string}`>>()
  const openProjectTarget = (target: ProjectLink) => {
    const identity = canonicalJson({
      target,
      scope: scope(),
      accountId: controller.getSnapshot().account?.accountId ?? null,
    })
    const existing = projectOpenings.get(identity)
    if (existing) return existing
    const work = (async (): Promise<'account' | `project=${string}`> => {
      const pending = await projectContinuation.capture(target)
      try {
        const project = await projectContinuation.continue(pending.token)
        return `project=${encodeURIComponent(project.id)}`
      } catch (error) {
        if (
          error instanceof DomainError &&
          ['NOT_AVAILABLE', 'AUTH_REQUIRED'].includes(error.detail.code)
        )
          return 'account'
        throw error
      }
    })()
    projectOpenings.set(identity, work)
    const clear = () => {
      if (projectOpenings.get(identity) === work) projectOpenings.delete(identity)
    }
    void work.then(clear, clear)
    return work
  }
  access = createEntitlementCache({ workflows: storage.workflows, current })
  const billingContext = () => {
    const session = current(),
      selected = controller.getSnapshot().scope
    return session && selected ? { session, scope: selected } : null
  }
  const billing = auth
    ? (await import('./billing/coordinator')).createBillingCoordinator({
        client: auth.functions,
        workflows: storage.workflows,
        current: billingContext,
        platform: native ? (Capacitor.getPlatform() as 'ios' | 'android') : 'web',
        access,
        adapter: native
          ? (await import('./platform/native/purchases')).createNativeBilling({
              current: billingContext,
              loadConfig: (platform, signal) =>
                auth.functions.post('billing-config', { platform }, signal),
            })
          : (await import('./platform/browser/purchases')).createWebBilling({
              current: billingContext,
              client: auth.functions,
            }),
      })
    : undefined
  const purchaseRecovery = auth
    ? (await import('./billing/recovery-service')).createPurchaseRecoveryService({
        repository,
        auth,
        client: auth.functions,
        workflows: storage.workflows,
        current,
      })
    : undefined
  const upgradePrompts = createUpgradePrompts({ workflows: storage.workflows, scope })
  let billingIdentity = '',
    billingRefresh: Promise<void> | undefined
  async function refreshBilling(remote = true) {
    if (!billing || billingRefresh) return
    billingRefresh = (async () => {
      const session = current(),
        identity = canonicalJson(
          session
            ? {
                account: session.accountId,
                principal: session.billingPrincipalId,
                deletion: session.deletionGeneration,
              }
            : null,
        )
      if (identity !== billingIdentity) {
        billingIdentity = identity
        await billing.initialize()
      }
      if (remote && session && online && foreground) await billing.refresh()
    })().catch(() => {
      /* The upgrade screen exposes errors; cached access remains available. */
    })
    await billingRefresh
    billingRefresh = undefined
    const session = current()
    if (
      billingIdentity !==
      canonicalJson(
        session
          ? {
              account: session.accountId,
              principal: session.billingPrincipalId,
              deletion: session.deletionGeneration,
            }
          : null,
      )
    )
      void refreshBilling()
  }
  await refreshBilling(false)
  const data = createLocalDataAdapter({
    ...storage,
    scope,
    mediaConcurrency: config.mediaConcurrency,
  })
  installDraftStoreFactory(() => storage.drafts(scope()))
  const backups = createBackupService({
    ...storage,
    data,
    scope,
    mediaConcurrency: config.mediaConcurrency,
    remote: remoteMedia && transport ? { media: remoteMedia, transport, current } : undefined,
  })
  installDataAdapter({ ...data, exportBackup: backups.exportComplete })
  const deletion = createDeletionService({
    repository,
    auth,
    client: auth?.functions,
    workflows: storage.workflows,
    current: controller.getSession,
  })
  const deletionListeners = new Set<() => void>()
  const captureModule = native ? await import('./platform/native/capture') : undefined
  const captureListeners = new Set<() => void>()
  const captureChanged = () => {
    for (const listener of captureListeners) listener()
  }
  const removeCapture = await storage.captureRecovery?.subscribe(captureChanged)
  const events = new Set<(event: NativeLifecycleEvent) => void>()
  let queuedUrl: NativeLifecycleEvent | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    disposed = false,
    running = false,
    runAgain = false,
    lastWork = ''
  const hints =
    auth && cloudModules
      ? cloudModules[3].createRealtimeHints({
          config,
          token: auth.accessToken,
          current: () => {
            const session = current(),
              selected = controller.getSnapshot().scope
            return session && selected ? { session, scope: selected } : null
          },
          onHint: () => schedule(),
        })
      : undefined
  let hintBinding = ''
  function updateHints() {
    const state = controller.getSnapshot()
    const binding =
      !disposed &&
      foreground &&
      online &&
      state.phase === 'ready' &&
      state.auth === 'authenticated' &&
      state.view?.info.kind === 'connected'
        ? JSON.stringify([state.scope, state.account?.accountId])
        : ''
    if (binding === hintBinding) return
    hintBinding = binding
    hints?.stop()
    if (binding)
      void hints?.start().catch(() => {
        /* Authoritative polling remains available. */
      })
  }
  function schedule(delay = 150) {
    clearTimeout(timer)
    if (disposed || !foreground || !sync) return
    // Saves or realtime hints arriving during hydration/pull must not be lost
    // when that cycle schedules its ordinary 45-second idle poll.
    if (running) {
      runAgain = true
      return
    }
    timer = setTimeout(() => void cycle(), delay)
  }
  async function cycle() {
    if (disposed || !foreground || running) return
    const state = controller.getSnapshot()
    if (
      state.phase !== 'ready' ||
      state.auth !== 'authenticated' ||
      state.view?.info.kind !== 'connected'
    )
      return
    running = true
    try {
      await controller.runSync()
    } catch {
      // The controller publishes a redacted, actionable error. Polls never dismiss it.
    } finally {
      running = false
      const followUp = runAgain
      runAgain = false
      const error = controller.getSnapshot().error
      if (
        !error ||
        error.retryable ||
        ![
          'AUTH_REQUIRED',
          'ACCOUNT_CHANGED',
          'SYNC_REBASE_REQUIRED',
          'CAPABILITY_UNAVAILABLE',
        ].includes(error.code)
      )
        schedule(followUp ? 150 : 45_000)
    }
  }
  const unsubscribe = controller.subscribe(() => {
    updateHints()
    const session = current()
    const identity = canonicalJson(
      session
        ? {
            account: session.accountId,
            principal: session.billingPrincipalId,
            deletion: session.deletionGeneration,
          }
        : null,
    )
    if (identity !== billingIdentity) void refreshBilling()
    const state = controller.getSnapshot()
    const work = JSON.stringify([
      state.scope,
      state.auth,
      state.view?.pending.map((item) => item.intent.operationId),
    ])
    if (work !== lastWork) {
      lastWork = work
      schedule()
    }
  })
  const onNetwork = () => {
    online = navigator.onLine
    updateHints()
    schedule()
    if (online) void refreshBilling()
  }
  const onVisibility = () => {
    foreground = document.visibilityState !== 'hidden'
    updateHints()
    if (!foreground) {
      clearTimeout(timer)
      sync?.stop()
    } else {
      schedule()
      void refreshBilling()
    }
  }
  window.addEventListener('online', onNetwork)
  window.addEventListener('offline', onNetwork)
  document.addEventListener('visibilitychange', onVisibility)
  let removeNative: (() => Promise<void>) | undefined
  if (native) {
    const { subscribeNativeLifecycle } = await import('./platform/native/lifecycle')
    removeNative = await subscribeNativeLifecycle((event) => {
      if (event.type === 'active') {
        foreground = event.active
        updateHints()
        if (!foreground) {
          clearTimeout(timer)
          sync?.stop()
        } else {
          schedule()
          void refreshBilling()
        }
      }
      if (event.type === 'network') {
        online = event.connected
        updateHints()
        schedule()
        if (online) void refreshBilling()
      }
      if (event.type === 'url' && !events.size) queuedUrl = event
      for (const listener of events) listener(event)
    })
  }
  schedule()
  updateHints()
  void refreshBilling()
  return {
    links: {
      getSnapshot: projectContinuation.getSnapshot,
      subscribe: projectContinuation.subscribe,
      dismiss: projectContinuation.dismiss,
      async continue(token: string): Promise<`project=${string}`> {
        const project = await projectContinuation.continue(token)
        return `project=${encodeURIComponent(project.id)}`
      },
    },
    native,
    config,
    controller,
    backups,
    billing,
    upgradePrompts,
    purchaseRecovery,
    async ensureCheckpointMedia(
      checkpointId: string,
      signal: AbortSignal,
      kind?: 'photo' | 'voice',
    ) {
      const selected = scope(),
        view = await repository.readView(selected.key)
      if (!remoteMedia || view.info.kind !== 'connected' || !current()) return
      const checkpoint = view.checkpoints.find((item) => item.id === checkpointId)
      if (!checkpoint) throw new DomainError('NOT_AVAILABLE')
      const refs = mediaRefs([checkpoint]).filter((ref) => !kind || ref.kind === kind)
      await mapBounded(
        refs,
        (ref) => remoteMedia.ensureAvailable(ref, selected, signal),
        config.mediaConcurrency,
      )
    },
    connections,
    subscribeConnections(listener: () => void) {
      connectionListeners.add(listener)
      return () => {
        connectionListeners.delete(listener)
      }
    },
    deletion,
    subscribeDeletion(listener: () => void) {
      deletionListeners.add(listener)
      return () => {
        deletionListeners.delete(listener)
      }
    },
    async deleteAccount(
      choice: {
        code: string
        keepLocal: boolean
        discardUniqueWork?: boolean
        allowMissingAttachments?: boolean
      },
      operationToken: string,
    ) {
      let receiptId: string | undefined
      try {
        await controller.deleteAccount(choice, async (fencedScope) => {
          const result = await deletion.delete(
            { operationToken, code: choice.code },
            fencedScope,
            AbortSignal.timeout(60_000),
          )
          receiptId = result.id
        })
        if (receiptId)
          await deletion.recordLocalOutcome(receiptId, choice.keepLocal ? 'kept' : 'removed')
      } finally {
        for (const listener of deletionListeners) listener()
      }
    },
    repository,
    share: storage.share,
    configurationErrors: errors,
    async accountUsage() {
      const session = controller.getSession()
      if (!auth || !session) throw new DomainError('AUTH_REQUIRED')
      const captured = canonicalJson(session)
      const result = accountUsageSchema.safeParse(
        await auth.functions.post(
          'account-usage',
          { collectionId: session.collection.collectionId, epoch: session.collection.epoch },
          AbortSignal.timeout(30_000),
        ),
      )
      if (canonicalJson(controller.getSession()) !== captured)
        throw new DomainError('ACCOUNT_CHANGED')
      if (
        !result.success ||
        result.data.collectionId !== session.collection.collectionId ||
        result.data.epoch !== session.collection.epoch
      )
        throw new DomainError('SYNC_PAGE_INVALID')
      return result.data
    },
    scope,
    draftStore: () => storage.drafts(scope()),
    captureRecovery: storage.captureRecovery,
    subscribeCapture(listener: () => void) {
      captureListeners.add(listener)
      return () => {
        captureListeners.delete(listener)
      }
    },
    async capturePhoto(source: NativeCaptureSource, isCurrent: () => boolean) {
      if (!captureModule || !storage.captureRecovery)
        throw new DomainError('CAPABILITY_UNAVAILABLE')
      const captured = JSON.stringify(source.scope)
      const capture = captureModule.createNativeCapture({
        isCurrent: () => isCurrent() && JSON.stringify(controller.getSnapshot().scope) === captured,
        onInterrupted: () => {},
        cameraContinuation: { recovery: storage.captureRecovery, source },
      })
      try {
        const result = await capture.photo()
        return { result, id: capture.capturedPhotoId() }
      } finally {
        await capture.dispose()
        captureChanged()
      }
    },
    async acknowledgePhoto(id: string, captured: SessionScope) {
      if (!storage.captureRecovery) throw new DomainError('CAPABILITY_UNAVAILABLE')
      await storage.captureRecovery.acknowledge(id, captured)
      captureChanged()
    },
    createVoiceCapture(options: NativeAudioOptions) {
      const captured = JSON.stringify(scope())
      return captureModule?.createNativeCapture({
        ...options,
        isCurrent: () =>
          options.isCurrent() && JSON.stringify(controller.getSnapshot().scope) === captured,
      })
    },
    subscribePlatform(listener: (event: NativeLifecycleEvent) => void) {
      events.add(listener)
      if (queuedUrl) {
        const event = queuedUrl
        queueMicrotask(() => {
          if (events.has(listener) && queuedUrl === event) {
            queuedUrl = undefined
            listener(event)
          }
        })
      }
      return () => {
        events.delete(listener)
      }
    },
    async openUrl(value: string): Promise<'account' | `project=${string}`> {
      const url = new URL(value)
      if (
        config.appOrigin &&
        url.origin === config.appOrigin &&
        url.pathname === '/auth/callback'
      ) {
        await controller.completeCallback(value)
        return 'account'
      }
      const origin = config.appOrigin ?? (!native ? location.origin : undefined)
      if (!origin) throw new DomainError('NOT_AVAILABLE')
      if (url.origin === origin && url.pathname === '/purchase/return') {
        if (!billing || native) throw new DomainError('PURCHASE_UNAVAILABLE')
        const { parsePurchaseReturn } = await import('./links/purchase-return')
        await billing.verifyReturn(parsePurchaseReturn(value, origin))
        return 'account'
      }
      return openProjectTarget(parseProjectLink(value, origin))
    },
    async dispose() {
      disposed = true
      projectContinuation.dispose()
      hints?.dispose()
      billing?.dispose()
      clearTimeout(timer)
      unsubscribe()
      window.removeEventListener('online', onNetwork)
      window.removeEventListener('offline', onNetwork)
      document.removeEventListener('visibilitychange', onVisibility)
      await removeNative?.()
      await removeCapture?.()
      captureListeners.clear()
      deletionListeners.clear()
      connectionListeners.clear()
      await controller.dispose()
      events.clear()
    },
  }
}
export type AppRuntime = Awaited<ReturnType<typeof createRuntime>>
export function startupMessage(error: unknown): string {
  const detail = safeError(error)
  return `${detail.problem} ${detail.nextAction}`
}
export function appLinkOrigin(config: PublicConfig, native: boolean): string | undefined {
  return config.appOrigin ?? (native ? undefined : location.origin)
}
