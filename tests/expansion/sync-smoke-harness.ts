import { openBrowserRepository } from '../../src/repositories/browser/repository'
import { createBrowserDeviceStore } from '../../src/repositories/browser/device-store'
import { createBrowserOperationPlanStore } from '../../src/repositories/browser/operation-plans'
import { createAccountAuth } from '../../src/auth/auth-service'
import { createAppController } from '../../src/services/app-controller'
import { createLocalDataAdapter } from '../../src/services/local-data-service'
import { createSyncCoordinator } from '../../src/sync/coordinator'
import { createSyncTransport } from '../../src/sync/transport'
import { createTabLease } from '../../src/sync/tab-lease'
import { parsePublicConfig } from '../../src/config'
import { DomainError } from '../../src/domain/errors'
let controller: ReturnType<typeof createAppController>,
  adapter: ReturnType<typeof createLocalDataAdapter>,
  repository: Awaited<ReturnType<typeof openBrowserRepository>>
export async function start(environment: Record<string, string>) {
  repository = await openBrowserRepository({ databaseName: 'smoke-client' })
  const collection = {
    key: {
      namespace: `guest_${crypto.randomUUID()}`,
      collectionId: crypto.randomUUID(),
      epoch: crypto.randomUUID(),
    },
    name: 'My device projects',
    kind: 'guest' as const,
    accountId: null,
    legacyAccess: false,
    createdAt: new Date().toISOString(),
  }
  if (!(await repository.readActive())) {
    await repository.createCollection(collection)
    await repository.transition(null, {
      key: collection.key,
      device: { id: crypto.randomUUID(), generation: crypto.randomUUID() },
    })
  }
  const auth = createAccountAuth({
    config: parsePublicConfig(environment),
    devices: createBrowserDeviceStore(repository),
  })
  controller = createAppController({
    repository,
    auth,
    sync: createSyncCoordinator({
      repository,
      transport: createSyncTransport(auth.functions),
      lease: createTabLease(),
    }),
  })
  await controller.initialize()
  adapter = createLocalDataAdapter({
    repository,
    media: repository.media,
    plans: createBrowserOperationPlanStore(repository),
    scope: () => {
      const scope = controller.getSnapshot().scope
      if (!scope) throw new DomainError('ACCOUNT_CHANGED')
      return scope
    },
  })
}
export const requestCode = (email: string) => controller.requestCode(email)
export const verifyCode = (email: string, code: string) => controller.verifyCode(email, code)
export async function selectAccount() {
  const collection = controller.getSnapshot().collections.find((c) => c.kind === 'connected')
  if (!collection) throw new Error('No verified account collection')
  await controller.chooseCollection(collection.key)
  await controller.runSync()
}
export const sync = () => controller.runSync()
export const state = () => controller.getSnapshot()
export const createProject = () =>
  adapter.createProject(
    {
      name: 'Synthetic week-later scarf',
      craft: 'Crochet',
      color: 'sage',
      yarn: 'Test cotton',
      toolSize: '4 mm',
      notes: '',
    },
    'project-token',
  )
export const checkpoint = (projectId: string, token: string, nextStep: string) =>
  adapter.addCheckpoint(
    projectId,
    { position: token, toolSize: '4 mm', nextStep, notes: '' },
    token,
  )
export const projects = () => adapter.listProjects()
export async function close() {
  await controller.dispose()
  await repository.close()
}
export async function keepDeviceConflict() {
  const view = controller.getSnapshot().view!,
    pending = view.pending.find((p) => p.state === 'conflict')
  if (!pending) throw new Error('Expected a reviewed conflict')
  await controller.resolveConflict(pending.intent.operationId, view.revision, { action: 'device' })
  await controller.runSync()
}
