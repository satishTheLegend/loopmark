import { describe, expect, it } from 'vitest'
import { actor, command, createProject, localEnvironment, quote, request, sql } from './helpers'
import { audioFixture, download, reserve, upload } from './media-fixtures'
import { accountUsageSchema } from '../../src/domain/remote-schema'

describe('I07 actual usage, reference-safe sweeping and explicit lease release', () => {
  it('reports actual physical bytes separately from allocated and portable bytes, then collects cancelled orphans', async () => {
    const a = await actor(),
      b = await actor(),
      fixture = audioFixture(81),
      unused = audioFixture(82)
    const input = {
      collectionId: a.session.collection.collectionId,
      epoch: a.session.collection.epoch,
    }
    const initial = await request(a.token, 'account-usage', input)
    expect(initial.status, JSON.stringify(initial.body)).toBe(200)
    expect(accountUsageSchema.parse(initial.body)).toMatchObject({
      storedBytes: 0,
      allocatedBytes: 0,
      portableBytes: 0,
    })
    expect((await request(b.token, 'account-usage', input)).status).toBe(404)
    const first = await reserve(a, fixture.ref),
      second = await reserve(a, unused.ref)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await upload(a, first.body, fixture.bytes)).status).toBe(200)
    const staged = await request(a.token, 'account-usage', input)
    expect(accountUsageSchema.parse(staged.body)).toMatchObject({
      storedBytes: 46,
      storedObjects: 1,
      allocatedBytes: 92,
      ordinaryStagedBytes: 92,
      unfinishedUploads: 2,
      portableBytes: 0,
    })
    const env = await localEnvironment()
    expect((await request(a.token, 'jobs', { action: 'sweep-media', ownerId: a.id })).status).toBe(
      401,
    )
    for (const reservation of [first, second])
      expect(
        (
          await request(a.token, 'media-upload', {
            action: 'cancel',
            reservationId: reservation.body.id,
          })
        ).status,
      ).toBe(200)
    // Advance only this synthetic account's GC age; ordinary wall-clock leases are untouched.
    await sql(
      `update loopmark_private.media_objects set created_at=now()-interval '2 hours' where owner_id=${quote(a.id)}::uuid`,
    )
    const swept = await request(env.serviceKey, 'jobs', {
      action: 'sweep-media',
      ownerId: a.id,
      limit: 1,
    })
    expect(swept.status, JSON.stringify(swept.body)).toBe(200)
    expect(swept.body.counts).toEqual({ examined: 1, changed: 1, failed: 0 })
    expect(
      (await request(env.serviceKey, 'jobs', { action: 'sweep-media', ownerId: a.id, limit: 1 }))
        .body.counts.changed,
    ).toBe(1)
    expect(
      (await request(env.serviceKey, 'jobs', { action: 'sweep-media', ownerId: a.id, limit: 1 }))
        .body.counts.examined,
    ).toBe(0)
    const final = await request(a.token, 'account-usage', input)
    expect(accountUsageSchema.parse(final.body)).toMatchObject({
      storedBytes: 0,
      storedObjects: 0,
      allocatedBytes: 0,
      ordinaryStagedBytes: 0,
      unfinishedUploads: 0,
    })
  })

  it('preserves live and pinned bytes, releases only owned snapshots idempotently, and frees the two-lease capacity', async () => {
    const a = await actor(),
      b = await actor(),
      created = await createProject(a),
      fixture = audioFixture(83)
    const reservation = await reserve(a, fixture.ref)
    expect((await upload(a, reservation.body, fixture.bytes)).status).toBe(200)
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
    const create = {
      action: 'create',
      purpose: 'export',
      collectionId: a.session.collection.collectionId,
    }
    const first = await request(a.token, 'sync-snapshot', create),
      second = await request(a.token, 'sync-snapshot', create)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await request(a.token, 'sync-snapshot', create)).body.error.code).toBe('RATE_LIMITED')
    expect(
      (
        await request(b.token, 'sync-snapshot', {
          action: 'release',
          snapshotId: first.body.snapshotId,
        })
      ).body,
    ).toEqual({ released: true })
    expect(
      (
        await request(a.token, 'sync-snapshot', {
          action: 'page',
          snapshotId: first.body.snapshotId,
          after: null,
        })
      ).status,
    ).toBe(200)
    await sql(
      `update loopmark_private.media_objects set created_at=now()-interval '2 hours' where owner_id=${quote(a.id)}::uuid`,
    )
    const env = await localEnvironment(),
      sweep = { action: 'sweep-media', ownerId: a.id, limit: 20 }
    expect((await request(env.serviceKey, 'jobs', sweep)).body.counts.examined).toBe(0)
    const remove = await command(
      a,
      { kind: 'project.delete', payload: { projectId: created.project.id } },
      { revision: '2' },
    )
    expect((await request(a.token, 'sync-push', remove)).status).toBe(200)
    expect((await request(env.serviceKey, 'jobs', sweep)).body.counts.examined).toBe(0)
    expect((await download(a, fixture.ref, { snapshotId: first.body.snapshotId })).bytes).toEqual(
      fixture.bytes,
    )
    for (const snapshot of [first, first, second])
      expect(
        (
          await request(a.token, 'sync-snapshot', {
            action: 'release',
            snapshotId: snapshot.body.snapshotId,
          })
        ).body,
      ).toEqual({ released: true })
    expect(
      (
        await request(a.token, 'sync-snapshot', {
          action: 'page',
          snapshotId: first.body.snapshotId,
          after: null,
        })
      ).body.error.code,
    ).toBe('SNAPSHOT_EXPIRED')
    expect((await request(a.token, 'sync-snapshot', create)).status).toBe(200)
    expect((await request(env.serviceKey, 'jobs', sweep)).body.counts).toEqual({
      examined: 1,
      changed: 1,
      failed: 0,
    })
    expect(
      await sql(
        `select count(*) from storage.objects where bucket_id='loopmark-private' and starts_with(name,${quote(a.id + '/')})`,
      ),
    ).toBe('0')
  })
})
