import { IDBFactory } from 'fake-indexeddb'
import { expect, it } from 'vitest'
import { openBrowserRepository } from './repository'
import { createBrowserDraftStore } from './draft-store'
import { info, create } from './fixtures.test-support'
it('selection CAS fences old callbacks and rejects unseen drafts or changed project reviews', async () => {
  const factory = new IDBFactory(),
    repo = await openBrowserRepository({ factory, databaseName: 'transitions' }),
    other = await openBrowserRepository({ factory, databaseName: 'transitions' })
  try {
    const collection = info()
    await repo.createCollection(collection)
    const target = { key: collection.key, device: { id: 'device', generation: 'gen' } },
      first = await repo.transition(null, target)
    const review = await repo.reviewLocal(target.key),
      drafts = createBrowserDraftStore(repo, first)
    await drafts.write('new', undefined, {
      key: 'new',
      revision: 'draft1',
      value: { name: 'unfinished' },
    })
    await expect(repo.transition(first, target, review)).rejects.toMatchObject({
      detail: { code: 'REVISION_CONFLICT' },
    })
    const reviewed = await repo.reviewLocal(target.key)
    const next = await other.transition(first, target, reviewed)
    await expect(
      drafts.write('new', 'draft1', { key: 'new', revision: 'draft2', value: {} }),
    ).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
    await expect(repo.transition(first, target)).rejects.toMatchObject({
      detail: { code: 'ACCOUNT_CHANGED' },
    })
    await other.commitLocal(target.key, create(), next.generation)
    await expect(repo.transition(next, target, reviewed)).rejects.toMatchObject({
      detail: { code: 'REVISION_CONFLICT' },
    })
    const retained = await repo.retainLocal(
      target.key,
      'Kept',
      (await repo.readView(target.key)).revision,
      next.generation,
    )
    const selected = await repo.transition(next, { key: retained, device: target.device })
    expect(await createBrowserDraftStore(repo, selected).read('new')).toMatchObject({
      revision: 'draft1',
      value: { name: 'unfinished' },
    })
  } finally {
    await repo.close()
    await other.close()
  }
})
