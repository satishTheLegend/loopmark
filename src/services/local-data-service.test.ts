import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { createBrowserOperationPlanStore } from '../repositories/browser/operation-plans'
import { createLocalDataAdapter } from './local-data-service'
import { info, png, wav, now } from '../repositories/browser/fixtures.test-support'
import type { DataAdapter } from '../data'
import type { SessionScope } from '../domain/contracts'
import { transaction, requestResult, mediaKey } from '../repositories/browser/schema'
let repository: BrowserRepository, adapter: DataAdapter, scope: SessionScope, factory: IDBFactory
const input = {
  name: 'Moss scarf',
  craft: 'Crochet' as const,
  color: 'sage' as const,
  yarn: 'DK',
  toolSize: '4 mm',
  notes: '',
}
beforeEach(async () => {
  factory = new IDBFactory()
  repository = await openBrowserRepository({ factory, databaseName: 'facade' })
  const collection = info()
  scope = { key: collection.key, generation: 1, device: { id: 'device', generation: 'gen' } }
  await repository.createCollection(collection)
  await repository.activate(scope)
  adapter = createLocalDataAdapter({
    repository,
    media: repository.media,
    plans: createBrowserOperationPlanStore(repository),
    scope: () => scope,
  })
})
afterEach(async () => {
  await repository.close()
})
it('the installed facade path captures newest checkpoint, all media and full history after restart', async () => {
  const p = await adapter.createProject(input, 'draft-token')
  await adapter.addCheckpoint(
    p.id,
    {
      position: 'row 1',
      toolSize: '4 mm',
      nextStep: 'Turn first',
      notes: '',
      photo: png,
      voice: wav,
    },
    'checkpoint-one',
  )
  await adapter.addCheckpoint(
    p.id,
    { position: 'row 2', toolSize: '4 mm', nextStep: 'Turn next', notes: '' },
    'checkpoint-two',
  )
  const listed = [await adapter.getProject(p.id)]
  expect(listed[0]!.checkpoints.map((c) => c.nextStep)).toEqual(['Turn next', 'Turn first'])
  expect(listed[0]!.checkpoints[1].photo).toBe(png)
  expect(listed[0]!.checkpoints[1].voice).toBe(wav)
  const backup = await adapter.exportBackup()
  expect(backup.projects).toEqual(listed)
  await repository.close()
  repository = await openBrowserRepository({ factory, databaseName: 'facade' })
  adapter = createLocalDataAdapter({
    repository,
    media: repository.media,
    plans: createBrowserOperationPlanStore(repository),
    scope: () => scope,
  })
  expect(await adapter.getProject(p.id)).toEqual(listed[0])
})
it('two independent local facades preserve concurrent immutable checkpoint appends and identical retries', async () => {
  const project = await adapter.createProject(input, 'create-concurrent'),
    other = await openBrowserRepository({ factory, databaseName: 'facade' })
  try {
    const second = createLocalDataAdapter({
      repository: other,
      media: other.media,
      plans: createBrowserOperationPlanStore(other),
      scope: () => scope,
    })
    const a = { position: '10', toolSize: '4 mm', nextStep: 'First tab', notes: '' },
      b = { ...a, nextStep: 'Second tab' }
    await Promise.all([
      adapter.addCheckpoint(project.id, a, 'append-a'),
      second.addCheckpoint(project.id, b, 'append-b'),
    ])
    await adapter.addCheckpoint(project.id, a, 'append-a')
    expect(
      (await second.getProject(project.id))?.checkpoints.map((c) => c.nextStep).sort(),
    ).toEqual(['First tab', 'Second tab'])
    expect(await repository.pending(scope.key)).toHaveLength(0)
  } finally {
    await other.close()
  }
})
it('durable operation plans keep create/checkpoint retries byte-identical after reopen', async () => {
  const p = await adapter.createProject(input, 'durable-create')
  const checkpoint = {
    position: 'row 1',
    toolSize: '4 mm',
    nextStep: 'Turn',
    notes: '',
    photo: png,
  }
  const saved = await adapter.addCheckpoint(p.id, checkpoint, 'durable-checkpoint')
  await repository.close()
  repository = await openBrowserRepository({ factory, databaseName: 'facade' })
  adapter = createLocalDataAdapter({
    repository,
    media: repository.media,
    plans: createBrowserOperationPlanStore(repository),
    scope: () => scope,
  })
  expect(await adapter.createProject(input, 'durable-create')).toEqual(saved)
  expect(await adapter.addCheckpoint(p.id, checkpoint, 'durable-checkpoint')).toEqual(saved)
  await expect(
    adapter.createProject({ ...input, name: 'Changed' }, 'durable-create'),
  ).rejects.toMatchObject({ detail: { code: 'OPERATION_REUSED' } })
  expect((await adapter.listProjects())[0].checkpoints).toHaveLength(1)
})
it('concurrent same-token submissions share one immutable plan and one saved project', async () => {
  const [a, b] = await Promise.all([
    adapter.createProject(input, 'same'),
    adapter.createProject(input, 'same'),
  ])
  expect(a).toEqual(b)
  expect(await adapter.listProjects()).toHaveLength(1)
})
it('numeric local CAS protects a stale timestamp form and reviewed restore preview', async () => {
  const p = await adapter.createProject(input)
  const before = await adapter.getLibraryState(),
    backup = await adapter.exportBackup()
  const changed = await adapter.updateProject(p.id, { ...input, name: 'Changed' }, p.updatedAt)
  expect(changed.updatedAt > p.updatedAt).toBe(true)
  await expect(adapter.updateProject(p.id, input, p.updatedAt)).rejects.toMatchObject({
    detail: { code: 'REVISION_CONFLICT' },
  })
  await expect(adapter.restoreBackup(backup, before.revision)).rejects.toMatchObject({
    detail: { code: 'REVISION_CONFLICT' },
  })
  expect((await adapter.listProjects())[0].name).toBe('Changed')
})
it('restores over-cap content without granting a fourth active create and retains full media', async () => {
  const p = await adapter.createProject(input)
  await adapter.addCheckpoint(
    p.id,
    { position: '', toolSize: '', nextStep: 'Continue', notes: '', photo: png },
    'media',
  )
  const backup = await adapter.exportBackup()
  backup.projects = Array.from({ length: 4 }, (_, n) => ({
    ...backup.projects[0],
    id: `p${n}`,
    code: `TEST-${n}`,
    checkpoints: backup.projects[0].checkpoints.map((c) => ({ ...c, id: `cp${n}` })),
  }))
  await adapter.restoreBackup(backup, (await adapter.getLibraryState()).revision)
  expect(await adapter.listProjects()).toHaveLength(4)
  expect((await adapter.exportBackup()).projects.every((p) => p.checkpoints[0].photo === png)).toBe(
    true,
  )
  await expect(adapter.createProject(input)).rejects.toMatchObject({
    detail: { code: 'UPGRADE_REQUIRED' },
  })
})
it('rejects malformed backups before mutation and does not seed over existing saved work', async () => {
  const p = await adapter.createProject(input),
    backup = await adapter.exportBackup()
  await adapter.seedSamples({ ...backup, projects: [] })
  await expect(adapter.restoreBackup({ ...backup, exportedAt: 'bad' })).rejects.toThrow()
  expect((await adapter.listProjects())[0]).toEqual(p)
})
it('server receipt references missing media permit readable text but cannot produce a full backup', async () => {
  const connected = info(true, 'cloud')
  await repository.createCollection(connected)
  scope = { ...scope, key: connected.key, generation: 2 }
  await repository.activate(scope)
  await repository.hydrate(
    scope.key,
    [
      {
        protocolVersion: 2,
        snapshotId: 'snapshot',
        collectionId: scope.key.collectionId,
        epoch: scope.key.epoch,
        after: null,
        cursor: '1',
        revision: '1',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        projects: [
          {
            ...input,
            id: 'remote',
            code: 'REMOTE-1',
            status: 'active',
            createdAt: now,
            updatedAt: now,
            revision: '1',
          },
        ],
        checkpoints: [
          {
            id: 'cp',
            projectId: 'remote',
            createdAt: now,
            position: '',
            toolSize: '',
            nextStep: 'Read me',
            notes: '',
            revision: '1',
            photo: {
              id: 'missing',
              kind: 'photo',
              mimeType: 'image/png',
              bytes: 68,
              sha256: '0'.repeat(64),
            },
          },
        ],
        media: [
          {
            id: 'missing',
            kind: 'photo',
            mimeType: 'image/png',
            bytes: 68,
            sha256: '0'.repeat(64),
          },
        ],
        nextPage: null,
      },
    ],
    2,
  )
  expect((await adapter.listProjects())[0].checkpoints[0].nextStep).toBe('Read me')
  await expect(adapter.exportBackup()).rejects.toMatchObject({
    detail: { code: 'BACKUP_INCOMPLETE' },
  })
  await adapter.addCheckpoint('remote', {
    position: '',
    toolSize: '',
    nextStep: 'New local text',
    notes: '',
  })
  expect((await adapter.listProjects())[0].checkpoints[0].nextStep).toBe('New local text')
})
it('shelf reads no media and selected detail/availability bound media work to two', async () => {
  const p = await adapter.createProject(input, 'shelf')
  for (let i = 0; i < 4; i++)
    await adapter.addCheckpoint(
      p.id,
      { position: String(i), toolSize: '4 mm', nextStep: 'Turn', notes: '', photo: png },
      `cp-${i}`,
    )
  let calls = 0,
    active = 0,
    maximum = 0
  const open = repository.media.open.bind(repository.media)
  repository.media.open = async (...args) => {
    calls++
    active++
    maximum = Math.max(maximum, active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    try {
      return await open(...args)
    } finally {
      active--
    }
  }
  const listed = await adapter.listProjects()
  expect(calls).toBe(0)
  expect(listed[0].checkpoints[0].photo).toBeUndefined()
  const [detail, availability] = await Promise.all([
    adapter.getProject(p.id),
    adapter.mediaAvailability(p.id),
  ])
  expect(detail?.checkpoints.every((c) => c.photo === png)).toBe(true)
  expect(availability.every((item) => item.state === 'available')).toBe(true)
  expect(maximum).toBe(2)
})

it('a corrupt cached attachment stays an explicit display placeholder without hiding checkpoint text or weakening strict export', async () => {
  const p = await adapter.createProject(input, 'corrupt-display')
  await adapter.addCheckpoint(
    p.id,
    {
      position: 'Row 8',
      toolSize: '4 mm',
      nextStep: 'Keep the saved next step',
      notes: 'Visible text',
      photo: png,
    },
    'corrupt-photo',
  )
  const view = await repository.readView(scope.key),
    ref = view.checkpoints[0].photo!
  await transaction(repository.database, 'readwrite', async (tx) => {
    const row = await requestResult(tx.objectStore('media').get(mediaKey(scope.key, ref.id)))
    const bytes = new Uint8Array(row.bytes)
    bytes[bytes.length - 1] ^= 1
    tx.objectStore('media').put({ ...row, bytes: bytes.buffer })
  })
  const opened = await adapter.getProject(p.id)
  expect(opened?.checkpoints[0]).toMatchObject({
    nextStep: 'Keep the saved next step',
    notes: 'Visible text',
  })
  expect(opened?.checkpoints[0].photo).toBeUndefined()
  expect(await adapter.mediaAvailability(p.id)).toEqual([
    { checkpointId: view.checkpoints[0].id, kind: 'photo', state: 'missing' },
  ])
  expect((await adapter.listProjects())[0].id).toBe(p.id)
  await expect(adapter.exportBackup()).rejects.toMatchObject({ detail: { code: 'MEDIA_INVALID' } })
  expect(await repository.readView(scope.key)).toEqual(view)
})
