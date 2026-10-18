import { describe, it, expect } from 'vitest'
import { actor, command, createProject, project, pullRequest, quote, request, sql } from './helpers'
import { parsePullPage } from '../../src/domain/schema'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
describe('transaction order, paging and retention on actual PostgreSQL', () => {
  it('does not expose a later cursor before an earlier committing mutation', async () => {
    const a = await actor(),
      first = await command(a, { kind: 'project.create', payload: { project: project() } }),
      second = await command(a, { kind: 'project.create', payload: { project: project() } })
    const marker = `loopmark-order-${crypto.randomUUID()}`
    const held = sql(
      `begin; set local application_name=${quote(marker)}; set local role authenticated; set local request.jwt.claim.sub=${quote(a.id)}; select public.loopmark_push(${quote(JSON.stringify(first))}::jsonb); select pg_sleep(2); commit;`,
    )
    for (let attempt = 0; attempt < 50; attempt++) {
      if (
        (await sql(
          `select count(*) from pg_stat_activity where application_name=${quote(marker)} and wait_event='PgSleep'`,
        )) === '1'
      )
        break
      await wait(40)
      if (attempt === 49) throw new Error('Could not establish held transaction')
    }
    let secondFinished = false
    const concurrent = request(a.token, 'sync-push', second).then((result) => {
      secondFinished = true
      return result
    })
    await wait(150)
    expect(secondFinished).toBe(false)
    expect(
      await sql(
        `select count(*) from loopmark_private.change_feed where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('0')
    await held
    const result = await concurrent
    expect(result.status).toBe(200)
    expect(result.body.cursor).toBe('2')
    const page = parsePullPage((await request(a.token, 'sync-pull', pullRequest(a))).body)
    expect(page.entries.map((x) => x.cursor)).toEqual(['1', '2'])
  })
  it('pages at 50 receipts, hydrates immutable pages, and advances retention floors before replay', async () => {
    const a = await actor()
    for (let index = 0; index < 55; index++) {
      await sql(
        `update loopmark_private.rate_buckets set refilled_at=now()-interval '1 minute' where owner_id=${quote(a.id)}::uuid and kind='command'`,
      )
      await createProject(a, 'finished')
    }
    const first = parsePullPage((await request(a.token, 'sync-pull', pullRequest(a))).body)
    expect(first.entries).toHaveLength(50)
    expect(first.hasMore).toBe(true)
    const second = parsePullPage(
      (await request(a.token, 'sync-pull', pullRequest(a, first.nextCursor))).body,
    )
    expect(second.entries).toHaveLength(5)
    expect(second.hasMore).toBe(false)
    const snapshot = (
      await request(a.token, 'sync-snapshot', {
        action: 'create',
        collectionId: a.session.collection.collectionId,
        purpose: 'hydrate',
      })
    ).body
    expect(snapshot.projects).toHaveLength(50)
    expect(snapshot.after).toBeNull()
    expect(snapshot.nextPage).toBe('50')
    const next = (
      await request(a.token, 'sync-snapshot', {
        action: 'page',
        snapshotId: snapshot.snapshotId,
        after: snapshot.nextPage,
      })
    ).body
    expect(next.projects).toHaveLength(5)
    expect(next.after).toBe(snapshot.nextPage)
    expect(next.nextPage).toBeNull()
    await sql(
      `update loopmark_private.operation_receipts set created_at=now()-interval '91 days' where owner_id=${quote(a.id)}::uuid;update loopmark_private.change_feed set created_at=now()-interval '91 days' where owner_id=${quote(a.id)}::uuid;delete from loopmark_private.snapshots where owner_id=${quote(a.id)}::uuid; begin;set local request.jwt.claims='{"role":"service_role"}';select public.loopmark_compact(100);commit;`,
    )
    expect(
      await sql(
        `select sequence_floor from loopmark_private.devices where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('55')
    expect((await request(a.token, 'sync-pull', pullRequest(a))).body.error.code).toBe(
      'SYNC_REBASE_REQUIRED',
    )
    const replay = await command(a, {
      kind: 'project.create',
      payload: { project: project('finished') },
    })
    const { sha256: _hash, ...unsigned } = replay
    const { signCommand } = await import('../../src/domain/schema')
    const old = await signCommand({ ...unsigned, sequence: '1' })
    expect((await request(a.token, 'sync-push', old)).body.error.code).toBe('SYNC_REBASE_REQUIRED')
  })
})
