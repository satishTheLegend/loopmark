import { IDBFactory } from 'fake-indexeddb'
import { expect, it } from 'vitest'
import { openBrowserRepository } from '../repositories/browser/repository'
import { createBrowserWorkflowStore } from '../repositories/browser/workflow-store'
import { info } from '../repositories/browser/fixtures.test-support'
import { createUpgradePrompts } from './upgrade-prompts'
import type { SessionScope } from '../domain/contracts'

it('retains a pre-auth draft action across reload without claiming account ownership or changing the draft', async () => {
  const repository = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: crypto.randomUUID(),
  })
  try {
    const collection = info(),
      scope: SessionScope = {
        key: collection.key,
        generation: 1,
        device: { id: 'device', generation: 'generation' },
      }
    await repository.createCollection(collection)
    await repository.activate(scope)
    const workflows = createBrowserWorkflowStore(repository),
      options = { workflows, scope: () => scope }
    const first = createUpgradePrompts(options)
    const saved = await first.save({ returnAction: 'new-project', draftKey: 'new' })
    expect(await createUpgradePrompts(options).read()).toEqual(saved)
    const row = (await workflows.list('purchase'))[0]
    expect(row.accountId).toMatch(/^local_/)
    expect(row.collection).toEqual(scope.key)
    expect((await repository.readView(scope.key)).projects).toEqual([])
    await first.clear()
    expect(await first.read()).toBeNull()
  } finally {
    await repository.close()
  }
})

it('keeps local prompts separate for two collections and rejects a stale generation mutation', async () => {
  const repository = await openBrowserRepository({
    factory: new IDBFactory(),
    databaseName: crypto.randomUUID(),
  })
  try {
    const first = info(),
      second = { ...info(), key: { ...first.key, collectionId: 'second' } }
    let scope: SessionScope = {
      key: first.key,
      generation: 1,
      device: { id: 'device', generation: 'generation' },
    }
    await repository.createCollection(first)
    await repository.createCollection(second)
    await repository.activate(scope)
    const workflow = createUpgradePrompts({
      workflows: createBrowserWorkflowStore(repository),
      scope: () => scope,
    })
    await workflow.save({ returnAction: 'reopen-project', projectId: 'saved-project' })
    const oldScope = scope
    scope = await repository.transition(scope, { key: second.key, device: scope.device })
    expect(await workflow.read()).toBeNull()
    const stale = createUpgradePrompts({
      workflows: createBrowserWorkflowStore(repository),
      scope: () => oldScope,
    })
    await expect(stale.save({ returnAction: 'settings' })).rejects.toMatchObject({
      detail: { code: 'ACCOUNT_CHANGED' },
    })
    scope = await repository.transition(scope, { key: first.key, device: scope.device })
    expect(await workflow.read()).toMatchObject({
      returnAction: 'reopen-project',
      projectId: 'saved-project',
    })
  } finally {
    await repository.close()
  }
})
