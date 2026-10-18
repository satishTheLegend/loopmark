import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { createBrowserWorkflowStore } from '../repositories/browser/workflow-store'
import { info, now } from '../repositories/browser/fixtures.test-support'
import type { AccountSession, EntitlementProjection, SessionScope } from '../domain/contracts'
import { createEntitlementCache } from './entitlement-cache'
import { createBillingCoordinator } from './coordinator'
import { DomainError } from '../domain/errors'
const repos: BrowserRepository[] = []
afterEach(async () => {
  for (const repo of repos.splice(0)) await repo.close()
})
async function setup(platform: 'web' | 'ios' = 'web') {
  const repo = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: crypto.randomUUID(),
  })
  repos.push(repo)
  const collection = { ...info(true), accountId: '11111111-1111-4111-8111-111111111111' },
    scope: SessionScope = {
      key: collection.key,
      generation: 1,
      device: { id: 'device', generation: 'gen' },
    }
  await repo.createCollection(collection)
  await repo.activate(scope)
  let session: AccountSession | null = {
    accountId: '11111111-1111-4111-8111-111111111111',
    billingPrincipalId: '22222222-2222-4222-8222-222222222222',
    collection: scope.key,
    device: scope.device,
    deletionGeneration: '0',
    expiresAt: '2030-01-01T00:00:00.000Z',
  }
  const workflows = createBrowserWorkflowStore(repo),
    access = createEntitlementCache({ workflows, current: () => session })
  let projection: EntitlementProjection = {
    accountId: '11111111-1111-4111-8111-111111111111',
    billingPrincipalId: '22222222-2222-4222-8222-222222222222',
    upgraded: false,
    revision: '1',
    verifiedAt: now,
  }
  const client = {
    post: vi.fn(async (_name: string, body: unknown) => {
      const input = body as { action: string; attemptId?: string }
      if (input.action === 'prepare') return { status: 'pending', attemptId: input.attemptId }
      if (input.action === 'reconcile')
        return { status: 'pending', attemptId: '11111111-1111-4111-8111-111111111111' }
      return {
        entitlement: projection,
        attempt: input.attemptId
          ? {
              id: input.attemptId,
              provider: platform === 'web' ? 'razorpay' : 'revenuecat',
              state: projection.upgraded ? 'verified' : 'pending',
            }
          : null,
        recoveryKeyConfigured: false,
      }
    }),
  }
  const adapter = {
    products: vi.fn(async () => []),
    purchase: vi.fn(async (intent: import('../domain/contracts').PurchaseIntent) => {
      const saved = (
        await workflows.list<{ intent: { attemptId: string }; phase: string }>('purchase')
      ).find((row) => row.value.intent?.attemptId === intent.attemptId)
      expect(saved?.value.phase).toBe('launched')
      return { status: 'submitted' as const, attemptId: intent.attemptId }
    }),
    restore: vi.fn(async () => ({ status: 'none' as const })),
  }
  const options = {
    adapter,
    client,
    workflows,
    current: () => (session ? { session, scope } : null),
    platform,
    access,
  }
  return {
    repo,
    scope,
    collection,
    workflows,
    access,
    client,
    adapter,
    options,
    coordinator: createBillingCoordinator(options),
    setSession: (value: AccountSession | null) => {
      session = value
    },
    session: session!,
    setProjection: (value: Partial<EntitlementProjection>) => {
      projection = { ...projection, ...value }
    },
  }
}
it('provider submission never grants access; the immutable draft intent survives restart and duplicate clicks', async () => {
  const f = await setup(),
    action = { returnAction: 'new-project' as const, draftKey: 'project-new' }
  const id = await f.coordinator.purchase('upgrade', action, 'click-token')
  expect(f.access.hasAccess(f.collection)).toBe(false)
  const restarted = createBillingCoordinator(f.options)
  await restarted.initialize()
  expect(restarted.getSnapshot().attempts[0].intent).toMatchObject({
    attemptId: id,
    draftKey: 'project-new',
    collection: f.scope.key,
  })
  expect(await restarted.purchase('upgrade', action, 'click-token')).toBe(id)
  expect(f.adapter.purchase).toHaveBeenCalledOnce()
  await expect(restarted.continuePurchase(id)).rejects.toMatchObject({
    detail: { code: 'ACCOUNT_CHANGED' },
  })
  f.setProjection({ upgraded: true, revision: '2' })
  await restarted.resume(id)
  expect(f.access.hasAccess(f.collection)).toBe(true)
  expect((await restarted.continuePurchase(id)).draftKey).toBe('project-new')
  expect(restarted.getSnapshot().attempts[0].phase).toBe('verified')
  await restarted.completeContinuation(id)
  expect(restarted.getSnapshot().attempts[0].phase).toBe('continued')
})
it('an unavailable server preserves verified one-time access; a monotonic refund revokes only new over-cap actions', async () => {
  const f = await setup()
  f.setProjection({ upgraded: true, revision: '2' })
  await f.coordinator.refresh()
  const restored = createEntitlementCache({ workflows: f.workflows, current: () => f.session })
  await restored.load()
  expect(restored.hasAccess(f.collection)).toBe(true)
  expect(restored.getSnapshot().source).toBe('cache')
  f.client.post.mockRejectedValueOnce(new DomainError('OFFLINE'))
  await expect(f.coordinator.refresh()).rejects.toMatchObject({ detail: { code: 'OFFLINE' } })
  expect(f.access.hasAccess(f.collection)).toBe(true)
  f.setProjection({ upgraded: false, revision: '3' })
  await f.coordinator.refresh()
  expect(f.access.hasAccess(f.collection)).toBe(false)
  f.setProjection({ upgraded: true, revision: '2' })
  await f.coordinator.refresh()
  expect(f.access.hasAccess(f.collection)).toBe(false)
  expect((await f.repo.readView(f.scope.key)).info).toEqual(f.collection)
})
it('other account, principal and deletion generations cannot consume a cached grant or late purchase response', async () => {
  const f = await setup()
  f.setProjection({ upgraded: true })
  await f.coordinator.refresh()
  for (const patch of [
    { accountId: 'other' },
    { billingPrincipalId: 'other' },
    { deletionGeneration: '1' },
  ]) {
    f.setSession({ ...f.session, ...patch })
    expect(f.access.hasAccess(f.collection)).toBe(false)
  }
  f.setSession(f.session)
  f.adapter.purchase.mockImplementationOnce(async (intent) => {
    f.setSession({ ...f.session, accountId: 'other' })
    return { status: 'submitted', attemptId: intent.attemptId }
  })
  await expect(
    f.coordinator.purchase('upgrade', { returnAction: 'settings' }, 'switch'),
  ).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
})
it('native purchase is server-prepared before SDK launch and lost callbacks never automatically repeat the purchase', async () => {
  const f = await setup('ios')
  f.adapter.purchase.mockImplementationOnce(async () => {
    expect(f.client.post.mock.calls[0][1]).toMatchObject({ action: 'prepare' })
    throw new DomainError('SERVICE_UNAVAILABLE')
  })
  await expect(
    f.coordinator.purchase('upgrade', { returnAction: 'settings' }, 'native'),
  ).rejects.toMatchObject({ detail: { code: 'SERVICE_UNAVAILABLE' } })
  await createBillingCoordinator(f.options).purchase(
    'upgrade',
    { returnAction: 'settings' },
    'native',
  )
  expect(f.adapter.purchase).toHaveBeenCalledOnce()
})
it('a forged callback cannot create an attempt or bypass authoritative response validation', async () => {
  const f = await setup()
  await expect(
    f.coordinator.verifyReturn({
      action: 'verify',
      attemptId: '11111111-1111-4111-8111-111111111111',
      paymentId: 'pay_fake',
      paymentLinkId: 'plink_fake',
      paymentLinkStatus: 'paid',
      signature: 'a'.repeat(64),
    }),
  ).rejects.toMatchObject({ detail: { code: 'NOT_AVAILABLE' } })
  expect(f.client.post).not.toHaveBeenCalled()
  expect(f.access.hasAccess(f.collection)).toBe(false)
})

it('failed durable intent storage never opens a provider and a reused token cannot buy a different product', async () => {
  const f = await setup()
  vi.spyOn(f.workflows, 'write').mockRejectedValueOnce(new DomainError('LOCAL_STORAGE_FAILED'))
  await expect(
    f.coordinator.purchase('upgrade', { returnAction: 'settings' }, 'intent'),
  ).rejects.toMatchObject({ detail: { code: 'LOCAL_STORAGE_FAILED' } })
  expect(f.adapter.purchase).not.toHaveBeenCalled()
  await f.coordinator.purchase('upgrade', { returnAction: 'settings' }, 'intent')
  await expect(
    f.coordinator.purchase('other', { returnAction: 'settings' }, 'intent'),
  ).rejects.toMatchObject({ detail: { code: 'OPERATION_REUSED' } })
  expect(f.adapter.purchase).toHaveBeenCalledOnce()
})
it('a queued action captured for account A cannot launch after account B replaces the session', async () => {
  const f = await setup()
  let finish!: (value: { status: 'submitted'; attemptId: string }) => void,
    attemptId = ''
  f.adapter.purchase.mockImplementationOnce((intent) => {
    attemptId = intent.attemptId
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const first = f.coordinator.purchase('upgrade', { returnAction: 'settings' }, 'first')
  const firstFailure = expect(first).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  const queued = f.coordinator.purchase('upgrade', { returnAction: 'settings' }, 'second')
  const queuedFailure = expect(queued).rejects.toMatchObject({
    detail: { code: 'ACCOUNT_CHANGED' },
  })
  f.setSession({ ...f.session, accountId: '33333333-3333-4333-8333-333333333333' })
  finish({ status: 'submitted', attemptId })
  await firstFailure
  await queuedFailure
  expect(f.adapter.purchase).toHaveBeenCalledOnce()
  expect(f.coordinator.getSnapshot().attempts).toEqual([])
  expect(f.access.getSnapshot().projection).toBeNull()
})
