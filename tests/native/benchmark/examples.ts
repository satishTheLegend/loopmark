import { localSave } from '../../examples/local-save'
import { retryOne } from '../../examples/offline-retry'
import { useCloud } from '../../examples/conflict'
import { completeLocalExport } from '../../examples/complete-export'
import { openNativeRepository } from '../../../src/platform/native/repository'
import { fixture, create } from '../harness/persistence'
import { storeInline } from '../../../src/services/media-codec'
import { DomainError } from '../../../src/domain/errors'
import type { Command, Receipt } from '../../../src/domain/contracts'

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQmcAAAAASUVORK5CYII='
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message)
}
export async function nativeExamples() {
  const results: string[] = []
  const databaseName = `examples_${Date.now()}`
  let repo = await openNativeRepository({ databaseName })
  const local = fixture(),
    connected = fixture(true)
  await repo.createCollection(local)
  let scope = await repo.transition(null, {
    key: local.key,
    device: { id: 'example-device', generation: 'example-generation' },
  })
  const intent = create(local)
  if (intent.kind !== 'project.create') throw new Error('Wrong fixture kind.')
  const project = intent.payload.project,
    photo = await storeInline(png, 'photo', repo.media, scope),
    checkpoint = {
      id: 'example_checkpoint',
      projectId: project.id,
      createdAt: local.createdAt,
      position: 'Row 12',
      toolSize: '4 mm',
      nextStep: 'Turn and begin repeat 3',
      notes: '',
      photo,
    },
    operations = { project: 'example_create', checkpoint: 'example_pause' }
  await localSave(repo, scope, project, checkpoint, operations)
  await repo.close()
  repo = await openNativeRepository({ databaseName })
  const view = await localSave(repo, scope, project, checkpoint, operations)
  assert(
    view.projects.length === 1 &&
      view.checkpoints.length === 1 &&
      view.checkpoints[0].nextStep === checkpoint.nextStep,
    'Example local save/reopen duplicate or lost content.',
  )
  results.push('local-save.ts: actual SQLite close/reopen and same-intent retry')
  const backup = await completeLocalExport(repo, repo.media, scope)
  assert(
    backup.projects[0].checkpoints[0].photo === png,
    'Example complete export lost photo bytes.',
  )
  results.push('complete-export.ts: actual native files, pinned complete photo bytes')
  await repo.createCollection(connected)
  scope = await repo.transition(scope, { key: connected.key, device: scope.device })
  const initial = create(connected)
  await repo.commitLocal(scope.key, initial, scope.generation)
  const commands: Command[] = []
  const push = async (command: Command): Promise<Receipt> => {
    commands.push(structuredClone(command))
    if (commands.length === 1) throw new DomainError('SERVICE_UNAVAILABLE')
    return {
      operationId: command.operationId,
      sha256: command.sha256,
      epoch: command.epoch,
      revision: '1',
      cursor: '1',
      resultId: project.id,
      changes: [{ kind: 'project.put', value: { ...project, revision: '1' } }],
    }
  }
  let lost = false
  try {
    await retryOne(repo, scope, initial.operationId, push)
  } catch (error) {
    lost = error instanceof DomainError && error.detail.code === 'SERVICE_UNAVAILABLE'
  }
  assert(lost, 'Expected synthetic lost server response.')
  await retryOne(repo, scope, initial.operationId, push)
  await retryOne(repo, scope, initial.operationId, push)
  assert(
    commands.length === 2 &&
      JSON.stringify(commands[0]) === JSON.stringify(commands[1]) &&
      !(await repo.pending(scope.key)).length,
    'Example retry rewrote a durable command.',
  )
  results.push(
    'offline-retry.ts: actual SQLite outbox; synthetic lost reply preserves exact command/hash',
  )
  await repo.commitLocal(
    scope.key,
    {
      kind: 'project.update',
      operationId: 'example_rename',
      createdAt: local.createdAt,
      base: { revision: '1' },
      payload: {
        projectId: project.id,
        updatedAt: local.createdAt,
        fields: {
          name: 'My device notes',
          craft: 'Knitting',
          color: 'clay',
          yarn: '',
          toolSize: '4 mm',
          notes: 'Keep this',
        },
      },
    },
    scope.generation,
  )
  await repo.markFailure(
    scope.key,
    'example_rename',
    new DomainError('REVISION_CONFLICT').detail,
    scope.generation,
  )
  let stale = false
  try {
    await useCloud(repo, scope, 'example_rename', '0')
  } catch (error) {
    stale = error instanceof DomainError && error.detail.code === 'REVISION_CONFLICT'
  }
  assert(stale, 'Example accepted a stale conflict review.')
  const resolution = await useCloud(
    repo,
    scope,
    'example_rename',
    (await repo.readView(scope.key)).revision,
  )
  assert(
    resolution.recovered &&
      (await repo.readView(resolution.recovered)).projects[0].notes === 'Keep this' &&
      (await repo.readView(scope.key)).projects[0].name === project.name &&
      !(await repo.pending(scope.key)).length,
    'Example conflict choice lost local recovery or cloud state.',
  )
  results.push('conflict.ts: actual SQLite atomic recovery and stale-review rejection')
  await repo.close()
  return results
}
