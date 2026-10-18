import type { AccountAuth } from '../../../src/auth/auth-service'
import type { AccountSession } from '../../../src/domain/contracts'
import { canonicalJson } from '../../../src/domain/canonical-json'
import { openNativeRepository } from '../../../src/platform/native/repository'
import { createAppController } from '../../../src/services/app-controller'
import { createSyncCoordinator } from '../../../src/sync/coordinator'
import { createTabLease } from '../../../src/sync/tab-lease'
import { create, fixture } from './persistence'

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message)
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Real controller/coordinator, Web Locks and SQLite; only account/network replies are synthetic. */
export async function nativeControllerSwitch() {
  const results: string[] = [],
    databaseName = `controller_switch_${Date.now()}`,
    guest = fixture(),
    connected = fixture(true),
    cleanupEntered = deferred(),
    cleanupReleased = deferred()
  let repo = await openNativeRepository({ databaseName })
  await repo.createCollection(guest)
  await repo.createCollection(connected)
  const initial = await repo.transition(null, {
    key: guest.key,
    device: { id: 'guest-device', generation: 'initial' },
  })
  await repo.commitLocal(guest.key, create(guest, 'Keep my local next step'), initial.generation)
  const session: AccountSession = {
    accountId: connected.accountId!,
    billingPrincipalId: 'synthetic-native-billing',
    deletionGeneration: '0',
    collection: connected.key,
    device: { id: 'account-device', generation: 'initial' },
    expiresAt: '2030-01-01T00:00:00.000Z',
  }
  const unused = async (): Promise<never> => {
    throw new Error('Unexpected synthetic service call')
  }
  const auth: AccountAuth = {
    reregisterDevice: unused,
    functions: { post: unused },
    accessToken: async () => null,
    verifiedIdentity: async () => ({
      accountId: session.accountId,
      email: 'native-fixture@example.test',
    }),
    cachedSession: async () => null,
    subscribeIdentity: () => () => {},
    currentSession: async () => null,
    verifyCode: async () => session,
    requestCode: unused,
    reauthenticate: unused,
    signOut: async () => {},
    completeCallback: unused,
    dispose: () => {},
  }
  assert(!!navigator.locks, 'Actual native Web Locks unavailable')
  const sync = createSyncCoordinator({
    repository: repo,
    lease: createTabLease(),
    currentAccountId: () => session.accountId,
    transport: {
      push: unused,
      pull: async (request) => ({
        protocolVersion: 2,
        collectionId: request.collectionId,
        epoch: request.epoch,
        afterCursor: request.afterCursor,
        nextCursor: request.afterCursor,
        entries: [],
        hasMore: false,
      }),
      snapshot: async () => ({
        protocolVersion: 2,
        snapshotId: 'controller-switch-snapshot',
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
      }),
      releaseSnapshot: async () => {
        cleanupEntered.resolve()
        // A remote cleanup may complete after the local sync cancellation.
        await cleanupReleased.promise
      },
    },
  })
  const controller = createAppController({ repository: repo, auth, sync, media: repo.media })
  let running: Promise<void> | undefined
  try {
    await controller.initialize()
    await controller.verifyCode('native-fixture@example.test', '123456')
    await controller.chooseCollection(connected.key)
    running = controller.runSync()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        cleanupEntered.promise,
        running.then(() => {
          throw new Error('Sync completed before the cleanup barrier')
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Snapshot cleanup barrier was not reached')),
            15000,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    assert(
      (await repo.readView(connected.key)).hydration === 'ready',
      'Snapshot did not reach real SQLite',
    )
    await controller.chooseCollection(guest.key)
    const selected = controller.getSnapshot().scope
    assert(
      !!selected && canonicalJson(selected.key) === canonicalJson(guest.key),
      'Guest switch did not finish',
    )
    cleanupReleased.resolve()
    await running
    const state = controller.getSnapshot()
    assert(
      state.phase === 'ready' &&
        state.error === null &&
        canonicalJson(state.scope) === canonicalJson(selected) &&
        state.view?.projects[0]?.name === 'Keep my local next step',
      'Old sync completion invalidated the newly selected guest view',
    )
    assert(
      canonicalJson(await repo.readActive()) === canonicalJson(selected),
      'Durable selected scope changed',
    )
    results.push('late snapshot cleanup cannot clear the guest view or publish ACCOUNT_CHANGED')
    const next = create(guest, 'Saved after late sync')
    if (next.kind !== 'project.create' || !selected) throw new Error('Wrong fixture')
    next.payload.project.id = 'after-late-sync'
    next.payload.project.code = 'LATE-2'
    await repo.commitLocal(guest.key, next, selected.generation)
    await controller.chooseCollection(guest.key)
    assert(
      controller.getSnapshot().view?.projects.length === 2,
      'Local saving no longer works after stale sync',
    )
    results.push('current guest remains editable through the real repository and controller')
    await controller.dispose()
    const expected = await repo.readView(guest.key),
      expectedScope = await repo.readActive()
    await repo.close()
    repo = await openNativeRepository({ databaseName })
    assert(
      canonicalJson(await repo.readView(guest.key)) === canonicalJson(expected),
      'Guest records differ after SQLite reopen',
    )
    assert(
      canonicalJson(await repo.readActive()) === canonicalJson(expectedScope),
      'Selection differs after SQLite reopen',
    )
    results.push('guest records and selection persist after actual SQLite close/reopen')
    return results
  } finally {
    cleanupReleased.resolve()
    await running?.catch(() => {})
    await controller.dispose()
    await repo.close()
  }
}
