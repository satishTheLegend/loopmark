import { openNativeRepository } from '../../../src/platform/native/repository'
import { createNativeDraftStore } from '../../../src/platform/native/drafts'
import { createNativeOperationPlanStore } from '../../../src/platform/native/operation-plans'
import { scopeKey } from '../../../src/platform/native/recovery-journal'
import { bytesToDataUrl } from '../../../src/services/media-codec'
import { canonicalHash } from '../../../src/domain/canonical-json'
import { DomainError } from '../../../src/domain/errors'
import type { LocalIntent, SessionScope } from '../../../src/domain/contracts'
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
  await test('native portable draft retains caller revision, normalized media, atomic pins and opening scope', async () => {
    const info = fixture(),
      name = `draftport_${Date.now()}`,
      scope = scopeFor(info.key)
    let repo = await openNativeRepository({ databaseName: name })
    await repo.createCollection(info)
    await repo.activate(scope)
    let drafts = createNativeDraftStore(repo, scope)
    const voice = bytesToDataUrl(new Uint8Array(await wave().arrayBuffer()), 'audio/wav')
    const draft = {
      key: 'checkpoint:native-project',
      revision: 'caller-revision',
      baseRevision: '5',
      value: { nextStep: 'Continue after restart', voice },
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
