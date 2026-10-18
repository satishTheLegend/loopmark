import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { actor, createProject, localEnvironment, request, sql, quote, type Actor } from './helpers'
import { audioFixture, reserve } from './media-fixtures'
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
})
