import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import type { PullPage } from '../../domain/contracts'
import { createBrowserDraftStore } from './draft-store'
import { create, info, receipt } from './fixtures.test-support'
import { openBrowserRepository, type BrowserRepository } from './repository'

const opened: BrowserRepository[] = []
afterEach(async () => {
  for (const repo of opened.splice(0)) await repo.close()
})
async function setup(connected = true) {
  const repo = await openBrowserRepository({ factory: new IDBFactory() })
  opened.push(repo)
  const collection = info(connected)
  const scope = {
    key: collection.key,
    generation: 1,
    device: { id: 'device', generation: 'device-generation' },
  }
  await repo.createCollection(collection)
  await repo.activate(scope)
  await repo.commitLocal(scope.key, create(), scope.generation)
  const draft = { key: 'checkpoint:project', revision: 'draft-1', value: { nextStep: 'Keep me' } }
  await createBrowserDraftStore(repo, scope).write(draft.key, undefined, draft)
  const page: PullPage = {
    protocolVersion: 2,
    collectionId: scope.key.collectionId,
    epoch: scope.key.epoch,
    afterCursor: '0',
    nextCursor: '0',
    hasMore: false,
    entries: [],
  }
  return { repo, scope, page, draft }
}

it('an unchanged empty pull preserves a device review, pending work, drafts and subscribers', async () => {
  const { repo, scope, page, draft } = await setup()
  const review = await repo.reviewLocal(scope.key)
  const view = await repo.readView(scope.key)
  const changed = vi.fn()
  const unsubscribe = repo.subscribe(changed)
  try {
    await repo.applyPage(scope.key, page, scope.generation)
    expect(await repo.reviewLocal(scope.key)).toEqual(review)
    expect(await repo.readView(scope.key)).toEqual(view)
    expect(await createBrowserDraftStore(repo, scope).read(draft.key)).toEqual(draft)
    expect(changed).not.toHaveBeenCalled()
    await expect(repo.transition(scope, scope, review)).resolves.toMatchObject({ generation: 2 })
  } finally {
    unsubscribe()
  }
})

it('an empty pull still rejects stale generation, wrong collection/epoch/cursor and malformed progress', async () => {
  const { repo, scope, page } = await setup()
  const before = await repo.readView(scope.key)
  for (const [input, generation, code] of [
    [page, 0, 'ACCOUNT_CHANGED'],
    [{ ...page, collectionId: 'other' }, 1, 'SYNC_REBASE_REQUIRED'],
    [{ ...page, epoch: 'other' }, 1, 'SYNC_REBASE_REQUIRED'],
    [{ ...page, afterCursor: '1', nextCursor: '1' }, 1, 'SYNC_PAGE_INVALID'],
    [{ ...page, nextCursor: '1' }, 1, 'SYNC_PAGE_INVALID'],
    [{ ...page, hasMore: true }, 1, 'SYNC_PAGE_INVALID'],
  ] as const) {
    await expect(repo.applyPage(scope.key, input, generation)).rejects.toMatchObject({
      detail: { code },
    })
    expect(await repo.readView(scope.key)).toEqual(before)
  }
})

it('a pull is unavailable to guest collections even if it has no changes', async () => {
  const { repo, scope, page } = await setup(false)
  await expect(repo.applyPage(scope.key, page, scope.generation)).rejects.toMatchObject({
    detail: { code: 'VALIDATION' },
  })
})

it.each([false, true])(
  'a real receipt/cursor advance invalidates review (already acknowledged: %s)',
  async (acknowledged) => {
    const { repo, scope, page, draft } = await setup()
    const command = (await repo.pending(scope.key))[0].command
    const ack = receipt(command.operationId, command.sha256)
    if (acknowledged) await repo.acknowledge(scope.key, ack, scope.generation)
    const review = await repo.reviewLocal(scope.key)
    await repo.applyPage(scope.key, { ...page, nextCursor: '1', entries: [ack] }, scope.generation)
    const view = await repo.readView(scope.key)
    expect(view.cursor).toBe('1')
    expect(view.pending).toEqual([])
    expect(view.projects).toHaveLength(1)
    expect(BigInt(view.revision)).toBeGreaterThan(BigInt(review.revision))
    expect(await createBrowserDraftStore(repo, scope).read(draft.key)).toEqual(draft)
    await expect(repo.transition(scope, scope, review)).rejects.toMatchObject({
      detail: { code: 'REVISION_CONFLICT' },
    })
  },
)
