import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { createBrowserOperationPlanStore } from '../repositories/browser/operation-plans'
import { createLocalDataAdapter, prepareBackupRecords } from './local-data-service'
import { createBackupService } from './backup-service'
import { info, create, now, png, wav, project } from '../repositories/browser/fixtures.test-support'
import { mediaKey, requestResult, transaction } from '../repositories/browser/schema'
import type { Backup, SessionScope } from '../domain/contracts'
let repo: BrowserRepository, scope: SessionScope, service: ReturnType<typeof createBackupService>
const { revision: _revision, ...fields } = project()
const backup: Backup = {
  format: 'loopmark',
  version: 1,
  exportedAt: now,
  projects: [
    {
      ...fields,
      checkpoints: [
        {
          id: 'cp',
          createdAt: now,
          position: '4',
          toolSize: '4 mm',
          nextStep: 'Turn',
          notes: '',
          photo: png,
          voice: wav,
        },
      ],
    },
  ],
}
beforeEach(async () => {
  repo = await openBrowserRepository({ factory: new IDBFactory(), databaseName: 'recovery' })
  const collection = info()
  await repo.createCollection(collection)
  scope = { key: collection.key, generation: 1, device: { id: 'device', generation: 'gen' } }
  await repo.activate(scope)
  await repo.commitLocal(scope.key, create('original'), 1)
  const data = createLocalDataAdapter({
    repository: repo,
    media: repo.media,
    plans: createBrowserOperationPlanStore(repo),
    scope: () => scope,
  })
  service = createBackupService({ repository: repo, media: repo.media, data, scope: () => scope })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await repo.close()
})
it('restores full verified history as a separate recovered collection and same-token retry reuses it', async () => {
  const before = await repo.readView(scope.key),
    key = await service.restoreAsRecovered(backup, 'Imported scarf', 'stable-token')
  expect(await repo.readView(scope.key)).toEqual(before)
  expect(await repo.readActive()).toEqual(scope)
  expect((await repo.readView(key)).info.kind).toBe('recovered')
  expect(await service.restoreAsRecovered(backup, 'Imported scarf', 'stable-token')).toEqual(key)
  expect(await repo.listCollections()).toHaveLength(2)
  scope = await repo.transition(scope, { key, device: scope.device })
  const output = await service.exportComplete()
  expect(output.projects).toEqual(backup.projects)
})
it('aborted candidate installation exposes no empty or partially restored collection', async () => {
  const original = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const request = original.call(this, value, key)
    if (this.name === 'collections') this.transaction.abort()
    return request
  })
  await expect(service.restoreAsRecovered(backup, 'Recovered', 'fault')).rejects.toMatchObject({
    detail: { code: 'LOCAL_STORAGE_FAILED' },
  })
  expect(await repo.listCollections()).toHaveLength(1)
  expect((await repo.readView(scope.key)).projects[0].id).toBe('original')
})
it('missing bytes and scoped media-ID collisions fail atomically without overwriting or showing the candidate', async () => {
  const prepared = await prepareBackupRecords(backup, repo.media, scope),
    target = { ...info(false, 'target'), kind: 'recovered' as const },
    ref = prepared.checkpoints[0].photo!
  await repo.media.release(ref, scope.key, scope.generation)
  await expect(
    repo.importLocal({ info: target, ...prepared }, { generation: 1, mediaSource: scope.key }),
  ).rejects.toMatchObject({ detail: { code: 'BACKUP_INCOMPLETE' } })
  await prepareBackupRecords(backup, repo.media, scope)
  await transaction(repo.database, 'readwrite', async (tx) => {
    const row = await requestResult(tx.objectStore('media').get(mediaKey(scope.key, ref.id)))
    tx.objectStore('media').add({ ...row, key: mediaKey(target.key, ref.id), scope: target.key })
  })
  await expect(
    repo.importLocal({ info: target, ...prepared }, { generation: 1, mediaSource: scope.key }),
  ).rejects.toMatchObject({ detail: { code: 'LOCAL_STORAGE_FAILED' } })
  expect(await repo.listCollections()).toHaveLength(1)
})
it('a generation change while media is being prepared cannot install the old-session candidate', async () => {
  const original = repo.media.storeVerified.bind(repo.media)
  let first = true
  vi.spyOn(repo.media, 'storeVerified').mockImplementation(async (...args) => {
    await original(...args)
    if (first) {
      first = false
      await repo.transition(scope, { key: scope.key, device: scope.device })
    }
  })
  await expect(service.restoreAsRecovered(backup, 'Recovered', 'switch')).rejects.toMatchObject({
    detail: { code: 'ACCOUNT_CHANGED' },
  })
  expect(await repo.listCollections()).toHaveLength(1)
})

it('complete export pins one local view, fetches missing bytes from one server lease, and keeps unsent history', async () => {
  const connected = info(true, 'export')
  await repo.createCollection(connected)
  scope = await repo.transition(scope, { key: connected.key, device: scope.device })
  const prepared = await prepareBackupRecords(backup, repo.media, scope)
  const manifest = {
    protocolVersion: 2 as const,
    snapshotId: 'export-lease',
    collectionId: scope.key.collectionId,
    epoch: scope.key.epoch,
    cursor: '1',
    revision: '1',
    expiresAt: '2030-01-01T00:00:00.000Z',
    after: null,
    nextPage: null,
    projects: prepared.projects.map((p) => ({ ...p, revision: '1' })),
    checkpoints: prepared.checkpoints.map((c) => ({ ...c, revision: '1' })),
    media: prepared.checkpoints.flatMap((c) => [c.photo!, c.voice!]),
  }
  await repo.hydrate(scope.key, [manifest], scope.generation)
  const photo = manifest.media[0],
    original = await new Response(await repo.media.open(photo, scope.key)).arrayBuffer()
  await transaction(repo.database, 'readwrite', async (tx) => {
    tx.objectStore('media').delete(mediaKey(scope.key, photo.id))
  })
  await expect(repo.snapshot(scope.key)).rejects.toMatchObject({
    detail: { code: 'BACKUP_INCOMPLETE' },
  })
  const pending = create('unsent', 'unsent-create')
  await repo.commitLocal(scope.key, pending, scope.generation)
  const transport = {
    snapshot: vi.fn(async () => manifest),
    releaseSnapshot: vi.fn(async () => {}),
    push: vi.fn(),
    pull: vi.fn(),
  }
  let localReleased = false
  const release = repo.releaseSnapshot.bind(repo)
  vi.spyOn(repo, 'releaseSnapshot').mockImplementation(async (id) => {
    localReleased = true
    await release(id)
  })
  const ensureAvailable = vi.fn(async (ref, bound, _signal, snapshotId) => {
    expect(snapshotId).toBe('export-lease')
    expect(localReleased).toBe(false)
    expect(transport.releaseSnapshot).not.toHaveBeenCalled()
    await repo.media.storeVerified(
      ref,
      new Blob([original], { type: photo.mimeType }),
      bound.key,
      bound.generation,
    )
  })
  const session = {
    accountId: 'account',
    billingPrincipalId: 'principal',
    collection: scope.key,
    device: scope.device,
    deletionGeneration: '0',
    expiresAt: '2030-01-01T00:00:00.000Z',
  }
  const exporter = createBackupService({
    repository: repo,
    media: repo.media,
    data: {} as never,
    scope: () => scope,
    remote: { transport, media: { ensureAvailable, upload: vi.fn() }, current: () => session },
  })
  const exported = await exporter.exportComplete()
  expect(exported.projects.map((p) => p.id).sort()).toEqual(['project', 'unsent'])
  expect(exported.projects.find((p) => p.id === 'project')!.checkpoints[0].photo).toBe(png)
  expect(ensureAvailable).toHaveBeenCalledTimes(1)
  expect(localReleased).toBe(true)
  expect(transport.releaseSnapshot).toHaveBeenCalledWith('export-lease', expect.any(AbortSignal))
  transport.snapshot.mockClear()
  await exporter.exportComplete()
  expect(transport.snapshot).not.toHaveBeenCalled() // Complete cached copies remain exportable offline.
})

it('missing server bytes reject a complete export and release both leases without emitting a partial backup', async () => {
  const connected = info(true, 'missing')
  await repo.createCollection(connected)
  scope = await repo.transition(scope, { key: connected.key, device: scope.device })
  const prepared = await prepareBackupRecords(backup, repo.media, scope)
  const manifest = {
    protocolVersion: 2 as const,
    snapshotId: 'missing-lease',
    collectionId: scope.key.collectionId,
    epoch: scope.key.epoch,
    cursor: '1',
    revision: '1',
    expiresAt: '2030-01-01T00:00:00.000Z',
    after: null,
    nextPage: null,
    projects: prepared.projects.map((p) => ({ ...p, revision: '1' })),
    checkpoints: prepared.checkpoints.map((c) => ({ ...c, revision: '1' })),
    media: prepared.checkpoints.flatMap((c) => [c.photo!, c.voice!]),
  }
  await repo.hydrate(scope.key, [manifest], scope.generation)
  await transaction(repo.database, 'readwrite', async (tx) => {
    tx.objectStore('media').delete(mediaKey(scope.key, manifest.media[0].id))
  })
  const transport = {
    snapshot: vi.fn(async () => ({ ...manifest, media: [] })),
    releaseSnapshot: vi.fn(async () => {}),
    push: vi.fn(),
    pull: vi.fn(),
  }
  const session = {
    accountId: 'account',
    billingPrincipalId: 'principal',
    collection: scope.key,
    device: scope.device,
    deletionGeneration: '0',
    expiresAt: '2030-01-01T00:00:00.000Z',
  }
  const ensureAvailable = vi.fn()
  const exporter = createBackupService({
    repository: repo,
    media: repo.media,
    data: {} as never,
    scope: () => scope,
    remote: { transport, media: { ensureAvailable, upload: vi.fn() }, current: () => session },
  })
  const release = vi
    .spyOn(repo, 'releaseSnapshot')
    .mockRejectedValueOnce(new Error('Local cleanup failed'))
  await expect(exporter.exportComplete()).rejects.toMatchObject({
    detail: { code: 'BACKUP_INCOMPLETE' },
  })
  expect(ensureAvailable).not.toHaveBeenCalled()
  expect(release).toHaveBeenCalledOnce()
  expect(transport.releaseSnapshot).toHaveBeenCalledOnce()
})
