import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from './repository'
import { createBrowserDraftStore } from './draft-store'
import { createBrowserWorkflowStore } from './workflow-store'
import { create, info, now, project, png } from './fixtures.test-support'
import { mediaKey, transaction, requestResult } from './schema'
import { describeInline } from '../../services/media-codec'
import { keyOf } from '../state'
import type { AccountSession, SessionScope, SnapshotManifest } from '../../domain/contracts'
const repos: BrowserRepository[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of repos.splice(0)) await repo.close()
})
async function setup(changedEpoch = false) {
  const repo = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: crypto.randomUUID(),
  })
  repos.push(repo)
  const collection = { ...info(true), key: { ...info(true).key, namespace: 'account_account' } }
  await repo.createCollection(collection)
  const scope: SessionScope = {
    key: collection.key,
    generation: 1,
    device: { id: 'device', generation: 'retired' },
  }
  await repo.activate(scope)
  const media = await describeInline(png, 'photo')
  await repo.media.storeVerified(media.ref, media.bytes, scope.key, 1)
  const page: SnapshotManifest = {
    protocolVersion: 2,
    snapshotId: 'source',
    collectionId: scope.key.collectionId,
    epoch: scope.key.epoch,
    cursor: '2',
    revision: '2',
    expiresAt: '2030-01-01T00:00:00.000Z',
    after: null,
    nextPage: null,
    projects: [project('server', '2')],
    checkpoints: [
      {
        id: 'cp',
        projectId: 'server',
        revision: '2',
        createdAt: now,
        toolSize: '4mm',
        position: '2',
        nextStep: 'Saved step',
        notes: '',
        photo: media.ref,
      },
    ],
    media: [media.ref],
  }
  await repo.hydrate(scope.key, [page], 1)
  await repo.commitLocal(scope.key, create('local'), 1)
  await repo.markAttempt(scope.key, 'create-local', 1)
  const drafts = createBrowserDraftStore(repo, scope)
  await drafts.write('new-project', undefined, {
    key: 'new-project',
    revision: 'draft',
    value: { name: 'Unsent draft', photo: png },
  })
  const workflows = createBrowserWorkflowStore(repo)
  await workflows.write(
    'upload-work',
    null,
    {
      kind: 'upload',
      accountId: 'account',
      collection: scope.key,
      value: { immutable: 'old command continuation' },
    },
    scope,
  )
  const session: AccountSession = {
    accountId: 'account',
    billingPrincipalId: 'principal',
    deletionGeneration: '0',
    device: { id: 'device', generation: 'registered' },
    collection: { ...scope.key, epoch: changedEpoch ? 'new-epoch' : scope.key.epoch },
    expiresAt: page.expiresAt,
  }
  const next = {
    ...page,
    snapshotId: 'fresh',
    epoch: session.collection.epoch,
    cursor: '20',
    revision: '20',
    projects: [{ ...project('server', '20'), name: 'Current account version' }],
  }
  const review = await repo.reviewLocal(scope.key)
  const input = {
    session,
    pages: [next],
    recoveryId: crypto.randomUUID(),
    recoveryName: 'Recovered device work',
  }
  return { repo, scope, review, input, drafts, media, workflows }
}
it.each([false, true])(
  'atomically keeps overlay, draft, history, media and immutable attempts before fresh publication (new epoch=%s)',
  async (changed) => {
    const { repo, scope, review, input, workflows, media } = await setup(changed)
    const before = await repo.readView(scope.key)
    const result = await repo.completeRebase(scope, review, input)
    expect(result.scope).toEqual({
      key: input.session.collection,
      device: input.session.device,
      generation: 2,
    })
    expect(await repo.readActive()).toEqual(result.scope)
    const fresh = await repo.readView(result.scope.key),
      copy = await repo.readView(result.recovered)
    expect(fresh.cursor).toBe('20')
    expect(fresh.hydration).toBe('ready')
    expect(fresh.pending).toEqual([])
    expect(fresh.projects.map((p) => p.name)).toEqual(['Current account version'])
    expect(copy.projects).toEqual(before.projects)
    expect(copy.checkpoints).toEqual(before.checkpoints)
    expect(copy.pending).toEqual([])
    expect((await repo.reviewLocal(result.recovered)).drafts).toEqual(review.drafts)
    expect((await repo.reviewLocal(result.scope.key)).drafts).toEqual([])
    expect(await workflows.list('upload')).toEqual([])
    const archive = await transaction(repo.database, 'readonly', (tx) =>
      requestResult(
        tx.objectStore('meta').get(JSON.stringify(['rebase-archive', input.recoveryId])),
      ),
    )
    expect(archive.value.source.pending).toEqual(before.pending)
    expect(archive.value.metadata[0].value.value).toEqual({ immutable: 'old command continuation' })
    expect(
      await new Response(await repo.media.open(media.ref, result.recovered)).arrayBuffer(),
    ).toEqual(await media.bytes.arrayBuffer())
    await repo.media.release(media.ref, result.recovered, result.scope.generation)
    await expect(repo.media.open(media.ref, result.recovered)).resolves.toBeInstanceOf(
      ReadableStream,
    )
    expect(await repo.completeRebase(scope, review, input)).toEqual(result)
    expect(await repo.listCollections()).toHaveLength(2)
    await expect(
      repo.completeRebase(scope, review, { ...input, recoveryName: 'changed retry' }),
    ).rejects.toMatchObject({ detail: { code: 'OPERATION_REUSED' } })
  },
)
it('a final IDB transaction abort preserves source selection, attempted outbox, draft and workflow', async () => {
  const { repo, scope, review, input, workflows } = await setup()
  const before = await repo.readView(scope.key)
  const put = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    const result = put.call(this, value, key)
    if (this.name === 'collections') this.transaction.abort()
    return result
  })
  await expect(repo.completeRebase(scope, review, input)).rejects.toMatchObject({
    detail: { code: 'LOCAL_STORAGE_FAILED' },
  })
  expect(await repo.readActive()).toEqual(scope)
  expect(await repo.readView(scope.key)).toEqual(before)
  expect(await repo.reviewLocal(scope.key)).toEqual(review)
  expect(await workflows.list('upload')).toHaveLength(1)
  expect(await repo.listCollections()).toHaveLength(1)
})
it('compares the complete draft set and full session scope, not only the source revision', async () => {
  const { repo, scope, review, input, drafts } = await setup()
  await drafts.write('checkpoint:server', undefined, {
    key: 'checkpoint:server',
    revision: 'late',
    value: { nextStep: 'Do not lose me' },
  })
  await expect(repo.completeRebase(scope, review, input)).rejects.toMatchObject({
    detail: { code: 'REVISION_CONFLICT' },
  })
  const latest = await repo.reviewLocal(scope.key)
  await repo.transition(scope, {
    key: scope.key,
    device: { ...scope.device, generation: 'other-tab' },
  })
  await expect(repo.completeRebase(scope, latest, input)).rejects.toMatchObject({
    detail: { code: 'ACCOUNT_CHANGED' },
  })
  expect(await repo.listCollections()).toHaveLength(1)
})
it('requires explicit missing-byte acknowledgement and never relaxes referenced draft bytes', async () => {
  const { repo, scope, review, input, media } = await setup()
  await transaction(repo.database, 'readwrite', (tx) =>
    tx.objectStore('media').delete(mediaKey(scope.key, media.ref.id)),
  )
  await expect(repo.completeRebase(scope, review, input)).rejects.toMatchObject({
    detail: { code: 'BACKUP_INCOMPLETE' },
  })
  await transaction(repo.database, 'readwrite', async (tx) => {
    const key = JSON.stringify([keyOf(scope.key), 'new-project'])
    const draft = await requestResult(tx.objectStore('drafts').get(key))
    tx.objectStore('drafts').put({ ...draft, media: [media.ref] })
  })
  await expect(
    repo.completeRebase(scope, review, { ...input, allowMissingMedia: true }),
  ).rejects.toMatchObject({ detail: { code: 'BACKUP_INCOMPLETE' } })
  await transaction(repo.database, 'readwrite', async (tx) => {
    const key = JSON.stringify([keyOf(scope.key), 'new-project'])
    const draft = await requestResult(tx.objectStore('drafts').get(key))
    tx.objectStore('drafts').put({ ...draft, media: [] })
  })
  const result = await repo.completeRebase(scope, review, { ...input, allowMissingMedia: true })
  expect((await repo.readView(result.recovered)).checkpoints[0].photo).toEqual(media.ref)
  await expect(repo.media.open(media.ref, result.recovered)).rejects.toMatchObject({
    detail: { code: 'BACKUP_INCOMPLETE' },
  })
})
it('rejects a replacement prepared after review, invalid pagination and a populated new-epoch destination', async () => {
  const { repo, scope, review, input, workflows } = await setup(true)
  await workflows.write(
    'candidate',
    null,
    {
      kind: 'candidate',
      accountId: 'account',
      collection: scope.key,
      value: { phase: 'prepared', preview: { destination: { key: scope.key } } },
    },
    scope,
  )
  expect(await repo.rebaseBlocked(scope.key)).toBe(true)
  await expect(repo.completeRebase(scope, review, input)).rejects.toMatchObject({
    detail: { code: 'SYNC_REBASE_REQUIRED' },
  })
  const row = (await workflows.list('candidate'))[0]
  await workflows.remove(row.id, row.revision, scope)
  await expect(
    repo.completeRebase(scope, review, {
      ...input,
      pages: [{ ...input.pages[0], after: 'missing-page' }],
    }),
  ).rejects.toMatchObject({ detail: { code: 'SYNC_PAGE_INVALID' } })
  await repo.createCollection({ ...info(true), key: input.session.collection })
  const atDestination = await repo.transition(scope, {
    key: input.session.collection,
    device: scope.device,
  })
  await repo.hydrate(input.session.collection, input.pages, atDestination.generation)
  const returned = await repo.transition(atDestination, { key: scope.key, device: scope.device })
  await expect(repo.completeRebase(returned, review, input)).rejects.toMatchObject({
    detail: { code: 'REVISION_CONFLICT' },
  })
  expect(await repo.readActive()).toEqual(returned)
})

it('keeps the per-device sequence above its previous maximum when feed expiry returns the same registration', async () => {
  const { repo, scope, review, input } = await setup()
  input.session.device = scope.device
  const old = (await repo.pending(scope.key))[0].command
  const result = await repo.completeRebase(scope, review, input)
  await repo.commitLocal(result.scope.key, create('new-after-rebase'), result.scope.generation)
  const next = (await repo.pending(result.scope.key))[0].command
  expect(BigInt(next.sequence)).toBeGreaterThan(BigInt(old.sequence))
  expect(next.deviceGeneration).toBe(old.deviceGeneration)
  expect(next.operationId).not.toBe(old.operationId)
})
