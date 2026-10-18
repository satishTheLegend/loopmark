import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { LocalIntent, SnapshotManifest } from '../../domain/contracts'
import { canonicalJson } from '../../domain/canonical-json'
import { DomainError } from '../../domain/errors'
import { verifyRepositoryContract } from '../contract-suite'
import { openBrowserRepository, type BrowserRepository } from './repository'
import { dataUrlToBlob } from './media-store'
import { transaction, requestResult, mediaKey, type MediaRow } from './schema'
import { info, now, create, receipt, project, png } from './fixtures.test-support'

let factory: IDBFactory, repositories: BrowserRepository[]
async function open(name = 'test', upgraded = false) {
  const repository = await openBrowserRepository({
    databaseName: name,
    factory,
    access: () => upgraded,
  })
  repositories.push(repository)
  return repository
}
async function setup(connected = false, upgraded = false) {
  const repository = await open('test', upgraded),
    collection = info(connected)
  await repository.createCollection(collection)
  await repository.activate({
    key: collection.key,
    generation: 1,
    device: { id: 'device', generation: 'device-gen' },
  })
  return { repository, key: collection.key, collection }
}
const fields = {
  name: 'Changed scarf',
  craft: 'Knitting' as const,
  color: 'clay' as const,
  yarn: '',
  toolSize: '5 mm',
  notes: '',
}
const update = (revision = '1'): LocalIntent => ({
  kind: 'project.update',
  operationId: 'update',
  createdAt: now,
  base: { revision },
  payload: { projectId: 'project', fields, updatedAt: now },
})
beforeEach(() => {
  factory = new IDBFactory()
  repositories = []
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repository of repositories) await repository.close()
})

describe('IndexedDB repository durability and isolation', () => {
  it('runs the reusable persistence/idempotence/generation/snapshot contract', async () => {
    await verifyRepositoryContract(() => open('contract'))
  })
  it('commits one effect for concurrent equal operation IDs across connections', async () => {
    const { repository, key } = await setup(true),
      other = await open()
    await Promise.all([
      repository.commitLocal(key, create(), 1),
      other.commitLocal(key, create(), 1),
    ])
    const view = await other.readView(key)
    expect(view.projects).toHaveLength(1)
    expect(view.pending).toHaveLength(1)
    expect(view.pending[0].command.sequence).toBe('1')
  })
  it('rejects changed content reused under an operation ID and permits Object prototype names', async () => {
    const { repository, key } = await setup()
    const intent = create('project', 'constructor')
    await repository.commitLocal(key, intent, 1)
    await expect(
      repository.commitLocal(key, { ...intent, createdAt: '2026-01-02T00:00:00.000Z' }, 1),
    ).rejects.toMatchObject({ detail: { code: 'OPERATION_REUSED' } })
    expect((await repository.readView(key)).projects).toHaveLength(1)
  })
  it('rolls back records, outbox, operation receipt and sequence if final storage write aborts', async () => {
    const { repository, key } = await setup(true)
    const original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const result = original.call(this, value, key)
      if (this.name === 'collections') this.transaction.abort()
      return result
    })
    await expect(repository.commitLocal(key, create(), 1)).rejects.toMatchObject({
      detail: { code: 'LOCAL_STORAGE_FAILED' },
    })
    vi.restoreAllMocks()
    const fresh = await open()
    expect((await fresh.readView(key)).projects).toHaveLength(0)
    await fresh.commitLocal(key, create(), 1)
    expect((await fresh.pending(key))[0].command.sequence).toBe('1')
  })
  it('fences asynchronous prepared writes and late commits after account switch', async () => {
    const { repository, key } = await setup(true),
      next = info(true, 'other')
    next.accountId = 'other'
    await repository.createCollection(next)
    await repository.activate({
      key: next.key,
      generation: 2,
      device: { id: 'other', generation: 'other' },
    })
    await expect(repository.commitLocal(key, create(), 1)).rejects.toMatchObject({
      detail: { code: 'ACCOUNT_CHANGED' },
    })
    await expect(
      repository.media.prepare({ bytes: dataUrlToBlob(png), kind: 'photo' }, key, 2),
    ).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
    expect((await repository.readView(next.key)).projects).toHaveLength(0)
  })
  it('uses local CAS while keeping guest mutations out of the network outbox', async () => {
    const { repository, key } = await setup()
    await repository.commitLocal(key, create(), 1)
    await repository.commitLocal(key, update(), 1)
    await expect(
      repository.commitLocal(key, { ...update(), operationId: 'stale' }, 1),
    ).rejects.toMatchObject({ detail: { code: 'REVISION_CONFLICT' } })
    expect(await repository.pending(key)).toEqual([])
    expect((await repository.readView(key)).projects[0].name).toBe('Changed scarf')
  })
  it('preserves an immutable command across retries, attempts and error markers', async () => {
    const { repository, key } = await setup(true)
    await repository.commitLocal(key, create(), 1)
    const original = canonicalJson((await repository.pending(key))[0].command)
    await repository.markAttempt(key, 'create-project', 1)
    await repository.markFailure(key, 'create-project', new DomainError('OFFLINE').detail, 1)
    await repository.commitLocal(key, create(), 1)
    expect(canonicalJson((await repository.pending(key))[0].command)).toBe(original)
  })
  it('enforces three active projects without blocking edit, finish, history or legacy local access', async () => {
    const { repository, key } = await setup()
    for (let n = 0; n < 3; n++) await repository.commitLocal(key, create(`p${n}`), 1)
    await expect(repository.commitLocal(key, create('p3'), 1)).rejects.toMatchObject({
      detail: { code: 'UPGRADE_REQUIRED' },
    })
    await repository.commitLocal(
      key,
      {
        kind: 'project.status',
        operationId: 'finish',
        createdAt: now,
        base: { revision: '1' },
        payload: { projectId: 'p0', status: 'finished', updatedAt: now },
      },
      1,
    )
    await repository.commitLocal(key, create('p3'), 1)
    expect((await repository.snapshot(key)).view.projects).toHaveLength(4)
    const legacy = { ...info(false, 'legacy'), legacyAccess: true }
    await repository.createCollection(legacy)
    await repository.activate({
      key: legacy.key,
      generation: 2,
      device: { id: 'device', generation: 'gen' },
    })
    for (let n = 0; n < 4; n++) await repository.commitLocal(legacy.key, create(`l${n}`), 2)
    expect((await repository.readView(legacy.key)).projects).toHaveLength(4)
  })
  it('does not treat a connected legacy flag as a paid entitlement', async () => {
    const { repository, key } = await setup(true)
    for (let n = 0; n < 3; n++) await repository.commitLocal(key, create(`p${n}`), 1)
    await expect(repository.commitLocal(key, create('p3'), 1)).rejects.toMatchObject({
      detail: { code: 'UPGRADE_REQUIRED' },
    })
    const upgraded = await open('test', true)
    await upgraded.commitLocal(key, create('p3'), 1)
    expect((await upgraded.readView(key)).projects).toHaveLength(4)
  })
})
describe('acknowledged shadow and pending overlay', () => {
  it('pull-before-ack removes only its matching intent and never duplicates the effect', async () => {
    const { repository, key } = await setup(true)
    await repository.commitLocal(key, create(), 1)
    const command = (await repository.pending(key))[0].command
    const ack = receipt(command.operationId, command.sha256)
    await repository.applyPage(
      key,
      {
        protocolVersion: 2,
        collectionId: key.collectionId,
        epoch: key.epoch,
        afterCursor: '0',
        nextCursor: '1',
        hasMore: false,
        entries: [ack],
      },
      1,
    )
    await repository.acknowledge(key, ack, 1)
    expect(await repository.pending(key)).toEqual([])
    expect((await repository.readView(key)).projects).toHaveLength(1)
    expect((await repository.readView(key)).cursor).toBe('1')
  })
  it('acknowledgement does not advance the contiguous pull cursor', async () => {
    const { repository, key } = await setup(true)
    await repository.commitLocal(key, create(), 1)
    const command = (await repository.pending(key))[0].command
    await repository.acknowledge(key, receipt(command.operationId, command.sha256, '9'), 1)
    expect((await repository.readView(key)).cursor).toBe('0')
  })
  it('rejects mismatched hash or a gapped page atomically', async () => {
    const { repository, key } = await setup(true)
    await repository.commitLocal(key, create(), 1)
    await expect(
      repository.acknowledge(key, receipt('create-project', '1'.repeat(64)), 1),
    ).rejects.toMatchObject({ detail: { code: 'OPERATION_REUSED' } })
    const view = await repository.readView(key)
    await expect(
      repository.applyPage(
        key,
        {
          protocolVersion: 2,
          collectionId: key.collectionId,
          epoch: key.epoch,
          afterCursor: '0',
          nextCursor: '2',
          hasMore: false,
          entries: [receipt('remote', '0'.repeat(64), '2')],
        },
        1,
      ),
    ).rejects.toMatchObject({ detail: { code: 'SYNC_PAGE_INVALID' } })
    expect(await repository.readView(key)).toEqual(view)
  })
  it('preserves local overlay over a remote edit and does not regress higher shadow revisions', async () => {
    const { repository, key } = await setup(true)
    await repository.acknowledge(key, receipt('remote', '0'.repeat(64)), 1)
    await repository.commitLocal(key, update(), 1)
    await repository.acknowledge(
      key,
      receipt('remote2', '1'.repeat(64), '3', [
        { kind: 'project.put', value: { ...project('project', '3'), name: 'Remote newer' } },
      ]),
      1,
    )
    expect((await repository.readView(key)).projects[0].name).toBe('Changed scarf')
    await repository.acknowledge(
      key,
      receipt('remote-old', '2'.repeat(64), '2', [
        { kind: 'project.put', value: { ...project('project', '2'), name: 'Remote old' } },
      ]),
      1,
    )
    const recovered = await repository.recoverPending(key, 'server-conflict')
    expect((await repository.readView(recovered)).projects[0].name).toBe('Changed scarf')
    expect((await repository.readView(key)).projects[0].name).toBe('Remote newer')
  })
  it('keeps a pending edit discoverable when a remote delete removes its target', async () => {
    const { repository, key } = await setup(true)
    await repository.acknowledge(key, receipt('remote', '0'.repeat(64)), 1)
    await repository.commitLocal(key, update(), 1)
    await repository.acknowledge(
      key,
      receipt('delete-remote', '1'.repeat(64), '2', [
        { kind: 'project.delete', id: 'project', revision: '2' },
      ]),
      1,
    )
    expect((await repository.readView(key)).projects[0].name).toBe('Changed scarf')
    await repository.acknowledge(key, receipt('old', '2'.repeat(64), '1'), 1)
    expect((await repository.readView(key)).projects[0].name).toBe('Changed scarf')
  })
  it('assigns ordered immutable predecessor operations for an offline create/edit chain', async () => {
    const { repository, key } = await setup(true)
    await repository.commitLocal(key, create(), 1)
    await repository.commitLocal(
      key,
      { ...update('0'), base: { afterOperationId: 'create-project' } },
      1,
    )
    const pending = await repository.pending(key)
    expect(pending.map((p) => p.command.sequence)).toEqual(['1', '2'])
    expect((await repository.readView(key)).projects[0].name).toBe('Changed scarf')
    await repository.acknowledge(
      key,
      receipt(pending[0].command.operationId, pending[0].command.sha256),
      1,
    )
    expect((await repository.readView(key)).projects[0].name).toBe('Changed scarf')
    expect(await repository.pending(key)).toHaveLength(1)
  })
})
describe('media, snapshots, copy and hydration', () => {
  it('pins real attachment bytes through deletion and releases only unreferenced bytes', async () => {
    const { repository, key } = await setup()
    await repository.commitLocal(key, create(), 1)
    const media = await repository.media.prepare(
      { bytes: dataUrlToBlob(png), kind: 'photo' },
      key,
      1,
    )
    await repository.commitLocal(
      key,
      {
        kind: 'checkpoint.create',
        operationId: 'cp',
        createdAt: now,
        base: { revision: '1' },
        payload: {
          updatedAt: now,
          checkpoint: {
            id: 'checkpoint',
            projectId: 'project',
            createdAt: now,
            position: 'row 2',
            toolSize: '4 mm',
            nextStep: 'Turn',
            notes: '',
            photo: media.ref,
          },
        },
      },
      1,
    )
    const snapshot = await repository.snapshot(key)
    await repository.commitLocal(
      key,
      {
        kind: 'project.delete',
        operationId: 'delete',
        createdAt: now,
        base: { revision: '2' },
        payload: { projectId: 'project' },
      },
      1,
    )
    await repository.media.release(media.ref, key, 1)
    expect(
      (await new Response(await repository.media.open(media.ref, key)).arrayBuffer()).byteLength,
    ).toBe(media.ref.bytes)
    await repository.releaseSnapshot(snapshot.id)
    await repository.media.release(media.ref, key, 1)
    await expect(repository.media.open(media.ref, key)).rejects.toMatchObject({
      detail: { code: 'BACKUP_INCOMPLETE' },
    })
  })
  it('verifies media hashes and isolates identical IDs in unrelated collection scopes', async () => {
    const { repository, key } = await setup()
    const media = await repository.media.prepare(
      { bytes: dataUrlToBlob(png), kind: 'photo' },
      key,
      1,
    )
    const other = info(false, 'other')
    await repository.createCollection(other)
    await expect(repository.media.open(media.ref, other.key)).rejects.toMatchObject({
      detail: { code: 'BACKUP_INCOMPLETE' },
    })
    await expect(
      repository.media.storeVerified(
        { ...media.ref, sha256: '0'.repeat(64) },
        dataUrlToBlob(png),
        key,
        1,
      ),
    ).rejects.toMatchObject({ detail: { code: 'MEDIA_INVALID' } })
    await repository.media.storeVerified(media.ref, dataUrlToBlob(png), other.key, 1)
    expect(await new Response(await repository.media.open(media.ref, other.key)).text()).toBe(
      await dataUrlToBlob(png).text(),
    )
  })
  it('rejects corrupted stored bytes at read boundary', async () => {
    const { repository, key } = await setup()
    const media = await repository.media.prepare(
      { bytes: dataUrlToBlob(png), kind: 'photo' },
      key,
      1,
    )
    await transaction(repository.database, 'readwrite', async (tx) => {
      const row = await requestResult<MediaRow>(
        tx.objectStore('media').get(mediaKey(key, media.ref.id)),
      )
      tx.objectStore('media').put({ ...row, bytes: new TextEncoder().encode('corrupted').buffer })
    })
    await expect(repository.media.open(media.ref, key)).rejects.toMatchObject({
      detail: { code: 'MEDIA_INVALID' },
    })
  })
  it('imports over-cap local backups without granting future commercial capacity and fences replacement', async () => {
    const { repository, key, collection } = await setup()
    await repository.importLocal(
      {
        info: { ...collection, legacyAccess: true },
        projects: Array.from({ length: 4 }, (_, i) => project(`p${i}`)),
        checkpoints: [],
        provenance: { kind: 'backup', sourceId: 'backup', capturedAt: now },
      },
      { generation: 1 },
    )
    expect((await repository.readView(key)).info.legacyAccess).toBe(false)
    await expect(repository.commitLocal(key, create('extra'), 1)).rejects.toMatchObject({
      detail: { code: 'UPGRADE_REQUIRED' },
    })
    await expect(
      repository.importLocal(
        {
          info: collection,
          projects: [],
          checkpoints: [],
          provenance: { kind: 'backup', sourceId: 'backup', capturedAt: now },
        },
        { generation: 1, replace: { key, revision: '0' } },
      ),
    ).rejects.toMatchObject({ detail: { code: 'REVISION_CONFLICT' } })
    expect((await repository.readView(key)).projects).toHaveLength(4)
  })
  it('retains a consistent named copy before scoped removal', async () => {
    const { repository, key } = await setup()
    await repository.commitLocal(key, create(), 1)
    const view = await repository.readView(key),
      copy = await repository.retainLocal(key, 'Kept scarf', view.revision, 1)
    await expect(repository.removeLocal(key, '0', 1)).rejects.toMatchObject({
      detail: { code: 'REVISION_CONFLICT' },
    })
    await repository.removeLocal(key, view.revision, 1)
    expect((await repository.readView(copy)).projects).toHaveLength(1)
    await expect(repository.readView(key)).rejects.toMatchObject({
      detail: { code: 'NOT_AVAILABLE' },
    })
  })
  it('validates all hydration pages before reader switch and permits missing remote bytes for text capture', async () => {
    const { repository, key } = await setup(true)
    const page: SnapshotManifest = {
      protocolVersion: 2,
      snapshotId: 'snapshot',
      after: null,
      collectionId: key.collectionId,
      epoch: key.epoch,
      cursor: '3',
      revision: '3',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      projects: [project('project', '3')],
      checkpoints: [],
      media: [],
      nextPage: null,
    }
    await repository.hydrate(key, [page], 1)
    const before = await repository.readView(key)
    await expect(
      repository.hydrate(
        key,
        [{ ...page, projects: [project('duplicate'), project('duplicate')] }],
        1,
      ),
    ).rejects.toBeTruthy()
    expect(await repository.readView(key)).toEqual(before)
    await repository.commitLocal(key, update('3'), 1)
    await expect(repository.hydrate(key, [page], 1)).rejects.toMatchObject({
      detail: { code: 'SYNC_REBASE_REQUIRED' },
    })
  })
})

it('requires a new session generation for device changes and starts that device sequence at one', async () => {
  const { repository, key } = await setup(true)
  await repository.commitLocal(key, create(), 1)
  await expect(
    repository.activate({
      key,
      generation: 1,
      device: { id: 'new-device', generation: 'new-gen' },
    }),
  ).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  await repository.activate({
    key,
    generation: 2,
    device: { id: 'new-device', generation: 'new-gen' },
  })
  await repository.commitLocal(key, create('other'), 2)
  const pending = await repository.pending(key)
  expect(pending.map((p) => [p.command.deviceId, p.command.sequence])).toEqual([
    ['device', '1'],
    ['new-device', '1'],
  ])
})
it('local predecessor receipts resolve in the actual collection epoch', async () => {
  const { repository, key } = await setup()
  await repository.commitLocal(key, create(), 1)
  await repository.commitLocal(
    key,
    { ...update(), base: { afterOperationId: 'create-project' } },
    1,
  )
  expect((await repository.readView(key)).projects[0].name).toBe('Changed scarf')
})
it('never restores an acknowledged target merely because unrelated pending work remains', async () => {
  const { repository, key } = await setup(true)
  await repository.acknowledge(key, receipt('remote', '0'.repeat(64)), 1)
  await repository.commitLocal(key, update(), 1)
  await repository.commitLocal(key, create('other'), 1)
  const pending = (await repository.pending(key)).find((p) => p.intent.operationId === 'update')!
  await repository.acknowledge(
    key,
    receipt('update', pending.command.sha256, '2', [
      { kind: 'project.put', value: { ...project('project', '2'), ...fields } },
    ]),
    1,
  )
  await repository.acknowledge(
    key,
    receipt('remote-delete', '1'.repeat(64), '3', [
      { kind: 'project.delete', id: 'project', revision: '3' },
    ]),
    1,
  )
  expect((await repository.readView(key)).projects.map((p) => p.id)).toEqual(['other'])
})
it('a retained/imported local revision clock remains greater than copied server revisions', async () => {
  const { repository, key, collection } = await setup()
  await repository.importLocal(
    {
      info: collection,
      projects: [project('project', '9000')],
      checkpoints: [],
      provenance: { kind: 'backup', sourceId: 'backup', capturedAt: now },
    },
    { generation: 1 },
  )
  await repository.commitLocal(key, update('9000'), 1)
  expect((await repository.readView(key)).projects[0].revision).toBe('9002')
})
