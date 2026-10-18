import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { createBrowserWorkflowStore } from '../repositories/browser/workflow-store'
import { info, png } from '../repositories/browser/fixtures.test-support'
import { describeInline } from './media-codec'
import { createRemoteMediaService } from './media-service'
import type { AccountSession, SessionScope } from '../domain/contracts'
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
