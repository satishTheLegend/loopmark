import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from './repository'
import { createBrowserDraftStore } from './draft-store'
import { info, project, now, create } from './fixtures.test-support'
import type { Receipt, SnapshotManifest } from '../../domain/contracts'
const opened: BrowserRepository[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of opened.splice(0)) await repo.close()
})
async function setup() {
  const repo = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: crypto.randomUUID(),
  })
  opened.push(repo)
  const collection = info(true),
    scope = { key: collection.key, generation: 1, device: { id: 'device', generation: 'gen' } }
  await repo.createCollection(collection)
  await repo.activate(scope)
  const snapshot: SnapshotManifest = {
    protocolVersion: 2,
    snapshotId: 'initial',
    collectionId: scope.key.collectionId,
    epoch: scope.key.epoch,
    cursor: '1',
    revision: '1',
    expiresAt: '2030-01-01T00:00:00.000Z',
    after: null,
    nextPage: null,
    projects: [project('project', '1')],
    checkpoints: [],
    media: [],
  }
  await repo.hydrate(scope.key, [snapshot], 1)
  await createBrowserDraftStore(repo, scope).write('new', undefined, {
    key: 'new',
    revision: 'draft',
    value: { name: 'Keep me' },
  })
  await repo.commitLocal(
    scope.key,
    {
      kind: 'collection.replace',
      operationId: 'replace',
      createdAt: now,
      base: { revision: '1' },
      payload: { reservationId: 'reservation', candidateSha256: '1'.repeat(64), nextEpoch: 'next' },
    },
    1,
  )
  const command = (await repo.pending(scope.key))[0].command
  const receipt: Receipt = {
    operationId: 'replace',
    sha256: command.sha256,
    epoch: 'epoch',
    revision: '2',
    cursor: '2',
    resultId: 'reservation',
    changes: [{ kind: 'collection.replaced', nextEpoch: 'next' }],
  }
  const pages = [
    {
      ...snapshot,
      snapshotId: 'next-snapshot',
      epoch: 'next',
      cursor: '2',
      revision: '2',
      projects: [{ ...project('project', '2'), name: 'Cloud replacement' }],
    },
  ]
  return { repo, scope, receipt, pages }
}
it('queues immutable replacement without changing records then atomically preserves old work and selects verified next epoch', async () => {
  const { repo, scope, receipt, pages } = await setup()
  expect((await repo.readView(scope.key)).projects[0].name).toBe('Moss scarf')
  await expect(repo.commitLocal(scope.key, create('later'), 1)).rejects.toMatchObject({
    detail: { code: 'SYNC_REBASE_REQUIRED' },
  })
  const next = await repo.completeReplacement(
    scope.key,
    { operationId: 'replace', receipt, pages },
    1,
  )
  expect(next.generation).toBe(2)
  expect(next.key.epoch).toBe('next')
  expect((await repo.readView(next.key)).projects[0].name).toBe('Cloud replacement')
  expect((await repo.readView(scope.key)).info).toMatchObject({
    kind: 'recovered',
    accountId: null,
  })
  expect((await repo.reviewLocal(scope.key)).drafts).toEqual([{ key: 'new', revision: 'draft' }])
  expect(await repo.pending(scope.key)).toEqual([])
  expect(
    await repo.completeReplacement(scope.key, { operationId: 'replace', receipt, pages }, 1),
  ).toEqual(next)
  expect(await repo.listCollections()).toHaveLength(2)
})
it('storage abort preserves the old scope, pending immutable command and drafts without a next-epoch collection', async () => {
  const { repo, scope, receipt, pages } = await setup(),
    original = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const request = original.call(this, value, key)
    if (this.name === 'collections') this.transaction.abort()
    return request
  })
  await expect(
    repo.completeReplacement(scope.key, { operationId: 'replace', receipt, pages }, 1),
  ).rejects.toMatchObject({ detail: { code: 'LOCAL_STORAGE_FAILED' } })
  expect(await repo.readActive()).toEqual(scope)
  expect(await repo.pending(scope.key)).toHaveLength(1)
  expect(await repo.listCollections()).toHaveLength(1)
})
it('rejects mismatched receipt hash, next snapshot epoch, or a different current device identity', async () => {
  const { repo, scope, receipt, pages } = await setup()
  await expect(
    repo.completeReplacement(
      scope.key,
      { operationId: 'replace', receipt: { ...receipt, sha256: '2'.repeat(64) }, pages },
      1,
    ),
  ).rejects.toMatchObject({ detail: { code: 'SYNC_PAGE_INVALID' } })
  await expect(
    repo.completeReplacement(
      scope.key,
      { operationId: 'replace', receipt, pages: [{ ...pages[0], epoch: 'other' }] },
      1,
    ),
  ).rejects.toMatchObject({ detail: { code: 'SYNC_PAGE_INVALID' } })
  const next = await repo.transition(scope, {
    key: scope.key,
    device: { id: 'other', generation: 'other-gen' },
  })
  await expect(
    repo.completeReplacement(
      scope.key,
      { operationId: 'replace', receipt, pages },
      next.generation,
    ),
  ).rejects.toMatchObject({ detail: { code: 'SYNC_PAGE_INVALID' } })
  expect(await repo.pending(scope.key)).toHaveLength(1)
})
