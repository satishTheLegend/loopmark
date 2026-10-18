import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { info, create, now, project, receipt } from '../repositories/browser/fixtures.test-support'
import type { SessionScope, SnapshotManifest } from '../domain/contracts'
import { DomainError } from '../domain/errors'
import { createSyncCoordinator } from './coordinator'
const opened: BrowserRepository[] = []
afterEach(async () => {
  for (const r of opened.splice(0)) await r.close()
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
      device: { id: 'device', generation: 'gen' },
    }
  await repo.createCollection(collection)
  await repo.activate(scope)
  const snapshot: SnapshotManifest = {
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
  }
  const transport = {
    snapshot: vi.fn(async () => snapshot),
    push: vi.fn(async (command: import('../domain/contracts').Command) =>
      receipt(command.operationId, command.sha256),
    ),
    pull: vi.fn(async (input: import('../domain/contracts').PullRequest) => ({
      protocolVersion: 2 as const,
      collectionId: input.collectionId,
      epoch: input.epoch,
      afterCursor: input.afterCursor,
      nextCursor: input.afterCursor,
      hasMore: false,
      entries: [],
    })),
  }
  let nowMs = Date.parse(now)
  const sleep = vi.fn(async (ms: number) => {
    nowMs += ms
  })
  const coordinator = createSyncCoordinator({
    repository: repo,
    transport,
    lease: {
      run: async (_scope, _signal, work) => {
        await work()
        return true
      },
    },
    clock: { now: () => nowMs, random: () => 0.5, sleep },
  })
  return { repo, scope, snapshot, transport, coordinator, sleep }
}
it('hydrates before selection use and reconciles the feed with no pending work', async () => {
  const { repo, scope, coordinator, transport } = await setup()
  await coordinator.run(scope)
  expect((await repo.readView(scope.key)).hydration).toBe('ready')
  expect(transport.pull).toHaveBeenCalledTimes(1)
  expect(coordinator.getSnapshot().state).toBe('idle')
})
it('retries a lost acknowledgement with exactly the same signed command and one local effect', async () => {
  const { repo, scope, snapshot, coordinator, transport, sleep } = await setup()
  await repo.hydrate(scope.key, [snapshot], 1)
  await repo.commitLocal(scope.key, create(), 1)
  transport.push.mockRejectedValueOnce(new DomainError('OFFLINE'))
  await coordinator.run(scope)
  expect(transport.push).toHaveBeenCalledTimes(2)
  expect(transport.push.mock.calls[0][0]).toEqual(transport.push.mock.calls[1][0])
  expect(sleep).toHaveBeenCalledWith(1000, expect.any(AbortSignal))
  expect((await repo.readView(scope.key)).projects).toHaveLength(1)
  expect(await repo.pending(scope.key)).toEqual([])
})
it('does not retry conflicts or their dependent operations and still pulls authoritative changes', async () => {
  const { repo, scope, snapshot, coordinator, transport } = await setup()
  await repo.hydrate(
    scope.key,
    [{ ...snapshot, projects: [project('project', '1')], revision: '1' }],
    1,
  )
  await repo.commitLocal(
    scope.key,
    {
      kind: 'project.update',
      operationId: 'update',
      createdAt: now,
      base: { revision: '1' },
      payload: {
        projectId: 'project',
        fields: {
          name: 'Local',
          craft: 'Crochet',
          color: 'sage',
          yarn: '',
          toolSize: '4 mm',
          notes: '',
        },
        updatedAt: now,
      },
    },
    1,
  )
  await repo.commitLocal(
    scope.key,
    {
      kind: 'project.status',
      operationId: 'status',
      createdAt: now,
      base: { afterOperationId: 'update' },
      payload: { projectId: 'project', status: 'finished', updatedAt: now },
    },
    1,
  )
  transport.push.mockRejectedValue(new DomainError('REVISION_CONFLICT'))
  await coordinator.run(scope)
  await coordinator.run(scope)
  expect(transport.push).toHaveBeenCalledTimes(1)
  expect(transport.pull).toHaveBeenCalledTimes(2)
  expect(coordinator.getSnapshot().state).toBe('conflict')
  await expect(coordinator.run(scope, ['update'])).rejects.toMatchObject({
    detail: { code: 'VALIDATION' },
  })
})
it('never applies a response after a different scope generation wins', async () => {
  const { repo, scope, snapshot, coordinator, transport } = await setup()
  await repo.hydrate(scope.key, [snapshot], 1)
  await repo.commitLocal(scope.key, create(), 1)
  let finish!: () => void
  transport.push.mockImplementation(
    (command) =>
      new Promise((resolve) => {
        finish = () => resolve(receipt(command.operationId, command.sha256))
      }),
  )
  const running = coordinator.run(scope),
    rejected = expect(running).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await repo.transition(scope, { key: scope.key, device: scope.device })
  finish()
  await rejected
  expect(await repo.pending(scope.key)).toHaveLength(1)
})
it('honors Retry-After without exceeding a bounded foreground cycle', async () => {
  const { repo, scope, snapshot, coordinator, transport, sleep } = await setup()
  await repo.hydrate(scope.key, [snapshot], 1)
  await repo.commitLocal(scope.key, create(), 1)
  transport.push.mockRejectedValue(new DomainError('RATE_LIMITED', { retryAfterMs: 120000 }))
  await expect(coordinator.run(scope)).rejects.toMatchObject({ detail: { code: 'RATE_LIMITED' } })
  expect(transport.push).toHaveBeenCalledTimes(1)
  expect(sleep).not.toHaveBeenCalled()
  expect((await repo.pending(scope.key))[0].error?.code).toBe('RATE_LIMITED')
})
