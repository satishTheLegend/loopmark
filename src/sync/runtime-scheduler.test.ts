import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository } from '../repositories/browser/repository'
import { info, project, create } from '../repositories/browser/fixtures.test-support'
import type { AccountSession, SessionScope } from '../domain/contracts'
import type { AccountAuth } from '../auth/auth-service'
import { DomainError } from '../domain/errors'
import { createAppController } from '../services/app-controller'
import { createSyncCoordinator } from './coordinator'
import { createRuntimeScheduler } from './runtime-scheduler'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
async function until(check: () => boolean) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  expect(check()).toBe(true)
}
async function waitForControllerIdle(controller: ReturnType<typeof createAppController>) {
  for (let i = 0; i < 1000; i++) {
    try {
      await controller.listAttachments()
      return
    } catch (error) {
      if (!(error instanceof DomainError) || error.detail.code !== 'ACCOUNT_CHANGED') throw error
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error('Controller did not settle local recovery')
}
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const close of cleanup.splice(0)) await close()
  vi.restoreAllMocks()
})
async function setup() {
  const repo = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: crypto.randomUUID(),
  })
  const connected = {
    ...info(true, 'connected'),
    accountId: 'account',
    key: { ...info(true, 'connected').key, namespace: 'account_account' },
  }
  await repo.createCollection(connected)
  const scope: SessionScope = {
    key: connected.key,
    generation: 1,
    device: { id: 'device', generation: 'device-generation' },
  }
  await repo.activate(scope)
  const session: AccountSession = {
    accountId: 'account',
    billingPrincipalId: 'principal',
    deletionGeneration: '0',
    collection: connected.key,
    device: scope.device,
    expiresAt: '2030-01-01T00:00:00.000Z',
  }
  await repo.hydrate(
    scope.key,
    [
      {
        protocolVersion: 2,
        snapshotId: 'initial',
        collectionId: scope.key.collectionId,
        epoch: scope.key.epoch,
        cursor: '1',
        revision: '1',
        expiresAt: session.expiresAt,
        after: null,
        nextPage: null,
        projects: [project('existing', '1')],
        checkpoints: [],
        media: [],
      },
    ],
    scope.generation,
  )
  const verification = deferred<AccountSession>(),
    resume = deferred(),
    entered = deferred()
  const actualResume = repo.resumeAfterAuthentication.bind(repo)
  vi.spyOn(repo, 'resumeAfterAuthentication').mockImplementation(async (...args) => {
    entered.resolve()
    await resume.promise
    return actualResume(...args)
  })
  let identityListener: ((accountId: string | null) => void) | undefined
  const auth: AccountAuth = {
    functions: { post: vi.fn() },
    accessToken: async () => null,
    verifiedIdentity: async () => ({ accountId: 'account', email: 'verified@example.test' }),
    cachedSession: async () => ({
      session,
      identity: { accountId: 'account', email: 'verified@example.test' },
    }),
    currentSession: () => verification.promise,
    subscribeIdentity: (listener) => {
      identityListener = listener
      return () => {
        identityListener = undefined
      }
    },
    requestCode: vi.fn(),
    verifyCode: vi.fn(),
    completeCallback: vi.fn(),
    reauthenticate: vi.fn(),
    reregisterDevice: vi.fn(),
    signOut: vi.fn(),
    dispose: () => {},
  }
  const transport = {
    pull: vi.fn(async () => {
      throw new DomainError('SYNC_REBASE_REQUIRED')
    }),
    push: vi.fn(),
    snapshot: vi.fn(),
    releaseSnapshot: vi.fn(),
  }
  const sync = createSyncCoordinator({
    repository: repo,
    transport,
    currentAccountId: () => 'account',
    lease: {
      run: async (_scope, _signal, work) => {
        await work()
        return true
      },
    },
  })
  const controller = createAppController({ repository: repo, auth, sync })
  await controller.initialize()
  let foreground = true,
    online = true
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const scheduler = createRuntimeScheduler({
    controller,
    enabled: true,
    foreground: () => foreground,
    online: () => online,
  })
  cleanup.push(async () => {
    scheduler.dispose()
    resume.resolve()
    await controller.dispose()
    await repo.close()
  })
  verification.resolve(session)
  await entered.promise
  return {
    repo,
    controller,
    scheduler,
    transport,
    resume,
    scope,
    connected,
    sync,
    invalidateIdentity: () => identityListener?.('another-account'),
    setForeground: (value: boolean) => {
      foreground = value
      if (!value) scheduler.cancel()
      else scheduler.request()
    },
    setOnline: (value: boolean) => {
      online = value
      scheduler.request()
    },
  }
}

it('runs the first pull promptly after authenticated startup recovery settles beyond the initial timer', async () => {
  const { controller, transport, resume } = await setup()
  expect(controller.getSnapshot().auth).toBe('authenticated')
  await vi.advanceTimersByTimeAsync(300)
  expect(transport.pull).not.toHaveBeenCalled()
  resume.resolve()
  await waitForControllerIdle(controller)
  await vi.advanceTimersByTimeAsync(150)
  await until(() => transport.pull.mock.calls.length > 0)
  expect(transport.pull).toHaveBeenCalledOnce()
  await until(() => controller.getSnapshot().error?.code === 'SYNC_REBASE_REQUIRED')
  expect(controller.getSnapshot().scope?.generation).toBe(1)
})

for (const condition of ['hidden', 'offline'] as const) {
  it(`does not start after recovery settles while ${condition}, then syncs on eligibility return`, async () => {
    const fixture = await setup()
    const change = condition === 'hidden' ? fixture.setForeground : fixture.setOnline
    await vi.advanceTimersByTimeAsync(300)
    change(false)
    fixture.resume.resolve()
    await until(() => !fixture.controller.getSnapshot().transitioning)
    await vi.advanceTimersByTimeAsync(45_000)
    expect(fixture.transport.pull).not.toHaveBeenCalled()
    change(true)
    await vi.advanceTimersByTimeAsync(150)
    await until(() => fixture.transport.pull.mock.calls.length > 0)
    expect(fixture.transport.pull).toHaveBeenCalledOnce()
  })
}
it('does not start or publish after disposal while startup recovery is held', async () => {
  const { controller, scheduler, transport, resume } = await setup()
  const published = vi.fn()
  controller.subscribe(published)
  scheduler.dispose()
  const disposed = controller.dispose()
  resume.resolve()
  await disposed
  await vi.advanceTimersByTimeAsync(45_000)
  expect(transport.pull).not.toHaveBeenCalled()
  expect(published).not.toHaveBeenCalled()
})
it('keeps queued account-selection work unavailable through an ABA switch and binds only the settled generation', async () => {
  const { repo, controller, transport, resume, connected, sync } = await setup()
  const guest = info()
  await repo.createCollection(guest)
  const selected = deferred(),
    releaseSelection = deferred()
  const actualTransition = repo.transition.bind(repo)
  vi.spyOn(repo, 'transition').mockImplementationOnce(async (...args) => {
    selected.resolve()
    await releaseSelection.promise
    return actualTransition(...args)
  })
  const run = vi.spyOn(sync, 'run')
  const readiness: boolean[] = []
  controller.subscribe(() => readiness.push(controller.getSnapshot().transitioning))
  const toGuest = controller.chooseCollection(guest.key)
  const toAccount = controller.chooseCollection(connected.key)
  // An old caller remains invalid immediately; it cannot become a future-selection action.
  await expect(controller.runSync()).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  await vi.advanceTimersByTimeAsync(300)
  resume.resolve()
  await selected.promise
  await vi.advanceTimersByTimeAsync(150)
  expect(readiness.every(Boolean)).toBe(true)
  expect(transport.pull).not.toHaveBeenCalled()
  releaseSelection.resolve()
  await Promise.all([toGuest, toAccount])
  expect(controller.getSnapshot().scope?.generation).toBe(3)
  expect(controller.getSnapshot().scope?.key).toEqual(connected.key)
  await vi.advanceTimersByTimeAsync(150)
  await until(() => transport.pull.mock.calls.length > 0)
  expect(run).toHaveBeenCalledOnce()
  expect(run).toHaveBeenCalledWith(controller.getSnapshot().scope)
  expect(readiness.filter((value, index) => !value && readiness[index - 1] !== false)).toHaveLength(
    1,
  )
})
it('does not retry a fatal recovery error on a hint or the idle timer', async () => {
  const { controller, scheduler, transport, resume } = await setup()
  resume.resolve()
  await until(() => !controller.getSnapshot().transitioning)
  await vi.advanceTimersByTimeAsync(150)
  await until(() => controller.getSnapshot().error?.code === 'SYNC_REBASE_REQUIRED')
  scheduler.request()
  await vi.advanceTimersByTimeAsync(45_000)
  expect(transport.pull).toHaveBeenCalledOnce()
})
it('preserves the immediate follow-up when local work arrives during an active sync', async () => {
  const { repo, controller, resume, sync, scope } = await setup()
  const running = deferred()
  const run = vi
    .spyOn(sync, 'run')
    .mockImplementationOnce(() => running.promise)
    .mockResolvedValue(undefined)
  resume.resolve()
  await until(() => !controller.getSnapshot().transitioning)
  await vi.advanceTimersByTimeAsync(150)
  await until(() => run.mock.calls.length === 1)
  await repo.commitLocal(scope.key, create('new-work'), scope.generation)
  await until(() => controller.getSnapshot().view?.pending.length === 1)
  running.resolve()
  for (let i = 0; i < 50; i++) await new Promise<void>((resolve) => setImmediate(resolve))
  await vi.advanceTimersByTimeAsync(150)
  await until(() => run.mock.calls.length === 2)
  expect(run).toHaveBeenNthCalledWith(2, scope)
})

it('does not transfer a startup timer to a different authenticated identity', async () => {
  const { controller, transport, resume, invalidateIdentity } = await setup()
  await vi.advanceTimersByTimeAsync(300)
  invalidateIdentity()
  expect(controller.getSnapshot().scope).toBeNull()
  expect(controller.getSnapshot().account).toBeNull()
  resume.resolve()
  await until(() => !controller.getSnapshot().transitioning)
  await vi.advanceTimersByTimeAsync(45_000)
  expect(controller.getSnapshot().view?.info.kind).toBe('guest')
  expect(controller.getSnapshot().auth).toBe('expired')
  expect(transport.pull).not.toHaveBeenCalled()
})
it('preserves admission order when a readiness subscriber queues another selection', async () => {
  const { repo, controller, scheduler, resume, connected } = await setup()
  scheduler.dispose()
  resume.resolve()
  await waitForControllerIdle(controller)
  const guest = info()
  await repo.createCollection(guest)
  const transitions = vi.spyOn(repo, 'transition')
  const readiness: boolean[] = []
  let successor: Promise<void> | undefined
  controller.subscribe(() => {
    const transitioning = controller.getSnapshot().transitioning
    readiness.push(transitioning)
    if (transitioning && !successor) successor = controller.chooseCollection(connected.key)
  })
  await controller.chooseCollection(guest.key)
  await successor
  expect(transitions.mock.calls.map(([, next]) => next.key)).toEqual([guest.key, connected.key])
  expect(controller.getSnapshot().scope?.key).toEqual(connected.key)
  expect(controller.getSnapshot().scope?.generation).toBe(3)
  expect(readiness.filter((value, index) => !value && readiness[index - 1] !== false)).toHaveLength(
    1,
  )
})
