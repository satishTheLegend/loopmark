import { IDBFactory } from 'fake-indexeddb'
import { expect, it } from 'vitest'
import { openBrowserRepository } from './repository'
import { createBrowserWorkflowStore } from './workflow-store'
import { info } from './fixtures.test-support'
it('persists immutable ownership, rejects stale CAS and the same-generation changed device, and keeps deletion receipts after collection removal', async () => {
  const factory = new IDBFactory(),
    databaseName = crypto.randomUUID(),
    repo = await openBrowserRepository({ factory, databaseName })
  const collection = info(),
    scope = { key: collection.key, generation: 1, device: { id: 'device', generation: 'g' } }
  await repo.createCollection(collection)
  await repo.activate(scope)
  const store = createBrowserWorkflowStore(repo),
    entry = {
      kind: 'upload' as const,
      accountId: 'account',
      collection: scope.key,
      value: { requestId: 'request' },
    }
  const first = await store.write('workflow', null, entry, scope)
  await expect(store.write('workflow', null, entry, scope)).rejects.toMatchObject({
    detail: { code: 'REVISION_CONFLICT' },
  })
  await expect(
    store.write('workflow', first.revision, { ...entry, accountId: 'other' }, scope),
  ).rejects.toMatchObject({ detail: { code: 'OPERATION_REUSED' } })
  await expect(
    store.write('workflow', first.revision, entry, {
      ...scope,
      device: { id: 'other', generation: 'g' },
    }),
  ).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  await store.write(
    'deletion',
    null,
    {
      kind: 'deletion',
      accountId: 'account',
      collection: null,
      value: { requestId: 'delete', receiptToken: 'a'.repeat(64) },
    },
    scope,
  )
  await repo.close()
  const reopened = await openBrowserRepository({ factory, databaseName }),
    fresh = createBrowserWorkflowStore(reopened)
  expect(await fresh.read('workflow')).toEqual(first)
  const view = await reopened.readView(scope.key)
  await reopened.removeLocal(scope.key, view.revision, 1)
  expect(await fresh.read('workflow')).toBeNull()
  expect(await fresh.list('deletion')).toHaveLength(1)
  await reopened.close()
})
