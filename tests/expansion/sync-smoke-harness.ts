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
import { createBrowserWorkflowStore } from '../../src/repositories/browser/workflow-store'
import { createRemoteMediaService } from '../../src/services/media-service'
import { createMediaTransport } from '../../src/sync/media-transport'
import { createReplacementService } from '../../src/services/replacement-service'
import { createBackupService } from '../../src/services/backup-service'
import { createDeletionService } from '../../src/services/deletion-service'
import { DomainError } from '../../src/domain/errors'
let controller: ReturnType<typeof createAppController>,
  adapter: ReturnType<typeof createLocalDataAdapter>,
  replacement: ReturnType<typeof createReplacementService>,
  deletion: ReturnType<typeof createDeletionService>,
  backupService: ReturnType<typeof createBackupService>,
  remoteMedia: ReturnType<typeof createRemoteMediaService>,
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
  const config = parsePublicConfig(environment)
  if (!config.cloud.enabled) throw new Error('Cloud required')
  const auth = createAccountAuth({
    config,
    devices: createBrowserDeviceStore(repository),
  })
  const workflows = createBrowserWorkflowStore(repository),
    transport = createSyncTransport(auth.functions),
    current = () => controller?.getSession() ?? null
  remoteMedia = createRemoteMediaService({
    repository,
    media: repository.media,
    workflows,
    current,
    transport: createMediaTransport({
      url: config.cloud.url,
      publicKey: config.cloud.publicKey,
      token: auth.accessToken,
      client: auth.functions,
    }),
  })
  replacement = createReplacementService({
    repository,
    workflows,
    transport,
    client: auth.functions,
    media: remoteMedia,
    current,
  })
  deletion = createDeletionService({ repository, workflows, auth, client: auth.functions, current })
  controller = createAppController({
    repository,
    media: repository.media,
    connections: replacement,
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
  backupService = createBackupService({
    repository,
    media: repository.media,
    data: adapter,
    scope: () => controller.getSnapshot().scope!,
    remote: { media: remoteMedia, transport, current },
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

export async function photoCheckpoint(projectId: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const context = canvas.getContext('2d')!
  context.fillStyle = '#759688'
  context.fillRect(0, 0, 32, 32)
  const photo = canvas.toDataURL('image/png')
  await adapter.addCheckpoint(
    projectId,
    {
      position: 'row 20',
      toolSize: '4 mm',
      nextStep: 'Turn and continue the photo row',
      notes: '',
      photo,
    },
    'photo-token',
  )
  return photo
}
export async function previewGuest() {
  const source = controller.getSnapshot().collections.find((c) => c.kind === 'guest')!
  return controller.previewAttach(source.key)
}
export const confirm = (preview: Awaited<ReturnType<typeof previewGuest>>) =>
  controller.confirmAttach(preview)
export async function downloadAll() {
  const scope = controller.getSnapshot().scope!
  const view = await repository.readView(scope.key)
  for (const checkpoint of view.checkpoints)
    for (const ref of [checkpoint.photo, checkpoint.voice])
      if (ref) await remoteMedia.ensureAvailable(ref, scope, new AbortController().signal)
}
export const backup = () => backupService.exportComplete()
export const candidates = () => replacement.list()
export const deletionCode = () =>
  deletion.requestCode(controller.getSnapshot().scope!, new AbortController().signal)
export const review = () => controller.prepareSignOut()
export async function deleteAccount(code: string) {
  let id = ''
  await controller.deleteAccount({ keepLocal: true }, async (scope) => {
    id = (
      await deletion.delete(
        { operationToken: 'delete-test', code },
        scope,
        new AbortController().signal,
      )
    ).id
  })
  await deletion.recordLocalOutcome(id, 'kept')
  return {
    id,
    receipt: await deletion.refreshReceipt(id, new AbortController().signal),
    saved: await deletion.listReceipts(),
  }
}
