import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Project } from '../../domain/contracts'
import { openBrowserRepository, type BrowserRepository } from './repository'
import {
  migrateLegacy,
  readLegacySnapshot,
  readMigrationSelection,
  readMigratedDraft,
  portableProjects,
} from './migration'
import { info, now, project, png, wav } from './fixtures.test-support'

let factory: IDBFactory, repository: BrowserRepository
const device = { id: 'device', generation: 'gen' }
function legacyProject(): Project {
  const { revision: _revision, ...fields } = project()
  return {
    ...fields,
    checkpoints: [
      {
        id: 'checkpoint',
        createdAt: now,
        position: 'row 4',
        toolSize: '4 mm',
        nextStep: 'Turn',
        notes: '',
        photo: png,
        voice: wav,
      },
    ],
  }
}
async function seed(projects = [legacyProject()], version = 1) {
  const create = (name: string, stores: string[], rows: Record<string, unknown[]>) =>
    new Promise<void>((resolve, reject) => {
      const req = factory.open(name, version)
      req.onupgradeneeded = () => {
        for (const store of stores)
          req.result.createObjectStore(store, { keyPath: store === 'projects' ? 'id' : 'key' })
      }
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result,
          tx = db.transaction(stores, 'readwrite')
        for (const store of stores) for (const row of rows[store]) tx.objectStore(store).put(row)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  await create('legacy', ['projects', 'meta'], {
    projects,
    meta: [
      {
        key: 'library',
        revision: 'old-revision',
        projects: projects.length,
        checkpoints: projects.length,
        bytes: 123,
      },
    ],
  })
  await create('legacy-drafts', ['drafts'], {
    drafts: [
      {
        key: 'checkpoint:project',
        revision: 'draft-revision',
        baseRevision: now,
        value: {
          position: '',
          toolSize: '4 mm',
          nextStep: '',
          notes: 'Unfinished',
          photo: undefined,
          voice: wav,
        },
      },
    ],
  })
}
const run = () =>
  migrateLegacy({
    repository,
    factory,
    sourceNames: { projects: 'legacy', drafts: 'legacy-drafts' },
    destination: info(),
    generation: 1,
    device,
  })
beforeEach(async () => {
  factory = new IDBFactory()
  repository = await openBrowserRepository({ factory, databaseName: 'destination' })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await repository.close()
})
it('copies records, every media byte and incomplete draft before durable selection, retaining original sources', async () => {
  await seed()
  const before = await readLegacySnapshot(factory, { projects: 'legacy', drafts: 'legacy-drafts' })
  const receipt = await run()
  expect(receipt).toMatchObject({
    status: 'selected',
    projectCount: 1,
    checkpointCount: 1,
    draftCount: 1,
    sourceRevision: 'old-revision',
    sources: { projects: 2, drafts: 2 },
  })
  expect(receipt.media).toHaveLength(2)
  expect(await portableProjects(repository, info().key)).toEqual(before.projects)
  expect(await readMigratedDraft(repository, info().key, 'checkpoint:project')).toEqual(
    before.drafts[0],
  )
  const after = await readLegacySnapshot(factory, { projects: 'legacy', drafts: 'legacy-drafts' })
  expect(after.projects).toEqual(before.projects)
  expect(after.drafts).toEqual(before.drafts)
  expect(after.metadata).toEqual(before.metadata)
  expect(await readMigrationSelection(repository)).toEqual(info().key)
  const reopened = await openBrowserRepository({ factory, databaseName: 'destination' })
  expect(await readMigrationSelection(reopened)).toEqual(info().key)
  await reopened.close()
  expect(await run()).toEqual(receipt)
})
it('discovery does not create stores; deliberate absent-store fences never grant legacy capacity', async () => {
  await readLegacySnapshot(factory, { projects: 'legacy', drafts: 'legacy-drafts' })
  expect((await factory.databases()).map((d) => d.name)).toEqual(['destination'])
  const result = await run()
  expect(result.originalSources).toEqual({ projects: null, drafts: null })
  expect(result.sources).toEqual({ projects: 2, drafts: 2 })
  expect((await repository.readView(info().key)).info.legacyAccess).toBe(false)
  expect((await factory.databases()).map((d) => d.name).sort()).toEqual([
    'destination',
    'legacy',
    'legacy-drafts',
  ])
})
it('freezes from the actual current source version rather than assuming version 1', async () => {
  await seed(undefined, 7)
  expect((await run()).sources).toEqual({ projects: 8, drafts: 8 })
})
it('refuses corrupt/poisoned legacy dates without switching or discarding originals', async () => {
  const bad = legacyProject()
  bad.updatedAt = '+275760-09-13T00:00:00.000Z'
  await seed([bad])
  await expect(run()).rejects.toMatchObject({ detail: { code: 'BACKUP_INVALID' } })
  expect(await readMigrationSelection(repository)).toBeNull()
  expect(await repository.listCollections()).toEqual([])
  const raw = await new Promise<Project>((resolve, reject) => {
    const r = factory.open('legacy')
    r.onsuccess = () => {
      const db = r.result,
        q = db.transaction('projects').objectStore('projects').get('project')
      q.onsuccess = () => {
        db.close()
        resolve(q.result)
      }
    }
    r.onerror = () => reject(r.error)
  })
  expect(raw.updatedAt).toBe(bad.updatedAt)
})
for (const store of ['collections', 'media', 'drafts', 'migrations'])
  it(`aborts the copy atomically if ${store} storage fails`, async () => {
    await seed()
    const original = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const result = original.call(this, value, key)
      if (this.transaction.db.name === 'destination' && this.name === store)
        this.transaction.abort()
      return result
    })
    await expect(run()).rejects.toMatchObject({ detail: { code: 'LOCAL_STORAGE_FAILED' } })
    spy.mockRestore()
    expect(await repository.listCollections()).toEqual([])
    expect(await readMigrationSelection(repository)).toBeNull()
    expect(
      (await readLegacySnapshot(factory, { projects: 'legacy', drafts: 'legacy-drafts' })).projects,
    ).toEqual([legacyProject()])
    expect((await run()).status).toBe('selected')
  })
it('a failed selection retains a complete verified copy and retry switches only once', async () => {
  await seed()
  const original = IDBObjectStore.prototype.put
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const result = original.call(this, value, key)
    if (this.transaction.db.name === 'destination' && this.name === 'meta') this.transaction.abort()
    return result
  })
  await expect(run()).rejects.toMatchObject({ detail: { code: 'LOCAL_STORAGE_FAILED' } })
  spy.mockRestore()
  expect(await readMigrationSelection(repository)).toBeNull()
  expect(await portableProjects(repository, info().key)).toEqual([legacyProject()])
  expect((await run()).status).toBe('selected')
})
it('blocks while an old connection refuses versionchange, then prevents explicit old-version writers', async () => {
  await seed()
  const held = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open('legacy', 1)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  await expect(run()).rejects.toMatchObject({ detail: { code: 'LOCAL_STORAGE_FAILED' } })
  expect(await readMigrationSelection(repository)).toBeNull()
  held.close()
  // The abandoned upgrade must abort instead of later switching the source version.
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect((await run()).status).toBe('selected')
  await expect(
    new Promise((resolve, reject) => {
      const r = factory.open('legacy', 1)
      r.onsuccess = () => {
        r.result.close()
        resolve(null)
      }
      r.onerror = () => reject(r.error)
    }),
  ).rejects.toMatchObject({ name: 'VersionError' })
})

it('retains original absence across crash/retry after creating the explicit fence', async () => {
  const original = IDBObjectStore.prototype.put
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const result = original.call(this, value, key)
    if (this.transaction.db.name === 'destination' && this.name === 'collections')
      this.transaction.abort()
    return result
  })
  await expect(run()).rejects.toMatchObject({ detail: { code: 'LOCAL_STORAGE_FAILED' } })
  spy.mockRestore()
  const result = await run()
  expect(result.originalSources).toEqual({ projects: null, drafts: null })
  expect((await repository.readView(info().key)).info.legacyAccess).toBe(false)
})
