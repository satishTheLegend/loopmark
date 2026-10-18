import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { createBrowserWorkflowStore } from '../repositories/browser/workflow-store'
import { info } from '../repositories/browser/fixtures.test-support'
import type { AccountAuth } from '../auth/auth-service'
import type { AccountSession, SessionScope } from '../domain/contracts'
import type { FunctionClient } from '../sync/http-client'
import { createDeletionService } from './deletion-service'
import { DomainError } from '../domain/errors'
const opened: BrowserRepository[] = []
afterEach(async () => {
  for (const repo of opened.splice(0)) await repo.close()
})
async function setup() {
  const repo = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: crypto.randomUUID(),
  })
  opened.push(repo)
  const collection = info(true),
    scope: SessionScope = {
      key: collection.key,
      generation: 1,
      device: { id: 'device', generation: 'g' },
    }
  await repo.createCollection(collection)
  await repo.activate(scope)
  const workflows = createBrowserWorkflowStore(repo),
    session: AccountSession = {
      accountId: 'account',
      billingPrincipalId: 'principal',
      collection: scope.key,
      device: scope.device,
      deletionGeneration: '0',
      expiresAt: '2030-01-01T00:00:00.000Z',
    }
  const auth = {
    verifiedIdentity: async () => ({ accountId: 'account', email: 'verified@example.invalid' }),
    requestCode: vi.fn(async () => ({ retryAt: '2030-01-01T00:00:00.000Z' })),
    reauthenticate: vi.fn(async () => ({
      challengeId: 'challenge',
      proof: 'a'.repeat(64),
      expiresAt: '2030-01-01T00:00:00.000Z',
    })),
  } as unknown as AccountAuth
  const client: FunctionClient = {
    post: vi.fn(async () => ({ status: 'pending', requestedAt: '2026-10-18T00:00:00.000Z' })),
  }
  const options = { repository: repo, auth, client, workflows, current: () => session }
  return { repo, scope, options, auth, client, workflows, service: createDeletionService(options) }
}
it('persists the receipt capability before deletion, and resumes a lost reply anonymously without replaying proof', async () => {
  const { scope, options, auth, client, workflows, service } = await setup()
  const calls: unknown[] = []
  let statusCalls = 0
  vi.mocked(client.post).mockImplementation(async (name, body, _signal, settings) => {
    calls.push(body)
    if (name === 'account-delete') {
      const rows = await workflows.list<{ receiptToken: string }>('deletion')
      expect(rows).toHaveLength(1)
      expect(rows[0].value.receiptToken).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.stringify(body)).not.toContain(rows[0].value.receiptToken)
      throw new DomainError('OFFLINE')
    }
    expect(name).toBe('deletion-status')
    expect(settings?.anonymous).toBe(true)
    if (++statusCalls === 1) throw new DomainError('OFFLINE')
    return { status: 'pending', requestedAt: '2026-10-18T00:00:00.000Z' }
  })
  await expect(
    service.delete({ operationToken: 'one', code: '123456' }, scope, new AbortController().signal),
  ).rejects.toMatchObject({ detail: { code: 'OFFLINE' } })
  const result = await createDeletionService(options).delete(
    { operationToken: 'one', code: '123456' },
    scope,
    new AbortController().signal,
  )
  expect(result.receipt?.status).toBe('pending')
  expect(result).not.toHaveProperty('receiptToken')
  expect(auth.reauthenticate).toHaveBeenCalledTimes(1)
  const signedOut = createDeletionService({ ...options, current: () => null })
  expect(await signedOut.refreshReceipt(result.id, new AbortController().signal)).toEqual(
    result.receipt,
  )
  expect(JSON.stringify(await signedOut.listReceipts())).not.toContain('receiptToken')
  expect(result.localOutcome).toBe('not-completed')
  await signedOut.recordLocalOutcome(result.id, 'kept')
  expect((await signedOut.listReceipts())[0].localOutcome).toBe('kept')
  const exported = JSON.parse(await (await signedOut.exportReceipt(result.id)).text())
  expect(exported.receiptToken).toMatch(/^[a-f0-9]{64}$/)
  expect(exported).not.toHaveProperty('accountId')
  expect(calls).toHaveLength(4)
})
it('requests reauthentication only for the verified email and fences a late code response', async () => {
  const { repo, scope, auth, client, service } = await setup()
  await service.requestCode(scope, new AbortController().signal)
  expect(auth.requestCode).toHaveBeenCalledWith('verified@example.invalid', expect.any(AbortSignal))
  vi.mocked(auth.reauthenticate).mockImplementationOnce(async () => {
    await repo.activate({ ...scope, generation: 2 })
    return {
      challengeId: 'challenge',
      proof: 'a'.repeat(64),
      expiresAt: '2030-01-01T00:00:00.000Z',
    }
  })
  await expect(
    service.delete({ operationToken: 'one', code: '123456' }, scope, new AbortController().signal),
  ).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  expect(client.post).not.toHaveBeenCalled()
})
it('does not contact deletion service when the durable receipt cannot be stored', async () => {
  const { scope, options, auth, client } = await setup()
  const service = createDeletionService({
    ...options,
    workflows: {
      ...options.workflows,
      write: async () => {
        throw new DomainError('LOCAL_STORAGE_FULL')
      },
    },
  })
  await expect(
    service.delete({ operationToken: 'one', code: '123456' }, scope, new AbortController().signal),
  ).rejects.toMatchObject({ detail: { code: 'LOCAL_STORAGE_FULL' } })
  expect(auth.reauthenticate).not.toHaveBeenCalled()
  expect(client.post).not.toHaveBeenCalled()
})
