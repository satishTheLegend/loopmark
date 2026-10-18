import type { AccountAuth } from '../../../src/auth/auth-service'
import type { AccountSession } from '../../../src/domain/contracts'
import { canonicalJson } from '../../../src/domain/canonical-json'
import { openNativeRepository } from '../../../src/platform/native/repository'
import { createAppController } from '../../../src/services/app-controller'
import { createSyncCoordinator } from '../../../src/sync/coordinator'
import { createRuntimeScheduler } from '../../../src/sync/runtime-scheduler'
import { createTabLease } from '../../../src/sync/tab-lease'
import { create, fixture } from './persistence'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean, message: string, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (!check() && Date.now() < deadline) await delay(10)
  assert(check(), message)
}

/** Actual native SQLite, Web Locks, controller, coordinator and production scheduler.
 * Synthetic identity/network replies and a deliberate async repository barrier only.
 * Timing bounds distinguish immediate scheduling from the 45-second idle poll;
 * they are functional deadlines, not a production performance measurement.
 */
export async function nativeRuntimeScheduler() {
  const results: string[] = []
  for (const queuedGuestSwitch of [false, true]) {
    const repo = await openNativeRepository({
        databaseName: `sched_${crypto.randomUUID().replaceAll('-', '')}`,
      }),
      guest = fixture(),
      connected = fixture(true),
      verification = deferred<AccountSession>(),
      resumeEntered = deferred(),
      resumeReleased = deferred()
    await repo.createCollection(guest)
    await repo.createCollection(connected)
    let selected = await repo.transition(null, {
      key: guest.key,
      device: { id: 'scheduler-device', generation: 'initial' },
    })
    await repo.commitLocal(
      guest.key,
      create(guest, 'Guest survives queued startup'),
      selected.generation,
    )
    selected = await repo.transition(selected, { key: connected.key, device: selected.device })
    const session: AccountSession = {
      accountId: connected.accountId!,
      billingPrincipalId: 'synthetic-native-billing',
      deletionGeneration: '0',
      collection: connected.key,
      device: selected.device,
      expiresAt: '2030-01-01T00:00:00.000Z',
    }
    await repo.hydrate(
      connected.key,
      [
        {
          protocolVersion: 2,
          snapshotId: 'scheduler-initial',
          collectionId: connected.key.collectionId,
          epoch: connected.key.epoch,
          cursor: '0',
          revision: '0',
          expiresAt: session.expiresAt,
          after: null,
          nextPage: null,
          projects: [],
          checkpoints: [],
          media: [],
        },
      ],
      selected.generation,
    )
    let resumedRevision: string | undefined
    const originalResume = repo.resumeAfterAuthentication.bind(repo)
    repo.resumeAfterAuthentication = async (...args) => {
      resumeEntered.resolve()
      await resumeReleased.promise
      await originalResume(...args)
      resumedRevision = (await repo.readView(connected.key)).revision
    }
    const unused = async (): Promise<never> => {
      throw new Error('Unexpected synthetic service call')
    }
    const identity = { accountId: session.accountId, email: 'native-scheduler@example.test' }
    const auth: AccountAuth = {
      functions: { post: unused },
      accessToken: async () => null,
      verifiedIdentity: async () => identity,
      cachedSession: async () => ({ session, identity }),
      currentSession: () => verification.promise,
      subscribeIdentity: () => () => {},
      requestCode: unused,
      verifyCode: unused,
      completeCallback: unused,
      reauthenticate: unused,
      reregisterDevice: unused,
      signOut: async () => {},
      dispose: () => {},
    }
    let pulls = 0
    assert(!!navigator.locks, 'Native Web Locks unavailable')
    const sync = createSyncCoordinator({
      repository: repo,
      lease: createTabLease(),
      currentAccountId: () => session.accountId,
      transport: {
        push: unused,
        snapshot: unused,
        releaseSnapshot: unused,
        pull: async (request) => {
          pulls++
          return {
            protocolVersion: 2,
            collectionId: request.collectionId,
            epoch: request.epoch,
            afterCursor: request.afterCursor,
            nextCursor: request.afterCursor,
            entries: [],
            hasMore: false,
          }
        },
      },
    })
    const controller = createAppController({ repository: repo, auth, sync, media: repo.media })
    const originalRun = controller.runSync.bind(controller)
    let lastRun: Promise<void> | undefined
    controller.runSync = () => {
      lastRun = originalRun()
      return lastRun
    }
    let scheduler: ReturnType<typeof createRuntimeScheduler> | undefined,
      selection: Promise<void> | undefined
    try {
      await controller.initialize()
      scheduler = createRuntimeScheduler({
        controller,
        enabled: true,
        foreground: () => true,
        online: () => true,
      })
      verification.resolve(session)
      await Promise.race([
        resumeEntered.promise,
        delay(15000).then(() => {
          throw new Error('Startup resume barrier was not reached')
        }),
      ])
      assert(
        controller.getSnapshot().auth === 'authenticated',
        'Authentication was not published before resume',
      )
      assert(
        controller.getSnapshot().transitioning,
        'Pending startup work is not exposed as transitioning',
      )
      if (queuedGuestSwitch) selection = controller.chooseCollection(guest.key)
      await delay(300)
      assert(pulls === 0, 'Scheduler pulled before authenticated startup work settled')
      assert(controller.getSnapshot().error === null, 'Scheduler published an early startup error')
      results.push(
        queuedGuestSwitch
          ? 'queued collection switch keeps startup unready with zero early native pulls'
          : 'authenticated startup held beyond the initial timer sends zero early native pulls',
      )
      resumeReleased.resolve()
      if (queuedGuestSwitch) {
        await selection
        await until(
          () => !controller.getSnapshot().transitioning,
          'Queued selection did not settle',
        )
        scheduler.request(0)
        await delay(300)
        const state = controller.getSnapshot(),
          active = await repo.readActive()
        assert(pulls === 0, 'Queued guest switch admitted an obsolete account pull')
        assert(
          state.phase === 'ready' &&
            state.error === null &&
            canonicalJson(state.scope?.key) === canonicalJson(guest.key),
          'Queued guest switch lost its ready view',
        )
        assert(
          state.view?.projects[0]?.name === 'Guest survives queued startup',
          'Guest project disappeared',
        )
        assert(
          canonicalJson(active) === canonicalJson(state.scope),
          'Durable selected scope differs after queued startup',
        )
        results.push(
          'queued guest selection cancels old scheduling and preserves exact durable guest scope',
        )
      } else {
        await until(() => !controller.getSnapshot().transitioning, 'Startup did not settle')
        await until(
          () => pulls === 1,
          'Settlement failed to schedule a prompt first pull before idle polling',
          2000,
        )
        await lastRun
        assert(controller.getSnapshot().error === null, 'First settled pull failed')
        assert(
          canonicalJson(await repo.readActive()) === canonicalJson(selected),
          'First pull changed selected scope',
        )
        assert(
          resumedRevision && (await repo.readView(connected.key)).revision === resumedRevision,
          'Empty first pull changed native revision',
        )
        results.push(
          'startup settlement triggers the first pull promptly while preserving SQLite scope and revision',
        )
      }
    } finally {
      scheduler?.dispose()
      resumeReleased.resolve()
      verification.resolve(session)
      await selection?.catch(() => {})
      await lastRun?.catch(() => {})
      await controller.dispose()
      await repo.close()
    }
  }
  return results
}
