import { IDBFactory } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
import { openBrowserRepository } from '../repositories/browser/repository'
import { createBrowserOperationPlanStore } from '../repositories/browser/operation-plans'
import { createLocalDataAdapter } from '../services/local-data-service'
import { createSyncCoordinator } from './coordinator'
import { info } from '../repositories/browser/fixtures.test-support'
import type {
  Command,
  ProjectRecord,
  CheckpointRecord,
  Receipt,
  SessionScope,
  SnapshotManifest,
} from '../domain/contracts'

it('T08 offline create → edit → edit → append survives process restart and a committed-but-lost acknowledgement without rewriting dependencies', async () => {
  const factory = new IDBFactory(),
    databaseName = 'offline-chain'
  let repo = await openBrowserRepository({ factory, databaseName })
  const collection = info(true),
    scope: SessionScope = {
      key: collection.key,
      generation: 1,
      device: { id: 'device', generation: 'gen' },
    }
  await repo.createCollection(collection)
  await repo.activate(scope)
  const snapshot: SnapshotManifest = {
    protocolVersion: 2,
    snapshotId: 'empty',
    collectionId: scope.key.collectionId,
    epoch: scope.key.epoch,
    cursor: '0',
    revision: '0',
    expiresAt: '2030-01-01T00:00:00.000Z',
    after: null,
    nextPage: null,
    projects: [],
    checkpoints: [],
    media: [],
  }
  await repo.hydrate(scope.key, [snapshot], 1)
  const adapter = createLocalDataAdapter({
    repository: repo,
    media: repo.media,
    plans: createBrowserOperationPlanStore(repo),
    scope: () => scope,
  })
  const fields = {
    name: 'Original scarf',
    craft: 'Crochet' as const,
    color: 'sage' as const,
    yarn: 'Cotton',
    toolSize: '4 mm',
    notes: '',
  }
  let project = await adapter.createProject(fields, 'create-token')
  project = await adapter.updateProject(
    project.id,
    { ...fields, name: 'First edit' },
    project.updatedAt,
  )
  project = await adapter.updateProject(
    project.id,
    { ...fields, name: 'Second edit', toolSize: '5 mm' },
    project.updatedAt,
  )
  await adapter.addCheckpoint(
    project.id,
    { position: 'Row 9', toolSize: '5 mm', nextStep: 'Turn after the marker', notes: '' },
    'checkpoint-token',
  )
  const original = (await repo.pending(scope.key)).map((item) => item.command)
  expect(original.map((command) => command.kind)).toEqual([
    'project.create',
    'project.update',
    'project.update',
    'checkpoint.create',
  ])
  expect(original.map((command) => command.base)).toEqual([
    null,
    ...original.slice(0, -1).map((command) => ({ afterOperationId: command.operationId })),
  ])
  expect(original.map((command) => command.sequence)).toEqual(['1', '2', '3', '4'])
  const expected = await repo.readView(scope.key)
  await repo.close()
  repo = await openBrowserRepository({ factory, databaseName })
  expect((await repo.pending(scope.key)).map((item) => item.command)).toEqual(original)
  const committed = new Map<string, Receipt>(),
    requests: Command[] = []
  let serverProject: ProjectRecord | undefined, serverCheckpoint: CheckpointRecord | undefined
  let loseAcknowledgement = true
  let coordinator: ReturnType<typeof createSyncCoordinator>
  const transport = {
    snapshot: vi.fn(async () => snapshot),
    releaseSnapshot: vi.fn(async () => {}),
    push: vi.fn(async (command: Command) => {
      requests.push(structuredClone(command))
      if (committed.has(command.operationId)) return committed.get(command.operationId)!
      const revision = String(committed.size + 1)
      const predecessor =
        command.base && 'afterOperationId' in command.base
          ? committed.get(command.base.afterOperationId)
          : null
      if (command.kind !== 'project.create')
        expect(predecessor?.revision).toBe(serverProject!.revision)
      if (command.kind === 'project.create')
        serverProject = { ...command.payload.project, revision }
      else if (command.kind === 'project.update')
        serverProject = {
          ...serverProject!,
          ...command.payload.fields,
          updatedAt: command.payload.updatedAt,
          revision,
        }
      else if (command.kind === 'checkpoint.create') {
        serverCheckpoint = { ...command.payload.checkpoint, revision }
        serverProject = { ...serverProject!, updatedAt: command.payload.updatedAt, revision }
      } else throw new Error('Unexpected fixture command')
      const receipt: Receipt = {
        operationId: command.operationId,
        sha256: command.sha256,
        epoch: command.epoch,
        revision,
        cursor: revision,
        resultId: serverCheckpoint?.id ?? serverProject!.id,
        changes: [
          { kind: 'project.put', value: structuredClone(serverProject!) },
          ...(command.kind === 'checkpoint.create'
            ? [{ kind: 'checkpoint.put' as const, value: structuredClone(serverCheckpoint!) }]
            : []),
        ],
      }
      committed.set(command.operationId, receipt)
      if (command.operationId === original[1].operationId && loseAcknowledgement) {
        loseAcknowledgement = false
        coordinator.stop()
        throw new DOMException('Process interrupted', 'AbortError')
      }
      return receipt
    }),
    pull: vi.fn(async (input: { collectionId: string; epoch: string; afterCursor: string }) => ({
      protocolVersion: 2 as const,
      collectionId: input.collectionId,
      epoch: input.epoch,
      afterCursor: input.afterCursor,
      nextCursor: String(committed.size),
      hasMore: false,
      entries: [...committed.values()].filter(
        (receipt) => BigInt(receipt.cursor) > BigInt(input.afterCursor),
      ),
    })),
  }
  const lease = {
    run: async (_scope: SessionScope, _signal: AbortSignal, work: () => Promise<void>) => {
      await work()
      return true
    },
  }
  try {
    coordinator = createSyncCoordinator({ repository: repo, transport, lease, online: () => false })
    await coordinator.run(scope)
    expect(requests).toEqual([])
    coordinator.dispose()
    coordinator = createSyncCoordinator({ repository: repo, transport, lease })
    await coordinator.run(scope)
    expect(committed.size).toBe(2)
    expect((await repo.pending(scope.key)).map((item) => item.command)).toEqual(original.slice(1))
    coordinator.dispose()
    await repo.close()
    repo = await openBrowserRepository({ factory, databaseName })
    expect((await repo.pending(scope.key))[0]).toMatchObject({
      state: 'attempted',
      command: original[1],
    })
    coordinator = createSyncCoordinator({ repository: repo, transport, lease })
    await coordinator.run(scope)
    expect(committed.size).toBe(4)
    expect(requests).toEqual([original[0], original[1], original[1], original[2], original[3]])
    expect(await repo.pending(scope.key)).toEqual([])
    const final = await repo.readView(scope.key)
    expect(final.projects[0]).toEqual(serverProject)
    expect(final.checkpoints).toEqual([serverCheckpoint])
    expect(final.projects[0].name).toBe(expected.projects[0].name)
    expect(final.checkpoints[0].nextStep).toBe(expected.checkpoints[0].nextStep)
    expect(final.cursor).toBe('4')
  } finally {
    coordinator!.dispose()
    await repo.close()
  }
})
