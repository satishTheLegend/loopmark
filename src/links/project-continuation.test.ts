import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { openBrowserRepository, type BrowserRepository } from '../repositories/browser/repository'
import { createBrowserWorkflowStore } from '../repositories/browser/workflow-store'
import { create, info } from '../repositories/browser/fixtures.test-support'
import type { SessionScope } from '../domain/contracts'
import { createProjectContinuation } from './project-continuation'
import { parseProjectLink } from './link-service'

const repositories: BrowserRepository[] = []
afterEach(async () => {
  for (const repository of repositories.splice(0)) await repository.close()
})
async function fixture() {
  const factory = new IDBFactory(),
    databaseName = crypto.randomUUID()
  let repository = await openBrowserRepository({ factory, databaseName })
  repositories.push(repository)
  const guest = info(false, 'guest'),
    account = info(true, 'owned'),
    other = { ...info(true, 'other'), accountId: 'other' }
  await repository.createCollection(guest)
  await repository.createCollection(account)
  await repository.createCollection(other)
  let scope: SessionScope = {
    key: guest.key,
    generation: 1,
    device: { id: 'device', generation: 'generation' },
  }
  let accountId: string | null = null,
    clock = Date.now()
  await repository.activate(scope)
  const hydrate = vi.fn(async (_signal: AbortSignal) => {})
  const current = () => ({ scope, accountId })
  const service = () =>
    createProjectContinuation({
      repository,
      workflows: createBrowserWorkflowStore(repository),
      current,
      hydrate,
      now: () => clock,
    })
  return {
    get repository() {
      return repository
    },
    get scope() {
      return scope
    },
    guest,
    account,
    other,
    hydrate,
    service,
    setAccount(value: string | null) {
      accountId = value
    },
    advance(ms: number) {
      clock += ms
    },
    async select(collection: typeof guest) {
      scope = await repository.transition(scope, { key: collection.key, device: scope.device })
    },
    async reopen() {
      await repository.close()
      repository = await openBrowserRepository({ factory, databaseName })
      repositories.push(repository)
    },
  }
}

it('persists a parsed target through restart and login, then opens only after explicit owned collection selection', async () => {
  const f = await fixture(),
    first = f.service()
  const target = parseProjectLink('https://craft.example/p/wanted', 'https://craft.example')
  const pending = await first.capture(target)
  await expect(first.continue(pending.token)).rejects.toMatchObject({
    detail: { code: 'NOT_AVAILABLE' },
  })
  first.dispose()
  await f.reopen()
  const resumed = f.service()
  await resumed.initialize()
  expect(resumed.getSnapshot().pending).toEqual(pending)
  f.setAccount('account')
  // Authentication itself neither selects a collection nor imports this local target.
  await expect(resumed.continue(pending.token)).rejects.toMatchObject({
    detail: { code: 'NOT_AVAILABLE' },
  })
  expect((await f.repository.readView(f.guest.key)).projects).toEqual([])
  await f.select(f.account)
  await f.repository.commitLocal(f.scope.key, create('wanted'), f.scope.generation)
  expect((await resumed.continue(pending.token)).id).toBe('wanted')
  expect(resumed.getSnapshot().pending).toBeNull()
  expect(await createBrowserWorkflowStore(f.repository).list('navigation')).toEqual([])
  expect(f.hydrate).not.toHaveBeenCalled() // The selected owned cache is enough offline.
})

it('a wrong account learns no project metadata and leaves the legacy target available for an explicit later choice', async () => {
  const f = await fixture()
  await f.select(f.account)
  f.setAccount('account')
  await f.repository.commitLocal(f.scope.key, create('private-project'), f.scope.generation)
  await f.select(f.other)
  f.setAccount('other')
  const service = f.service()
  const pending = await service.capture(
    parseProjectLink('https://craft.example/#project=private-project', 'https://craft.example'),
  )
  await expect(service.continue(pending.token)).rejects.toMatchObject({
    detail: { code: 'NOT_AVAILABLE' },
  })
  expect(f.hydrate).toHaveBeenCalledOnce()
  expect(JSON.stringify(service.getSnapshot())).not.toContain('Moss scarf')
  expect(service.getSnapshot().pending).toEqual(pending)
  await f.select(f.account)
  f.setAccount('account')
  f.hydrate.mockRejectedValue(new Error('Offline'))
  expect((await service.continue(pending.token)).id).toBe('private-project')
  expect(f.hydrate).toHaveBeenCalledOnce()
})

it('late hydration cannot consume a newer scanned target or navigate after a scope change', async () => {
  const f = await fixture()
  await f.select(f.account)
  f.setAccount('account')
  const service = f.service()
  const first = await service.capture({ kind: 'project', projectId: 'first' })
  let entered!: () => void, finish!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const held = new Promise<void>((resolve) => {
    finish = resolve
  })
  f.hydrate.mockImplementationOnce(async () => {
    entered()
    await held
  })
  const continuation = service.continue(first.token).catch((error) => error)
  await started
  const newer = await service.capture({ kind: 'project', projectId: 'newer' })
  await f.repository.commitLocal(f.scope.key, create('first'), f.scope.generation)
  finish()
  expect(await continuation).toMatchObject({ detail: { code: 'REVISION_CONFLICT' } })
  expect(service.getSnapshot().pending).toEqual(newer)
  f.hydrate.mockImplementationOnce(async () => {
    await f.select(f.other)
    f.setAccount('other')
  })
  await expect(service.continue(newer.token)).rejects.toMatchObject({
    detail: { code: 'ACCOUNT_CHANGED' },
  })
  expect(service.getSnapshot().pending).toEqual(newer)
  await expect(service.dismiss(first.token)).rejects.toMatchObject({
    detail: { code: 'NOT_AVAILABLE' },
  })
  expect(service.getSnapshot().pending).toEqual(newer)
  await service.dismiss(newer.token)
  expect(service.getSnapshot().pending).toBeNull()
})

it('stores only a bounded target, reuses a repeated scan and expires it after 24 hours', async () => {
  const f = await fixture(),
    service = f.service()
  const pending = await service.capture({ kind: 'project', projectId: 'wanted' })
  expect(await service.capture({ kind: 'project', projectId: 'wanted' })).toEqual(pending)
  await expect(
    service.capture({
      kind: 'project',
      projectId: 'wanted',
      next: 'https://private.invalid/?token=secret',
    } as never),
  ).rejects.toMatchObject({ detail: { code: 'NOT_AVAILABLE' } })
  const [row] = await createBrowserWorkflowStore(f.repository).list('navigation')
  expect(row.collection).toBeNull()
  expect(row.accountId).toBe('local_navigation')
  expect(JSON.stringify(row)).not.toMatch(/private\.invalid|next|Moss scarf/)
  expect(JSON.stringify(row).length).toBeLessThan(600)
  f.advance(24 * 60 * 60 * 1000)
  await service.initialize()
  expect(service.getSnapshot().pending).toBeNull()
  await expect(service.continue(pending.token)).rejects.toMatchObject({
    detail: { code: 'NOT_AVAILABLE' },
  })
  expect(await createBrowserWorkflowStore(f.repository).list('navigation')).toEqual([])
})

it('concurrent duplicate captures and continuations share one token and consume it without a false failure', async () => {
  const f = await fixture(),
    service = f.service()
  await f.repository.commitLocal(f.scope.key, create('wanted'), f.scope.generation)
  const [first, second] = await Promise.all([
    service.capture({ kind: 'project', projectId: 'wanted' }),
    service.capture({ kind: 'project', projectId: 'wanted' }),
  ])
  expect(second).toEqual(first)
  const [one, two] = await Promise.all([
    service.continue(first.token),
    service.continue(second.token),
  ])
  expect(one.id).toBe('wanted')
  expect(two.id).toBe('wanted')
  expect(service.getSnapshot()).toEqual({ pending: null, busy: false, error: null })
  expect(await createBrowserWorkflowStore(f.repository).list('navigation')).toEqual([])
})
