import { openNativeRepository } from '../../../src/platform/native/repository'
import { createNativeWorkflowStore } from '../../../src/platform/native/workflow-store'
import { removeNativeDownloads } from '../../../src/platform/native/downloads'
import { durableFiles } from '../../../src/platform/native/files-bridge'
import { scopeKey } from '../../../src/platform/native/recovery-journal'
import { sha256Bytes } from '../../../src/domain/canonical-json'
import { DomainError, type ErrorCode } from '../../../src/domain/errors'
import type { MediaRef, SnapshotManifest } from '../../../src/domain/contracts'
import { fixture, create, wave } from './persistence'
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
  throw new Error(`Expected ${code}`)
}
/** Real SQLite/files; one injected bridge rejection tests durable cleanup retry, not an OS fault claim. */
export async function nativeDownloads() {
  const databaseName = `downloads_${Date.now()}`,
    info = fixture(true),
    bytes = wave()
  let repo = await openNativeRepository({ databaseName })
  await repo.createCollection(info)
  const scope = await repo.transition(null, {
    key: info.key,
    device: { id: 'download-device', generation: 'initial' },
  })
  const ref: MediaRef = {
      id: 'remote-voice',
      kind: 'voice',
      mimeType: bytes.type,
      bytes: bytes.size,
      sha256: await sha256Bytes(new Uint8Array(await bytes.arrayBuffer())),
    },
    local = { ...ref, id: 'local-voice' }
  const intent = create(info)
  if (intent.kind !== 'project.create') throw new Error('Wrong fixture')
  const page: SnapshotManifest = {
    protocolVersion: 2,
    snapshotId: 'download-snapshot',
    collectionId: scope.key.collectionId,
    epoch: scope.key.epoch,
    cursor: '1',
    revision: '1',
    expiresAt: '2030-01-01T00:00:00.000Z',
    after: null,
    nextPage: null,
    projects: [{ ...intent.payload.project, revision: '1' }],
    checkpoints: [ref, local].map((voice, i) => ({
      id: `download-checkpoint-${i}`,
      projectId: 'native-project',
      revision: '1',
      createdAt: info.createdAt,
      position: 'Row 1',
      toolSize: '4 mm',
      nextStep: 'Continue',
      notes: '',
      voice,
    })),
    media: [ref, local],
  }
  await repo.hydrate(scope.key, [page], scope.generation)
  await repo.media.storeVerified(ref, bytes, scope.key, scope.generation, { downloaded: true })
  await repo.media.storeVerified(local, bytes, scope.key, scope.generation)
  await repo.media.storeVerified(local, bytes, scope.key, scope.generation, { downloaded: true })
  const row = async (id: string) =>
    repo.database.serial(
      async (db) =>
        (
          await db.query('SELECT file_key,downloaded FROM media WHERE scope=? AND id=?', [
            scopeKey(scope.key),
            id,
          ])
        ).values?.[0],
    )
  assert(
    (await row(local.id))?.downloaded === 0 && (await row(ref.id))?.downloaded === 1,
    'Local provenance was promoted to removable remote cache',
  )
  const snapshot = await repo.snapshot(scope.key)
  await rejects(() => repo.removeDownloads(scope, 'native-project'), 'DOWNLOADS_PROTECTED')
  await repo.releaseSnapshot(snapshot.id)
  const draft = await repo.drafts.save(
    'voice-draft',
    scope.key,
    scope.generation,
    { notes: 'Keep draft recording' },
    [ref],
    null,
  )
  await rejects(() => repo.removeDownloads(scope, 'native-project'), 'DOWNLOADS_PROTECTED')
  await repo.drafts.clear(draft.id, scope.key, scope.generation, draft.revision)
  const workflows = createNativeWorkflowStore(repo)
  const upload = await workflows.write(
    'download-upload',
    null,
    {
      kind: 'upload',
      accountId: info.accountId!,
      collection: scope.key,
      value: { state: 'reserved', ref },
    },
    scope,
  )
  await rejects(() => repo.removeDownloads(scope, 'native-project'), 'DOWNLOADS_PROTECTED')
  await workflows.remove(upload.id, upload.revision, scope)
  const candidate = await workflows.write(
    'download-candidate',
    null,
    {
      kind: 'candidate',
      accountId: info.accountId!,
      collection: scope.key,
      value: { phase: 'preview', preview: { source: { key: scope.key } } },
    },
    scope,
  )
  await rejects(() => repo.removeDownloads(scope, 'native-project'), 'DOWNLOADS_PROTECTED')
  await workflows.remove(candidate.id, candidate.revision, scope)
  await repo.commitLocal(
    scope.key,
    {
      kind: 'project.update',
      operationId: 'download-pending',
      base: { revision: '1' },
      createdAt: info.createdAt,
      payload: {
        projectId: 'native-project',
        updatedAt: info.createdAt,
        fields: {
          name: 'Pending scarf',
          craft: 'Knitting',
          color: 'clay',
          yarn: '',
          toolSize: '4 mm',
          notes: '',
        },
      },
    },
    scope.generation,
  )
  await rejects(() => repo.removeDownloads(scope, 'native-project'), 'DOWNLOADS_PROTECTED')
  const pending = (await repo.pending(scope.key))[0]
  await repo.acknowledge(
    scope.key,
    {
      operationId: pending.command.operationId,
      sha256: pending.command.sha256,
      epoch: scope.key.epoch,
      revision: '2',
      cursor: '2',
      resultId: 'native-project',
      changes: [
        {
          kind: 'project.put',
          value: { ...page.projects[0], name: 'Pending scarf', revision: '2' },
        },
      ],
    },
    scope.generation,
  )
  const file = String((await row(ref.id))!.file_key)
  await repo.database.serial((db) =>
    db.execute(
      "CREATE TEMP TRIGGER fail_download_delete BEFORE DELETE ON media BEGIN SELECT RAISE(ABORT, 'synthetic eviction failure'); END;",
    ),
  )
  await rejects(() => repo.removeDownloads(scope, 'native-project'), 'LOCAL_STORAGE_FAILED')
  assert(
    !!(await row(ref.id)) && (await durableFiles.list()).files.some((item) => item.key === file),
    'SQL rollback destroyed downloaded bytes',
  )
  await repo.database.serial((db) => db.execute('DROP TRIGGER fail_download_delete;'))
  await rejects(
    () =>
      removeNativeDownloads(repo.database, scope, 'native-project', async () => {
        throw new DomainError('LOCAL_STORAGE_FAILED')
      }),
    'LOCAL_STORAGE_FAILED',
  )
  assert(
    !(await row(ref.id)) && (await durableFiles.list()).files.some((item) => item.key === file),
    'Failed physical cleanup should retain only an unreferenced journalled file',
  )
  await repo.close()
  repo = await openNativeRepository({ databaseName })
  const result = await repo.removeDownloads(scope, 'native-project')
  assert(
    result.removed === 1 &&
      result.retained === 1 &&
      !(await durableFiles.list()).files.some((item) => item.key === file),
    'Restart cleanup did not physically remove only remote bytes',
  )
  await rejects(() => repo.media.open(ref, scope.key), 'BACKUP_INCOMPLETE')
  assert(
    (await new Response(await repo.media.open(local, scope.key)).blob()).size === local.bytes,
    'Local source bytes were removed',
  )
  await repo.media.storeVerified(ref, bytes, scope.key, scope.generation, { downloaded: true })
  assert(
    (await new Response(await repo.media.open(ref, scope.key)).blob()).size === ref.bytes,
    'Redownload failed',
  )
  await rejects(
    () => repo.removeDownloads({ ...scope, generation: scope.generation + 1 }, 'native-project'),
    'ACCOUNT_CHANGED',
  )
  assert(
    (await repo.removeDownloads(scope, 'native-project')).removed === 1,
    'Verified redownload was not removable',
  )
  await repo.close()
  return [
    'sticky local provenance and acknowledged remote eligibility',
    'draft/export/upload/candidate/pending command protections',
    'actual SQLite rollback preserves physical bytes',
    'injected bridge rejection survives close/reopen and retries journalled physical cleanup',
    'removed bytes become unavailable and verified redownload works',
    'exact session-generation fence',
  ]
}
