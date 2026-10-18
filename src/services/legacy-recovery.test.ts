import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { readLegacyBackup } from './legacy-recovery'
import { project } from '../repositories/browser/fixtures.test-support'

it('reads a fenced old collection without writing or depending on malformed drafts', async () => {
  const factory = new IDBFactory()
  const original = { ...project(), checkpoints: [] }
  const { revision: _revision, ...portable } = original
  const db = await new Promise<IDBDatabase>((resolve) => {
    const r = factory.open('loopmark', 4)
    r.onupgradeneeded = () => {
      r.result.createObjectStore('projects', { keyPath: 'id' }).put(portable)
      r.result
        .createObjectStore('loopmark_migration_fence', { keyPath: 'key' })
        .put({ key: 'original', originalVersion: 1 })
    }
    r.onsuccess = () => resolve(r.result)
  })
  const result = await readLegacyBackup(factory)
  expect(result.projects).toEqual([portable])
  expect(db.version).toBe(4)
  expect([...db.objectStoreNames]).toEqual(['loopmark_migration_fence', 'projects'])
  db.close()
})
it('does not create an empty legacy database when none exists', async () => {
  const factory = new IDBFactory()
  await expect(readLegacyBackup(factory)).rejects.toMatchObject({
    detail: { code: 'NOT_AVAILABLE' },
  })
  expect(await factory.databases()).toEqual([])
})
