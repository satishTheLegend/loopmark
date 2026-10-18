import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openBrowserRepository } from '../repositories/browser/repository'
import { prepareBrowserStorage, prepareNativeStorage } from './startup'
import { create, now } from '../repositories/browser/fixtures.test-support'
import { createBrowserDraftStore } from '../repositories/browser/draft-store'

describe('durable application startup', () => {
  it('fences legacy writers and reopens the same selection, records and drafts', async () => {
    const factory = new IDBFactory()
    const first = await openBrowserRepository({ factory })
    const scope = await prepareBrowserStorage(first, factory)
    await first.commitLocal(scope.key, create(), scope.generation)
    await createBrowserDraftStore(first, scope).write('new', undefined, {
      key: 'new',
      revision: 'draft-one',
      value: { name: 'Next project', createdAt: now },
    })
    await first.close()
    const reopened = await openBrowserRepository({ factory })
    expect(await prepareBrowserStorage(reopened, factory)).toEqual(scope)
    expect((await reopened.readView(scope.key)).projects).toHaveLength(1)
    expect((await createBrowserDraftStore(reopened, scope).read('new'))?.revision).toBe('draft-one')
    expect((await factory.databases()).find((db) => db.name === 'loopmark')?.version).toBe(2)
    await reopened.close()
  })
  it('native bootstrap reuses a collection created before a process interruption', async () => {
    // Shared bootstrap port; native SQLite execution is separately covered by the native harness.
    const repository = await openBrowserRepository({ factory: new IDBFactory() })
    await repository.createCollection({
      key: { namespace: 'local', collectionId: 'personal', epoch: 'initial' },
      name: 'Personal projects',
      kind: 'guest',
      accountId: null,
      createdAt: now,
      legacyAccess: false,
    })
    const scope = await prepareNativeStorage(repository)
    expect(await prepareNativeStorage(repository)).toEqual(scope)
    expect(await repository.listCollections()).toHaveLength(1)
    await repository.close()
  })
})
