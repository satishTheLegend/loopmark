import { describe, it, expect } from 'vitest'
import { actor, command, createProject, project, pullRequest, quote, request, sql } from './helpers'
import { parsePullPage, parseReceipt, parseSnapshot } from '../../src/domain/schema'

describe('actual local Auth, SQL ownership and Edge commands', () => {
  it('requires verified user authentication and rejects cross-owner access and same-owner direct writes', async () => {
    const a = await actor(),
      b = await actor(),
      saved = await createProject(a)
    expect((await request('not-a-jwt', 'sync-pull', pullRequest(a))).status).toBe(401)
    const denied = await request(b.token, 'sync-pull', pullRequest(a))
    expect(denied.status).not.toBe(200)
    const own = await a.client.from('loopmark_projects').select('*')
    expect(own.error).toBeNull()
    expect(own.data?.map((x) => x.id)).toContain(saved.project.id)
    const other = await b.client.from('loopmark_projects').select('*').eq('id', saved.project.id)
    expect(other.error).toBeNull()
    expect(other.data).toEqual([])
    expect(
      (
        await a.client
          .from('loopmark_projects')
          .update({ data: { name: 'forged' } })
          .eq('id', saved.project.id)
      ).error,
    ).not.toBeNull()
    expect(
      (await a.client.schema('loopmark_private').from('operation_receipts').select('*')).error,
    ).not.toBeNull()
    expect(
      (
        await a.client.storage
          .from('loopmark-private')
          .upload(`${a.id}/forged`, new Blob(['forged']))
      ).error,
    ).not.toBeNull()
    const source = await sql(
      "select bool_and(proconfig @> ARRAY['search_path=\"\"']) from pg_proc join pg_namespace on pg_namespace.oid=pronamespace where nspname='public' and proname like 'loopmark_%' and prosecdef",
    )
    expect(source).toBe('t')
  })
  it('keeps idempotent effects, refuses altered hashes and applies dependent CAS without lost updates', async () => {
    const a = await actor(),
      saved = await createProject(a)
    const duplicate = await request(a.token, 'sync-push', saved.cmd)
    expect(duplicate.body).toEqual(saved.receipt)
    const altered = { ...saved.cmd, payload: { project: { ...saved.project, name: 'Altered' } } }
    expect((await request(a.token, 'sync-push', altered)).body.error.code).toBe('OPERATION_REUSED')
    const edit = await command(
      a,
      {
        kind: 'project.update',
        payload: {
          projectId: saved.project.id,
          fields: {
            name: 'New name',
            craft: 'Knitting',
            color: 'sage',
            yarn: '',
            toolSize: '4 mm',
            notes: '',
          },
          updatedAt: new Date().toISOString(),
        },
      },
      { afterOperationId: saved.cmd.operationId },
    )
    const updated = await request(a.token, 'sync-push', edit)
    expect(updated.status).toBe(200)
    expect(parseReceipt(updated.body).revision).toBe('2')
    const stale = await command(
      a,
      {
        kind: 'project.status',
        payload: {
          projectId: saved.project.id,
          status: 'finished',
          updatedAt: new Date().toISOString(),
        },
      },
      { revision: '1' },
    )
    const conflict = await request(a.token, 'sync-push', stale)
    expect(conflict.status).toBe(409)
    expect(conflict.body.conflict.current.name).toBe('New name')
    expect(conflict.body.conflict.current.revision).toBe('2')
    const resolved = await command(
      a,
      {
        kind: 'project.status',
        payload: {
          projectId: saved.project.id,
          status: 'finished',
          updatedAt: new Date().toISOString(),
        },
      },
      { revision: '2' },
    )
    expect(Number(resolved.sequence)).toBe(Number(stale.sequence) + 1)
    expect((await request(a.token, 'sync-push', resolved)).status).toBe(200)
    const retried = await request(a.token, 'sync-push', stale)
    expect(retried.status).toBe(409)
    expect(retried.body.conflict.current.status).toBe('finished')
    expect(retried.body.conflict.current.revision).toBe('3')
    const pull = await request(a.token, 'sync-pull', pullRequest(a))
    expect(parsePullPage(pull.body).entries).toHaveLength(3)
    expect(
      await sql(
        `select count(*) from loopmark_private.operation_receipts where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('3')
  })
  it('validates direct RPC payloads and canonical hashes, and never grants from imported flags', async () => {
    const a = await actor(),
      value = project()
    const cmd = await command(a, { kind: 'project.create', payload: { project: value } })
    const bads = [
      { ...cmd, ownerId: a.id },
      { ...cmd, payload: { project: { ...value, sample: true } } },
      { ...cmd, sequence: '1.0' },
      { ...cmd, payload: { project: { ...value, name: 'Changed' } } },
    ]
    for (const bad of bads) {
      const result = await a.client.rpc('loopmark_push', { cmd: bad })
      expect(result.data?.failure || result.error).toBeTruthy()
    }
    const first = await request(a.token, 'sync-push', cmd)
    expect(first.status).toBe(200)
    await createProject(a)
    await createProject(a)
    const fourth = await command(a, { kind: 'project.create', payload: { project: project() } })
    expect((await request(a.token, 'sync-push', fourth)).body.error.code).toBe('UPGRADE_REQUIRED')
    expect(
      await sql(
        `select project_count||':'||next_cursor from loopmark_private.collections where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('3:3')
  })
  it('persists checkpoint and parent in one receipt and rolls back a failed multi-row mutation', async () => {
    const a = await actor(),
      saved = await createProject(a)
    const checkpoint = {
      id: crypto.randomUUID(),
      projectId: saved.project.id,
      createdAt: new Date().toISOString(),
      position: 'Row 12',
      toolSize: '4 mm',
      nextStep: 'Knit row 13',
      notes: '',
    }
    const cmd = await command(
      a,
      { kind: 'checkpoint.create', payload: { checkpoint, updatedAt: checkpoint.createdAt } },
      { revision: saved.receipt.revision },
    )
    const response = await request(a.token, 'sync-push', cmd)
    expect(response.status).toBe(200)
    expect(response.body.changes.map((x: { kind: string }) => x.kind)).toEqual([
      'checkpoint.put',
      'project.put',
    ])
    const before = await sql(
      `select portable_bytes from loopmark_private.collections where owner_id=${quote(a.id)}::uuid`,
    )
    expect(Number(before)).toBeGreaterThan(0)
    const mutation = await command(
      a,
      {
        kind: 'project.status',
        payload: {
          projectId: saved.project.id,
          status: 'finished',
          updatedAt: new Date().toISOString(),
        },
      },
      { revision: '2' },
    )
    await sql(
      `begin; set local role authenticated; set local request.jwt.claim.sub=${quote(a.id)}; select public.loopmark_push(${quote(JSON.stringify(mutation))}::jsonb); rollback;`,
    )
    expect(
      await sql(
        `select next_cursor from loopmark_private.collections where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('2')
    expect(
      await sql(
        `select count(*) from loopmark_private.operation_receipts where owner_id=${quote(a.id)}::uuid and operation_id=${quote(mutation.operationId)}`,
      ),
    ).toBe('0')
  })
  it('keeps immutable snapshots through later writes and enforces bounded leases', async () => {
    const a = await actor(),
      saved = await createProject(a)
    const first = await request(a.token, 'sync-snapshot', {
      action: 'create',
      collectionId: a.session.collection.collectionId,
      purpose: 'hydrate',
    })
    const snapshot = parseSnapshot(first.body)
    const cmd = await command(
      a,
      {
        kind: 'project.status',
        payload: {
          projectId: saved.project.id,
          status: 'finished',
          updatedAt: new Date().toISOString(),
        },
      },
      { revision: '1' },
    )
    expect((await request(a.token, 'sync-push', cmd)).status).toBe(200)
    const page = await request(a.token, 'sync-snapshot', {
      action: 'page',
      snapshotId: snapshot.snapshotId,
      after: null,
    })
    expect(page.body.projects[0].status).toBe('active')
    expect(page.body.cursor).toBe('1')
    expect(
      (
        await request(a.token, 'sync-snapshot', {
          action: 'renew',
          snapshotId: snapshot.snapshotId,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await request(a.token, 'sync-snapshot', {
          action: 'create',
          collectionId: a.session.collection.collectionId,
          purpose: 'export',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await request(a.token, 'sync-snapshot', {
          action: 'create',
          collectionId: a.session.collection.collectionId,
          purpose: 'export',
        })
      ).status,
    ).toBe(429)
    await sql(
      `update loopmark_private.snapshots set expires_at=now()-interval '1 second' where id=${quote(snapshot.snapshotId)}`,
    )
    expect(
      (
        await request(a.token, 'sync-snapshot', {
          action: 'page',
          snapshotId: snapshot.snapshotId,
          after: null,
        })
      ).body.error.code,
    ).toBe('SNAPSHOT_EXPIRED')
  })
  it('denies old valid JWTs immediately after disable, and forces old device/epoch rebase', async () => {
    const a = await actor()
    await createProject(a)
    expect(
      (await request(a.token, 'sync-pull', { ...pullRequest(a), epoch: crypto.randomUUID() })).body
        .error.code,
    ).toBe('SYNC_REBASE_REQUIRED')
    await sql(
      `update loopmark_private.devices set last_seen=now()-interval '91 days' where owner_id=${quote(a.id)}::uuid`,
    )
    expect((await request(a.token, 'sync-pull', pullRequest(a))).body.error.code).toBe(
      'SYNC_REBASE_REQUIRED',
    )
    const registered = await request(a.token, 'account-session', {
      deviceId: a.session.device.id,
      reregister: true,
    })
    expect(registered.status).toBe(200)
    expect(registered.body.device.generation).not.toBe(a.session.device.generation)
    await sql(
      `update loopmark_private.accounts set state='deleting',deletion_generation=1 where id=${quote(a.id)}::uuid`,
    )
    expect((await request(a.token, 'sync-pull', pullRequest(a))).status).toBe(401)
    expect((await a.client.from('loopmark_projects').select('*')).data).toEqual([])
    expect(
      (await request(a.token, 'account-session', { deviceId: crypto.randomUUID() })).status,
    ).toBe(401)
  })
  it('returns private noncacheable responses and rate-limits failed command attempts', async () => {
    const a = await actor(),
      saved = await createProject(a)
    await sql(
      `update loopmark_private.rate_buckets set tokens=1,refilled_at=now()+interval '1 minute' where owner_id=${quote(a.id)}::uuid and kind='command'`,
    )
    const bad = { ...saved.cmd, payload: { project: { ...saved.project, name: 'Changed' } } }
    const response = await request(a.token, 'sync-push', bad)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    // Edge catches invalid hashes before RPC; use a valid but stale CAS to exercise admitted failure.
    const cmd = await command(
      a,
      {
        kind: 'project.status',
        payload: {
          projectId: saved.project.id,
          status: 'finished',
          updatedAt: new Date().toISOString(),
        },
      },
      { revision: '0' },
    )
    const rejected = await request(a.token, 'sync-push', cmd)
    expect([409, 429]).toContain(rejected.status)
    const limited = await request(a.token, 'sync-push', cmd)
    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('RATE_LIMITED')
    expect(limited.headers.get('retry-after')).toBeTruthy()
  })
})
