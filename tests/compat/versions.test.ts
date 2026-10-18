import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  openDatabase,
  BROWSER_SCHEMA_VERSION,
  requestResult,
} from '../../src/repositories/browser/schema'
import { backupSchema, parsePullPage } from '../../src/domain/schema'
import { openBrowserRepository } from '../../src/repositories/browser/repository'
import { createBackupService } from '../../src/services/backup-service'
import { createLocalDataAdapter } from '../../src/services/local-data-service'
import { createBrowserOperationPlanStore } from '../../src/repositories/browser/operation-plans'
import { info } from '../../src/repositories/browser/fixtures.test-support'
import type { SessionScope } from '../../src/domain/contracts'
import backup from '../fixtures/expansion/portable-v1.json'

it('restores the foundation portable-v1 format with exact fields and no imported paid access', async () => {
  const repo = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: crypto.randomUUID(),
  })
  try {
    const collection = info()
    let scope: SessionScope = {
      key: collection.key,
      generation: 1,
      device: { id: 'device', generation: 'generation' },
    }
    await repo.createCollection(collection)
    await repo.activate(scope)
    const data = createLocalDataAdapter({
      repository: repo,
      media: repo.media,
      plans: createBrowserOperationPlanStore(repo),
      scope: () => scope,
    })
    const service = createBackupService({
      repository: repo,
      media: repo.media,
      data,
      scope: () => scope,
    })
    const key = await service.restoreAsRecovered(
      backupSchema.parse(backup),
      'Previous release',
      'portable-v1-compatibility',
    )
    scope = await repo.transition(scope, { key, device: scope.device })
    expect((await service.exportComplete()).projects).toEqual(backup.projects)
    expect((await repo.readView(key)).info.legacyAccess).toBe(false)
    expect((await repo.readView(key)).info.accountId).toBeNull()
    for (const corrupt of [
      { ...backup, version: 2 },
      { ...backup, upgraded: true },
      { ...backup, projects: [{ ...backup.projects[0], legacyAccess: true }] },
    ])
      expect(backupSchema.safeParse(corrupt).success).toBe(false)
  } finally {
    await repo.close()
  }
})

it('older local readers fail closed on a future schema and leave its data intact', async () => {
  const factory = new IDBFactory(),
    name = 'future-schema'
  const request = factory.open(name, BROWSER_SCHEMA_VERSION + 1)
  request.onupgradeneeded = () => request.result.createObjectStore('future')
  const future = await requestResult(request)
  const tx = future.transaction('future', 'readwrite')
  tx.objectStore('future').put({ preserved: true }, 'sentinel')
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve()
  })
  future.close()
  await expect(openDatabase(name, factory)).rejects.toMatchObject({
    detail: { code: 'LOCAL_STORAGE_FAILED' },
  })
  const reopened = await requestResult(factory.open(name))
  expect(reopened.version).toBe(BROWSER_SCHEMA_VERSION + 1)
  expect(
    await requestResult(reopened.transaction('future').objectStore('future').get('sentinel')),
  ).toEqual({ preserved: true })
  reopened.close()
})

it('rejects unsupported wire generations instead of interpreting them as empty successful sync', () => {
  const valid = {
    protocolVersion: 2,
    collectionId: 'collection',
    epoch: 'epoch',
    afterCursor: '0',
    nextCursor: '0',
    hasMore: false,
    entries: [],
  }
  expect(parsePullPage(valid)).toEqual(valid)
  for (const protocolVersion of [0, 1, 3])
    expect(() => parsePullPage({ ...valid, protocolVersion })).toThrow()
})
