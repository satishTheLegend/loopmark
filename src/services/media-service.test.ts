import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { createBrowserWorkflowStore } from '../repositories/browser/workflow-store'
import { info, png } from '../repositories/browser/fixtures.test-support'
import { describeInline } from './media-codec'
import { createRemoteMediaService } from './media-service'
import type { AccountSession, SessionScope } from '../domain/contracts'
import { mediaKey, requestResult, transaction } from '../repositories/browser/schema'
const opened: BrowserRepository[] = []
afterEach(async () => {
  for (const repo of opened.splice(0)) await repo.close()
})
async function setup() {
  const repo = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: crypto.randomUUID(),
  })
  opened.push(repo)
  const collection = info(true),
    scope: SessionScope = {
      key: collection.key,
      generation: 1,
      device: { id: 'device', generation: 'g' },
    }
  await repo.createCollection(collection)
  await repo.activate(scope)
  const session: AccountSession = {
    accountId: 'account',
    billingPrincipalId: 'principal',
    collection: scope.key,
    device: scope.device,
    deletionGeneration: '0',
    expiresAt: '2030-01-01T00:00:00.000Z',
  }
  const media = await describeInline(png, 'photo'),
    transport = {
      reserve: vi.fn(async () => ({
        id: 'reservation',
        collectionId: scope.key.collectionId,
        epoch: scope.key.epoch,
        media: media.ref,
        expiresAt: '2030-01-01T00:00:00.000Z',
        deletionGeneration: '0',
      })),
      upload: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      download: vi.fn(async () => media.bytes),
    }
  const options = {
    repository: repo,
    media: repo.media,
    transport,
    workflows: createBrowserWorkflowStore(repo),
    current: () => session,
  }
  return {
    repo,
    scope,
    session,
    transport,
    media,
    options,
    service: createRemoteMediaService(options),
  }
}
it('reuses a persisted verified upload after service restart without sending bytes twice', async () => {
  const { repo, scope, service, options, transport, media } = await setup()
  await repo.media.storeVerified(media.ref, media.bytes, scope.key, 1)
  const input = {
    scope,
    source: scope.key,
    sourceRef: media.ref,
    ref: media.ref,
    operationId: 'checkpoint',
  }
  await service.upload(input, new AbortController().signal)
  await createRemoteMediaService(options).upload(input, new AbortController().signal)
  expect(transport.reserve).toHaveBeenCalledTimes(1)
  expect(transport.upload).toHaveBeenCalledTimes(1)
  expect((await options.workflows.list<{ verified: boolean }>('upload'))[0].value.verified).toBe(
    true,
  )
})
it('downloads missing media once and fences an account switch before persisting late bytes', async () => {
  const { repo, scope, service, transport, media } = await setup()
  transport.download.mockImplementationOnce(async () => {
    await repo.activate({ ...scope, generation: 2 })
    return media.bytes
  })
  await expect(
    service.ensureAvailable(media.ref, scope, new AbortController().signal),
  ).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  await expect(repo.media.open(media.ref, scope.key)).rejects.toMatchObject({
    detail: { code: 'BACKUP_INCOMPLETE' },
  })
})
it('failed upload retains the same reservation/request for an immutable retry', async () => {
  const { repo, scope, service, transport, media } = await setup()
  await repo.media.storeVerified(media.ref, media.bytes, scope.key, 1)
  transport.upload.mockRejectedValueOnce(new Error('lost response'))
  const input = {
    scope,
    source: scope.key,
    sourceRef: media.ref,
    ref: media.ref,
    operationId: 'checkpoint',
  }
  await expect(service.upload(input, new AbortController().signal)).rejects.toThrow('lost response')
  await service.upload(input, new AbortController().signal)
  expect(transport.reserve).toHaveBeenCalledTimes(1)
  expect(transport.upload.mock.calls[0].slice(0, 2)).toEqual(
    transport.upload.mock.calls[1].slice(0, 2),
  )
})

it('rejects a late repair after a scope change and never overwrites a different media descriptor', async () => {
  const { repo, scope, service, transport, media } = await setup()
  await repo.media.storeVerified(media.ref, media.bytes, scope.key, scope.generation)
  const corrupt = new Uint8Array(await media.bytes.arrayBuffer())
  corrupt[corrupt.length - 1] ^= 1
  await transaction(repo.database, 'readwrite', async (tx) => {
    const row = await requestResult(tx.objectStore('media').get(mediaKey(scope.key, media.ref.id)))
    tx.objectStore('media').put({ ...row, bytes: corrupt.buffer })
  })
  transport.download.mockImplementationOnce(async () => {
    await repo.activate({ ...scope, generation: scope.generation + 1 })
    return media.bytes
  })
  await expect(
    service.ensureAvailable(media.ref, scope, new AbortController().signal),
  ).rejects.toMatchObject({
    detail: { code: 'ACCOUNT_CHANGED' },
  })
  await expect(repo.media.open(media.ref, scope.key)).rejects.toMatchObject({
    detail: { code: 'MEDIA_INVALID' },
  })
  const changedRef = { ...media.ref, sha256: '0'.repeat(64) }
  await transaction(repo.database, 'readwrite', async (tx) => {
    const row = await requestResult(tx.objectStore('media').get(mediaKey(scope.key, media.ref.id)))
    tx.objectStore('media').put({ ...row, ref: changedRef })
  })
  await expect(
    repo.media.storeVerified(media.ref, media.bytes, scope.key, scope.generation + 1),
  ).rejects.toMatchObject({ detail: { code: 'MEDIA_INVALID' } })
  const stored = await transaction(repo.database, 'readonly', (tx) =>
    requestResult(tx.objectStore('media').get(mediaKey(scope.key, media.ref.id))),
  )
  expect(stored.ref).toEqual(changedRef)
  expect(new Uint8Array(stored.bytes)).toEqual(corrupt)
})

it('T15 renews an expired ordinary reservation with a fresh request while preserving exact local bytes and immutable operation identity', async () => {
  const f = await setup()
  await f.repo.media.storeVerified(f.media.ref, f.media.bytes, f.scope.key, 1)
  let clock = Date.parse('2026-10-01T00:00:00.000Z')
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  f.transport.reserve.mockImplementation(async () => ({
    id: `reservation-${f.transport.reserve.mock.calls.length}`,
    collectionId: f.scope.key.collectionId,
    epoch: f.scope.key.epoch,
    media: f.media.ref,
    deletionGeneration: '0',
    expiresAt: new Date(clock + 1000).toISOString(),
  }))
  f.transport.upload.mockRejectedValueOnce(new Error('interrupted upload'))
  const input = {
    scope: f.scope,
    source: f.scope.key,
    sourceRef: f.media.ref,
    ref: f.media.ref,
    operationId: 'immutable-checkpoint',
  }
  await expect(f.service.upload(input, new AbortController().signal)).rejects.toThrow(
    'interrupted upload',
  )
  expect(
    await new Response(await f.repo.media.open(f.media.ref, f.scope.key)).arrayBuffer(),
  ).toEqual(await f.media.bytes.arrayBuffer())
  clock += 1001
  await createRemoteMediaService(f.options).upload(input, new AbortController().signal)
  expect(f.transport.reserve).toHaveBeenCalledTimes(2)
  const requests = f.transport.reserve.mock.calls as unknown as Array<
    [{ requestId: string; upload: unknown }]
  >
  expect(requests[0][0].requestId).not.toBe(requests[1][0].requestId)
  expect(requests[0][0].upload).toEqual(requests[1][0].upload)
  expect((f.transport.upload.mock.calls as unknown as Array<[string]>).map((c) => c[0])).toEqual([
    'reservation-1',
    'reservation-2',
  ])
  expect(
    await new Response(await f.repo.media.open(f.media.ref, f.scope.key)).arrayBuffer(),
  ).toEqual(await f.media.bytes.arrayBuffer())
  expect(await f.repo.pending(f.scope.key)).toEqual([])
  vi.restoreAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (failure: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
it('serializes concurrent same-scope/ref downloads and the waiter reuses the verified durable bytes', async () => {
  const f = await setup(),
    held = deferred<Blob>()
  f.transport.download.mockImplementationOnce(() => held.promise)
  const first = f.service.ensureAvailable(f.media.ref, f.scope, new AbortController().signal)
  await vi.waitFor(() => expect(f.transport.download).toHaveBeenCalledTimes(1))
  const second = f.service.ensureAvailable(f.media.ref, f.scope, new AbortController().signal)
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(f.transport.download).toHaveBeenCalledTimes(1)
  held.resolve(f.media.bytes)
  await Promise.all([first, second])
  expect(f.transport.download).toHaveBeenCalledTimes(1)
  expect(
    await new Response(await f.repo.media.open(f.media.ref, f.scope.key)).arrayBuffer(),
  ).toEqual(await f.media.bytes.arrayBuffer())
})
it('a cancelled waiter rejects promptly, preserves the active owner, and cannot let a third caller overlap it', async () => {
  const f = await setup(),
    held = deferred<Blob>(),
    cancelled = new AbortController(),
    ownerSignal = new AbortController()
  f.transport.download.mockImplementationOnce(() => held.promise)
  const owner = f.service.ensureAvailable(f.media.ref, f.scope, ownerSignal.signal)
  await vi.waitFor(() => expect(f.transport.download).toHaveBeenCalledTimes(1))
  const waiter = f.service.ensureAvailable(f.media.ref, f.scope, cancelled.signal)
  const rejected = expect(waiter).rejects.toMatchObject({ name: 'AbortError' })
  cancelled.abort()
  await rejected // Owner is deliberately still held: cancellation must not wait for it.
  expect(ownerSignal.signal.aborted).toBe(false)
  const third = f.service.ensureAvailable(f.media.ref, f.scope, new AbortController().signal)
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(f.transport.download).toHaveBeenCalledTimes(1)
  held.resolve(f.media.bytes)
  await Promise.all([owner, third])
  expect(f.transport.download).toHaveBeenCalledTimes(1)
})
it('a live waiter retries with its own signal when the owning request is cancelled before caching', async () => {
  const f = await setup(),
    ownerSignal = new AbortController(),
    waiterSignal = new AbortController()
  f.transport.download.mockImplementationOnce(
    (...args: unknown[]) =>
      new Promise<Blob>((_resolve, reject) => {
        const signal = args[2] as AbortSignal
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
  )
  const owner = f.service.ensureAvailable(f.media.ref, f.scope, ownerSignal.signal)
  const rejected = expect(owner).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(f.transport.download).toHaveBeenCalledTimes(1))
  const waiter = f.service.ensureAvailable(f.media.ref, f.scope, waiterSignal.signal)
  ownerSignal.abort()
  await rejected
  await waiter
  expect(f.transport.download).toHaveBeenCalledTimes(2)
  const calls = f.transport.download.mock.calls as unknown as Array<[unknown, unknown, AbortSignal]>
  expect(calls[0][2]).toBe(ownerSignal.signal)
  expect(calls[1][2]).toBe(waiterSignal.signal)
  expect(waiterSignal.signal.aborted).toBe(false)
})
it('distinct snapshot authorities are not coalesced, and a new generation never adopts the old callback', async () => {
  const f = await setup(),
    old = deferred<Blob>(),
    fresh = deferred<Blob>()
  f.transport.download
    .mockImplementationOnce(() => old.promise)
    .mockImplementationOnce(() => fresh.promise)
  const a = f.service.ensureAvailable(
    f.media.ref,
    f.scope,
    new AbortController().signal,
    'snapshot-one',
  )
  const b = f.service.ensureAvailable(
    f.media.ref,
    f.scope,
    new AbortController().signal,
    'snapshot-two',
  )
  await vi.waitFor(() => expect(f.transport.download).toHaveBeenCalledTimes(2))
  const calls = f.transport.download.mock.calls as unknown as Array<[{ snapshotId: string }]>
  expect(calls.map(([request]) => request.snapshotId).sort()).toEqual([
    'snapshot-one',
    'snapshot-two',
  ])
  old.resolve(f.media.bytes)
  fresh.resolve(f.media.bytes)
  await Promise.all([a, b])
  await f.repo.media.release(f.media.ref, f.scope.key, 1)
  const held = deferred<Blob>()
  f.transport.download.mockImplementationOnce(() => held.promise)
  const previous = f.service.ensureAvailable(f.media.ref, f.scope, new AbortController().signal)
  const previousRejected = expect(previous).rejects.toMatchObject({
    detail: { code: 'ACCOUNT_CHANGED' },
  })
  await vi.waitFor(() => expect(f.transport.download).toHaveBeenCalledTimes(3))
  const next = { ...f.scope, generation: 2 }
  await f.repo.activate(next)
  await f.service.ensureAvailable(f.media.ref, next, new AbortController().signal)
  expect(f.transport.download).toHaveBeenCalledTimes(4)
  held.resolve(f.media.bytes)
  await previousRejected
  expect(await new Response(await f.repo.media.open(f.media.ref, next.key)).arrayBuffer()).toEqual(
    await f.media.bytes.arrayBuffer(),
  )
})

it('same media IDs in a newly selected account never join or accept the previous account download', async () => {
  const f = await setup(),
    held = deferred<Blob>()
  f.transport.download.mockImplementationOnce(() => held.promise)
  const old = f.service.ensureAvailable(f.media.ref, f.scope, new AbortController().signal)
  const oldRejected = expect(old).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  await vi.waitFor(() => expect(f.transport.download).toHaveBeenCalledTimes(1))
  const other = { ...info(true, 'second'), accountId: 'second-account' }
  await f.repo.createCollection(other)
  const next = await f.repo.transition(f.scope, {
    key: other.key,
    device: { id: 'second-device', generation: 'second-generation' },
  })
  Object.assign(f.session, {
    accountId: other.accountId,
    collection: next.key,
    device: next.device,
  })
  await f.service.ensureAvailable(f.media.ref, next, new AbortController().signal)
  expect(f.transport.download).toHaveBeenCalledTimes(2)
  held.resolve(f.media.bytes)
  await oldRejected
  await expect(f.repo.media.open(f.media.ref, f.scope.key)).rejects.toMatchObject({
    detail: { code: 'BACKUP_INCOMPLETE' },
  })
  expect(await new Response(await f.repo.media.open(f.media.ref, next.key)).arrayBuffer()).toEqual(
    await f.media.bytes.arrayBuffer(),
  )
})
