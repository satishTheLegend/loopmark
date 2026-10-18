import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { createBrowserWorkflowStore } from '../repositories/browser/workflow-store'
import { info } from '../repositories/browser/fixtures.test-support'
import type { AccountAuth } from '../auth/auth-service'
import type { AccountSession, SessionScope } from '../domain/contracts'
import { DomainError } from '../domain/errors'
import { sha256Bytes } from '../domain/canonical-json'
import { createPurchaseRecoveryService } from './recovery-service'
const repos: BrowserRepository[] = []
afterEach(async () => {
  for (const repo of repos.splice(0)) await repo.close()
})
async function setup() {
  const repo = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: crypto.randomUUID(),
  })
  repos.push(repo)
  const collection = info(true),
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
  const auth = {
    verifiedIdentity: vi.fn(async () =>
      session ? { accountId: session.accountId, email: 'synthetic@example.invalid' } : null,
    ),
    requestCode: vi.fn(async () => ({ retryAt: '2030-01-01T00:00:00.000Z' })),
    reauthenticate: vi.fn(async () => ({
      challengeId: 'challenge',
      proof: 'a'.repeat(64),
      expiresAt: '2030-01-01T00:00:00.000Z',
    })),
  }
  const workflows = createBrowserWorkflowStore(repo)
  let result: unknown = null,
    lost = false
  const client = {
    post: vi.fn(async (_name: string, body: unknown) => {
      const request = body as { action: string; nextRecoveryKeyHash: string }
      if (request.action === 'status') {
        if (!result) throw new DomainError('NOT_AVAILABLE')
        return result
      }
      const [saved] = await workflows.list<{ nextKey: string }>('purchase')
      expect(request.nextRecoveryKeyHash).toBe(
        await sha256Bytes(new TextEncoder().encode(saved.value.nextKey)),
      )
      expect(body).not.toHaveProperty('nextKey')
      result =
        request.action === 'set-key'
          ? { status: 'key-saved', recoveryKeyHash: request.nextRecoveryKeyHash }
          : { status: 'pending', caseId: '55555555-5555-4555-8555-555555555555' }
      if (lost) {
        lost = false
        throw new DomainError('SERVICE_UNAVAILABLE')
      }
      return result
    }),
  }
  const service = createPurchaseRecoveryService({
    repository: repo,
    workflows,
    auth: auth as unknown as AccountAuth,
    client,
    current: () => session,
  })
  return {
    repo,
    scope,
    session: session!,
    auth,
    client,
    workflows,
    service,
    lose: () => {
      lost = true
    },
    setSession: (value: AccountSession | null) => {
      session = value
    },
    setResult: (value: unknown) => {
      result = value
    },
  }
}
it('saves a random key before sending only its hash and recovers a lost response without rotating it again', async () => {
  const f = await setup(),
    signal = new AbortController().signal
  f.lose()
  const saved = await f.service.setKey({ operationToken: 'initial' }, f.scope, signal)
  expect(saved.result?.status).toBe('key-saved')
  const exported = JSON.parse(await (await f.service.exportKey(saved.id)).text())
  expect(exported.recoveryKey).toMatch(/^[a-f0-9]{64}$/)
  expect(exported).not.toHaveProperty('accountId')
  const again = await f.service.setKey({ operationToken: 'initial' }, f.scope, signal)
  expect(again).toEqual(saved)
  expect(
    f.client.post.mock.calls.filter(
      ([, body]) => (body as { action: string }).action === 'set-key',
    ),
  ).toHaveLength(1)
  expect(f.auth.reauthenticate).not.toHaveBeenCalled()
})
it('a claim stays pending without granting access and uses a persisted next key and fresh proof once', async () => {
  const f = await setup(),
    signal = new AbortController().signal
  const saved = await f.service.claim(
    {
      operationToken: 'claim',
      provider: 'razorpay',
      evidenceId: 'pay_owned',
      recoveryKey: 'b'.repeat(64),
      code: '123456',
    },
    f.scope,
    signal,
  )
  expect(saved.result).toEqual({
    status: 'pending',
    caseId: '55555555-5555-4555-8555-555555555555',
  })
  expect(f.auth.reauthenticate).toHaveBeenCalledOnce()
  await f.service.claim(
    {
      operationToken: 'claim',
      provider: 'razorpay',
      evidenceId: 'pay_owned',
      recoveryKey: 'b'.repeat(64),
      code: 'different',
    },
    f.scope,
    signal,
  )
  expect(f.auth.reauthenticate).toHaveBeenCalledOnce()
  await expect(f.service.exportKey(saved.id)).rejects.toMatchObject({
    detail: { code: 'NOT_AVAILABLE' },
  })
  const [row] = await f.workflows.list<{ nextKey: string }>('purchase')
  f.setResult({
    status: 'recovered',
    recoveryKeyHash: await sha256Bytes(new TextEncoder().encode(row.value.nextKey)),
    entitlement: {
      accountId: f.session.accountId,
      billingPrincipalId: '33333333-3333-4333-8333-333333333333',
      upgraded: true,
      revision: '2',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    },
  })
  expect((await f.service.refresh(saved.id, f.scope, signal)).result?.status).toBe('recovered')
  expect(JSON.parse(await (await f.service.exportKey(saved.id)).text()).recoveryKey).toBe(
    row.value.nextKey,
  )
})
it('a recovery key is unavailable to another account and a changed scope fences proof completion', async () => {
  const f = await setup(),
    signal = new AbortController().signal
  const saved = await f.service.setKey({ operationToken: 'key' }, f.scope, signal)
  f.setSession({ ...f.session, accountId: '44444444-4444-4444-8444-444444444444' })
  expect(await f.service.listKeys()).toEqual([])
  await expect(f.service.exportKey(saved.id)).rejects.toMatchObject({
    detail: { code: 'NOT_AVAILABLE' },
  })
  f.setSession(f.session)
  f.setResult(null)
  f.auth.reauthenticate.mockImplementationOnce(async () => {
    await f.repo.activate({ ...f.scope, generation: 2 })
    return {
      challengeId: 'challenge',
      proof: 'a'.repeat(64),
      expiresAt: '2030-01-01T00:00:00.000Z',
    }
  })
  await expect(
    f.service.claim(
      {
        operationToken: 'switch',
        provider: 'revenuecat',
        evidenceId: 'transaction',
        code: '123456',
      },
      f.scope,
      signal,
    ),
  ).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  expect(
    f.client.post.mock.calls.filter(([, body]) => (body as { action: string }).action === 'claim'),
  ).toHaveLength(0)
})

it('a current-key refresh marks rotated historical keys superseded and fences their export without deleting them', async () => {
  const f = await setup(),
    signal = new AbortController().signal
  const saved = await f.service.setKey({ operationToken: 'key' }, f.scope, signal)
  expect((await f.service.listKeys())[0].keyState).toBe('last-confirmed')
  const row = (await f.workflows.list<{ nextKey: string }>('purchase'))[0]
  const hash = await sha256Bytes(new TextEncoder().encode(row.value.nextKey))
  const status = (currentRecoveryKeyHash: string | null) => ({
    entitlement: {
      accountId: f.session.accountId,
      billingPrincipalId: f.session.billingPrincipalId,
      upgraded: true,
      revision: '1',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    },
    attempt: null,
    recoveryKeyConfigured: currentRecoveryKeyHash !== null,
    currentRecoveryKeyHash,
  })
  f.client.post.mockResolvedValueOnce(status(hash))
  await f.service.refreshKeyStatus(f.scope, signal)
  expect((await f.service.listKeys())[0].keyState).toBe('current')
  await expect(f.service.exportKey(saved.id)).resolves.toBeInstanceOf(Blob)
  f.client.post.mockResolvedValueOnce(status('f'.repeat(64)))
  await f.service.refreshKeyStatus(f.scope, signal)
  expect((await f.service.listKeys())[0]).toMatchObject({
    id: saved.id,
    keyState: 'superseded',
    keyCheckedAt: expect.any(String),
  })
  await expect(f.service.exportKey(saved.id)).rejects.toMatchObject({
    detail: { code: 'NOT_AVAILABLE' },
  })
  expect(await f.workflows.read(saved.id)).not.toBeNull()
})
