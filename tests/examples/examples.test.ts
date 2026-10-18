import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import {
  openBrowserRepository,
  type BrowserRepository,
} from '../../src/repositories/browser/repository'
import { createBrowserWorkflowStore } from '../../src/repositories/browser/workflow-store'
import {
  info,
  project,
  create,
  now,
  png,
} from '../../src/repositories/browser/fixtures.test-support'
import { storeInline } from '../../src/services/media-codec'
import { DomainError } from '../../src/domain/errors'
import type { AccountSession, Command, Receipt, SessionScope } from '../../src/domain/contracts'
import { createBillingCoordinator } from '../../src/billing/coordinator'
import { localSave } from './local-save'
import { retryOne } from './offline-retry'
import { useCloud } from './conflict'
import { completeLocalExport } from './complete-export'
import { reconcilePurchase } from './webhook-reconciliation'

const repositories: BrowserRepository[] = []
afterEach(async () => {
  for (const repo of repositories.splice(0)) await repo.close()
})
async function fixture(connected = false) {
  const factory = new IDBFactory(),
    databaseName = crypto.randomUUID()
  const repo = await openBrowserRepository({ factory, databaseName })
  repositories.push(repo)
  const collection = info(connected)
  await repo.createCollection(collection)
  const scope: SessionScope = {
    key: collection.key,
    generation: 1,
    device: { id: 'device', generation: 'generation' },
  }
  await repo.activate(scope)
  return { repo, scope, factory, databaseName }
}
const checkpoint = {
  id: 'checkpoint',
  projectId: 'project',
  createdAt: now,
  position: 'Row 12',
  toolSize: '4 mm',
  nextStep: 'Turn and begin repeat 3',
  notes: '',
}
const { revision: _revision, ...fields } = project()
const receiptFor = (command: Command): Receipt => ({
  operationId: command.operationId,
  sha256: command.sha256,
  epoch: command.epoch,
  revision: '1',
  cursor: '1',
  resultId: 'project',
  changes: [{ kind: 'project.put', value: project('project', '1') }],
})

it('local save remains exactly once after repository close/reopen and exports every photo byte', async () => {
  const f = await fixture()
  const photo = await storeInline(png, 'photo', f.repo.media, f.scope)
  const input = { ...checkpoint, photo }
  await localSave(f.repo, f.scope, fields, input, { project: 'create', checkpoint: 'pause' })
  await f.repo.close()
  const reopened = await openBrowserRepository({ factory: f.factory, databaseName: f.databaseName })
  repositories.push(reopened)
  const view = await localSave(reopened, f.scope, fields, input, {
    project: 'create',
    checkpoint: 'pause',
  })
  expect(view.projects).toHaveLength(1)
  expect(view.checkpoints).toHaveLength(1)
  expect(view.checkpoints[0].nextStep).toBe(checkpoint.nextStep)
  const backup = await completeLocalExport(reopened, reopened.media, f.scope)
  expect(backup.projects[0].checkpoints[0].photo).toBe(png)
})

it('lost remote response retries the same command and hash then applies one receipt', async () => {
  const { repo, scope } = await fixture(true)
  await repo.commitLocal(scope.key, create('project', 'stable-operation'), scope.generation)
  const commands: Command[] = []
  const push = vi.fn(async (command: Command) => {
    commands.push(structuredClone(command))
    if (commands.length === 1) throw new DomainError('SERVICE_UNAVAILABLE')
    return receiptFor(command)
  })
  await expect(retryOne(repo, scope, 'stable-operation', push)).rejects.toMatchObject({
    detail: { code: 'SERVICE_UNAVAILABLE' },
  })
  expect((await repo.readView(scope.key)).projects).toHaveLength(1)
  await retryOne(repo, scope, 'stable-operation', push)
  await retryOne(repo, scope, 'stable-operation', push)
  expect(commands).toHaveLength(2)
  expect(commands[1]).toEqual(commands[0])
  expect(await repo.pending(scope.key)).toEqual([])
})

it('cloud choice preserves conflicting device work and rejects a stale reviewed revision', async () => {
  const { repo, scope } = await fixture(true)
  await repo.commitLocal(scope.key, create(), scope.generation)
  const [initial] = await repo.pending(scope.key)
  await repo.acknowledge(scope.key, receiptFor(initial.command), scope.generation)
  await repo.commitLocal(
    scope.key,
    {
      operationId: 'rename',
      createdAt: now,
      base: { revision: '1' },
      kind: 'project.update',
      payload: {
        projectId: 'project',
        fields: {
          name: 'My device notes',
          craft: 'Crochet',
          color: 'sage',
          yarn: 'Cotton',
          toolSize: '4 mm',
          notes: 'Keep this',
        },
        updatedAt: now,
      },
    },
    scope.generation,
  )
  await repo.markFailure(
    scope.key,
    'rename',
    new DomainError('REVISION_CONFLICT').detail,
    scope.generation,
  )
  const review = await repo.readView(scope.key)
  await expect(useCloud(repo, scope, 'rename', '0')).rejects.toMatchObject({
    detail: { code: 'REVISION_CONFLICT' },
  })
  const result = await useCloud(repo, scope, 'rename', review.revision)
  expect((await repo.readView(result.recovered!)).projects[0].notes).toBe('Keep this')
  expect((await repo.readView(scope.key)).projects[0].name).toBe('Moss scarf')
  expect(await repo.pending(scope.key)).toEqual([])
})

it('webhook hint reads the verified server projection and a later refund revokes access', async () => {
  const { repo, scope } = await fixture()
  const session: AccountSession = {
    accountId: '11111111-1111-4111-8111-111111111111',
    billingPrincipalId: '22222222-2222-4222-8222-222222222222',
    collection: scope.key,
    device: scope.device,
    deletionGeneration: '0',
    expiresAt: '2030-01-01T00:00:00.000Z',
  }
  let upgraded = false,
    revision = '1'
  const billing = createBillingCoordinator({
    platform: 'web',
    workflows: createBrowserWorkflowStore(repo),
    current: () => ({ session, scope }),
    adapter: {
      products: async () => [],
      purchase: async () => ({
        status: 'unavailable',
        error: new DomainError('CAPABILITY_UNAVAILABLE').detail,
      }),
      restore: async () => ({ status: 'none' }),
    },
    client: {
      post: async () => ({
        entitlement: {
          accountId: session.accountId,
          billingPrincipalId: session.billingPrincipalId,
          upgraded,
          revision,
          verifiedAt: now,
        },
        attempt: null,
        recoveryKeyConfigured: false,
        currentRecoveryKeyHash: null,
      }),
    },
  })
  expect((await reconcilePurchase(billing)).projection?.upgraded).toBe(false)
  upgraded = true
  revision = '2'
  expect((await reconcilePurchase(billing)).projection?.upgraded).toBe(true)
  upgraded = false
  revision = '3'
  expect((await reconcilePurchase(billing)).projection?.upgraded).toBe(false)
  billing.dispose()
})
