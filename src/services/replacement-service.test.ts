import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { createBrowserWorkflowStore } from '../repositories/browser/workflow-store'
import { info, create } from '../repositories/browser/fixtures.test-support'
import type {
  AccountSession,
  Command,
  Receipt,
  SessionScope,
  SnapshotManifest,
} from '../domain/contracts'
import type { CandidateMetadata, CandidatePreparation } from '../domain/remote-contracts'
import type { FunctionClient } from '../sync/http-client'
import type { SyncTransport } from '../platform/contracts'
import { canonicalHash } from '../domain/canonical-json'
import { candidatePortableBytes, mergeCandidate } from '../domain/remote-schema'
import { DomainError } from '../domain/errors'
import { createReplacementService } from './replacement-service'
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
  const source = info(),
    destination = info(true),
    scope: SessionScope = {
      key: source.key,
      generation: 1,
      device: { id: 'device', generation: 'g' },
    }
  await repo.createCollection(source)
  await repo.createCollection(destination)
  await repo.activate(scope)
  await repo.commitLocal(scope.key, create(), 1)
  let session: AccountSession = {
    accountId: 'account',
    billingPrincipalId: 'principal',
    collection: destination.key,
    device: scope.device,
    deletionGeneration: '0',
    expiresAt: '2030-01-01T00:00:00.000Z',
  }
  const snapshot: SnapshotManifest = {
    protocolVersion: 2,
    snapshotId: 'snapshot',
    collectionId: destination.key.collectionId,
    epoch: destination.key.epoch,
    cursor: '0',
    revision: '0',
    expiresAt: '2030-01-01T00:00:00.000Z',
    after: null,
    nextPage: null,
    projects: [],
    checkpoints: [],
    media: [],
  }
  let preparation: CandidatePreparation | null = null,
    serverReceipt: Receipt | null = null,
    loseResponse = false,
    prepareCount = 0
  const client: FunctionClient = {
    post: vi.fn(async (_name, body) => {
      const input = body as {
        action: string
        requestId: string
        candidate: CandidateMetadata
        source: { key: typeof source.key; name: string; revision: string }
      }
      if (input.action === 'cancel') return { cancelled: true }
      if (input.action === 'status') {
        if (!preparation) throw new DomainError('NOT_AVAILABLE')
        return { ...preparation, receipt: serverReceipt }
      }
      prepareCount++
      const merged = await mergeCandidate('attach', input.requestId, input.candidate, {
          projects: [],
          checkpoints: [],
        }),
        hash = await canonicalHash(merged.candidate)
      preparation = {
        mode: 'attach',
        nextEpoch: 'next',
        candidate: merged.candidate,
        mediaMappings: merged.mediaMappings,
        requiredMedia: [],
        receipt: null,
        replacement: {
          reservationId: 'reservation',
          collectionId: destination.key.collectionId,
          epoch: destination.key.epoch,
          revision: '0',
          candidateSha256: hash,
          projects: merged.candidate.projects.length,
          checkpoints: 0,
          mediaBytes: 0,
          portableBytes: candidatePortableBytes(merged.candidate),
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
        preview: {
          id: 'reservation',
          source: input.source,
          destination: {
            key: destination.key,
            name: destination.name,
            revision: '0',
            email: 'maker@example.invalid',
          },
          additions: merged.additions,
          matches: merged.matches,
          copies: merged.copies,
          mappings: merged.mappings,
          resulting: {
            projects: merged.candidate.projects.length,
            activeProjects: 1,
            checkpoints: 0,
            portableBytes: candidatePortableBytes(merged.candidate),
          },
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      }
      return preparation
    }),
  }
  const transport: SyncTransport = {
    releaseSnapshot: vi.fn(async () => {}),
    snapshot: vi.fn(async () =>
      serverReceipt
        ? {
            ...snapshot,
            epoch: 'next',
            cursor: '1',
            revision: '1',
            projects: preparation!.candidate.projects.map((p) => ({ ...p, revision: '1' })),
          }
        : snapshot,
    ),
    pull: async () => {
      throw new Error('unused')
    },
    push: vi.fn(async (command: Command) => {
      serverReceipt = {
        operationId: command.operationId,
        sha256: command.sha256,
        epoch: command.epoch,
        revision: '1',
        cursor: '1',
        resultId: destination.key.collectionId,
        changes: [{ kind: 'collection.replaced', nextEpoch: 'next' }],
      }
      if (loseResponse) throw new DomainError('OFFLINE')
      return serverReceipt
    }),
  }
  const options = {
    repository: repo,
    transport,
    client,
    media: {
      upload: vi.fn(async () => {
        throw new Error('unused')
      }),
      ensureAvailable: vi.fn(async () => {}),
    },
    workflows: createBrowserWorkflowStore(repo),
    current: () => session,
  }
  return {
    repo,
    source,
    destination,
    scope,
    options,
    client,
    transport,
    service: createReplacementService(options),
    get session() {
      return session
    },
    lose: () => {
      loseResponse = true
    },
    advanceSession: () => {
      session = { ...session, collection: { ...session.collection, epoch: 'next' } }
    },
    prepared: () => prepareCount,
  }
}
it('calculates preview locally without source upload and only confirms the exact reviewed source', async () => {
  const { repo, source, scope, session, service, client } = await setup()
  const preview = await service.preview(source.key, session, 'maker@example.invalid', scope)
  expect(preview.resulting.projects).toBe(1)
  expect(client.post).not.toHaveBeenCalled()
  await repo.commitLocal(source.key, create('second'), scope.generation)
  await expect(service.confirm(preview, session, scope)).rejects.toMatchObject({
    detail: { code: 'REVISION_CONFLICT' },
  })
  expect(client.post).not.toHaveBeenCalled()
  expect((await repo.readView(source.key)).projects).toHaveLength(2)
})
it('atomically selects the next epoch, preserves the source and previous collection, and releases snapshot leases', async () => {
  const { repo, source, scope, session, service, transport } = await setup()
  const preview = await service.preview(source.key, session, 'maker@example.invalid', scope),
    selected = await service.confirm(preview, session, scope)
  expect(selected.key.epoch).toBe('next')
  expect(await repo.readActive()).toEqual(selected)
  expect((await repo.readView(source.key)).projects).toHaveLength(1)
  expect(
    (await repo.listCollections()).find(
      (c) => c.key.namespace === session.collection.namespace && c.key.epoch === 'epoch',
    ),
  ).toMatchObject({ kind: 'recovered', accountId: null })
  expect((await repo.readView(selected.key)).projects).toHaveLength(1)
  expect(transport.releaseSnapshot).toHaveBeenCalledTimes(3)
})
it('recovers a committed replacement after response loss and next-epoch authentication without resending a mutation', async () => {
  const fixture = await setup(),
    preview = await fixture.service.preview(
      fixture.source.key,
      fixture.session,
      'maker@example.invalid',
      fixture.scope,
    )
  fixture.lose()
  await expect(
    fixture.service.confirm(preview, fixture.session, fixture.scope),
  ).rejects.toMatchObject({ detail: { code: 'OFFLINE' } })
  const active = (await fixture.repo.readActive())!
  expect(await fixture.repo.pending(active.key)).toHaveLength(1)
  fixture.advanceSession()
  const reopened = createReplacementService(fixture.options)
  const selected = await reopened.resume!(fixture.session, active)
  expect(selected?.key.epoch).toBe('next')
  expect(fixture.transport.push).toHaveBeenCalledTimes(1)
  expect(fixture.prepared()).toBe(1)
  expect((await fixture.repo.readView(selected!.key)).projects).toHaveLength(1)
})
it('cancels an unsubmitted preview locally, releasing its media pin without sending source metadata', async () => {
  const { scope, source, session, service, client, repo } = await setup()
  const preview = await service.preview(source.key, session, 'maker@example.invalid', scope)
  await service.cancel(preview.id, scope, new AbortController().signal)
  expect(client.post).not.toHaveBeenCalled()
  expect((await service.list())[0].phase).toBe('cancelled')
  expect((await repo.readView(source.key)).projects).toHaveLength(1)
})
it('blocks source removal after a queued replacement loses its server response', async () => {
  const fixture = await setup(),
    preview = await fixture.service.preview(
      fixture.source.key,
      fixture.session,
      'maker@example.invalid',
      fixture.scope,
    )
  fixture.lose()
  await expect(
    fixture.service.confirm(preview, fixture.session, fixture.scope),
  ).rejects.toMatchObject({ detail: { code: 'OFFLINE' } })
  const active = (await fixture.repo.readActive())!,
    selected = await fixture.repo.transition(active, {
      key: fixture.source.key,
      device: active.device,
    })
  await expect(
    fixture.repo.removeLocal(
      selected.key,
      (await fixture.repo.readView(selected.key)).revision,
      selected.generation,
    ),
  ).rejects.toMatchObject({ detail: { code: 'SYNC_REBASE_REQUIRED' } })
  expect((await fixture.service.list())[0].phase).toBe('queued')
  expect((await fixture.repo.readView(selected.key)).projects).toHaveLength(1)
})
it('explicit cancellation retires an uncommitted replacement without deleting either collection', async () => {
  const fixture = await setup(),
    preview = await fixture.service.preview(
      fixture.source.key,
      fixture.session,
      'maker@example.invalid',
      fixture.scope,
    )
  vi.mocked(fixture.transport.push).mockRejectedValueOnce(new DomainError('OFFLINE'))
  await expect(
    fixture.service.confirm(preview, fixture.session, fixture.scope),
  ).rejects.toMatchObject({ detail: { code: 'OFFLINE' } })
  const active = (await fixture.repo.readActive())!
  await fixture.service.cancel(preview.id, active, new AbortController().signal)
  expect(await fixture.repo.pending(active.key)).toHaveLength(0)
  expect((await fixture.service.list())[0].phase).toBe('cancelled')
  expect((await fixture.repo.readView(fixture.source.key)).projects).toHaveLength(1)
})
