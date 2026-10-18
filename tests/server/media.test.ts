import { describe, it, expect } from 'vitest'
import { actor, command, createProject, request, sql, quote } from './helpers'
import { audioFixture, reserve, upload, download } from './media-fixtures'

describe('I07 real private media admission', () => {
  it('refuses an expired ordinary upload reservation and completes the same retained bytes with a fresh reservation', async () => {
    const a = await actor(),
      created = await createProject(a),
      fixture = audioFixture(101)
    const old = await reserve(a, fixture.ref)
    expect((await upload(a, old.body, fixture.bytes)).status).toBe(200)
    await sql(
      `update loopmark_private.upload_reservations set expires_at=now()-interval '1 second' where id=${quote(old.body.id)} and owner_id=${quote(a.id)}::uuid`,
    )
    expect((await upload(a, old.body, fixture.bytes)).body.error.code).toBe('SNAPSHOT_EXPIRED')
    const cp = {
      id: crypto.randomUUID(),
      projectId: created.project.id,
      createdAt: new Date().toISOString(),
      position: '8',
      toolSize: '4mm',
      nextStep: 'Keep this voice note',
      notes: '',
      voice: fixture.ref,
    }
    const append = await command(
      a,
      { kind: 'checkpoint.create', payload: { checkpoint: cp, updatedAt: cp.createdAt } },
      { revision: '1' },
    )
    const receipt = await request(a.token, 'sync-push', append)
    expect(receipt.status).toBe(200)
    expect((await download(a, fixture.ref)).status).toBe(400)
    const stale = await command(
      a,
      {
        kind: 'media.attach',
        payload: {
          projectId: created.project.id,
          checkpointId: cp.id,
          reservationId: old.body.id,
          media: fixture.ref,
        },
      },
      { revision: '2' },
    )
    expect((await request(a.token, 'media-finalize', stale)).body.error.code).toBe(
      'SNAPSHOT_EXPIRED',
    )
    expect(
      await sql(
        `select count(*) from loopmark_private.operation_receipts where owner_id=${quote(a.id)}::uuid and operation_id=${quote(stale.operationId)}`,
      ),
    ).toBe('0')
    const fresh = await reserve(a, fixture.ref)
    expect(fresh.body.id).not.toBe(old.body.id)
    expect((await upload(a, fresh.body, fixture.bytes)).status).toBe(200)
    const attach = await command(
      a,
      {
        kind: 'media.attach',
        payload: {
          projectId: created.project.id,
          checkpointId: cp.id,
          reservationId: fresh.body.id,
          media: fixture.ref,
        },
      },
      { revision: '2' },
    )
    expect((await request(a.token, 'media-finalize', attach)).status).toBe(200)
    expect((await request(a.token, 'sync-push', append)).body).toEqual(receipt.body)
    expect((await download(a, fixture.ref)).bytes).toEqual(fixture.bytes)
  })
  it('streams verified bytes, atomically consumes an ordinary reservation with checkpoint.create, and denies other owners', async () => {
    const a = await actor(),
      b = await actor(),
      created = await createProject(a),
      fixture = audioFixture()
    const reserved = await reserve(a, fixture.ref)
    expect(reserved.status, JSON.stringify(reserved.body)).toBe(200)
    const uploaded = await upload(a, reserved.body, fixture.bytes)
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200)
    expect((await download(a, fixture.ref)).status).toBe(404)
    const checkpoint = {
      id: crypto.randomUUID(),
      projectId: created.project.id,
      createdAt: new Date().toISOString(),
      position: '3',
      toolSize: '4mm',
      nextStep: 'Next stitch',
      notes: '',
      voice: fixture.ref,
    }
    const cmd = await command(
      a,
      { kind: 'checkpoint.create', payload: { checkpoint, updatedAt: checkpoint.createdAt } },
      { revision: '1' },
    )
    const response = await request(a.token, 'sync-push', cmd)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const bytes = await download(a, fixture.ref)
    expect(bytes.status).toBe(200)
    expect(bytes.bytes).toEqual(fixture.bytes)
    expect(bytes.headers.get('cache-control')).toContain('no-store')
    expect((await upload(a, reserved.body, fixture.bytes)).status).toBe(200)
    const changed = fixture.bytes.slice()
    changed[45] ^= 1
    expect((await upload(a, reserved.body, changed)).body.error.code).toBe('MEDIA_INVALID')
    const alreadyLive = await reserve(a, fixture.ref)
    expect(alreadyLive.status).toBe(200)
    expect((await upload(a, alreadyLive.body, fixture.bytes)).status).toBe(200)
    expect((await download(a, fixture.ref)).bytes).toEqual(fixture.bytes)
    expect((await upload(b, reserved.body, fixture.bytes)).status).toBe(404)
    const other = await b.client.rpc('loopmark_media_download', {
      request: {
        collectionId: a.session.collection.collectionId,
        epoch: a.session.collection.epoch,
        mediaId: fixture.ref.id,
      },
    })
    expect(other.error?.message).toBe('NOT_AVAILABLE')
    expect(
      await sql(
        `select state from loopmark_private.upload_reservations where id=${quote(reserved.body.id)}`,
      ),
    ).toBe('attached')
    expect((await request(a.token, 'sync-push', cmd)).body).toEqual(response.body)
  })
  it('finalizes pending metadata with checkpoint CAS and advances both parent and checkpoint exactly once', async () => {
    const a = await actor(),
      created = await createProject(a),
      fixture = audioFixture(2)
    const checkpoint = {
      id: crypto.randomUUID(),
      projectId: created.project.id,
      createdAt: new Date().toISOString(),
      position: '',
      toolSize: '',
      nextStep: 'Continue',
      notes: '',
      voice: fixture.ref,
    }
    const append = await command(
      a,
      { kind: 'checkpoint.create', payload: { checkpoint, updatedAt: checkpoint.createdAt } },
      { revision: '1' },
    )
    expect((await request(a.token, 'sync-push', append)).status).toBe(200)
    expect((await download(a, fixture.ref)).status).toBe(400)
    const reserved = await reserve(a, fixture.ref)
    expect(reserved.status).toBe(200)
    expect((await upload(a, reserved.body, fixture.bytes)).status).toBe(200)
    const attach = await command(
      a,
      {
        kind: 'media.attach',
        payload: {
          projectId: created.project.id,
          checkpointId: checkpoint.id,
          reservationId: reserved.body.id,
          media: fixture.ref,
        },
      },
      { afterOperationId: append.operationId },
    )
    const finalized = await request(a.token, 'media-finalize', attach)
    expect(finalized.status, JSON.stringify(finalized.body)).toBe(200)
    expect(
      finalized.body.changes.map((change: { kind: string; value: { revision: string } }) => [
        change.kind,
        change.value.revision,
      ]),
    ).toEqual([
      ['checkpoint.put', '3'],
      ['project.put', '3'],
    ])
    expect((await request(a.token, 'sync-push', attach)).body).toEqual(finalized.body)
    expect((await download(a, fixture.ref)).bytes).toEqual(fixture.bytes)
  })
  it('rejects truncation, hash mismatch, malformed media, altered reservation retries and same-owner ready forgery', async () => {
    const a = await actor(),
      fixture = audioFixture(3)
    const reserved = await reserve(a, fixture.ref)
    expect(reserved.status).toBe(200)
    expect((await upload(a, reserved.body, fixture.bytes.slice(0, -2))).status).toBe(400)
    await sql(
      `update loopmark_private.upload_reservations set inflight_until=now()-interval '1 second' where id=${quote(reserved.body.id)}`,
    )
    const wrong = fixture.bytes.slice()
    wrong[45] ^= 1
    expect((await upload(a, reserved.body, wrong)).body.error.code).toBe('MEDIA_INVALID')
    const forged = await a.client.rpc('loopmark_media_verified', {
      p_owner: a.id,
      p_id: reserved.body.id,
      p_fence: 2,
    })
    expect(forged.error).toBeTruthy()
    expect(
      await sql(
        `select state from loopmark_private.media_objects where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('staged')
    const fake = audioFixture()
    fake.bytes.fill(0)
    const { sha256Bytes } = await import('../../src/domain/canonical-json')
    fake.ref.sha256 = await sha256Bytes(fake.bytes)
    const another = await reserve(a, fake.ref)
    expect((await upload(a, another.body, fake.bytes)).body.error.code).toBe('MEDIA_INVALID')
  })
  it('serializes concurrent four-upload admission and releases cancelled reservations without mutating active data', async () => {
    const a = await actor()
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, (_, i) => reserve(a, audioFixture(i + 10).ref)),
    )
    expect(outcomes.filter((result) => result.status === 200)).toHaveLength(4)
    expect(
      outcomes.filter((result) => result.body.error?.code === 'MEDIA_CAPACITY_REACHED'),
    ).toHaveLength(2)
    const first = outcomes.find((r) => r.status === 200)!
    expect(
      (await request(a.token, 'media-upload', { action: 'cancel', reservationId: first.body.id }))
        .body,
    ).toEqual({ cancelled: true })
    expect((await reserve(a, audioFixture(99).ref)).status).toBe(200)
    expect(
      await sql(
        `select project_count from loopmark_private.collections where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('0')
  })
})
