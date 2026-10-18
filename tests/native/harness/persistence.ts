import { openNativeRepository } from '../../../src/platform/native/repository'
import type { CollectionInfo, LocalIntent } from '../../../src/domain/contracts'
import { scopeKey } from '../../../src/platform/native/recovery-journal'

type Test = (name: string, action: () => Promise<void>) => Promise<void>
const assert = (value: unknown) => {
  if (!value) throw new Error('Assertion failed')
}
function fixture(connected = false): CollectionInfo {
  return {
    key: {
      namespace: connected ? 'account_native' : 'guest_native',
      collectionId: crypto.randomUUID(),
      epoch: crypto.randomUUID(),
    },
    accountId: connected ? 'native-account' : null,
    kind: connected ? 'connected' : 'guest',
    name: 'Synthetic native fixture',
    legacyAccess: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}
function create(info: CollectionInfo, name = 'Durable scarf'): LocalIntent {
  return {
    operationId: crypto.randomUUID(),
    kind: 'project.create',
    base: null,
    createdAt: info.createdAt,
    payload: {
      project: {
        id: 'native-project',
        code: 'NATIVE-1',
        name,
        craft: 'Knitting',
        color: 'clay',
        yarn: '',
        toolSize: '4 mm',
        notes: '',
        status: 'active',
        createdAt: info.createdAt,
        updatedAt: info.createdAt,
      },
    },
  }
}
function wave(): Blob {
  const bytes = new Uint8Array(46),
    view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, 38, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 16000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, 2, true)
  return new Blob([bytes], { type: 'audio/wav' })
}
export async function persistenceTests(test: Test) {
  let restartPhase = 0
  await test('actual SQLite record/outbox atomicity and failed transaction preserves draft', async () => {
    const info = fixture(true),
      name = `outbox_${Date.now()}`
    let repo = await openNativeRepository({ databaseName: name })
    await repo.createCollection(info)
    await repo.activate({
      key: info.key,
      generation: 1,
      device: { id: 'native-device', generation: 'native-generation' },
    })
    const draft = await repo.drafts.save(
      'checkpoint-draft',
      info.key,
      1,
      { nextStep: 'Keep this instruction' },
      [],
      null,
    )
    await repo.database.serial((db) =>
      db.execute(
        "CREATE TEMP TRIGGER fail_collection BEFORE INSERT ON collections BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
      ),
    )
    let rejected = false
    try {
      await repo.commitLocal(info.key, create(info), 1)
    } catch {
      rejected = true
    }
    assert(rejected)
    assert((await repo.pending(info.key)).length === 0)
    assert((await repo.readView(info.key)).projects.length === 0)
    assert((await repo.drafts.read('checkpoint-draft', info.key))?.revision === draft.revision)
    await repo.database.serial((db) => db.execute('DROP TRIGGER fail_collection;'))
    const intent = create(info)
    await repo.commitLocal(info.key, intent, 1)
    await repo.close()
    repo = await openNativeRepository({ databaseName: name })
    assert((await repo.readView(info.key)).projects.length === 1)
    assert((await repo.pending(info.key)).length === 1)
    assert((await repo.pending(info.key))[0].command.operationId === intent.operationId)
    await repo.close()
  })
  await test('native validated media, draft pins, CAS, source isolation and cleanup protection', async () => {
    const info = fixture(),
      repo = await openNativeRepository({ databaseName: `media_${Date.now()}` })
    await repo.createCollection(info)
    await repo.activate({
      key: info.key,
      generation: 1,
      device: { id: 'native-device', generation: 'native-generation' },
    })
    const bytes = wave(),
      prepared = await repo.media.prepare({ kind: 'voice', bytes }, info.key, 1)
    const draft = await repo.drafts.save(
      'voice-draft',
      info.key,
      1,
      { nextStep: 'Keep recording' },
      [prepared.ref],
      null,
    )
    await repo.database.serial((db) => db.run('UPDATE media SET prepared_at=0'))
    await repo.media.reconcile()
    assert(
      (await new Response(await repo.media.open(prepared.ref, info.key)).blob()).size ===
        bytes.size,
    )
    let conflict = false
    try {
      await repo.drafts.clear('voice-draft', info.key, 1, 'stale')
    } catch {
      conflict = true
    }
    assert(conflict)
    const other = fixture()
    await repo.createCollection(other)
    let isolated = false
    try {
      await repo.media.open(prepared.ref, other.key)
    } catch {
      isolated = true
    }
    assert(isolated)
    await repo.drafts.clear('voice-draft', info.key, 1, draft.revision)
    await repo.media.reconcile()
    assert(
      (
        await repo.database.serial((db) =>
          db.query('SELECT id FROM media WHERE scope=?', [scopeKey(info.key)]),
        )
      ).values?.length === 0,
    )
    await repo.close()
  })
  await test('native media promotion before SQL fault leaves recoverable journal and no visible ref', async () => {
    const info = fixture(),
      repo = await openNativeRepository({ databaseName: `journal_${Date.now()}` })
    await repo.createCollection(info)
    await repo.activate({
      key: info.key,
      generation: 1,
      device: { id: 'native-device', generation: 'native-generation' },
    })
    await repo.database.serial((db) =>
      db.execute(
        "CREATE TEMP TRIGGER fail_media BEFORE INSERT ON media BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
      ),
    )
    let rejected = false
    try {
      await repo.media.prepare({ kind: 'voice', bytes: wave() }, info.key, 1)
    } catch {
      rejected = true
    }
    assert(rejected)
    assert(
      (await repo.database.serial((db) => db.query('SELECT file_key FROM prepared_files'))).values
        ?.length === 1,
    )
    assert(
      (await repo.database.serial((db) => db.query('SELECT id FROM media'))).values?.length === 0,
    )
    assert((await repo.readView(info.key)).checkpoints.length === 0)
    await repo.close()
  })
  await test('snapshot pins survive source removal and media-preserving import stays revision fenced', async () => {
    const info = fixture(),
      repo = await openNativeRepository({ databaseName: `snapshot_${Date.now()}` })
    await repo.createCollection(info)
    await repo.activate({
      key: info.key,
      generation: 1,
      device: { id: 'native-device', generation: 'native-generation' },
    })
    const saved = await repo.commitLocal(info.key, create(info), 1)
    const bytes = wave(),
      prepared = await repo.media.prepare({ kind: 'voice', bytes }, info.key, 1)
    await repo.commitLocal(
      info.key,
      {
        kind: 'checkpoint.create',
        operationId: crypto.randomUUID(),
        base: { revision: saved.view.projects[0].revision },
        createdAt: info.createdAt,
        payload: {
          updatedAt: info.createdAt,
          checkpoint: {
            id: 'native-checkpoint',
            projectId: 'native-project',
            createdAt: info.createdAt,
            position: 'Row 5',
            toolSize: '4 mm',
            nextStep: 'Continue here',
            notes: '',
            voice: prepared.ref,
          },
        },
      },
      1,
    )
    const snapshot = await repo.snapshot(info.key)
    await repo.removeLocal(info.key, snapshot.view.revision, 1)
    const restoredBytes = await new Response(await repo.media.open(prepared.ref, info.key)).blob()
    assert(restoredBytes.size === bytes.size)
    const destination = fixture()
    await repo.createCollection(destination)
    await repo.activate({
      key: destination.key,
      generation: 2,
      device: { id: 'native-device', generation: 'native-generation' },
    })
    await repo.media.storeVerified(
      prepared.ref,
      new Blob([await restoredBytes.arrayBuffer()], { type: prepared.ref.mimeType }),
      destination.key,
      2,
    )
    const candidate = {
      info: destination,
      projects: snapshot.view.projects,
      checkpoints: snapshot.view.checkpoints,
      provenance: {
        kind: 'backup' as const,
        sourceId: info.key.collectionId,
        capturedAt: info.createdAt,
      },
    }
    const restored = await repo.importLocal(candidate, { generation: 2 })
    assert(restored.checkpoints[0].voice?.sha256 === prepared.ref.sha256)
    let stale = false
    try {
      await repo.importLocal(candidate, {
        generation: 2,
        replace: { key: destination.key, revision: '0' },
      })
    } catch {
      stale = true
    }
    assert(stale)
    assert((await repo.readView(destination.key)).checkpoints.length === 1)
    await repo.releaseSnapshot(snapshot.id)
    await repo.close()
  })
  await test('saved collection survives a full native app process restart', async () => {
    const repo = await openNativeRepository({ databaseName: 'restart_fixture' })
    const collections = await repo.listCollections()
    if (!collections.length) {
      const info = fixture()
      await repo.createCollection(info)
      await repo.activate({
        key: info.key,
        generation: 1,
        device: { id: 'restart-device', generation: 'restart-generation' },
      })
      await repo.commitLocal(info.key, create(info), 1)
      await repo.database.serial((db) =>
        db.run("INSERT INTO metadata(key,body) VALUES('restart-phase','1')"),
      )
      restartPhase = 1
    } else {
      assert((await repo.readView(collections[0].key)).projects[0].name === 'Durable scarf')
      await repo.database.serial((db) =>
        db.run("UPDATE metadata SET body='2' WHERE key='restart-phase'"),
      )
      restartPhase = 2
    }
    await repo.close()
  })
  return restartPhase
}
