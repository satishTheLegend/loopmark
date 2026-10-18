import type { CollectionInfo, LocalIntent, SessionScope } from '../domain/contracts'
import type { Repository } from './contracts'

// Framework-independent durability assertions; run against real IDB and native adapters.
// Each factory opens the same fixture store; destroy only the test-owned store after the suite.
export async function verifyRepositoryContract(open: () => Promise<Repository>): Promise<void> {
  const key = {
    namespace: 'guest-contract',
    collectionId: 'collection-contract',
    epoch: 'epoch-contract',
  }
  const scope: SessionScope = {
    key,
    generation: 1,
    device: { id: 'device-contract', generation: 'device-generation' },
  }
  const collection: CollectionInfo = {
    key,
    name: 'Contract fixture',
    kind: 'guest',
    accountId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    legacyAccess: false,
  }
  const repository = await open()
  await repository.createCollection(collection)
  await repository.activate(scope)
  const intent: LocalIntent = {
    operationId: 'create-contract',
    base: null,
    createdAt: collection.createdAt,
    kind: 'project.create',
    payload: {
      project: {
        id: 'project-contract',
        code: 'TEST-1',
        name: 'Durable scarf',
        craft: 'Knitting',
        color: 'clay',
        yarn: '',
        toolSize: '4 mm',
        notes: '',
        status: 'active',
        createdAt: collection.createdAt,
        updatedAt: collection.createdAt,
      },
    },
  }
  await repository.commitLocal(key, intent, 1)
  await repository.commitLocal(key, intent, 1)
  await repository.close()
  const reopened = await open()
  const view = await reopened.readView(key)
  if (view.projects.length !== 1 || view.projects[0].name !== 'Durable scarf')
    throw new Error('Durable atomic save/idempotence contract failed')
  await reopened.activate({ ...scope, generation: 2 })
  let rejected = false
  try {
    await reopened.commitLocal(key, { ...intent, operationId: 'late-operation' }, 1)
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('Stale generation must not commit')
  const snapshot = await reopened.snapshot(key)
  if (snapshot.view.projects.length !== 1) throw new Error('Snapshot lost committed work')
  await reopened.releaseSnapshot(snapshot.id)
  await reopened.close()
}
