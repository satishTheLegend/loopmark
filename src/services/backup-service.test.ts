import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { createBrowserOperationPlanStore } from '../repositories/browser/operation-plans'
import { createLocalDataAdapter, prepareBackupRecords } from './local-data-service'
import { createBackupService, IncompleteBackupError } from './backup-service'
import { info, create, now, png, wav, project } from '../repositories/browser/fixtures.test-support'
import { mediaKey, requestResult, transaction } from '../repositories/browser/schema'
import type { Backup, SessionScope } from '../domain/contracts'
import { DomainError } from '../domain/errors'
import { createRemoteMediaService } from './media-service'
import { createBrowserWorkflowStore } from '../repositories/browser/workflow-store'
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

it('cancel during remote export drains active downloads, preserves the collection and releases both leases', async () => {
  const connected = info(true, 'cancel')
  await repo.createCollection(connected)
  scope = await repo.transition(scope, { key: connected.key, device: scope.device })
  const prepared = await prepareBackupRecords(backup, repo.media, scope)
  const manifest = {
    protocolVersion: 2 as const,
    snapshotId: 'cancel-lease',
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
  const bytes = await Promise.all(
    manifest.media.map(
      async (ref) =>
        new Blob([await new Response(await repo.media.open(ref, scope.key)).arrayBuffer()], {
          type: ref.mimeType,
        }),
    ),
  )
  await transaction(repo.database, 'readwrite', async (tx) => {
    for (const ref of manifest.media) tx.objectStore('media').delete(mediaKey(scope.key, ref.id))
  })
  const before = await repo.readView(scope.key),
    abort = new AbortController()
  let secondStarted!: () => void, releaseSecond!: () => void
  const started = new Promise<void>((resolve) => {
    secondStarted = resolve
  })
  const held = new Promise<void>((resolve) => {
    releaseSecond = resolve
  })
  const cancelled = new Promise<void>((resolve) =>
    abort.signal.addEventListener('abort', () => resolve(), { once: true }),
  )
  let calls = 0
  const ensureAvailable = vi.fn(async (ref, bound) => {
    const index = calls++
    if (index === 0) {
      await started
      await repo.media.storeVerified(ref, bytes[index], bound.key, bound.generation)
      abort.abort(new DOMException('Export cancelled', 'AbortError'))
    } else {
      secondStarted()
      await held
      await repo.media.storeVerified(ref, bytes[index], bound.key, bound.generation)
    }
  })
  const transport = {
    snapshot: vi.fn(async () => manifest),
    releaseSnapshot: vi.fn(async () => {}),
    push: vi.fn(),
    pull: vi.fn(),
  }
  const release = vi.spyOn(repo, 'releaseSnapshot')
  const exporter = createBackupService({
    repository: repo,
    media: repo.media,
    data: {} as never,
    scope: () => scope,
    remote: {
      transport,
      media: { ensureAvailable, upload: vi.fn() },
      current: () => ({
        accountId: 'account',
        billingPrincipalId: 'principal',
        collection: scope.key,
        device: scope.device,
        deletionGeneration: '0',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    },
  })
  const progress = vi.fn()
  const outcome = exporter.exportComplete(abort.signal, progress).catch((error) => error)
  await cancelled
  expect(release).not.toHaveBeenCalled()
  expect(transport.releaseSnapshot).not.toHaveBeenCalled()
  releaseSecond()
  expect(await outcome).toMatchObject({ name: 'AbortError' })
  expect(release).toHaveBeenCalledOnce()
  expect(transport.releaseSnapshot).toHaveBeenCalledOnce()
  expect(progress.mock.calls.some(([value]) => value.stage === 'downloading')).toBe(true)
  expect(progress.mock.calls.some(([value]) => value.stage === 'encoding')).toBe(false)
  expect(await repo.readView(scope.key)).toEqual(before)
})

it('lists only unavailable snapshot attachments, keeps successful bytes, and retry downloads only the remainder', async () => {
  const connected = info(true, 'retry')
  await repo.createCollection(connected)
  scope = await repo.transition(scope, { key: connected.key, device: scope.device })
  const prepared = await prepareBackupRecords(backup, repo.media, scope)
  const manifest = {
    protocolVersion: 2 as const,
    snapshotId: 'retry-lease',
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
  const bytes = new Map(
    await Promise.all(
      manifest.media.map(
        async (ref) =>
          [
            ref.id,
            new Blob([await new Response(await repo.media.open(ref, scope.key)).arrayBuffer()], {
              type: ref.mimeType,
            }),
          ] as const,
      ),
    ),
  )
  await transaction(repo.database, 'readwrite', async (tx) => {
    for (const ref of manifest.media) tx.objectStore('media').delete(mediaKey(scope.key, ref.id))
  })
  let failVoice = true
  const ensureAvailable = vi.fn(async (ref, bound) => {
    if (failVoice && ref.kind === 'voice') throw new DomainError('SERVICE_UNAVAILABLE')
    await repo.media.storeVerified(ref, bytes.get(ref.id)!, bound.key, bound.generation)
  })
  const transport = {
    snapshot: vi.fn(async () => manifest),
    releaseSnapshot: vi.fn(async () => {}),
    push: vi.fn(),
    pull: vi.fn(),
  }
  const exporter = createBackupService({
    repository: repo,
    media: repo.media,
    data: {} as never,
    scope: () => scope,
    remote: {
      transport,
      media: { ensureAvailable, upload: vi.fn() },
      current: () => ({
        accountId: 'account',
        billingPrincipalId: 'principal',
        collection: scope.key,
        device: scope.device,
        deletionGeneration: '0',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    },
  })
  const output = vi.fn()
  const first = await exporter.exportComplete().then(output, (error) => error)
  expect(first).toBeInstanceOf(IncompleteBackupError)
  expect(first).toMatchObject({
    scope,
    snapshotRevision: '1',
    total: 1,
    missing: [
      {
        projectId: 'project',
        projectName: 'Moss scarf',
        checkpointId: 'cp',
        checkpointCreatedAt: now,
        position: '4',
        kind: 'voice',
      },
    ],
  })
  expect(output).not.toHaveBeenCalled()
  expect(transport.releaseSnapshot).toHaveBeenCalledOnce()
  await expect(repo.media.open(manifest.media[0], scope.key)).resolves.toBeInstanceOf(
    ReadableStream,
  )
  ensureAvailable.mockClear()
  failVoice = false
  const completed = await exporter.exportComplete()
  expect(ensureAvailable).toHaveBeenCalledOnce()
  expect(ensureAvailable.mock.calls[0][0].kind).toBe('voice')
  const fresh = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: 'independent-complete-restore',
  })
  try {
    const destination = info(false, 'independent')
    await fresh.createCollection(destination)
    let freshScope = { key: destination.key, generation: 1, device: scope.device }
    await fresh.activate(freshScope)
    const data = createLocalDataAdapter({
      repository: fresh,
      media: fresh.media,
      plans: createBrowserOperationPlanStore(fresh),
      scope: () => freshScope,
    })
    const restore = createBackupService({
      repository: fresh,
      media: fresh.media,
      data,
      scope: () => freshScope,
    })
    const recovered = await restore.restoreAsRecovered(completed, 'Independent restore', 'restore')
    freshScope = await fresh.transition(freshScope, { key: recovered, device: freshScope.device })
    expect((await restore.exportComplete()).projects).toEqual(backup.projects)
  } finally {
    await fresh.close()
  }
  const snapshot = await repo.snapshot(scope.key)
  try {
    snapshot.view.checkpoints = Array.from({ length: 25 }, (_, index) => ({
      ...snapshot.view.checkpoints[0],
      id: `cp_${index}`,
    }))
    const bounded = new IncompleteBackupError(
      scope,
      snapshot,
      new Set(manifest.media.map((ref) => ref.id)),
    )
    expect(bounded.total).toBe(50)
    expect(bounded.missing).toHaveLength(20)
    expect(JSON.stringify(bounded.missing)).not.toContain('nextStep')
  } finally {
    await repo.releaseSnapshot(snapshot.id)
  }
})

it('authentication failure during missing-media lookup remains an authentication error', async () => {
  const connected = info(true, 'auth')
  await repo.createCollection(connected)
  scope = await repo.transition(scope, { key: connected.key, device: scope.device })
  const prepared = await prepareBackupRecords(backup, repo.media, scope)
  await repo.hydrate(
    scope.key,
    [
      {
        protocolVersion: 2,
        snapshotId: 'auth-lease',
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
      },
    ],
    scope.generation,
  )
  await transaction(repo.database, 'readwrite', async (tx) => {
    tx.objectStore('media').delete(mediaKey(scope.key, prepared.checkpoints[0].photo!.id))
  })
  const original = new DomainError('AUTH_REQUIRED')
  const exporter = createBackupService({
    repository: repo,
    media: repo.media,
    data: {} as never,
    scope: () => scope,
    remote: {
      media: { upload: vi.fn(), ensureAvailable: vi.fn() },
      transport: {
        snapshot: vi.fn(async () => {
          throw original
        }),
        releaseSnapshot: vi.fn(),
        push: vi.fn(),
        pull: vi.fn(),
      },
      current: () => ({
        accountId: 'account',
        billingPrincipalId: 'principal',
        collection: scope.key,
        device: scope.device,
        deletionGeneration: '0',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    },
  })
  await expect(exporter.exportComplete()).rejects.toBe(original)
})

it.each(['wrong-hash', 'truncated'] as const)(
  'repairs %s cached bytes under the original snapshot and exports exact complete media',
  async (damage) => {
    const connected = info(true, 'repair')
    await repo.createCollection(connected)
    scope = await repo.transition(scope, { key: connected.key, device: scope.device })
    const prepared = await prepareBackupRecords(backup, repo.media, scope)
    const manifest = {
      protocolVersion: 2 as const,
      snapshotId: 'repair-lease',
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
    const before = await repo.readView(scope.key)
    const photo = manifest.media[0]
    const original = await new Response(await repo.media.open(photo, scope.key)).arrayBuffer()
    const corrupt = new Uint8Array(original.slice(0))
    corrupt[corrupt.length - 1] ^= 1
    await transaction(repo.database, 'readwrite', async (tx) => {
      const key = mediaKey(scope.key, photo.id)
      const row = await requestResult(tx.objectStore('media').get(key))
      tx.objectStore('media').put({
        ...row,
        bytes: damage === 'truncated' ? corrupt.buffer.slice(0, -1) : corrupt.buffer,
      })
    })
    await expect(repo.media.open(photo, scope.key)).rejects.toMatchObject({
      detail: { code: 'MEDIA_INVALID' },
    })
    if (damage === 'truncated')
      await expect(repo.snapshot(scope.key)).rejects.toMatchObject({
        detail: { code: 'BACKUP_INCOMPLETE' },
      })
    const pinned = await repo.snapshot(scope.key, { allowMissingMedia: true })
    expect(pinned.media).toContainEqual(photo)
    const current = () => ({
      accountId: 'account',
      billingPrincipalId: 'principal',
      collection: scope.key,
      device: scope.device,
      deletionGeneration: '0',
      expiresAt: '2030-01-01T00:00:00.000Z',
    })
    const transport = {
      snapshot: vi.fn(async () => manifest),
      releaseSnapshot: vi.fn(async () => {}),
      push: vi.fn(),
      pull: vi.fn(),
    }
    const download = vi.fn(
      async (_request: { mediaId: string }) => new Blob([original], { type: photo.mimeType }),
    )
    download.mockResolvedValueOnce(new Blob([corrupt], { type: photo.mimeType }))
    const remoteMedia = createRemoteMediaService({
      repository: repo,
      media: repo.media,
      workflows: createBrowserWorkflowStore(repo),
      current,
      transport: { download, reserve: vi.fn(), upload: vi.fn(), cancel: vi.fn() },
    })
    const exporter = createBackupService({
      repository: repo,
      media: repo.media,
      data: {} as never,
      scope: () => scope,
      remote: { transport, media: remoteMedia, current },
    })
    const output = vi.fn()
    const first = await exporter.exportComplete().then(output, (error) => error)
    expect(first).toBeInstanceOf(IncompleteBackupError)
    expect(first).toMatchObject({
      scope,
      total: 1,
      missing: [{ checkpointId: 'cp', kind: 'photo' }],
    })
    expect(output).not.toHaveBeenCalled()
    await expect(repo.media.open(photo, scope.key)).rejects.toMatchObject({
      detail: { code: 'MEDIA_INVALID' },
    })
    expect((await exporter.exportComplete()).projects).toEqual(backup.projects)
    expect(download).toHaveBeenCalledTimes(2)
    expect(download.mock.calls.every(([request]) => request.mediaId === photo.id)).toBe(true)
    expect(await repo.readView(scope.key)).toEqual(before)
    const durablePin = await transaction(repo.database, 'readonly', (tx) =>
      requestResult(tx.objectStore('snapshots').get(pinned.id)),
    )
    expect(durablePin.value.media).toContainEqual(photo)
    const repaired = await new Response(await repo.media.open(photo, scope.key)).arrayBuffer()
    expect(new Uint8Array(repaired)).toEqual(new Uint8Array(original))
    download.mockClear()
    transport.snapshot.mockClear()
    expect((await exporter.exportComplete()).projects).toEqual(backup.projects)
    expect(download).not.toHaveBeenCalled()
    expect(transport.snapshot).not.toHaveBeenCalled()
    await repo.releaseSnapshot(pinned.id)
    await transaction(repo.database, 'readwrite', async (tx) => {
      const row = await requestResult(tx.objectStore('media').get(mediaKey(scope.key, photo.id)))
      tx.objectStore('media').put({ ...row, ref: { ...photo, sha256: '0'.repeat(64) } })
    })
    await expect(repo.snapshot(scope.key, { allowMissingMedia: true })).rejects.toMatchObject({
      detail: { code: 'BACKUP_INCOMPLETE' },
    })
  },
)
