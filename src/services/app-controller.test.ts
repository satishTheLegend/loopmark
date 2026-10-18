import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { createBrowserDraftStore } from '../repositories/browser/draft-store'
import { info, create, now, project, png } from '../repositories/browser/fixtures.test-support'
import { describeInline } from './media-codec'
import type { AccountSession, SessionScope } from '../domain/contracts'
import type { AccountAuth } from '../auth/auth-service'
import { createAppController } from './app-controller'
import { DomainError } from '../domain/errors'
const repos: BrowserRepository[] = [],
  controllers: ReturnType<typeof createAppController>[] = []
afterEach(async () => {
  for (const c of controllers.splice(0)) await c.dispose()
  for (const r of repos.splice(0)) await r.close()
})
async function setup(withMedia = false) {
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
  const controller = createAppController({
    repository: repo,
    auth,
    ...(withMedia ? { media: repo.media } : {}),
  })
  controllers.push(controller)
  await controller.initialize()
  return {
    repo,
    controller,
    auth,
    guest,
    connected,
    session,
    scope,
    event: (accountId: string | null) => event?.(accountId),
  }
}
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
