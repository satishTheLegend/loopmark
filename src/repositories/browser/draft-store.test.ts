import { IDBFactory } from 'fake-indexeddb'
import { expect, it } from 'vitest'
import { openBrowserRepository } from './repository'
import { createBrowserDraftStore } from './draft-store'
import { info } from './fixtures.test-support'
it('keeps incomplete media drafts scope-bound, CAS-protected and outside saved snapshots', async () => {
  const repository = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: 'draft-contract',
  })
  const collection = info(),
    scope = { key: collection.key, generation: 1, device: { id: 'device', generation: 'gen' } }
  await repository.createCollection(collection)
  await repository.activate(scope)
  const drafts = createBrowserDraftStore(repository, scope)
  const draft = { key: 'new', revision: 'draft-one', value: { name: '', photo: undefined } }
  await drafts.write('new', undefined, draft)
  expect(await drafts.read('new')).toEqual(draft)
  await expect(
    drafts.write('new', undefined, { ...draft, revision: 'other' }),
  ).rejects.toMatchObject({ detail: { code: 'REVISION_CONFLICT' } })
  const snapshot = await repository.snapshot(collection.key)
  expect(snapshot.view.projects).toEqual([])
  expect(snapshot.media).toEqual([])
  const other = info(false, 'other')
  await repository.createCollection(other)
  await repository.activate({ ...scope, key: other.key, generation: 2 })
  await expect(
    drafts.write('new', 'draft-one', { ...draft, revision: 'late' }),
  ).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  await expect(drafts.read('new')).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  const newDrafts = createBrowserDraftStore(repository, { ...scope, key: other.key, generation: 2 })
  expect(await newDrafts.read('new')).toBeUndefined()
  await repository.close()
})
