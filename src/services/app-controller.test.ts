import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { createBrowserDraftStore } from '../repositories/browser/draft-store'
import {
  info,
  create,
  now,
  project,
  png,
  receipt,
} from '../repositories/browser/fixtures.test-support'
import { describeInline } from './media-codec'
import type { AccountSession, SessionScope } from '../domain/contracts'
import type { AccountAuth } from '../auth/auth-service'
import { createAppController } from './app-controller'
import { DomainError } from '../domain/errors'
import { createSyncCoordinator } from '../sync/coordinator'
const repos: BrowserRepository[] = [],
  controllers: ReturnType<typeof createAppController>[] = []
afterEach(async () => {
  for (const c of controllers.splice(0)) await c.dispose()
  for (const r of repos.splice(0)) await r.close()
})
async function setup(withMedia = false, withRecovery = false) {
  const repo = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: crypto.randomUUID(),
  })
  repos.push(repo)
  const guest = info(),
    connected = {
      ...info(true, 'connected'),
      accountId: 'account',
      key: { ...info(true, 'connected').key, namespace: 'account_account' },
    }
  await repo.createCollection(guest)
  await repo.createCollection(connected)
  const scope: SessionScope = {
    key: guest.key,
    generation: 1,
    device: { id: 'guest-device', generation: 'guest-gen' },
  }
  await repo.activate(scope)
  const session: AccountSession = {
    accountId: 'account',
    billingPrincipalId: 'billing',
    deletionGeneration: '0',
    collection: connected.key,
    device: { id: 'account-device', generation: 'account-gen' },
    expiresAt: '2030-01-01T00:00:00.000Z',
  }
  let current: AccountSession | null = null,
    event: ((accountId: string | null) => void) | undefined
  const auth: AccountAuth = {
    reregisterDevice: vi.fn(async () => session),
    functions: {
      post: async () => {
        throw new Error('unused')
      },
    },
    accessToken: async () => null,
    verifiedIdentity: async () => ({ accountId: 'account', email: 'verified@example.test' }),
    cachedSession: async () => null,
    subscribeIdentity: (listener) => {
      event = listener
      return () => {
        event = undefined
      }
    },
    currentSession: async () => current,
    verifyCode: async () => {
      current = session
      return session
    },
    requestCode: async () => ({ retryAt: now }),
    reauthenticate: async () => {
      throw new Error('unused')
    },
    signOut: vi.fn(async () => {
      current = null
      event?.(null)
    }),
    completeCallback: async () => session,
    dispose: () => {},
  }
  const recoveryTransport = {
    snapshot: vi.fn(async () => ({
      protocolVersion: 2 as const,
      snapshotId: 'rebase-snapshot',
      collectionId: session.collection.collectionId,
      epoch: session.collection.epoch,
      cursor: '20',
      revision: '20',
      expiresAt: session.expiresAt,
      after: null,
      nextPage: null,
      projects: [project('cloud', '20')],
      checkpoints: [],
      media: [],
    })),
    releaseSnapshot: vi.fn(async () => {}),
    push: vi.fn(),
    pull: vi.fn(),
  }
  const sync = withRecovery
    ? createSyncCoordinator({
        repository: repo,
        transport: recoveryTransport,
        currentAccountId: () => 'account',
        lease: {
          run: async (_scope, _signal, work) => {
            await work()
            return true
          },
        },
      })
    : undefined
  const controller = createAppController({
    repository: repo,
    auth,
    sync,
    ...(withMedia ? { media: repo.media } : {}),
  })
  controllers.push(controller)
  await controller.initialize()
  return {
    sync,
    repo,
    recoveryTransport,
    controller,
    auth,
    guest,
    connected,
    session,
    scope,
    event: (accountId: string | null) => event?.(accountId),
  }
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const asyncActions = ['runSync', 'retryOperations', 'retryAttachments'] as const
for (const action of asyncActions) {
  for (const duringSelection of [false, true]) {
    it(`${action} completion cannot replace a deliberately selected collection (transition in flight: ${duringSelection})`, async () => {
      const { controller, repo, connected, guest, sync } = await setup(false, true)
      await controller.verifyCode('maker@example.test', '123456')
      await controller.chooseCollection(connected.key)
      const started = deferred(),
        finish = deferred(),
        selecting = deferred(),
        publishSelection = deferred()
      vi.spyOn(
        sync!,
        action === 'retryAttachments' ? 'retryAttachments' : 'run',
      ).mockImplementationOnce(async () => {
        started.resolve()
        await finish.promise
      })
      const pending = action === 'runSync' ? controller.runSync() : controller[action]([])
      await started.promise
      if (duringSelection) {
        const list = repo.listCollections.bind(repo)
        vi.spyOn(repo, 'listCollections').mockImplementationOnce(async () => {
          selecting.resolve()
          await publishSelection.promise
          return list()
        })
      }
      const selection = controller.chooseCollection(guest.key)
      if (duringSelection) await selecting.promise
      else await selection
      finish.resolve()
      await pending
      publishSelection.resolve()
      await selection
      expect(controller.getSnapshot()).toMatchObject({
        phase: 'ready',
        scope: { key: guest.key },
        view: { info: { key: guest.key } },
        error: null,
      })
      expect(controller.getSnapshot().scope).toEqual(await repo.readActive())
    })
  }
  it(`${action} ignores a late rejection belonging to the prior collection`, async () => {
    const { controller, connected, guest, sync } = await setup(false, true)
    await controller.verifyCode('maker@example.test', '123456')
    await controller.chooseCollection(connected.key)
    const started = deferred(),
      finish = deferred()
    vi.spyOn(
      sync!,
      action === 'retryAttachments' ? 'retryAttachments' : 'run',
    ).mockImplementationOnce(async () => {
      started.resolve()
      await finish.promise
    })
    const pending = action === 'runSync' ? controller.runSync() : controller[action]([])
    await started.promise
    await controller.chooseCollection(guest.key)
    finish.reject(new DomainError('SERVICE_UNAVAILABLE'))
    await expect(pending).resolves.toBeUndefined()
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      scope: { key: guest.key },
      error: null,
    })
  })
}
it('a late run from an earlier generation cannot invalidate an account selected again', async () => {
  const { controller, connected, guest, sync } = await setup(false, true)
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  const original = controller.getSnapshot().scope!,
    started = deferred(),
    finish = deferred()
  vi.spyOn(sync!, 'run').mockImplementationOnce(async () => {
    started.resolve()
    await finish.promise
  })
  const pending = controller.runSync()
  await started.promise
  await controller.chooseCollection(guest.key)
  await controller.chooseCollection(connected.key)
  const selected = controller.getSnapshot().scope!
  expect(selected.generation).toBeGreaterThan(original.generation)
  finish.resolve()
  await pending
  expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', scope: selected, error: null })
})
it('runSync does not start an obsolete request after its initial repository read settles', async () => {
  const { controller, repo, connected, guest, sync } = await setup(false, true)
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  const read = repo.readView.bind(repo),
    started = deferred(),
    finish = deferred()
  vi.spyOn(repo, 'readView').mockImplementationOnce(async (key) => {
    const view = await read(key)
    started.resolve()
    await finish.promise
    return view
  })
  const run = vi.spyOn(sync!, 'run')
  const pending = controller.runSync()
  await started.promise
  await controller.chooseCollection(guest.key)
  finish.resolve()
  await pending
  expect(run).not.toHaveBeenCalled()
  expect(controller.getSnapshot()).toMatchObject({
    phase: 'ready',
    scope: { key: guest.key },
    error: null,
  })
})
it('a still-current completion fails closed when durable scope changed externally', async () => {
  const { controller, repo, connected, sync } = await setup(false, true)
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  const scope = controller.getSnapshot().scope!,
    started = deferred(),
    finish = deferred()
  vi.spyOn(sync!, 'run').mockImplementationOnce(async () => {
    started.resolve()
    await finish.promise
  })
  const pending = controller.runSync()
  await started.promise
  vi.spyOn(repo, 'readActive').mockResolvedValueOnce({ ...scope, generation: scope.generation + 1 })
  finish.resolve()
  await pending
  expect(controller.getSnapshot()).toMatchObject({
    phase: 'error',
    scope: null,
    view: null,
    error: { code: 'ACCOUNT_CHANGED' },
  })
})
it('an older refresh failure cannot overwrite a newer successful refresh in the same scope', async () => {
  const { controller, repo, connected, sync } = await setup(false, true)
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  vi.spyOn(sync!, 'run').mockResolvedValue(undefined)
  const started = deferred(),
    finish = deferred()
  vi.spyOn(repo, 'listCollections').mockImplementationOnce(async () => {
    started.resolve()
    await finish.promise
    throw new DomainError('LOCAL_STORAGE_FAILED')
  })
  const older = controller.runSync()
  await started.promise
  await controller.runSync()
  const newest = controller.getSnapshot()
  finish.resolve()
  await expect(older).resolves.toBeUndefined()
  expect(controller.getSnapshot()).toBe(newest)
})
it('a refresh already reading storage cannot cancel or publish over a later selection', async () => {
  const { controller, repo, connected, guest, sync } = await setup(false, true)
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  vi.spyOn(sync!, 'run').mockResolvedValueOnce(undefined)
  const stopped = vi.spyOn(sync!, 'stop'),
    read = repo.readActive.bind(repo)
  const started = deferred(),
    finish = deferred()
  vi.spyOn(repo, 'readActive').mockImplementationOnce(async () => {
    started.resolve()
    await finish.promise
    return read()
  })
  const older = controller.runSync()
  await started.promise
  await controller.chooseCollection(guest.key)
  stopped.mockClear()
  finish.resolve()
  await older
  expect(stopped).not.toHaveBeenCalled()
  expect(controller.getSnapshot()).toMatchObject({
    phase: 'ready',
    scope: { key: guest.key },
    error: null,
  })
})
it('login retains guest selection, exposes verified identity and switches only deliberately', async () => {
  const { controller, guest, connected } = await setup()
  await controller.verifyCode('typed@example.test', '123456')
  expect(controller.getSnapshot().scope?.key).toEqual(guest.key)
  expect(controller.getSnapshot().account?.email).toBe('verified@example.test')
  const copy = controller.getSession()!
  copy.billingPrincipalId = 'tampered'
  expect(controller.getSession()?.billingPrincipalId).toBe('billing')
  await controller.chooseCollection(connected.key)
  expect(controller.getSnapshot().scope?.key).toEqual(connected.key)
})
it('keeps a restored collection without selecting it when cleanup finishes after a deliberate switch', async () => {
  const { repo, controller, connected } = await setup()
  const restored = { ...info(false, 'restored'), kind: 'recovered' as const }
  await repo.createCollection(restored)
  await controller.verifyCode('maker@example.test', '123456')
  const source = controller.getSnapshot().scope!
  let finishCleanup!: () => void
  const cleanup = new Promise<void>((resolve) => {
    finishCleanup = resolve
  })
  const continuation = cleanup.then(() => controller.chooseCollection(restored.key, source))
  await controller.chooseCollection(connected.key)
  const selected = controller.getSnapshot().scope
  finishCleanup()
  await expect(continuation).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  expect(controller.getSnapshot().scope).toEqual(selected)
  expect(await repo.readActive()).toEqual(selected)
  expect((await repo.readView(restored.key)).info.kind).toBe('recovered')
  // Manual selection remains available after reviewing the saved copy.
  await controller.chooseCollection(restored.key)
  expect(controller.getSnapshot().scope?.key).toEqual(restored.key)
})
it('checks the captured source inside the serialized selection, including same-key generation changes', async () => {
  const { repo, controller, guest } = await setup()
  const restored = { ...info(false, 'restored'), kind: 'recovered' as const }
  await repo.createCollection(restored)
  const source = structuredClone(controller.getSnapshot().scope!)
  const transition = controller.chooseCollection(guest.key)
  const staleContinuation = controller.chooseCollection(restored.key, source)
  // Mutating the caller-owned object must not change the queued guard.
  source.generation += 1
  await transition
  await expect(staleContinuation).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  expect(controller.getSnapshot().scope?.key).toEqual(guest.key)
  expect(controller.getSnapshot().scope?.generation).toBe(source.generation)
  expect(await repo.readActive()).toEqual(controller.getSnapshot().scope)
  await controller.chooseCollection(restored.key, controller.getSnapshot().scope!)
  expect(controller.getSnapshot().scope?.key).toEqual(restored.key)
})
it('refuses a guarded selection when durable scope changes before the controller observes it', async () => {
  const { repo, controller, guest } = await setup()
  const source = controller.getSnapshot().scope!
  const changed = await repo.transition(source, {
    key: guest.key,
    device: { ...source.device, generation: 'new-device-generation' },
  })
  await expect(controller.chooseCollection(guest.key, source)).rejects.toMatchObject({
    detail: { code: 'ACCOUNT_CHANGED' },
  })
  expect(await repo.readActive()).toEqual(changed)
})
it('does not create an empty next epoch over a pending replacement when verified auth advances after response loss', async () => {
  const { repo, controller, connected, session, auth } = await setup()
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  const scope = controller.getSnapshot().scope!
  await repo.hydrate(
    scope.key,
    [
      {
        protocolVersion: 2,
        snapshotId: 'snapshot',
        collectionId: scope.key.collectionId,
        epoch: scope.key.epoch,
        cursor: '0',
        revision: '0',
        expiresAt: '2030-01-01T00:00:00.000Z',
        after: null,
        nextPage: null,
        projects: [],
        checkpoints: [],
        media: [],
      },
    ],
    scope.generation,
  )
  await repo.commitLocal(
    scope.key,
    {
      kind: 'collection.replace',
      operationId: 'replacement',
      createdAt: now,
      base: { revision: '0' },
      payload: { reservationId: 'reservation', candidateSha256: 'a'.repeat(64), nextEpoch: 'next' },
    },
    scope.generation,
  )
  auth.verifyCode = async () => ({
    ...session,
    collection: { ...session.collection, epoch: 'next' },
  })
  await controller.verifyCode('maker@example.test', '123456')
  expect((await repo.listCollections()).some((c) => c.key.epoch === 'next')).toBe(false)
  expect(controller.getSession()?.collection.epoch).toBe('next')
  expect(await repo.pending(scope.key)).toHaveLength(1)
})
it('sign-out counts unsent project mutations and requires explicit discard with no checkpoint', async () => {
  const { controller, repo, connected, auth } = await setup()
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  const scope = controller.getSnapshot().scope!
  await repo.commitLocal(connected.key, create(), scope.generation)
  const counts = await controller.prepareSignOut()
  expect(counts.unsentProjectChanges).toBe(1)
  expect(counts.unsentCheckpoints).toBe(0)
  await expect(controller.signOut({ keepLocal: false })).rejects.toMatchObject({
    detail: { code: 'VALIDATION' },
  })
  expect(auth.signOut).not.toHaveBeenCalled()
  await controller.signOut({ keepLocal: false, discardUniqueWork: true })
  expect((await repo.listCollections()).some((c) => c.kind === 'connected')).toBe(false)
  expect(controller.getSnapshot().account).toBeNull()
  expect(controller.getSession()).toBeNull()
})
it('a draft created after review blocks signout and keep preserves its source-bound content', async () => {
  const { controller, repo, connected } = await setup()
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  const scope = controller.getSnapshot().scope!,
    drafts = createBrowserDraftStore(repo, scope)
  await controller.prepareSignOut()
  await drafts.write('new', undefined, {
    key: 'new',
    revision: 'draft1',
    value: { name: 'Unfinished' },
  })
  await expect(controller.signOut({ keepLocal: true })).rejects.toMatchObject({
    detail: { code: 'REVISION_CONFLICT' },
  })
  await controller.prepareSignOut()
  await controller.signOut({ keepLocal: true })
  const selected = controller.getSnapshot().scope!
  expect((await repo.readView(selected.key)).info.kind).toBe('retained')
  expect(await createBrowserDraftStore(repo, selected).read('new')).toMatchObject({
    value: { name: 'Unfinished' },
  })
  await expect(
    drafts.write('new', 'draft1', { key: 'new', revision: 'late', value: {} }),
  ).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
})
it('retains saved work and drafts before the deletion barrier, and failure preserves both copies', async () => {
  const { controller, repo, connected, auth } = await setup()
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  const scope = controller.getSnapshot().scope!
  await repo.commitLocal(scope.key, create(), scope.generation)
  await createBrowserDraftStore(repo, scope).write('new', undefined, {
    key: 'new',
    revision: 'draft1',
    value: { name: 'Draft' },
  })
  await controller.prepareSignOut()
  const revoke = vi.fn(async (fenced: SessionScope) => {
    expect(fenced.generation).toBeGreaterThan(scope.generation)
    expect(await repo.readActive()).toEqual(fenced)
    const retained = (await repo.listCollections()).find((c) => c.kind === 'retained')!
    expect((await repo.readView(retained.key)).projects).toHaveLength(1)
    expect((await repo.reviewLocal(retained.key)).drafts).toHaveLength(1)
    throw new DomainError('OFFLINE')
  })
  await expect(controller.deleteAccount({ keepLocal: true }, revoke)).rejects.toMatchObject({
    detail: { code: 'OFFLINE' },
  })
  expect(auth.signOut).not.toHaveBeenCalled()
  expect((await repo.readView(connected.key)).projects).toHaveLength(1)
  expect((await repo.listCollections()).filter((c) => c.kind === 'retained')).toHaveLength(1)
})
it('clears credentials and removes connected copies only after successful deletion', async () => {
  const { controller, repo, connected, auth } = await setup()
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  await controller.prepareSignOut()
  const order: string[] = []
  vi.mocked(auth.signOut).mockImplementation(async () => {
    order.push('credentials')
  })
  await controller.deleteAccount({ keepLocal: false }, async () => {
    order.push('barrier')
    expect((await repo.listCollections()).some((c) => c.kind === 'connected')).toBe(true)
  })
  expect(order).toEqual(['barrier', 'credentials'])
  expect((await repo.listCollections()).some((c) => c.kind === 'connected')).toBe(false)
})
it('an empty background pull after deletion review permits explicit draft discard and preserves guest work', async () => {
  const { controller, repo, connected, guest, auth } = await setup()
  const guestScope = controller.getSnapshot().scope!
  await repo.commitLocal(guest.key, create('personal'), guestScope.generation)
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  const scope = controller.getSnapshot().scope!
  await repo.commitLocal(scope.key, create(), scope.generation)
  const command = (await repo.pending(scope.key))[0].command
  const page = {
    protocolVersion: 2 as const,
    collectionId: scope.key.collectionId,
    epoch: scope.key.epoch,
    afterCursor: '0',
    nextCursor: '1',
    hasMore: false,
    entries: [receipt(command.operationId, command.sha256)],
  }
  await repo.applyPage(scope.key, page, scope.generation)
  const draft = { key: 'checkpoint:project', revision: 'draft-1', value: { nextStep: 'Unsent' } }
  await createBrowserDraftStore(repo, scope).write(draft.key, undefined, draft)
  expect(await controller.prepareSignOut()).toMatchObject({ drafts: 1, unsentProjectChanges: 0 })
  // This is the exact race: a valid poll finishes after review without changing any work.
  await repo.applyPage(scope.key, { ...page, afterCursor: '1', entries: [] }, scope.generation)
  const revoke = vi.fn(async (fenced: SessionScope) => {
    expect(await createBrowserDraftStore(repo, fenced).read(draft.key)).toEqual(draft)
    expect(auth.signOut).not.toHaveBeenCalled()
  })
  await controller.deleteAccount({ keepLocal: false, discardUniqueWork: true }, revoke)
  expect(revoke).toHaveBeenCalledOnce()
  expect(auth.signOut).toHaveBeenCalledOnce()
  expect((await repo.listCollections()).some((c) => c.kind === 'connected')).toBe(false)
  expect((await repo.readView(guest.key)).projects.map((p) => p.id)).toEqual(['personal'])
})
it('requires explicit acknowledgement of missing bytes and rejects unknown cache state before deletion', async () => {
  for (const withMedia of [false, true]) {
    const { repo, controller, connected } = await setup(withMedia)
    await controller.verifyCode('maker@example.test', '123456')
    await controller.chooseCollection(connected.key)
    const scope = controller.getSnapshot().scope!,
      { ref } = await describeInline(png, 'photo')
    await repo.hydrate(
      scope.key,
      [
        {
          protocolVersion: 2,
          snapshotId: 'snapshot',
          collectionId: scope.key.collectionId,
          epoch: scope.key.epoch,
          cursor: '1',
          revision: '1',
          expiresAt: '2030-01-01T00:00:00.000Z',
          after: null,
          nextPage: null,
          projects: [project('project', '1')],
          checkpoints: [
            {
              id: 'checkpoint',
              projectId: 'project',
              revision: '1',
              createdAt: now,
              toolSize: '4 mm',
              position: '2',
              nextStep: 'Next',
              notes: '',
              photo: ref,
            },
          ],
          media: [ref],
        },
      ],
      scope.generation,
    )
    expect((await controller.prepareSignOut()).missingAttachments).toBe(withMedia ? 1 : null)
    const revoke = vi.fn(async () => {})
    await expect(controller.deleteAccount({ keepLocal: true }, revoke)).rejects.toMatchObject({
      detail: { code: 'BACKUP_INCOMPLETE' },
    })
    expect(revoke).not.toHaveBeenCalled()
    if (withMedia)
      await controller.deleteAccount({ keepLocal: true, allowMissingAttachments: true }, revoke)
    else
      await expect(
        controller.deleteAccount({ keepLocal: true, allowMissingAttachments: true }, revoke),
      ).rejects.toMatchObject({ detail: { code: 'BACKUP_INCOMPLETE' } })
  }
})
it('external auth identity changes hide account data immediately and fence old callbacks', async () => {
  const { controller, repo, connected, event } = await setup()
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  const old = controller.getSnapshot().scope!
  event('other-account')
  expect(controller.getSnapshot().view).toBeNull()
  expect(controller.getSnapshot().account).toBeNull()
  await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe('ready'))
  await expect(repo.commitLocal(old.key, create(), old.generation)).rejects.toMatchObject({
    detail: { code: 'ACCOUNT_CHANGED' },
  })
  expect(controller.getSnapshot().collections.some((c) => c.kind === 'connected')).toBe(false)
})
it('offline startup keeps only the previously verified connected cache editable locally', async () => {
  const { controller, repo, connected, session, auth } = await setup()
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  await controller.dispose()
  auth.cachedSession = async () => ({
    session,
    identity: { accountId: 'account', email: 'verified@example.test' },
  })
  auth.currentSession = async () => {
    throw new DomainError('OFFLINE')
  }
  const reopened = createAppController({ repository: repo, auth })
  controllers.push(reopened)
  await reopened.initialize()
  expect(reopened.getSnapshot().scope?.key).toEqual(connected.key)
  expect(reopened.getSnapshot().auth).toBe('expired')
  await repo.commitLocal(connected.key, create(), reopened.getSnapshot().scope!.generation)
  expect(await repo.pending(connected.key)).toHaveLength(1)
})
it('local initialization does not wait for a hung authentication request', async () => {
  const { controller, repo, auth } = await setup()
  await controller.dispose()
  auth.currentSession = () => new Promise(() => {})
  const local = createAppController({ repository: repo, auth })
  controllers.push(local)
  await local.initialize()
  expect(local.getSnapshot().phase).toBe('ready')
  expect(local.getSnapshot().view?.info.kind).toBe('guest')
})
it('a validated native/web callback follows the same verified guest-preserving account path', async () => {
  const { controller, auth, guest } = await setup()
  const callback = vi.spyOn(auth, 'completeCallback')
  await controller.completeCallback(
    'https://configured.example/auth/callback?code=validated-by-auth',
  )
  expect(callback).toHaveBeenCalled()
  expect(controller.getSnapshot().account?.email).toBe('verified@example.test')
  expect(controller.getSnapshot().scope?.key).toEqual(guest.key)
})
it('secure credential read failure leaves existing local projects usable without a plaintext fallback', async () => {
  const { controller, repo, auth, scope } = await setup()
  await controller.dispose()
  await repo.commitLocal(scope.key, create(), scope.generation)
  auth.cachedSession = async () => {
    throw new DomainError('LOCAL_STORAGE_FAILED')
  }
  auth.currentSession = async () => {
    throw new DomainError('AUTH_REQUIRED')
  }
  const local = createAppController({ repository: repo, auth })
  controllers.push(local)
  await local.initialize()
  expect(local.getSnapshot().phase).toBe('ready')
  expect(local.getSnapshot().view?.projects).toHaveLength(1)
  expect(local.getSnapshot().account).toBeNull()
})

it('fresh authentication accepts a recovered billing principal only for the already selected account', async () => {
  const { controller, auth, session, guest } = await setup()
  await controller.verifyCode('typed@example.test', '123456')
  vi.spyOn(auth, 'currentSession').mockResolvedValueOnce({
    ...session,
    billingPrincipalId: 'recovered-principal',
  })
  await controller.refreshAuthentication()
  expect(controller.getSession()?.billingPrincipalId).toBe('recovered-principal')
  expect(controller.getSnapshot().scope?.key).toEqual(guest.key)
  vi.spyOn(auth, 'currentSession').mockResolvedValueOnce({ ...session, accountId: 'different' })
  await expect(controller.refreshAuthentication()).rejects.toMatchObject({
    detail: { code: 'ACCOUNT_CHANGED' },
  })
  expect(controller.getSession()?.accountId).toBe(session.accountId)
})

it('explicit recovery re-registers then atomically switches to the account snapshot while leaving local edits and draft in a recovered copy', async () => {
  const { repo, controller, connected, auth, session, recoveryTransport } = await setup(true, true)
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  const scope = controller.getSnapshot().scope!
  await repo.hydrate(scope.key, [await recoveryTransport.snapshot()], scope.generation)
  await repo.commitLocal(scope.key, create('unsent'), scope.generation)
  await repo.markAttempt(scope.key, 'create-unsent', scope.generation)
  await repo.markFailure(
    scope.key,
    'create-unsent',
    new DomainError('SYNC_REBASE_REQUIRED').detail,
    scope.generation,
  )
  await createBrowserDraftStore(repo, scope).write('new-project', undefined, {
    key: 'new-project',
    revision: 'r',
    value: { name: 'Keep this draft' },
  })
  vi.spyOn(auth, 'reregisterDevice').mockResolvedValue({
    ...session,
    device: { ...session.device, generation: 'fresh-device' },
  })
  const preview = await controller.prepareSyncRecovery()
  expect(preview.counts).toEqual({
    projects: 2,
    checkpoints: 0,
    drafts: 1,
    unsent: 1,
    missingAttachments: 0,
  })
  const result = await controller.recoverSync(preview)
  expect(auth.reregisterDevice).toHaveBeenCalledWith('account', expect.any(AbortSignal))
  expect(controller.getSnapshot().scope).toEqual(result.scope)
  expect(controller.getSnapshot().view!.projects.map((p) => p.id)).toEqual(['cloud'])
  expect((await repo.readView(result.recovered)).projects.map((p) => p.id).sort()).toEqual([
    'cloud',
    'unsent',
  ])
  expect((await repo.reviewLocal(result.recovered)).drafts).toHaveLength(1)
  expect(await repo.pending(result.scope.key)).toEqual([])
  expect(recoveryTransport.push).not.toHaveBeenCalled()
  expect(recoveryTransport.releaseSnapshot).toHaveBeenCalledOnce()
})
it('new work after the recovery review prevents registration and source publication', async () => {
  const { repo, controller, connected, auth } = await setup(true, true)
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  const preview = await controller.prepareSyncRecovery()
  await createBrowserDraftStore(repo, preview.scope).write('new-project', undefined, {
    key: 'new-project',
    revision: 'late',
    value: { name: 'New work' },
  })
  await expect(controller.recoverSync(preview)).rejects.toMatchObject({
    detail: { code: 'REVISION_CONFLICT' },
  })
  expect(auth.reregisterDevice).not.toHaveBeenCalled()
  expect(await repo.readActive()).toEqual(preview.scope)
})
it('snapshot failure after registration preserves source and restart cannot silently adopt the new device generation', async () => {
  const { repo, controller, connected, auth, session, recoveryTransport } = await setup(true, true)
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  const scope = controller.getSnapshot().scope!
  await repo.commitLocal(scope.key, create('unsent'), scope.generation)
  const before = await repo.readView(scope.key),
    fresh = { ...session, device: { ...session.device, generation: 'new-registration' } }
  vi.spyOn(auth, 'reregisterDevice').mockResolvedValue(fresh)
  recoveryTransport.snapshot.mockRejectedValueOnce(new DomainError('OFFLINE'))
  await expect(
    controller.recoverSync(await controller.prepareSyncRecovery()),
  ).rejects.toMatchObject({ detail: { code: 'OFFLINE' } })
  expect(await repo.readActive()).toEqual(scope)
  expect(await repo.readView(scope.key)).toEqual(before)
  await controller.dispose()
  auth.cachedSession = async () => ({
    session: fresh,
    identity: { accountId: 'account', email: 'verified@example.test' },
  })
  auth.currentSession = () => new Promise(() => {})
  const reopened = createAppController({ repository: repo, auth, media: repo.media })
  controllers.push(reopened)
  await reopened.initialize()
  expect(await repo.readActive()).toEqual(scope)
  expect(reopened.getSnapshot().scope).toEqual(scope)
  expect(reopened.getSnapshot().error?.code).toBe('SYNC_REBASE_REQUIRED')
  expect((await repo.readView(scope.key)).pending).toEqual(before.pending)
})

it('a new draft arriving while the fresh snapshot downloads aborts publication and releases its remote lease', async () => {
  const { repo, controller, connected, recoveryTransport } = await setup(true, true)
  await controller.verifyCode('maker@example.test', '123456')
  await controller.chooseCollection(connected.key)
  const preview = await controller.prepareSyncRecovery(),
    original = recoveryTransport.snapshot.getMockImplementation()!
  recoveryTransport.snapshot.mockImplementationOnce(async () => {
    await createBrowserDraftStore(repo, preview.scope).write('new-project', undefined, {
      key: 'new-project',
      revision: 'new-after-registration',
      value: { name: 'Saved during recovery' },
    })
    return original()
  })
  await expect(controller.recoverSync(preview)).rejects.toMatchObject({
    detail: { code: 'REVISION_CONFLICT' },
  })
  expect(await repo.readActive()).toEqual(preview.scope)
  expect((await repo.listCollections()).filter((c) => c.kind === 'recovered')).toEqual([])
  expect((await repo.reviewLocal(preview.scope.key)).drafts).toHaveLength(1)
  expect(recoveryTransport.releaseSnapshot).toHaveBeenCalledOnce()
})
