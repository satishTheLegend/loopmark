import { IDBFactory } from 'fake-indexeddb'
import { expect, it } from 'vitest'
import { openBrowserRepository } from './repository'
import { createBrowserOperationPlanStore } from './operation-plans'
import { info, create, now, png } from './fixtures.test-support'
import { dataUrlToBlob } from './media-store'
import { requestResult, transaction } from './schema'
import type { LocalIntent } from '../../domain/contracts'

it('pins retry-plan media until commit and removes scoped plans with the collection', async () => {
  const repo = await openBrowserRepository({ factory: new IDBFactory(), databaseName: 'plans' })
  const collection = info(),
    scope = { key: collection.key, generation: 1, device: { id: 'device', generation: 'gen' } }
  try {
    await repo.createCollection(collection)
    await repo.activate(scope)
    await repo.commitLocal(scope.key, create(), 1)
    const { ref } = await repo.media.prepare(
      { bytes: dataUrlToBlob(png), kind: 'photo' },
      scope.key,
      1,
    )
    const intent: LocalIntent = {
      kind: 'checkpoint.create',
      operationId: 'checkpoint',
      createdAt: now,
      base: { revision: '1' },
      payload: {
        updatedAt: now,
        checkpoint: {
          id: 'cp',
          projectId: 'project',
          createdAt: now,
          position: '1',
          nextStep: 'Turn',
          toolSize: '4 mm',
          notes: '',
          photo: ref,
        },
      },
    }
    const plans = createBrowserOperationPlanStore(repo)
    await plans.putIfAbsent(scope, {
      operationId: intent.operationId,
      inputHash: '1'.repeat(64),
      intent,
    })
    await repo.media.release(ref, scope.key, 1)
    expect((await new Response(await repo.media.open(ref, scope.key)).arrayBuffer()).byteLength).toBe(ref.bytes)
    await repo.commitLocal(scope.key, intent, 1)
    const view = await repo.readView(scope.key)
    await repo.commitLocal(
      scope.key,
      {
        kind: 'project.delete',
        operationId: 'delete',
        createdAt: now,
        base: { revision: view.projects[0].revision },
        payload: { projectId: 'project' },
      },
      1,
    )
    await repo.media.release(ref, scope.key, 1)
    await expect(repo.media.open(ref, scope.key)).rejects.toMatchObject({
      detail: { code: 'BACKUP_INCOMPLETE' },
    })
    await repo.removeLocal(scope.key, (await repo.readView(scope.key)).revision, 1)
    const rows = await transaction(repo.database, 'readonly', (tx) =>
      requestResult(tx.objectStore('meta').getAll()),
    )
    expect(rows.filter((row) => row.scope)).toEqual([])
  } finally {
    await repo.close()
  }
})
