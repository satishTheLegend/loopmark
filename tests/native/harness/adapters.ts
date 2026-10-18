import { openNativeRepository } from '../../../src/platform/native/repository'
import { createNativeDraftStore } from '../../../src/platform/native/drafts'
import { createNativeOperationPlanStore } from '../../../src/platform/native/operation-plans'
import { scopeKey } from '../../../src/platform/native/recovery-journal'
import { bytesToDataUrl } from '../../../src/services/media-codec'
import { canonicalHash } from '../../../src/domain/canonical-json'
import { DomainError } from '../../../src/domain/errors'
import type {
  LocalIntent,
  SessionScope,
  Receipt,
  SnapshotManifest,
} from '../../../src/domain/contracts'
import { create, fixture, wave } from './persistence'

const assert = (value: unknown) => {
  if (!value) throw new Error('Assertion failed')
}
async function rejects(action: () => Promise<unknown>) {
  let rejected = false
  try {
    await action()
  } catch {
    rejected = true
  }
  assert(rejected)
}
const scopeFor = (key: SessionScope['key']): SessionScope => ({
  key,
  generation: 1,
  device: { id: 'native-device', generation: 'native-generation' },
})
export async function adapterTests(
  test: (name: string, action: () => Promise<void>) => Promise<void>,
) {
  await test('native reviewed retention keeps missing saved refs but refuses missing draft media', async () => {
    const info = fixture(),
      scope = scopeFor(info.key)
    const repo = await openNativeRepository({ databaseName: `missing_${Date.now()}` })
    await repo.createCollection(info)
    await repo.activate(scope)
    const created = await repo.commitLocal(info.key, create(info), 1)
    const prepared = await repo.media.prepare({ kind: 'voice', bytes: wave() }, info.key, 1)
    await repo.commitLocal(
      info.key,
      {
        kind: 'checkpoint.create',
        operationId: crypto.randomUUID(),
        base: { revision: created.view.projects[0].revision },
        createdAt: info.createdAt,
        payload: {
          updatedAt: info.createdAt,
          checkpoint: {
            id: 'missing-saved',
            projectId: 'native-project',
            createdAt: info.createdAt,
            toolSize: '',
            position: '',
            nextStep: 'Retain text and unavailable media reference',
            notes: '',
            voice: prepared.ref,
          },
        },
      },
      1,
    )
    await repo.database.serial((db) =>
      db.run('DELETE FROM media WHERE scope=? AND id=?', [scopeKey(info.key), prepared.ref.id]),
    )
    const view = await repo.readView(info.key)
    await rejects(() => repo.snapshot(info.key))
    const partialSnapshot = await repo.snapshot(info.key, { allowMissingMedia: true })
    assert(partialSnapshot.media[0].id === prepared.ref.id)
    await rejects(() => repo.retainLocal(info.key, 'Strict copy', view.revision, 1))
    const retained = await repo.retainLocal(info.key, 'Acknowledged missing', view.revision, 1, {
      allowMissingMedia: true,
    })
    assert((await repo.readView(retained)).checkpoints[0].voice?.id === prepared.ref.id)
    await rejects(() => repo.media.open(prepared.ref, retained))
    const draftMedia = await repo.media.prepare({ kind: 'voice', bytes: wave() }, info.key, 1)
    await repo.drafts.save(
      'checkpoint:source',
      info.key,
      1,
      { voice: draftMedia.ref },
      [draftMedia.ref],
      null,
    )
    await repo.database.serial((db) =>
      db.run('DELETE FROM media WHERE scope=? AND id=?', [scopeKey(info.key), draftMedia.ref.id]),
    )
    const count = (await repo.listCollections()).length
    await rejects(() =>
      repo.retainLocal(info.key, 'Must preserve draft', view.revision, 1, {
        allowMissingMedia: true,
      }),
    )
    assert(
      (await repo.listCollections()).length === count &&
        !!(await repo.drafts.read('checkpoint:source', info.key)),
    )
    await repo.media.storeVerified(prepared.ref, wave(), info.key, 1)
    await repo.removeLocal(info.key, view.revision, 1)
    const bytes = await new Response(await repo.media.open(prepared.ref, info.key)).arrayBuffer()
    assert(bytes.byteLength === prepared.ref.bytes)
    await repo.releaseSnapshot(partialSnapshot.id)
    await repo.close()
  })
  await test('native verified authentication resumes only matching-device auth failures', async () => {
    const info = fixture(true),
      scope = scopeFor(info.key),
      repo = await openNativeRepository({ databaseName: `reauth_${Date.now()}` })
    await repo.createCollection(info)
    await repo.activate(scope)
    const intent = create(info)
    await repo.commitLocal(info.key, intent, 1)
    await repo.markFailure(info.key, intent.operationId, new DomainError('AUTH_REQUIRED').detail, 1)
    const hash = (await repo.pending(info.key))[0].command.sha256
    await repo.resumeAfterAuthentication(info.key, 1)
    assert(
      (await repo.pending(info.key))[0].state === 'queued' &&
        (await repo.pending(info.key))[0].command.sha256 === hash,
    )
    await repo.markFailure(info.key, intent.operationId, new DomainError('AUTH_REQUIRED').detail, 1)
    const next = await repo.transition(scope, {
      key: info.key,
      device: { id: 'changed', generation: 'changed' },
    })
    await rejects(() => repo.resumeAfterAuthentication(info.key, next.generation))
    assert((await repo.pending(info.key))[0].state === 'rejected')
    await repo.close()
  })
  await test('native epoch replacement preserves old drafts and bytes through transaction failure and retry', async () => {
    const info = fixture(true),
      scope = scopeFor(info.key),
      name = `replace_${Date.now()}`
    const repo = await openNativeRepository({ databaseName: name })
    await repo.createCollection(info)
    await repo.activate(scope)
    const media = await repo.media.prepare({ kind: 'voice', bytes: wave() }, info.key, 1)
    const mutation = create(info)
    if (mutation.kind !== 'project.create') throw new Error('Fixture')
    const snapshot: SnapshotManifest = {
      protocolVersion: 2,
      snapshotId: 'original',
      collectionId: info.key.collectionId,
      epoch: info.key.epoch,
      cursor: '1',
      revision: '1',
      expiresAt: '2099-01-01T00:00:00.000Z',
      after: null,
      nextPage: null,
      projects: [{ ...mutation.payload.project, revision: '1' }],
      checkpoints: [
        {
          id: 'checkpoint',
          projectId: 'native-project',
          revision: '1',
          createdAt: info.createdAt,
          position: '1',
          toolSize: '4mm',
          nextStep: 'Original work',
          notes: '',
          voice: media.ref,
        },
      ],
      media: [media.ref],
    }
    await repo.hydrate(info.key, [snapshot], 1)
    await repo.drafts.save(
      'checkpoint:native-project',
      info.key,
      1,
      { nextStep: 'Keep unsaved work', voice: media.ref },
      [media.ref],
      null,
    )
    await repo.commitLocal(
      info.key,
      {
        operationId: 'replace',
        kind: 'collection.replace',
        createdAt: info.createdAt,
        base: { revision: '1' },
        payload: {
          reservationId: 'reservation',
          candidateSha256: '1'.repeat(64),
          nextEpoch: 'new-epoch',
        },
      },
      1,
    )
    const pending = (await repo.pending(info.key))[0]
    const receipt: Receipt = {
      operationId: 'replace',
      sha256: pending.command.sha256,
      epoch: info.key.epoch,
      revision: '2',
      cursor: '2',
      resultId: 'reservation',
      changes: [{ kind: 'collection.replaced', nextEpoch: 'new-epoch' }],
    }
    const pages: SnapshotManifest[] = [
      {
        ...snapshot,
        snapshotId: 'next',
        epoch: 'new-epoch',
        revision: '2',
        cursor: '2',
        projects: [{ ...snapshot.projects[0], name: 'Remote replacement', revision: '2' }],
        checkpoints: [{ ...snapshot.checkpoints[0], revision: '2' }],
      },
    ]
    const input = { operationId: 'replace', receipt, pages }
    await rejects(() =>
      repo.completeReplacement(
        info.key,
        { ...input, receipt: { ...receipt, sha256: '0'.repeat(64) } },
        1,
      ),
    )
    await repo.database.serial((db) =>
      db.execute(
        "CREATE TEMP TRIGGER fail_replacement BEFORE INSERT ON collections BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
      ),
    )
    await rejects(() => repo.completeReplacement(info.key, input, 1))
    assert(
      (await repo.listCollections()).length === 1 && (await repo.pending(info.key)).length === 1,
    )
    assert((await repo.readActive())?.generation === 1)
    await repo.database.serial((db) => db.execute('DROP TRIGGER fail_replacement;'))
    const next = await repo.completeReplacement(info.key, input, 1)
    assert(next.generation === 2 && next.key.epoch === 'new-epoch')
    assert((await repo.readView(info.key)).info.kind === 'recovered')
    assert((await repo.reviewLocal(info.key)).drafts.length === 1)
    assert((await repo.readView(next.key)).projects[0].name === 'Remote replacement')
    assert(
      (await new Response(await repo.media.open(media.ref, next.key)).blob()).size === wave().size,
    )
    assert(
      scopeKey((await repo.completeReplacement(info.key, input, 1)).key) === scopeKey(next.key),
    )
    await repo.close()
  })
  await test('native recovered import publishes files and collection atomically after source staging', async () => {
    const info = fixture(),
      target = fixture(),
      name = `import_${Date.now()}`
    const repo = await openNativeRepository({ databaseName: name })
    await repo.createCollection(info)
    await repo.activate(scopeFor(info.key))
    const saved = await repo.commitLocal(info.key, create(info), 1)
    const media = await repo.media.prepare({ kind: 'voice', bytes: wave() }, info.key, 1)
    const candidate = {
      info: { ...target, kind: 'recovered' as const },
      projects: saved.view.projects,
      checkpoints: [
        {
          id: 'restored-checkpoint',
          projectId: 'native-project',
          revision: '40',
          createdAt: info.createdAt,
          position: '5',
          toolSize: '4mm',
          nextStep: 'Keep going',
          notes: '',
          voice: media.ref,
        },
      ],
      provenance: {
        kind: 'backup' as const,
        sourceId: 'synthetic-backup',
        capturedAt: info.createdAt,
      },
    }
    await repo.database.serial((db) =>
      db.execute(
        "CREATE TEMP TRIGGER fail_import BEFORE INSERT ON collections BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
      ),
    )
    await rejects(() => repo.importLocal(candidate, { generation: 1, mediaSource: info.key }))
    assert((await repo.listCollections()).length === 1)
    assert((await repo.readView(info.key)).projects.length === 1)
    await repo.database.serial((db) => db.execute('DROP TRIGGER fail_import;'))
    await rejects(() => repo.importLocal(candidate, { generation: 0, mediaSource: info.key }))
    const restored = await repo.importLocal(candidate, { generation: 1, mediaSource: info.key })
    assert(restored.revision === '41' && !restored.info.legacyAccess)
    assert(
      (await new Response(await repo.media.open(media.ref, target.key)).blob()).size ===
        wave().size,
    )
    assert(scopeKey((await repo.readActive())!.key) === scopeKey(info.key))
    await rejects(() => repo.importLocal(candidate, { generation: 1, mediaSource: info.key }))
    await repo.close()
  })
  await test('native transition rejects newly added drafts and stale identities; retained copy preserves draft media', async () => {
    const info = fixture(),
      destination = fixture(),
      name = `transition_${Date.now()}`
    let repo = await openNativeRepository({ databaseName: name })
    await repo.createCollection(info)
    await repo.createCollection(destination)
    assert((await repo.readActive()) === null)
    const first = await repo.transition(null, { key: info.key, device: scopeFor(info.key).device })
    assert(first.generation === 0)
    const review = await repo.reviewLocal(info.key),
      drafts = createNativeDraftStore(repo, first)
    const draft = {
      key: 'checkpoint:native-project',
      revision: 'saved-draft',
      baseRevision: '1',
      value: {
        nextStep: 'Retain this draft too',
        voice: bytesToDataUrl(new Uint8Array(await wave().arrayBuffer()), 'audio/wav'),
      },
    }
    await drafts.write(draft.key, undefined, draft)
    await rejects(() =>
      repo.transition(first, { key: destination.key, device: first.device }, review),
    )
    await rejects(() =>
      repo.transition(
        { ...first, device: { ...first.device, id: 'other-device' } },
        { key: destination.key, device: first.device },
      ),
    )
    assert((await repo.readActive())?.generation === 0)
    const latest = await repo.reviewLocal(info.key)
    const fenced = await repo.transition(first, { key: info.key, device: first.device }, latest)
    await rejects(() => drafts.write(draft.key, draft.revision, { ...draft, revision: 'late' }))
    const retained = await repo.retainLocal(
      info.key,
      'Retained draft fixture',
      latest.revision,
      fenced.generation,
    )
    const selected = await repo.transition(fenced, { key: retained, device: first.device })
    const restored = await createNativeDraftStore(repo, selected).read<typeof draft.value>(
      draft.key,
    )
    assert(restored?.value.voice === draft.value.voice && restored.revision === draft.revision)
    assert((await repo.drafts.read(draft.key, info.key))?.revision === draft.revision)
    await repo.close()
    repo = await openNativeRepository({ databaseName: name })
    assert((await repo.readActive())?.generation === selected.generation)
    assert(scopeKey((await repo.readActive())!.key) === scopeKey(retained))
    await repo.close()
  })
  await test('native portable draft retains caller revision, normalized media, atomic pins and opening scope', async () => {
    const info = fixture(),
      name = `draftport_${Date.now()}`,
      scope = scopeFor(info.key)
    let repo = await openNativeRepository({ databaseName: name })
    await repo.createCollection(info)
    await repo.activate(scope)
    let drafts = createNativeDraftStore(repo, scope)
    const emptyForm = {
      key: 'checkpoint:empty',
      revision: 'empty-revision',
      baseRevision: '5',
      value: {
        nextStep: 'Text-only checkpoint',
        position: '',
        toolSize: '',
        notes: '',
        photo: undefined,
        voice: undefined,
      },
    }
    await drafts.write(emptyForm.key, undefined, emptyForm)
    const textOnly = await drafts.read<{ nextStep: string; photo?: string; voice?: string }>(
      emptyForm.key,
    )
    assert(
      textOnly?.value.nextStep === 'Text-only checkpoint' &&
        textOnly.value.photo === undefined &&
        textOnly.value.voice === undefined,
    )
    const voice = bytesToDataUrl(new Uint8Array(await wave().arrayBuffer()), 'audio/wav')
    const draft = {
      key: 'checkpoint:native-project',
      revision: 'caller-revision',
      baseRevision: '5',
      value: { nextStep: 'Continue after restart', voice, photo: undefined },
    }
    await drafts.write(draft.key, undefined, draft)
    const stored = await repo.drafts.read(draft.key, info.key)
    assert(typeof (stored?.value as { voice: unknown }).voice === 'object')
    await repo.database.serial((db) =>
      db.execute(
        "CREATE TEMP TRIGGER fail_pin BEFORE INSERT ON pins BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
      ),
    )
    await rejects(() =>
      drafts.write(draft.key, draft.revision, { ...draft, revision: 'failed-revision' }),
    )
    assert((await drafts.read(draft.key))?.revision === draft.revision)
    await repo.database.serial((db) => db.execute('DROP TRIGGER fail_pin;'))
    await repo.close()
    repo = await openNativeRepository({ databaseName: name })
    drafts = createNativeDraftStore(repo, scope)
    const restored = await drafts.read<{ nextStep: string; voice: string }>(draft.key)
    assert(
      restored?.value.voice === voice &&
        restored.baseRevision === '5' &&
        restored.revision === draft.revision,
    )
    await rejects(() => drafts.write(draft.key, 'stale', undefined))
    await drafts.removeProjectDrafts('native-project')
    assert(!(await drafts.read(draft.key)))
    await repo.activate({ ...scope, generation: 2 })
    await rejects(() => drafts.read(draft.key))
    await rejects(() => drafts.write(draft.key, undefined, draft))
    await repo.close()
  })
  await test('native operation plans survive restart and failed save with immutable identity and media pins', async () => {
    const info = fixture(),
      scope = scopeFor(info.key),
      name = `plans_${Date.now()}`
    let repo = await openNativeRepository({ databaseName: name })
    await repo.createCollection(info)
    await repo.activate(scope)
    const saved = await repo.commitLocal(info.key, create(info), 1)
    const prepared = await repo.media.prepare({ kind: 'voice', bytes: wave() }, info.key, 1)
    const intent: LocalIntent = {
      kind: 'checkpoint.create',
      operationId: crypto.randomUUID(),
      base: { revision: saved.view.projects[0].revision },
      createdAt: info.createdAt,
      payload: {
        updatedAt: info.createdAt,
        checkpoint: {
          id: 'retry-checkpoint',
          projectId: 'native-project',
          createdAt: info.createdAt,
          toolSize: '',
          position: '',
          nextStep: 'Retry exactly once',
          notes: '',
          voice: prepared.ref,
        },
      },
    }
    const plan = {
      operationId: intent.operationId,
      inputHash: await canonicalHash({ nextStep: 'Retry exactly once' }),
      intent,
    }
    let plans = createNativeOperationPlanStore(repo)
    await plans.putIfAbsent(scope, plan)
    await repo.database.serial((db) => db.run('UPDATE media SET prepared_at=0'))
    await repo.media.reconcile()
    await repo.close()
    repo = await openNativeRepository({ databaseName: name })
    plans = createNativeOperationPlanStore(repo)
    assert((await plans.read(scope, plan.operationId))?.intent.createdAt === info.createdAt)
    const duplicate = await plans.putIfAbsent(scope, {
      ...plan,
      intent: { ...intent, createdAt: '2026-02-01T00:00:00.000Z' },
    })
    assert(duplicate.intent.createdAt === info.createdAt)
    await rejects(() => plans.putIfAbsent(scope, { ...plan, inputHash: '1'.repeat(64) }))
    assert(
      (await new Response(await repo.media.open(prepared.ref, info.key)).blob()).size ===
        prepared.ref.bytes,
    )
    await repo.commitLocal(info.key, duplicate.intent, 1)
    assert(
      (
        await repo.database.serial((db) =>
          db.query('SELECT owner FROM pins WHERE owner=?', [
            `operation-plan:${intent.operationId}`,
          ]),
        )
      ).values?.length === 0,
    )
    await repo.close()
  })
  await test('native conflict recovery copies media before atomic retirement, preserves failures, and deduplicates retry', async () => {
    const info = fixture(true),
      scope = scopeFor(info.key)
    const repo = await openNativeRepository({ databaseName: `resolve_${Date.now()}` })
    await repo.createCollection(info)
    await repo.activate(scope)
    const original = create(info)
    if (original.kind !== 'project.create') throw new Error('fixture')
    await repo.hydrate(
      info.key,
      [
        {
          protocolVersion: 2,
          snapshotId: 'snapshot',
          collectionId: info.key.collectionId,
          epoch: info.key.epoch,
          revision: '1',
          cursor: '1',
          after: null,
          nextPage: null,
          expiresAt: '2099-01-01T00:00:00.000Z',
          projects: [{ ...original.payload.project, revision: '1' }],
          checkpoints: [],
          media: [],
        },
      ],
      1,
    )
    const pending: LocalIntent = {
      kind: 'project.update',
      operationId: crypto.randomUUID(),
      base: { revision: '1' },
      createdAt: info.createdAt,
      payload: {
        projectId: 'native-project',
        updatedAt: info.createdAt,
        fields: {
          name: 'My local name',
          craft: 'Knitting',
          color: 'clay',
          toolSize: '4mm',
          yarn: '',
          notes: '',
        },
      },
    }
    await repo.commitLocal(info.key, pending, 1)
    const prepared = await repo.media.prepare({ kind: 'voice', bytes: wave() }, info.key, 1)
    const child: LocalIntent = {
      kind: 'checkpoint.create',
      operationId: crypto.randomUUID(),
      base: { afterOperationId: pending.operationId },
      createdAt: info.createdAt,
      payload: {
        updatedAt: info.createdAt,
        checkpoint: {
          id: 'dependent-checkpoint',
          projectId: 'native-project',
          createdAt: info.createdAt,
          toolSize: '',
          position: '',
          nextStep: 'Saved dependent history',
          notes: '',
          voice: prepared.ref,
        },
      },
    }
    await repo.commitLocal(info.key, child, 1)
    await repo.markFailure(
      info.key,
      pending.operationId,
      new DomainError('REVISION_CONFLICT').detail,
      1,
    )
    assert((await repo.readAcknowledged(info.key)).projects[0].name === 'Durable scarf')
    const before = await repo.readView(info.key)
    const replacement: LocalIntent = {
      ...pending,
      operationId: crypto.randomUUID(),
      base: { revision: '1' },
      payload: { ...pending.payload, fields: { ...pending.payload.fields, name: 'Reviewed name' } },
    }
    const resolution = {
      operationId: pending.operationId,
      expectedRevision: before.revision,
      recoveryName: 'Saved before review',
      replacement,
    }
    await repo.database.serial((db) =>
      db.execute(
        "CREATE TEMP TRIGGER fail_recovery BEFORE INSERT ON collections BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
      ),
    )
    await rejects(() => repo.resolvePending(info.key, resolution, 1))
    assert((await repo.readView(info.key)).revision === before.revision)
    assert((await repo.pending(info.key)).length === 2)
    assert((await repo.listCollections()).length === 1)
    await repo.database.serial((db) => db.execute('DROP TRIGGER fail_recovery;'))
    const result = await repo.resolvePending(info.key, resolution, 1)
    assert(result.recovered && result.commit?.view.projects[0].name === 'Reviewed name')
    const recovered = await repo.readView(result.recovered!)
    assert(
      recovered.projects[0].name === 'My local name' &&
        recovered.checkpoints[0].nextStep === 'Saved dependent history',
    )
    assert(
      (await new Response(await repo.media.open(prepared.ref, result.recovered!)).blob()).size ===
        prepared.ref.bytes,
    )
    assert((await repo.pending(info.key)).length === 1)
    assert(
      scopeKey((await repo.resolvePending(info.key, resolution, 1)).recovered!) ===
        scopeKey(result.recovered!),
    )
    await rejects(() =>
      repo.resolvePending(info.key, { ...resolution, recoveryName: 'Changed retry' }, 1),
    )
    assert((await repo.listCollections()).length === 2)
    await repo.close()
  })
}
