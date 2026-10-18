import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { info, now, project, png, wav } from '../repositories/browser/fixtures.test-support'
import { requestResult, transaction, mediaKey } from '../repositories/browser/schema'
import { createBrowserWorkflowStore } from '../repositories/browser/workflow-store'
import { createBrowserOperationPlanStore } from '../repositories/browser/operation-plans'
import { createRemoteMediaService } from './media-service'
import { createDownloadsService } from './downloads-service'
import { describeInline } from './media-codec'
import type { LocalIntent, SessionScope } from '../domain/contracts'
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
    scope: SessionScope = {
      key: collection.key,
      generation: 1,
      device: { id: 'device', generation: 'gen' },
    }
  await repo.createCollection(collection)
  await repo.activate(scope)
  const photo = await describeInline(png, 'photo'),
    voice = await describeInline(wav, 'voice')
  const checkpoint = {
    id: 'cp',
    projectId: 'project',
    createdAt: now,
    position: 'Row 4',
    toolSize: '4 mm',
    nextStep: 'Turn',
    notes: '',
    revision: '1',
    photo: photo.ref,
    voice: voice.ref,
  }
  await repo.hydrate(
    scope.key,
    [
      {
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
        checkpoints: [checkpoint],
        media: [photo.ref, voice.ref],
      },
    ],
    1,
  )
  const transport = {
    download: vi.fn(async (request: { mediaId: string }) =>
      request.mediaId === photo.ref.id ? photo.bytes : voice.bytes,
    ),
    reserve: vi.fn(),
    upload: vi.fn(),
    cancel: vi.fn(),
  }
  const remote = createRemoteMediaService({
    repository: repo,
    media: repo.media,
    workflows: createBrowserWorkflowStore(repo),
    transport,
    current: () => ({
      accountId: 'account',
      billingPrincipalId: 'principal',
      deletionGeneration: '0',
      collection: scope.key,
      device: scope.device,
      expiresAt: '2030-01-01T00:00:00.000Z',
    }),
  })
  const service = createDownloadsService({
    repository: repo,
    media: repo.media,
    scope: () => scope,
    remote,
  })
  return { repo, scope, photo, voice, checkpoint, transport, remote, service }
}
it('truthfully checks whole-project offline readiness, removes only downloaded bytes and downloads them again without cloud mutation', async () => {
  const f = await setup(),
    before = await f.repo.readView(f.scope.key)
  expect(await f.service.inspect('project')).toMatchObject({
    state: 'unavailable',
    total: 2,
    available: 0,
    missing: 2,
  })
  await f.remote.ensureAvailable(f.photo.ref, f.scope, new AbortController().signal)
  expect(await f.service.inspect('project')).toMatchObject({
    state: 'partial',
    available: 1,
    missing: 1,
  })
  expect(await f.service.download('project')).toMatchObject({
    state: 'available',
    available: 2,
    missing: 0,
  })
  expect(f.transport.download).toHaveBeenCalledTimes(2)
  expect(await f.service.remove('project')).toMatchObject({
    removed: 2,
    retained: 0,
    state: 'unavailable',
  })
  expect(await f.repo.readView(f.scope.key)).toEqual(before)
  expect(await f.repo.pending(f.scope.key)).toEqual([])
  expect(await f.service.download('project')).toMatchObject({ state: 'available' })
  expect(f.transport.download).toHaveBeenCalledTimes(4)
  expect(
    await new Response(await f.repo.media.open(f.photo.ref, f.scope.key)).arrayBuffer(),
  ).toEqual(await f.photo.bytes.arrayBuffer())
})
it.each(['draft', 'snapshot', 'plan', 'candidate', 'archive', 'pending', 'upload'] as const)(
  'retains bytes owned by %s while safely evicting unrelated downloads',
  async (kind) => {
    const f = await setup()
    await f.service.download('project')
    const { revision: _revision, ...checkpointInput } = f.checkpoint
    const append: LocalIntent = {
      kind: 'checkpoint.create',
      operationId: 'append',
      createdAt: now,
      base: { revision: '1' },
      payload: {
        updatedAt: now,
        checkpoint: { ...checkpointInput, id: 'second', voice: undefined },
      },
    }
    if (kind === 'draft')
      await transaction(f.repo.database, 'readwrite', (tx) => {
        tx.objectStore('drafts').put({
          key: 'draft',
          scope: f.scope.key,
          media: [f.photo.ref],
          value: { key: 'checkpoint:project', revision: 'one', value: { photo: f.photo.ref } },
        })
      })
    if (kind === 'snapshot') await f.repo.snapshot(f.scope.key)
    if (kind === 'plan') {
      delete append.payload.checkpoint.voice
      await createBrowserOperationPlanStore(f.repo).putIfAbsent(f.scope, {
        operationId: 'append',
        inputHash: '0'.repeat(64),
        intent: append,
      })
    }
    if (kind === 'archive')
      await transaction(f.repo.database, 'readwrite', (tx) => {
        tx.objectStore('meta').put({
          key: JSON.stringify(['rebase-archive', 'id']),
          scope: f.scope.key,
          media: [f.photo.ref],
          value: {},
        })
      })
    if (kind === 'upload')
      await createBrowserWorkflowStore(f.repo).write(
        'attachment',
        null,
        {
          kind: 'upload',
          accountId: 'account',
          collection: f.scope.key,
          value: { state: 'pending', ref: f.photo.ref },
        },
        f.scope,
      )
    if (kind === 'candidate')
      await createBrowserWorkflowStore(f.repo).write(
        'candidate',
        null,
        {
          kind: 'candidate',
          accountId: 'account',
          collection: f.scope.key,
          value: {
            phase: 'prepared',
            preview: { source: { key: f.scope.key }, destination: { key: f.scope.key } },
          },
        },
        f.scope,
      )
    if (kind === 'pending') {
      delete append.payload.checkpoint.voice
      await f.repo.commitLocal(f.scope.key, append, 1)
    }
    if (['snapshot', 'candidate', 'pending'].includes(kind))
      await expect(f.service.remove('project')).rejects.toMatchObject({
        detail: { code: 'DOWNLOADS_PROTECTED' },
      })
    else
      expect(await f.service.remove('project')).toMatchObject({
        removed: 1,
        retained: 1,
        state: 'partial',
      })
    expect(
      (await new Response(await f.repo.media.open(f.photo.ref, f.scope.key)).arrayBuffer())
        .byteLength,
    ).toBe(f.photo.ref.bytes)
  },
)
it('retains local provenance and guest/recovered copies even when IDs match a downloaded account blob', async () => {
  const f = await setup()
  await f.repo.media.storeVerified(f.photo.ref, f.photo.bytes, f.scope.key, 1)
  await f.remote.ensureAvailable(f.voice.ref, f.scope, new AbortController().signal)
  const recovered = await f.repo.retainLocal(
    f.scope.key,
    'Kept copy',
    (await f.repo.readView(f.scope.key)).revision,
    1,
  )
  expect(await f.service.remove('project')).toMatchObject({ removed: 1, retained: 1 })
  expect(
    (await new Response(await f.repo.media.open(f.voice.ref, recovered)).arrayBuffer()).byteLength,
  ).toBe(f.voice.ref.bytes)
  const selected = await f.repo.transition(f.scope, { key: recovered, device: f.scope.device })
  await expect(f.repo.removeDownloads(selected, 'project')).rejects.toMatchObject({
    detail: { code: 'DOWNLOADS_PROTECTED' },
  })
  await expect(f.repo.removeDownloads(f.scope, 'project')).rejects.toMatchObject({
    detail: { code: 'ACCOUNT_CHANGED' },
  })
})
it('aborts all byte removal on a storage failure and fences same-generation changed device identity', async () => {
  const f = await setup()
  await f.service.download('project')
  await expect(
    f.repo.removeDownloads({ ...f.scope, device: { id: 'other', generation: 'gen' } }, 'project'),
  ).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  const original = IDBObjectStore.prototype.delete
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    const result = original.call(this, key)
    if (this.name === 'media') this.transaction.abort()
    return result
  })
  await expect(f.service.remove('project')).rejects.toMatchObject({
    detail: { code: 'LOCAL_STORAGE_FAILED' },
  })
  expect(await f.service.inspect('project')).toMatchObject({ state: 'available', available: 2 })
})
it('detects corrupt cached bytes and repairs them before claiming available offline', async () => {
  const f = await setup()
  await f.service.download('project')
  await transaction(f.repo.database, 'readwrite', async (tx) => {
    const row = await requestResult(
      tx.objectStore('media').get(mediaKey(f.scope.key, f.photo.ref.id)),
    )
    const bytes = new Uint8Array(row.bytes)
    bytes[bytes.length - 1] ^= 1
    tx.objectStore('media').put({ ...row, bytes: bytes.buffer })
  })
  expect(await f.service.inspect('project')).toMatchObject({ state: 'partial', missing: 1 })
  expect(await f.service.download('project')).toMatchObject({ state: 'available' })
  expect(f.transport.download).toHaveBeenCalledTimes(3)
})

it('keeps local provenance sticky when verified remote bytes repair the same ID', async () => {
  const f = await setup()
  await f.repo.media.storeVerified(f.photo.ref, f.photo.bytes, f.scope.key, 1)
  await f.repo.media.storeVerified(f.photo.ref, f.photo.bytes, f.scope.key, 1, { downloaded: true })
  const row = await transaction(f.repo.database, 'readonly', (tx) =>
    requestResult(tx.objectStore('media').get(mediaKey(f.scope.key, f.photo.ref.id))),
  )
  expect(row.downloaded).toBeUndefined()
  await expect(f.service.remove('project')).rejects.toMatchObject({
    detail: { code: 'DOWNLOADS_PROTECTED' },
  })
})
