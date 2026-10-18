import { openNativeRepository } from '../../../src/platform/native/repository'
import { createNativeWorkflowStore } from '../../../src/platform/native/workflow-store'
import { createNativeOperationPlanStore } from '../../../src/platform/native/operation-plans'
import { NativeCaptureRecovery } from '../../../src/platform/native/capture-recovery'
import { durableFiles } from '../../../src/platform/native/files-bridge'
import { scopeKey } from '../../../src/platform/native/recovery-journal'
import { canonicalHash, canonicalJson } from '../../../src/domain/canonical-json'
import { DomainError, type ErrorCode } from '../../../src/domain/errors'
import type { AccountSession, LocalIntent, SnapshotManifest } from '../../../src/domain/contracts'
import { describeInline } from '../../../src/services/media-codec'
import { fixture, create, wave } from './persistence'

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQmcAAAAASUVORK5CYII='
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message)
}
async function rejects(action: () => Promise<unknown>, code: ErrorCode) {
  try {
    await action()
  } catch (error) {
    assert(
      error instanceof DomainError && error.detail.code === code,
      `Expected ${code}; received ${error instanceof DomainError ? error.detail.code : String(error)}`,
    )
    return
  }
  throw new Error(`Expected ${code}`)
}

/** Actual SQLite and durable native files; the authenticated session/snapshot are synthetic fixtures. */
export async function nativeRebase() {
  const checks: string[] = []
  for (const changedEpoch of [false, true]) {
    const databaseName = `rebase_${Date.now()}`,
      info = fixture(true)
    let repo = await openNativeRepository({ databaseName })
    await repo.createCollection(info)
    let scope = await repo.transition(null, {
      key: info.key,
      device: { id: 'old-device', generation: 'old-generation' },
    })
    const projectIntent = create(info)
    if (projectIntent.kind !== 'project.create') throw new Error('Wrong fixture')
    const photo = await describeInline(png, 'photo')
    const page: SnapshotManifest = {
      protocolVersion: 2,
      snapshotId: 'native-rebase-old',
      collectionId: info.key.collectionId,
      epoch: info.key.epoch,
      cursor: '5',
      revision: '5',
      expiresAt: '2030-01-01T00:00:00.000Z',
      after: null,
      nextPage: null,
      projects: [{ ...projectIntent.payload.project, revision: '5' }],
      checkpoints: [
        {
          id: 'rebase-checkpoint',
          projectId: 'native-project',
          revision: '5',
          createdAt: info.createdAt,
          position: 'Row 12',
          toolSize: '4 mm',
          nextStep: 'Keep these stitches',
          notes: '',
          photo: photo.ref,
        },
      ],
      media: [photo.ref],
    }
    await repo.hydrate(scope.key, [page], scope.generation)
    await repo.media.storeVerified(photo.ref, photo.bytes, scope.key, scope.generation)
    const voice = await repo.media.prepare(
      { kind: 'voice', bytes: wave() },
      scope.key,
      scope.generation,
    )
    const draft = await repo.drafts.save(
      'checkpoint:native-project',
      scope.key,
      scope.generation,
      { nextStep: 'Unsaved row 13' },
      [voice.ref],
      null,
    )
    const capture = new NativeCaptureRecovery(repo)
    const captureId = await capture.begin({
      scope,
      draftKey: draft.id,
      draftRevision: draft.revision,
    })
    const edit: LocalIntent = {
      kind: 'project.update',
      operationId: 'native-rebase-edit',
      createdAt: info.createdAt,
      base: { revision: '5' },
      payload: {
        projectId: 'native-project',
        updatedAt: info.createdAt,
        fields: {
          name: 'Offline modified scarf',
          craft: 'Knitting',
          color: 'clay',
          yarn: '',
          toolSize: '4 mm',
          notes: 'Preserve offline modification',
        },
      },
    }
    const plans = createNativeOperationPlanStore(repo),
      workflows = createNativeWorkflowStore(repo)
    await plans.putIfAbsent(scope, {
      operationId: edit.operationId,
      inputHash: await canonicalHash(edit),
      intent: edit,
    })
    await repo.commitLocal(scope.key, edit, scope.generation)
    const pendingBefore = canonicalJson(await repo.pending(scope.key))
    const upload = await workflows.write(
      'native-rebase-upload',
      null,
      {
        kind: 'upload',
        accountId: info.accountId!,
        collection: scope.key,
        value: { phase: 'reserved' },
      },
      scope,
    )
    await workflows.write(
      'native-rebase-purchase',
      null,
      {
        kind: 'purchase',
        accountId: info.accountId!,
        collection: scope.key,
        value: { phase: 'pending' },
      },
      scope,
    )
    await workflows.write(
      'native-rebase-deletion',
      null,
      {
        kind: 'deletion',
        accountId: info.accountId!,
        collection: null,
        value: { phase: 'pending', receiptToken: 'synthetic-only' },
      },
      scope,
    )
    const session: AccountSession = {
      accountId: info.accountId!,
      billingPrincipalId: 'native-rebase-principal',
      deletionGeneration: '0',
      collection: { ...scope.key, epoch: changedEpoch ? crypto.randomUUID() : scope.key.epoch },
      device: { id: 'fresh-device', generation: 'fresh-generation' },
      expiresAt: '2030-01-01T00:00:00.000Z',
    }
    const fresh: SnapshotManifest = {
      ...page,
      snapshotId: 'native-rebase-fresh',
      epoch: session.collection.epoch,
      cursor: '8',
      revision: '8',
      projects: [{ ...page.projects[0], revision: '8', name: 'Fresh server scarf' }],
    }
    const input = {
      session,
      pages: [fresh],
      recoveryId: crypto.randomUUID(),
      recoveryName: 'Recovered offline work',
    }
    let review = await repo.reviewLocal(scope.key)
    const extra = await repo.drafts.save(
      'new-after-review',
      scope.key,
      scope.generation,
      { notes: 'Concurrent draft' },
      [],
      null,
    )
    await rejects(() => repo.completeRebase(scope, review, input), 'REVISION_CONFLICT')
    await repo.drafts.clear(extra.id, scope.key, scope.generation, extra.revision)
    review = await repo.reviewLocal(scope.key)
    const candidate = await workflows.write(
      'native-rebase-candidate',
      null,
      {
        kind: 'candidate',
        accountId: info.accountId!,
        collection: scope.key,
        value: {
          phase: 'preview',
          preview: {
            source: { key: { ...scope.key, namespace: 'guest_candidate' } },
            destination: { key: scope.key },
          },
        },
      },
      scope,
    )
    assert(await repo.rebaseBlocked(scope.key), 'Destination candidate should block rebase')
    await rejects(() => repo.completeRebase(scope, review, input), 'SYNC_REBASE_REQUIRED')
    await workflows.remove(candidate.id, candidate.revision, scope)
    assert(!(await repo.rebaseBlocked(scope.key)), 'Cleared candidate still blocks')
    const oldSnapshot = await repo.snapshot(scope.key)
    await repo.database.serial((db) =>
      db.execute(
        "CREATE TEMP TRIGGER fail_rebase BEFORE INSERT ON collections BEGIN SELECT RAISE(ABORT, 'synthetic rebase failure'); END;",
      ),
    )
    await rejects(() => repo.completeRebase(scope, review, input), 'LOCAL_STORAGE_FAILED')
    assert(
      canonicalJson(await repo.readActive()) === canonicalJson(scope),
      'Rollback changed selected scope',
    )
    assert(
      canonicalJson(await repo.pending(scope.key)) === pendingBefore,
      'Rollback lost immutable pending command',
    )
    assert(
      (await repo.drafts.read(draft.id, scope.key))?.revision === draft.revision,
      'Rollback lost draft',
    )
    assert(
      (await workflows.read(upload.id))?.revision === upload.revision,
      'Rollback lost upload continuation',
    )
    await repo.database.serial((db) => db.execute('DROP TRIGGER fail_rebase;'))
    const previousScope = structuredClone(scope)
    const result = await repo.completeRebase(scope, review, input)
    assert(
      canonicalJson(await repo.completeRebase(scope, review, input)) === canonicalJson(result),
      'Idempotent retry changed result',
    )
    await rejects(
      () => repo.completeRebase(scope, review, { ...input, recoveryName: 'Reused differently' }),
      'OPERATION_REUSED',
    )
    scope = result.scope
    assert(
      scope.generation === previousScope.generation + 1 && scope.device.id === 'fresh-device',
      'Fresh identity/generation not selected',
    )
    assert(
      (await repo.readView(scope.key)).projects[0].name === 'Fresh server scarf' &&
        !(await repo.pending(scope.key)).length,
      'Old edit leaked into fresh server state',
    )
    assert(
      (await repo.readView(result.recovered)).projects[0].notes === 'Preserve offline modification',
      'Recovery omitted visible pending overlay',
    )
    assert(
      (await repo.drafts.read(draft.id, result.recovered))?.revision === draft.revision &&
        !(await repo.drafts.read(draft.id, scope.key)),
      'Draft was not moved exactly',
    )
    assert(
      (await workflows.read(upload.id)) === null &&
        !!(await workflows.read('native-rebase-purchase')) &&
        !!(await workflows.read('native-rebase-deletion')),
      'Wrong workflow retirement',
    )
    const archive = await repo.database.serial(async (db) =>
      JSON.parse(
        String(
          (
            await db.query('SELECT body FROM metadata WHERE key=?', [
              JSON.stringify(['rebase-archive', input.recoveryId]),
            ])
          ).values![0].body,
        ),
      ),
    )
    assert(
      canonicalJson(archive.value.source.pending) === pendingBefore &&
        archive.value.metadata.some((row: { key: string }) =>
          row.key.startsWith('operation-plan:'),
        ),
      'Immutable pending/plan archive missing',
    )
    assert(
      (await new Response(await repo.media.open(photo.ref, result.recovered)).blob()).size ===
        photo.ref.bytes,
      'Recovered photo missing',
    )
    assert(
      (await new Response(await repo.media.open(photo.ref, previousScope.key)).blob()).size ===
        photo.ref.bytes,
      'Old export snapshot pin lost',
    )
    await rejects(
      () => repo.commitLocal(previousScope.key, edit, previousScope.generation),
      'ACCOUNT_CHANGED',
    )
    await repo.close()
    repo = await openNativeRepository({ databaseName })
    assert(
      canonicalJson(await repo.readActive()) === canonicalJson(scope),
      'Rebase not durable after close/reopen',
    )
    scope = await repo.transition(scope, { key: result.recovered, device: scope.device })
    assert(
      (await new NativeCaptureRecovery(repo).pending(scope))?.id === captureId,
      'Camera continuation not preserved with draft',
    )
    await repo.removeLocal(
      result.recovered,
      (await repo.readView(result.recovered)).revision,
      scope.generation,
    )
    const archiveRows = await repo.database.serial((db) =>
      db.query('SELECT key FROM metadata WHERE key=?', [
        JSON.stringify(['rebase-archive', input.recoveryId]),
      ]),
    )
    assert(!archiveRows.values?.length, 'Removed recovery left archive capability')
    await repo.releaseSnapshot(oldSnapshot.id)
    await repo.close()
    checks.push(
      `${changedEpoch ? 'changed epoch' : 'retired device/same epoch'}: exact review/CAS, SQL rollback, immutable archive, fresh selection, draft/media/camera preservation, restart and cleanup`,
    )
  }
  const info = fixture(true),
    repo = await openNativeRepository({ databaseName: `rebase_missing_${Date.now()}` })
  await repo.createCollection(info)
  const scope = await repo.transition(null, {
    key: info.key,
    device: { id: 'missing-device', generation: 'first' },
  })
  const project = create(info)
  if (project.kind !== 'project.create') throw new Error('Wrong fixture')
  const photo = await describeInline(png, 'photo'),
    voice = await repo.media.prepare({ kind: 'voice', bytes: wave() }, scope.key, scope.generation)
  const page: SnapshotManifest = {
    protocolVersion: 2,
    snapshotId: 'missing-rebase',
    collectionId: scope.key.collectionId,
    epoch: scope.key.epoch,
    cursor: '1',
    revision: '1',
    expiresAt: '2030-01-01T00:00:00.000Z',
    after: null,
    nextPage: null,
    projects: [{ ...project.payload.project, revision: '1' }],
    checkpoints: [
      {
        id: 'missing-checkpoint',
        projectId: 'native-project',
        revision: '1',
        createdAt: info.createdAt,
        position: 'Row 9',
        toolSize: '4 mm',
        nextStep: 'Keep missing reference',
        notes: '',
        photo: photo.ref,
      },
    ],
    media: [photo.ref],
  }
  await repo.hydrate(scope.key, [page], scope.generation)
  await repo.drafts.save(
    'voice-draft',
    scope.key,
    scope.generation,
    { notes: 'Draft bytes mandatory' },
    [voice.ref],
    null,
  )
  const review = await repo.reviewLocal(scope.key),
    input = {
      session: {
        accountId: info.accountId!,
        billingPrincipalId: 'missing-principal',
        deletionGeneration: '0',
        collection: scope.key,
        device: { id: 'fresh-missing-device', generation: 'second' },
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
      pages: [page],
      recoveryId: crypto.randomUUID(),
      recoveryName: 'Recovery with missing photo',
    }
  await rejects(() => repo.completeRebase(scope, review, input), 'BACKUP_INCOMPLETE')
  const file = await repo.database.serial(async (db) =>
    String(
      (
        await db.query('SELECT file_key FROM media WHERE scope=? AND id=?', [
          scopeKey(scope.key),
          voice.ref.id,
        ])
      ).values![0].file_key,
    ),
  )
  await durableFiles.remove({ key: file })
  await rejects(
    () => repo.completeRebase(scope, review, { ...input, allowMissingMedia: true }),
    'BACKUP_INCOMPLETE',
  )
  await repo.media.storeVerified(voice.ref, wave(), scope.key, scope.generation)
  const recovered = await repo.completeRebase(scope, review, { ...input, allowMissingMedia: true })
  assert(
    (await repo.readView(recovered.recovered)).checkpoints[0].photo?.id === photo.ref.id,
    'Missing saved ref was erased',
  )
  await rejects(() => repo.media.open(photo.ref, recovered.recovered), 'BACKUP_INCOMPLETE')
  assert(
    (await new Response(await repo.media.open(voice.ref, recovered.recovered)).blob()).size ===
      voice.ref.bytes,
    'Recovered draft bytes missing',
  )
  await repo.close()
  checks.push(
    'Explicit missing-media acknowledgement preserves absent saved refs; missing draft bytes still abort atomically',
  )
  return checks
}
