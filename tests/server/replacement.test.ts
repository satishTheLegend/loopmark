import { describe, it, expect } from 'vitest'
import { actor, command, createProject, project, request, quote, sql } from './helpers'
import { audioFixture, download, reserve, upload } from './media-fixtures'
import { verifyCandidatePreparation } from '../../src/domain/remote-schema'
import type { CandidateMetadata } from '../../src/domain/remote-contracts'
import { parseSnapshot } from '../../src/domain/schema'
const prepareRequest = (
  a: Awaited<ReturnType<typeof actor>>,
  candidate: CandidateMetadata,
  revision = '0',
) => ({
  action: 'prepare' as const,
  requestId: crypto.randomUUID(),
  destination: {
    collectionId: a.session.collection.collectionId,
    epoch: a.session.collection.epoch,
    revision,
  },
  candidate,
})
describe('I07 atomic replacement and attachment', () => {
  it('prepares a complete mapped attach, commits once across epoch, and recovers lost receipt', async () => {
    const a = await actor(),
      created = await createProject(a)
    const copied = { ...created.project, name: 'Changed local copy' },
      added = project('finished')
    const req = {
      ...prepareRequest(a, { projects: [copied, added], checkpoints: [] }, '1'),
      source: {
        key: { namespace: 'guest', collectionId: 'guest', epoch: 'guest' },
        name: 'On this device',
        revision: '7',
      },
    }
    const prepared = await request(a.token, 'collection-attach', req)
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(200)
    const preview = await verifyCandidatePreparation(prepared.body)
    expect(preview.preview).toMatchObject({
      additions: 1,
      copies: 1,
      matches: 0,
      resulting: { projects: 3 },
    })
    expect(
      preview.candidate.projects.find((p) => p.name.endsWith('(copy from this device)'))?.id,
    ).not.toBe(created.project.id)
    expect((await request(a.token, 'collection-attach', req)).body).toEqual(preview)
    expect(
      (
        await request(a.token, 'collection-attach', {
          ...req,
          source: { ...req.source, revision: '8' },
        })
      ).body.error.code,
    ).toBe('OPERATION_REUSED')
    const commit = await command(
      a,
      {
        kind: 'collection.replace',
        payload: {
          reservationId: preview.replacement.reservationId,
          candidateSha256: preview.replacement.candidateSha256,
          nextEpoch: preview.nextEpoch,
        },
      },
      { revision: '1' },
    )
    const completed = await request(a.token, 'sync-push', commit)
    expect(completed.status, JSON.stringify(completed.body)).toBe(200)
    expect(completed.body.epoch).toBe(req.destination.epoch)
    expect(completed.body.changes).toEqual([
      { kind: 'collection.replaced', nextEpoch: preview.nextEpoch },
    ])
    expect((await request(a.token, 'sync-push', commit)).body).toEqual(completed.body)
    expect(
      (
        await request(a.token, 'collection-attach', {
          action: 'status',
          reservationId: preview.replacement.reservationId,
        })
      ).body.receipt,
    ).toEqual(completed.body)
    expect((await request(a.token, 'collection-attach', req)).body.receipt).toEqual(completed.body)
    const snapshot = parseSnapshot(
      (
        await request(a.token, 'sync-snapshot', {
          action: 'create',
          purpose: 'hydrate',
          collectionId: req.destination.collectionId,
        })
      ).body,
    )
    expect(snapshot.epoch).toBe(preview.nextEpoch)
    expect(snapshot.revision).toBe(completed.body.revision)
    expect(snapshot.projects).toHaveLength(3)
  })
  it('matches identical content, copies divergent record identity, and rejects stale destination commit without partial mutation', async () => {
    const a = await actor(),
      created = await createProject(a)
    const req = {
      ...prepareRequest(a, { projects: [created.project], checkpoints: [] }, '1'),
      source: {
        key: { namespace: 'guest', collectionId: 'guest', epoch: 'guest' },
        name: 'Local',
        revision: '1',
      },
    }
    const prepared = await request(a.token, 'collection-attach', req)
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(200)
    expect(prepared.body.preview).toMatchObject({ matches: 1, copies: 0, additions: 0 })
    const append = await command(
      a,
      {
        kind: 'project.update',
        payload: {
          projectId: created.project.id,
          fields: {
            name: 'New cloud edit',
            craft: 'Knitting',
            color: 'sage',
            yarn: '',
            toolSize: '',
            notes: '',
          },
          updatedAt: new Date().toISOString(),
        },
      },
      { revision: '1' },
    )
    expect((await request(a.token, 'sync-push', append)).status).toBe(200)
    const commit = await command(
      a,
      {
        kind: 'collection.replace',
        payload: {
          reservationId: prepared.body.replacement.reservationId,
          candidateSha256: prepared.body.replacement.candidateSha256,
          nextEpoch: prepared.body.nextEpoch,
        },
      },
      { revision: '1' },
    )
    expect((await request(a.token, 'sync-push', commit)).body.error.code).toBe('REVISION_CONFLICT')
    expect(
      await sql(
        `select data->>'name' from loopmark_private.projects where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('New cloud edit')
    expect(
      await sql(
        `select epoch from loopmark_private.collections where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe(a.session.collection.epoch)
    expect(
      (
        await request(a.token, 'collection-attach', {
          action: 'cancel',
          reservationId: prepared.body.replacement.reservationId,
        })
      ).body,
    ).toEqual({ cancelled: true })
  })
  it('holds incomplete candidate media outside active data and preserves old snapshot bytes after replacement', async () => {
    const a = await actor(),
      p = project(),
      fixture = audioFixture(17)
    const checkpoint = {
      id: crypto.randomUUID(),
      projectId: p.id,
      createdAt: new Date().toISOString(),
      position: '',
      toolSize: '',
      nextStep: 'Continue',
      notes: '',
      voice: fixture.ref,
    }
    const first = await request(
      a.token,
      'collection-replace',
      prepareRequest(a, { projects: [p], checkpoints: [checkpoint] }),
    )
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    const preview = await verifyCandidatePreparation(first.body)
    const commit = await command(
      a,
      {
        kind: 'collection.replace',
        payload: {
          reservationId: preview.replacement.reservationId,
          candidateSha256: preview.replacement.candidateSha256,
          nextEpoch: preview.nextEpoch,
        },
      },
      { revision: '0' },
    )
    expect((await request(a.token, 'sync-push', commit)).body.error.code).toBe('MEDIA_INVALID')
    expect(
      await sql(
        `select project_count from loopmark_private.collections where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('0')
    const reserved = await reserve(a, fixture.ref, {
      candidateId: preview.replacement.reservationId,
      epoch: preview.nextEpoch,
    })
    expect(reserved.status, JSON.stringify(reserved.body)).toBe(200)
    expect((await upload(a, reserved.body, fixture.bytes)).status).toBe(200)
    expect((await request(a.token, 'sync-push', commit)).status).toBe(200)
    a.session.collection.epoch = preview.nextEpoch
    const pinned = parseSnapshot(
      (
        await request(a.token, 'sync-snapshot', {
          action: 'create',
          purpose: 'export',
          collectionId: a.session.collection.collectionId,
        })
      ).body,
    )
    const empty = await request(
      a.token,
      'collection-replace',
      prepareRequest(a, { projects: [], checkpoints: [] }, '1'),
    )
    expect(empty.status, JSON.stringify(empty.body)).toBe(200)
    const replacement = await command(
      a,
      {
        kind: 'collection.replace',
        payload: {
          reservationId: empty.body.replacement.reservationId,
          candidateSha256: empty.body.replacement.candidateSha256,
          nextEpoch: empty.body.nextEpoch,
        },
      },
      { revision: '1' },
    )
    expect((await request(a.token, 'sync-push', replacement)).status).toBe(200)
    const old = await download(a, fixture.ref, {
      snapshotId: pinned.snapshotId,
      epoch: pinned.epoch,
    })
    expect(old.status).toBe(200)
    expect(old.bytes).toEqual(fixture.bytes)
    const page = await request(a.token, 'sync-snapshot', {
      action: 'page',
      snapshotId: pinned.snapshotId,
      after: null,
    })
    expect(page.status).toBe(200)
    expect(page.body.checkpoints[0].voice).toEqual(fixture.ref)
    expect((await download(a, fixture.ref)).status).toBe(409)
  })
  it('enforces one candidate, bounded admission, ownership, expiry, and service-only staging', async () => {
    const a = await actor(),
      b = await actor(),
      req = prepareRequest(a, { projects: [], checkpoints: [] })
    const first = await request(a.token, 'collection-replace', req)
    expect(first.status).toBe(200)
    expect(
      (await request(a.token, 'collection-replace', { ...req, requestId: crypto.randomUUID() }))
        .body.error.code,
    ).toBe('MEDIA_CAPACITY_REACHED')
    expect(
      (
        await request(b.token, 'collection-replace', {
          action: 'status',
          reservationId: first.body.replacement.reservationId,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await a.client.rpc('loopmark_candidate_prepare', {
          p_owner: a.id,
          p_request: req,
          p_preparation: first.body,
        })
      ).error,
    ).toBeTruthy()
    await sql(
      `update loopmark_private.candidates set expires_at=now()-interval '1 second' where id=${quote(first.body.replacement.reservationId)}`,
    )
    expect(
      (
        await request(a.token, 'collection-replace', {
          action: 'status',
          reservationId: first.body.replacement.reservationId,
        })
      ).body.error.code,
    ).toBe('SNAPSHOT_EXPIRED')
    const oversized = prepareRequest(a, {
      projects: Array.from({ length: 201 }, () => project('finished')),
      checkpoints: [],
    })
    expect((await request(a.token, 'collection-replace', oversized)).status).toBe(400)
  })
})
