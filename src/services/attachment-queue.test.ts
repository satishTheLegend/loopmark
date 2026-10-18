import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { createBrowserWorkflowStore } from '../repositories/browser/workflow-store'
import { info, project, now, png, wav } from '../repositories/browser/fixtures.test-support'
import { describeInline } from './media-codec'
import { createAttachmentQueue } from './attachment-queue'
import { DomainError } from '../domain/errors'
import type {
  AccountSession,
  CheckpointRecord,
  Command,
  Receipt,
  SessionScope,
} from '../domain/contracts'
const opened: BrowserRepository[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of opened.splice(0)) await repo.close()
})
async function setup(voice = false) {
  const repo = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: crypto.randomUUID(),
  })
  opened.push(repo)
  const collection = info(true),
    scope: SessionScope = {
      key: collection.key,
      generation: 1,
      device: { id: 'device', generation: 'gen' },
    }
  await repo.createCollection(collection)
  await repo.activate(scope)
  let parent = project('project', '1'),
    checkpoint: CheckpointRecord
  await repo.hydrate(
    scope.key,
    [
      {
        protocolVersion: 2,
        snapshotId: 'hydrate',
        collectionId: scope.key.collectionId,
        epoch: 'epoch',
        cursor: '1',
        revision: '1',
        after: null,
        nextPage: null,
        expiresAt: '2030-01-01T00:00:00.000Z',
        projects: [parent],
        checkpoints: [],
        media: [],
      },
    ],
    1,
  )
  const photo = await describeInline(png, 'photo'),
    audio = await describeInline(wav, 'voice')
  await repo.media.storeVerified(photo.ref, photo.bytes, scope.key, 1)
  if (voice) await repo.media.storeVerified(audio.ref, audio.bytes, scope.key, 1)
  const intent = {
    operationId: 'checkpoint-op',
    kind: 'checkpoint.create' as const,
    createdAt: now,
    base: { revision: '1' },
    payload: {
      updatedAt: now,
      checkpoint: {
        id: 'checkpoint',
        projectId: 'project',
        createdAt: now,
        position: '20',
        toolSize: '4 mm',
        nextStep: 'Turn',
        notes: '',
        photo: photo.ref,
        ...(voice ? { voice: audio.ref } : {}),
      },
    },
  }
  await repo.commitLocal(scope.key, intent, 1)
  const command = (await repo.pending(scope.key))[0].command
  const session: AccountSession = {
    accountId: 'account',
    billingPrincipalId: 'principal',
    collection: scope.key,
    device: scope.device,
    deletionGeneration: '0',
    expiresAt: '2030-01-01T00:00:00.000Z',
  }
  let seq = 2,
    failPush = false
  const receipts = new Map<string, Receipt>(),
    transport = {
      pull: vi.fn(),
      snapshot: vi.fn(),
      releaseSnapshot: vi.fn(),
      push: vi.fn(async (cmd: Command) => {
        if (receipts.has(cmd.operationId)) return receipts.get(cmd.operationId)!
        if (cmd.kind !== 'media.attach') throw new Error('Expected attachment command')
        seq++
        checkpoint = { ...checkpoint, revision: String(seq) }
        parent = { ...parent, revision: String(seq) }
        const receipt: Receipt = {
          operationId: cmd.operationId,
          sha256: cmd.sha256,
          epoch: cmd.epoch,
          cursor: String(seq),
          revision: String(seq),
          resultId: checkpoint.id,
          changes: [
            { kind: 'project.put', value: parent },
            { kind: 'checkpoint.put', value: checkpoint },
          ],
        }
        receipts.set(cmd.operationId, receipt)
        if (failPush) {
          failPush = false
          throw new DomainError('SERVICE_UNAVAILABLE')
        }
        return receipt
      }),
    }
  const media = {
    ensureAvailable: vi.fn(),
    upload: vi.fn(async (input) => ({
      id: 'reservation-' + input.ref.kind,
      collectionId: scope.key.collectionId,
      epoch: 'epoch',
      media: input.ref,
      expiresAt: '2030-01-01T00:00:00.000Z',
      deletionGeneration: '0',
    })),
  }
  const workflows = createBrowserWorkflowStore(repo),
    options = { repository: repo, workflows, transport, media, current: () => session },
    queue = createAttachmentQueue(options)
  await queue.prepareCommand(scope, command, new AbortController().signal)
  const acknowledgeText = async () => {
    checkpoint = { ...intent.payload.checkpoint, revision: '2' }
    parent = { ...parent, revision: '2' }
    await repo.acknowledge(
      scope.key,
      {
        operationId: command.operationId,
        sha256: command.sha256,
        epoch: 'epoch',
        cursor: '2',
        revision: '2',
        resultId: checkpoint.id,
        changes: [
          { kind: 'project.put', value: parent },
          { kind: 'checkpoint.put', value: checkpoint },
        ],
      },
      1,
    )
  }
  return {
    repo,
    scope,
    command,
    queue,
    options,
    media,
    transport,
    acknowledgeText,
    receipts,
    losePush: () => {
      failPush = true
    },
  }
}
it('journals both refs before text ack, then finalizes each exact checkpoint CAS in order without rewriting text', async () => {
  const f = await setup(true),
    signal = new AbortController().signal
  expect(await f.queue.list(f.scope.key)).toHaveLength(2)
  await f.queue.run(f.scope, signal)
  expect(f.media.upload).not.toHaveBeenCalled()
  expect((await f.repo.pending(f.scope.key))[0].command).toEqual(f.command)
  await f.acknowledgeText()
  await f.queue.run(f.scope, signal)
  expect(await f.repo.pending(f.scope.key)).toEqual([])
  expect((await f.queue.list(f.scope.key)).map((x) => x.state)).toEqual(['complete', 'complete'])
  expect(f.transport.push.mock.calls.map(([cmd]) => cmd.base)).toEqual([
    { revision: '2' },
    { revision: '3' },
  ])
})
it('text stays acknowledged during failed bytes and restart retries only the durable attachment', async () => {
  const f = await setup(),
    signal = new AbortController().signal
  await f.acknowledgeText()
  f.media.upload.mockRejectedValueOnce(new DomainError('OFFLINE'))
  await expect(f.queue.run(f.scope, signal)).rejects.toMatchObject({ detail: { code: 'OFFLINE' } })
  expect(await f.repo.pending(f.scope.key)).toEqual([])
  const [failed] = await f.queue.list(f.scope.key)
  expect(failed.state).toBe('failed')
  expect(failed.error?.retryable).toBe(true)
  await createAttachmentQueue(f.options).run(f.scope, signal, [failed.id])
  expect(f.transport.push).toHaveBeenCalledOnce()
  expect((await f.repo.readView(f.scope.key)).checkpoints[0].nextStep).toBe('Turn')
})
it('a lost finalization response replays exactly one immutable command and never creates another server effect', async () => {
  const f = await setup(),
    signal = new AbortController().signal
  await f.acknowledgeText()
  f.losePush()
  await expect(f.queue.run(f.scope, signal)).rejects.toMatchObject({
    detail: { code: 'SERVICE_UNAVAILABLE' },
  })
  await createAttachmentQueue(f.options).run(f.scope, signal)
  expect(f.transport.push.mock.calls[0][0]).toEqual(f.transport.push.mock.calls[1][0])
  expect(f.receipts.size).toBe(1)
  expect(f.media.upload).toHaveBeenCalledOnce()
  expect((await f.queue.list(f.scope.key))[0].state).toBe('complete')
})
it('receipt persisted before ack survives a local transaction failure without guessing readiness from the media ref', async () => {
  const f = await setup(),
    signal = new AbortController().signal
  await f.acknowledgeText()
  const ack = f.repo.acknowledge.bind(f.repo)
  vi.spyOn(f.repo, 'acknowledge')
    .mockRejectedValueOnce(new DomainError('LOCAL_STORAGE_FAILED'))
    .mockImplementation(ack)
  await f.queue.run(f.scope, signal)
  await createAttachmentQueue(f.options).run(f.scope, signal)
  expect(f.transport.push).toHaveBeenCalledOnce()
  expect((await f.queue.list(f.scope.key))[0].state).toBe('complete')
})
it('an account generation change during upload cannot enqueue or finalize the old attachment', async () => {
  const f = await setup(),
    signal = new AbortController().signal
  await f.acknowledgeText()
  const upload = f.media.upload.getMockImplementation()!
  f.media.upload.mockImplementationOnce(async (input) => {
    await f.repo.activate({ ...f.scope, generation: 2 })
    return upload(input)
  })
  await expect(f.queue.run(f.scope, signal)).rejects.toMatchObject({
    detail: { code: 'ACCOUNT_CHANGED' },
  })
  expect(f.transport.push).not.toHaveBeenCalled()
  expect(await f.repo.pending(f.scope.key)).toEqual([])
})

it('permanent authorization failures remain paused until the exact verified session resumes', async () => {
  const f = await setup(),
    signal = new AbortController().signal
  await f.acknowledgeText()
  f.media.upload.mockRejectedValueOnce(new DomainError('AUTH_REQUIRED'))
  await expect(f.queue.run(f.scope, signal)).rejects.toMatchObject({
    detail: { code: 'AUTH_REQUIRED' },
  })
  await f.queue.run(f.scope, signal)
  expect(f.media.upload).toHaveBeenCalledOnce()
  await f.queue.resumeAfterAuthentication(f.scope)
  await f.queue.run(f.scope, signal)
  expect(f.media.upload).toHaveBeenCalledTimes(2)
  expect((await f.queue.list(f.scope.key))[0].state).toBe('complete')
})
