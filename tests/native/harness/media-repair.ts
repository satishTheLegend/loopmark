import { openNativeRepository } from '../../../src/platform/native/repository'
import { durableFiles } from '../../../src/platform/native/files-bridge'
import { scopeKey } from '../../../src/platform/native/recovery-journal'
import { describeInline } from '../../../src/services/media-codec'
import { sha256Bytes } from '../../../src/domain/canonical-json'
import { DomainError, type ErrorCode } from '../../../src/domain/errors'
import { fixture, create } from './persistence'
import { localSave } from '../../examples/local-save'
import { completeLocalExport } from '../../examples/complete-export'
import { createBackupService } from '../../../src/services/backup-service'
import { createRemoteMediaService } from '../../../src/services/media-service'
import { createNativeWorkflowStore } from '../../../src/platform/native/workflow-store'
import { createLocalDataAdapter } from '../../../src/services/local-data-service'
import { createNativeOperationPlanStore } from '../../../src/platform/native/operation-plans'
import type { SnapshotManifest } from '../../../src/domain/contracts'

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQmcAAAAASUVORK5CYII='
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message)
}
async function rejects(action: () => Promise<unknown>, code: ErrorCode) {
  try {
    await action()
  } catch (error) {
    assert(error instanceof DomainError && error.detail.code === code, `Expected ${code}`)
    return
  }
  throw new Error(`Expected ${code} rejection`)
}

/** Corrupts only a synthetic fixture file through the actual native bridge. */
export async function nativeMediaRepair() {
  const databaseName = `repair_${Date.now()}`,
    info = fixture()
  let repo = await openNativeRepository({ databaseName })
  await repo.createCollection(info)
  const scope = await repo.transition(null, {
    key: info.key,
    device: { id: 'repair-device', generation: 'first' },
  })
  const { ref, bytes } = await describeInline(png, 'photo')
  await repo.media.storeVerified(ref, bytes, scope.key, scope.generation)
  const intent = create(info)
  if (intent.kind !== 'project.create') throw new Error('Wrong fixture')
  await localSave(
    repo,
    scope,
    intent.payload.project,
    {
      id: 'repair-checkpoint',
      projectId: intent.payload.project.id,
      createdAt: info.createdAt,
      position: 'Row 12',
      toolSize: '4 mm',
      nextStep: 'Keep these stitches',
      notes: '',
      photo: ref,
    },
    { project: 'repair-create', checkpoint: 'repair-pause' },
  )
  await repo.drafts.save(
    'repair-draft',
    scope.key,
    scope.generation,
    { notes: 'Keep this draft' },
    [ref],
    null,
  )
  const snapshot = await repo.snapshot(scope.key)
  const pointer = async () =>
    repo.database.serial(async (db) =>
      String(
        (
          await db.query('SELECT file_key FROM media WHERE scope=? AND id=?', [
            scopeKey(scope.key),
            ref.id,
          ])
        ).values![0].file_key,
      ),
    )
  const pins = async () =>
    repo.database.serial(async (db) =>
      JSON.stringify(
        (
          await db.query('SELECT owner,scope,media_id FROM pins WHERE scope=? ORDER BY owner', [
            scopeKey(scope.key),
          ])
        ).values,
      ),
    )
  const original = await pointer(),
    originalPins = await pins()
  await repo.media.storeVerified(ref, bytes, scope.key, scope.generation)
  assert((await pointer()) === original, 'Valid cached bytes should remain immutable')
  const corrupt = new TextEncoder().encode('Synthetic corrupt cached photo')
  await durableFiles.remove({ key: original })
  await durableFiles.put({
    key: original,
    base64: btoa(String.fromCharCode(...corrupt)),
    sha256: await sha256Bytes(corrupt),
  })
  await rejects(() => repo.media.open(ref, scope.key), 'MEDIA_INVALID')
  await repo.database.serial((db) =>
    db.execute(
      "CREATE TEMP TRIGGER fail_repair BEFORE UPDATE ON media BEGIN SELECT RAISE(ABORT, 'synthetic repair commit failure'); END;",
    ),
  )
  await rejects(
    () => repo.media.storeVerified(ref, bytes, scope.key, scope.generation),
    'LOCAL_STORAGE_FAILED',
  )
  assert(
    (await pointer()) === original && (await pins()) === originalPins,
    'Failed repair changed pointer or pins',
  )
  await repo.database.serial((db) => db.execute('DROP TRIGGER fail_repair;'))
  await rejects(
    () => repo.media.storeVerified(ref, bytes, scope.key, scope.generation + 10),
    'ACCOUNT_CHANGED',
  )
  assert((await pointer()) === original, 'Stale generation changed file pointer')
  await repo.media.storeVerified(ref, bytes, scope.key, scope.generation)
  const repaired = await pointer()
  assert(
    repaired !== original && (await pins()) === originalPins,
    'Repair must atomically replace file pointer and preserve pins',
  )
  assert(
    (await completeLocalExport(repo, repo.media, scope)).projects[0].checkpoints[0].photo === png,
    'Repaired export bytes differ',
  )
  await durableFiles.remove({ key: repaired })
  await rejects(() => repo.media.open(ref, scope.key), 'BACKUP_INCOMPLETE')
  await repo.media.storeVerified(ref, bytes, scope.key, scope.generation)
  assert(
    (await pointer()) !== repaired && (await pins()) === originalPins,
    'Missing-file repair lost pins',
  )
  await repo.close()
  repo = await openNativeRepository({ databaseName })
  assert(
    (await completeLocalExport(repo, repo.media, scope)).projects[0].checkpoints[0].photo === png,
    'Repaired file lost after reopen',
  )
  const savedDraft = (await repo.drafts.read('repair-draft', scope.key))?.value as
    { notes?: string } | undefined
  assert(savedDraft?.notes === 'Keep this draft', 'Repair changed draft')
  await repo.releaseSnapshot(snapshot.id)
  await repo.close()
  await nativeCompleteExportRepair()
  return [
    'actual native corruption detected',
    'failed SQL repair preserves original pointer and draft/export pins',
    'stale generation rejected',
    'immutable replacement repairs corrupt and missing files',
    'reopen complete export preserves exact photo',
    'actual complete-export service downloads and repairs corrupt cache using synthetic authenticated transport',
  ]
}

async function nativeCompleteExportRepair() {
  const repo = await openNativeRepository({ databaseName: `export_repair_${Date.now()}` }),
    info = fixture(true)
  await repo.createCollection(info)
  const scope = await repo.transition(null, {
    key: info.key,
    device: { id: 'repair-device', generation: 'first' },
  })
  const { ref, bytes } = await describeInline(png, 'photo'),
    intent = create(info)
  if (intent.kind !== 'project.create') throw new Error('Wrong fixture')
  const manifest: SnapshotManifest = {
    protocolVersion: 2,
    snapshotId: 'repair-export-snapshot',
    collectionId: scope.key.collectionId,
    epoch: scope.key.epoch,
    cursor: '1',
    revision: '1',
    expiresAt: '2030-01-01T00:00:00.000Z',
    after: null,
    nextPage: null,
    projects: [{ ...intent.payload.project, revision: '1' }],
    checkpoints: [
      {
        id: 'export-checkpoint',
        projectId: intent.payload.project.id,
        createdAt: info.createdAt,
        revision: '1',
        position: 'Row 12',
        toolSize: '4 mm',
        nextStep: 'Keep these stitches',
        notes: '',
        photo: ref,
      },
    ],
    media: [ref],
  }
  await repo.hydrate(scope.key, [manifest], scope.generation)
  await repo.media.storeVerified(ref, bytes, scope.key, scope.generation)
  const row = await repo.database.serial(
    async (db) =>
      (
        await db.query('SELECT file_key FROM media WHERE scope=? AND id=?', [
          scopeKey(scope.key),
          ref.id,
        ])
      ).values![0],
  )
  const fileKey = String(row.file_key),
    corrupt = new Uint8Array([1, 2, 3])
  await durableFiles.remove({ key: fileKey })
  await durableFiles.put({
    key: fileKey,
    base64: btoa(String.fromCharCode(...corrupt)),
    sha256: await sha256Bytes(corrupt),
  })
  const session = {
    accountId: info.accountId!,
    billingPrincipalId: 'repair-principal',
    collection: scope.key,
    device: scope.device,
    deletionGeneration: '0',
    expiresAt: '2030-01-01T00:00:00.000Z',
  }
  let downloads = 0,
    releases = 0
  const unused = async (): Promise<never> => {
    throw new Error('Unexpected transport operation')
  }
  const remote = createRemoteMediaService({
    repository: repo,
    media: repo.media,
    workflows: createNativeWorkflowStore(repo),
    current: () => session,
    transport: {
      reserve: unused,
      upload: unused,
      cancel: unused,
      download: async () => {
        downloads++
        const pins = await repo.database.serial(
          async (db) =>
            (
              await db.query(
                "SELECT owner FROM pins WHERE scope=? AND media_id=? AND owner LIKE 'snapshot:%'",
                [scopeKey(scope.key), ref.id],
              )
            ).values ?? [],
        )
        assert(pins.length > 0, 'Repair download lost its export pin')
        return bytes
      },
    },
  })
  const data = createLocalDataAdapter({
    repository: repo,
    media: repo.media,
    plans: createNativeOperationPlanStore(repo),
    scope: () => scope,
  })
  const backups = createBackupService({
    repository: repo,
    media: repo.media,
    data,
    scope: () => scope,
    remote: {
      current: () => session,
      media: remote,
      transport: {
        snapshot: async () => manifest,
        releaseSnapshot: async () => {
          releases++
        },
        push: unused,
        pull: unused,
      },
    },
  })
  const backup = await backups.exportComplete()
  assert(
    backup.projects[0].checkpoints[0].photo === png && downloads === 1 && releases === 1,
    'Complete backup did not repair exact bytes or release lease',
  )
  await backups.exportComplete()
  assert(downloads === 1, 'Already repaired cache downloaded twice')
  await repo.close()
}
