import { Capacitor } from '@capacitor/core'
import { loadPublicConfig, type PublicConfig } from './config'
import { installDataAdapter } from './data'
import { installDraftStoreFactory } from './drafts'
import { DomainError, safeError } from './domain/errors'
import type { SessionScope } from './domain/contracts'
import type { Repository } from './repositories/contracts'
import type { DraftStore } from './repositories/drafts'
import type { PlatformMedia, CredentialStore, SharePort } from './platform/contracts'
import type { OperationPlanStore } from './services/operation-plans'
import type { DeviceStore } from './auth/auth-service'
import type { NativeLifecycleEvent } from './platform/native/lifecycle'
import type { NativeAudioOptions } from './platform/native/audio'
import type { NativeCaptureRecovery, NativeCaptureSource } from './platform/native/capture-recovery'
import type { WorkflowStore } from './services/workflow-store'
import { createAppController } from './services/app-controller'
import { createLocalDataAdapter } from './services/local-data-service'
import { createBackupService } from './services/backup-service'
import { prepareBrowserStorage, prepareNativeStorage } from './services/startup'
import { createSyncCoordinator } from './sync/coordinator'
import { createSyncTransport } from './sync/transport'
import { createTabLease } from './sync/tab-lease'
import { parseProjectLink, resolveProjectLink } from './links/link-service'

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
async function openStorage(native: boolean): Promise<Storage> {
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
    const repository = await repositoryModule.openNativeRepository()
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
  const repository = await repositoryModule.openBrowserRepository()
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
  const native = Capacitor.isNativePlatform(),
    { config, errors } = loadPublicConfig(environment),
    storage = await openStorage(native),
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
  const sync = auth
    ? createSyncCoordinator({
        repository,
        transport: createSyncTransport(auth.functions),
        lease: createTabLease(),
        online: () => online,
      })
    : undefined
  const controller = createAppController({ repository, auth, sync, media: storage.media })
  await controller.initialize()
  const scope = () => {
    const value = controller.getSnapshot().scope
    if (!value) throw new DomainError('ACCOUNT_CHANGED')
    return structuredClone(value)
  }
  const data = createLocalDataAdapter({
    ...storage,
    scope,
    mediaConcurrency: config.mediaConcurrency,
  })
  installDataAdapter(data)
  installDraftStoreFactory(() => storage.drafts(scope()))
  const backups = createBackupService({ ...storage, data, scope })
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
    lastWork = ''
  function schedule(delay = 150) {
    clearTimeout(timer)
    if (disposed || !foreground || !sync) return
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
        schedule(4000)
    }
  }
  const unsubscribe = controller.subscribe(() => {
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
    schedule()
  }
  const onVisibility = () => {
    foreground = document.visibilityState !== 'hidden'
    if (!foreground) {
      clearTimeout(timer)
      sync?.stop()
    } else schedule()
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
        if (!foreground) {
          clearTimeout(timer)
          sync?.stop()
        } else schedule()
      }
      if (event.type === 'network') {
        online = event.connected
        schedule()
      }
      if (event.type === 'url' && !events.size) queuedUrl = event
      for (const listener of events) listener(event)
    })
  }
  schedule()
  return {
    native,
    config,
    controller,
    backups,
    repository,
    share: storage.share,
    configurationErrors: errors,
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
      const selected = scope()
      const project = await resolveProjectLink({
        target: parseProjectLink(value, origin),
        scope: selected,
        repository,
        accountId: controller.getSnapshot().account?.accountId ?? null,
        signal: AbortSignal.timeout(60000),
        hydrate: () => controller.runSync(),
      })
      return `project=${encodeURIComponent(project.id)}`
    },
    async dispose() {
      disposed = true
      clearTimeout(timer)
      unsubscribe()
      window.removeEventListener('online', onNetwork)
      window.removeEventListener('offline', onNetwork)
      document.removeEventListener('visibilitychange', onVisibility)
      await removeNative?.()
      await removeCapture?.()
      captureListeners.clear()
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
