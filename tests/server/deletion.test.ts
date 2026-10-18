import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  actor,
  command,
  createProject,
  localEnvironment,
  request,
  sql,
  quote,
  type Actor,
} from './helpers'
import { audioFixture, reserve, upload, download } from './media-fixtures'
const run = promisify(execFile)
async function authorization(a: Actor) {
  const env = await localEnvironment(),
    admin = createClient(env.url, env.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  const challengeId = randomUUID(),
    proof = randomBytes(32).toString('hex'),
    hash = createHash('sha256').update(proof).digest('hex')
  const issued = await admin.rpc('loopmark_issue_reauthentication', {
    p_owner: a.id,
    p_challenge: challengeId,
    p_hash: hash,
  })
  if (issued.error) throw new Error('Synthetic recent-auth fixture failed')
  const receiptToken = randomBytes(32).toString('hex')
  return {
    receiptToken,
    body: {
      requestId: randomUUID(),
      receiptTokenHash: createHash('sha256').update(receiptToken).digest('hex'),
      reauthentication: { challengeId, proof, expiresAt: issued.data },
    },
  }
}
async function ledgerAppend(intent: unknown) {
  const env = await localEnvironment()
  const code =
    "const r=await fetch('http://127.0.0.1:8787/append',{method:'POST',headers:{authorization:'Bearer '+process.env.LOOPMARK_ERASURE_LEDGER_KEY,'content-type':'application/json'},body:process.argv[1]});if(!r.ok)process.exit(2);process.stdout.write(await r.text())"
  const output = await run('docker', [
    'exec',
    `loopmark_erasure_ledger_${env.projectId}`,
    'node',
    '--input-type=module',
    '-e',
    code,
    JSON.stringify(intent),
  ])
  return JSON.parse(output.stdout)
}
async function advanceSyntheticDeadline(a: Actor) {
  await sql(
    `update loopmark_private.deletion_requests set purge_after=now()-interval '1 second' where owner_id=${quote(a.id)}::uuid; update loopmark_private.jobs set next_attempt=now()-interval '1 second' where owner_id=${quote(a.id)}::uuid`,
  )
}
describe('I07 real deletion barrier and independent ledger', () => {
  it('serializes a live media finalizer before deletion and erases its bytes without resurrection', async () => {
    const a = await actor(),
      created = await createProject(a),
      fixture = audioFixture(119)
    const checkpoint = {
      id: randomUUID(),
      projectId: created.project.id,
      createdAt: new Date().toISOString(),
      position: '19',
      toolSize: '4mm',
      nextStep: 'Finalized before erasure',
      notes: '',
      voice: fixture.ref,
    }
    const append = await command(
      a,
      { kind: 'checkpoint.create', payload: { checkpoint, updatedAt: checkpoint.createdAt } },
      { revision: '1' },
    )
    expect((await request(a.token, 'sync-push', append)).status).toBe(200)
    const reservation = await reserve(a, fixture.ref)
    expect((await upload(a, reservation.body, fixture.bytes)).status).toBe(200)
    const finalize = await command(
      a,
      {
        kind: 'media.attach',
        payload: {
          projectId: created.project.id,
          checkpointId: checkpoint.id,
          reservationId: reservation.body.id,
          media: fixture.ref,
        },
      },
      { afterOperationId: append.operationId },
    )
    const auth = await authorization(a),
      env = await localEnvironment(),
      marker = 'loopmark-finalize-delete-' + randomUUID()
    const held = sql(
      `begin;set local application_name=${quote(marker)};set local role authenticated;set local request.jwt.claim.sub=${quote(a.id)};select public.loopmark_push(${quote(JSON.stringify(finalize))}::jsonb);select pg_sleep(2);commit;`,
    )
    for (let attempt = 0; ; attempt++) {
      if (
        (await sql(
          `select count(*) from pg_stat_activity where application_name=${quote(marker)} and wait_event='PgSleep'`,
        )) === '1'
      )
        break
      if (attempt === 49) throw new Error('Media finalization order barrier unavailable')
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    let finished = false
    const deleting = request(a.token, 'account-delete', auth.body).then((value) => {
      finished = true
      return value
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(finished).toBe(false)
    await held
    expect((await deleting).status).toBe(200)
    expect(
      await sql(
        `select count(*) from loopmark_private.operation_receipts where owner_id=${quote(a.id)}::uuid and operation_id=${quote(finalize.operationId)}`,
      ),
    ).toBe('1')
    const objectKey = await sql(
      `select object_key from loopmark_private.media where owner_id=${quote(a.id)}::uuid and id=${quote(fixture.ref.id)} and state='ready'`,
    )
    expect(objectKey).not.toBe('')
    expect((await request(a.token, 'media-finalize', finalize)).status).toBe(401)
    expect((await download(a, fixture.ref)).status).toBe(401)
    await advanceSyntheticDeadline(a)
    const purged = await request(env.serviceKey, 'jobs', {
      action: 'resume-deletions',
      limit: 1,
      ownerId: a.id,
    })
    expect(purged.body.counts).toEqual({ examined: 1, changed: 1, failed: 0 })
    expect(
      await sql(
        `select count(*) from loopmark_private.media_objects where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('0')
    expect(
      await sql(
        `select count(*) from storage.objects where bucket_id='loopmark-private' and name=${quote(objectKey)}`,
      ),
    ).toBe('0')
    expect((await request(a.token, 'media-finalize', finalize)).status).toBe(401)
    expect(
      await sql(
        `select count(*) from loopmark_private.checkpoints where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('0')
  })
  it('requires recent auth, durably revokes refresh, denies old JWTs, and completes live erasure with a narrow receipt', async () => {
    const a = await actor()
    await createProject(a)
    const auth = await authorization(a),
      env = await localEnvironment()
    const session = await a.client.auth.getSession(),
      refreshToken = session.data.session!.refresh_token
    const denied = await request(a.token, 'account-delete', {
      ...auth.body,
      reauthentication: { ...auth.body.reauthentication, proof: '0'.repeat(64) },
    })
    expect(denied.body.error.code).toBe('REAUTH_REQUIRED')
    const removed = await request(a.token, 'account-delete', auth.body)
    expect(removed.status, JSON.stringify(removed.body)).toBe(200)
    expect(removed.body.status).toBe('pending')
    expect((await a.client.auth.refreshSession({ refresh_token: refreshToken })).error).toBeTruthy()
    expect((await request(a.token, 'account-session', { deviceId: randomUUID() })).status).toBe(401)
    expect((await a.client.from('loopmark_projects').select('*')).data ?? []).toEqual([])
    const status = await request('', 'deletion-status', {
      requestId: auth.body.requestId,
      receiptToken: auth.receiptToken,
    })
    expect(status.body).toEqual(removed.body)
    expect(
      (
        await request('', 'deletion-status', {
          requestId: auth.body.requestId,
          receiptToken: '0'.repeat(64),
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(env.serviceKey, 'jobs', {
          action: 'resume-deletions',
          limit: 1,
          ownerId: a.id,
        })
      ).body.counts.examined,
    ).toBe(0)
    // Controlled time fixture moves only this synthetic job past its already asserted request-time barrier.
    await advanceSyntheticDeadline(a)
    // An old preparation must not make the eventual backup-retention receipt expire early.
    const originalRequestedAt = await sql(
      `select requested_at::text from loopmark_private.deletion_requests where owner_id=${quote(a.id)}::uuid`,
    )
    try {
      await sql(
        `update loopmark_private.deletion_requests set requested_at=now()-interval '2 days',backup_expires_at=now()+interval '5 days' where owner_id=${quote(a.id)}::uuid`,
      )
      const jobs = await request(env.serviceKey, 'jobs', {
        action: 'resume-deletions',
        limit: 1,
        ownerId: a.id,
      })
      expect(jobs.status).toBe(200)
      expect(jobs.body.counts, JSON.stringify(jobs.body)).toEqual({
        examined: 1,
        changed: 1,
        failed: 0,
      })
      expect(await sql(`select count(*) from auth.users where id=${quote(a.id)}::uuid`)).toBe('0')
      expect(
        await sql(
          `select count(*) from loopmark_private.projects where owner_id=${quote(a.id)}::uuid`,
        ),
      ).toBe('0')
      const finished = await request('', 'deletion-status', {
        requestId: auth.body.requestId,
        receiptToken: auth.receiptToken,
      })
      expect(finished.body.status).toBe('live-data-removed')
      expect(Object.keys(finished.body).sort()).toEqual(['backupExpiresAt', 'removedAt', 'status'])
      expect(
        Date.parse(finished.body.backupExpiresAt) - Date.parse(finished.body.removedAt),
      ).toBeGreaterThanOrEqual(7 * 86400000)
    } finally {
      await sql(
        `update loopmark_private.deletion_requests set requested_at=${quote(originalRequestedAt)}::timestamptz where owner_id=${quote(a.id)}::uuid`,
      )
    }
  })
  it('preserves original receipt capability after ledger append before the primary barrier and retries idempotently', async () => {
    const a = await actor(),
      auth = await authorization(a),
      env = await localEnvironment()
    const prepared = await a.client.rpc('loopmark_delete_prepare', { request: auth.body })
    expect(prepared.error).toBeNull()
    const appended = await ledgerAppend(prepared.data)
    expect(appended.watermark).toMatch(/^\d+:[a-f0-9]{64}$/)
    expect(
      await sql(`select state from loopmark_private.accounts where id=${quote(a.id)}::uuid`),
    ).toBe('active')
    const receipt = await request('', 'deletion-status', {
      requestId: auth.body.requestId,
      receiptToken: auth.receiptToken,
    })
    expect(receipt.body.status).toBe('pending')
    const retry = await request(a.token, 'account-delete', auth.body)
    expect(retry.status, JSON.stringify(retry.body)).toBe(200)
    expect((await request(a.token, 'account-delete', auth.body)).status).toBe(401)
    expect(
      (
        await request('', 'deletion-status', {
          requestId: auth.body.requestId,
          receiptToken: auth.receiptToken,
        })
      ).body,
    ).toEqual(retry.body)
    expect(
      await sql(
        `select count(*) from loopmark_private.jobs where owner_id=${quote(a.id)}::uuid and kind='delete-account'`,
      ),
    ).toBe('1')
    expect(
      (await request(a.token, 'jobs', { action: 'resume-deletions', limit: 1, ownerId: a.id }))
        .status,
    ).toBe(401)
    expect(
      (await request(env.serviceKey, 'jobs', { action: 'resume-deletions', limit: 101 })).status,
    ).toBe(400)
  })
  it('blocks late uploads and finalizers and waits past reserved expiry before storage erasure', async () => {
    const a = await actor(),
      fixture = audioFixture(),
      reserved = await reserve(a, fixture.ref)
    expect(reserved.status).toBe(200)
    const admitted = await a.client.rpc('loopmark_media_admit', { p_id: reserved.body.id })
    expect(admitted.error).toBeNull()
    const auth = await authorization(a),
      env = await localEnvironment(),
      admin = createClient(env.url, env.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    expect((await request(a.token, 'account-delete', auth.body)).status).toBe(200)
    const late = await admin.rpc('loopmark_media_verified', {
      p_owner: a.id,
      p_id: reserved.body.id,
      p_fence: admitted.data.fence,
    })
    expect(late.error?.message).toBe('AUTH_REQUIRED')
    expect(
      await sql(
        `select (purge_after>(${quote(reserved.body.expiresAt)}::timestamptz+interval '59 seconds'))::text from loopmark_private.deletion_requests where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('true')
    // Simulate an admitted immutable object finishing after disable, before the protected deadline.
    expect(
      (
        await admin.storage
          .from('loopmark-private')
          .upload(admitted.data.objectKey, fixture.bytes, {
            contentType: fixture.ref.mimeType,
            upsert: false,
          })
      ).error,
    ).toBeNull()
    await advanceSyntheticDeadline(a)
    const worker = await request(env.serviceKey, 'jobs', {
      action: 'resume-deletions',
      limit: 1,
      ownerId: a.id,
    })
    expect(worker.body.counts, JSON.stringify(worker.body)).toEqual({
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
  it('expires the original receipt capability and rate-limits valid anonymous lookup', async () => {
    const a = await actor(),
      auth = await authorization(a)
    expect((await request(a.token, 'account-delete', auth.body)).status).toBe(200)
    const lookup = { requestId: auth.body.requestId, receiptToken: auth.receiptToken }
    await sql(
      "insert into loopmark_private.rate_buckets(owner_id,kind,tokens,refilled_at) values('00000000-0000-0000-0000-000000000000','deletion-status',0,now()+interval '10 seconds') on conflict(owner_id,kind) do update set tokens=0,refilled_at=excluded.refilled_at",
    )
    try {
      const limited = await request('', 'deletion-status', lookup)
      expect(limited.status).toBe(429)
      expect(limited.body.error.code).toBe('RATE_LIMITED')
      expect(limited.headers.get('retry-after')).toBe('1')
    } finally {
      await sql(
        "update loopmark_private.rate_buckets set tokens=60,refilled_at=now() where owner_id='00000000-0000-0000-0000-000000000000' and kind='deletion-status'",
      )
    }
    const expired = await actor(),
      aged = await authorization(expired)
    expect(
      (await expired.client.rpc('loopmark_delete_prepare', { request: aged.body })).error,
    ).toBeNull()
    await sql(
      `update loopmark_private.deletion_requests set requested_at=now()-interval '91 days',retain_until=now()-interval '1 day' where owner_id=${quote(expired.id)}::uuid`,
    )
    const intent = JSON.parse(
      await sql(
        `select loopmark_private.erasure_intent(d) from loopmark_private.deletion_requests d where owner_id=${quote(expired.id)}::uuid`,
      ),
    )
    await ledgerAppend(intent)
    expect(
      (
        await request('', 'deletion-status', {
          requestId: aged.body.requestId,
          receiptToken: aged.receiptToken,
        })
      ).status,
    ).toBe(404)
  })
})
