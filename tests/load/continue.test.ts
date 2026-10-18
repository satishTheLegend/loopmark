import { it, expect } from 'vitest'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { command, project, quote, localEnvironment, type Actor } from '../server/helpers'
import { audioFixture, download } from '../server/media-fixtures'
import { seedBilling, fixture, fixtureSecret, webProduct } from '../server/billing-fixtures'
import { signCommand } from '../../src/domain/schema'
import type { Command } from '../../src/domain/contracts'
import { context, rpc, sql as streamedSql } from '../../scripts/ops/common.mjs'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function mapLimit<T, R>(
  values: T[],
  limit: number,
  fn: (value: T, index: number) => Promise<R>,
) {
  let next = 0
  const result: R[] = []
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const index = next++
        result[index] = await fn(values[index], index)
      }
    }),
  )
  return result
}
it('continues only the interrupted invariant and auxiliary phases of an exact recovered synthetic cohort', async () => {
  const id = process.env.LOOPMARK_LOAD_CONTINUE
  expect(id).toMatch(/^[a-f0-9-]{36}$/)
  const directory = '.gstack/load/' + id
  const prior = JSON.parse(await readFile(directory + '/result.json', 'utf8'))
  const marker = JSON.parse(await readFile(directory + '/prepared.json', 'utf8'))
  expect(prior.id).toBe(id)
  expect(marker.run).toBe(id)
  expect(prior.schemaVersion).toBe(2)
  expect(prior.accounts).toBe(1000)
  expect(prior.recoveredAccounts).toBe(1000)
  expect(prior.phase).toBe('bounded-post-pressure-recovery')
  expect(prior.ownerDenialsVerifiedAt).toBeTruthy()
  expect(prior.success).toBe(false)
  const ctx = await context(),
    env = await localEnvironment()
  const sql = (statement: string) => streamedSql(ctx, statement)
  const report: any = {
    schemaVersion: 1,
    sourceRun: id,
    startedAt: new Date().toISOString(),
    originalBurstSuccess: false,
    originalBurstFailurePreserved: true,
    readOnly: false,
    success: false,
    auxiliaryResponses: {},
    auxiliaryRetries: 0,
  }
  const boundedRequest = async (token: string, endpoint: string, body: unknown) => {
    const r = await fetch(env.url + '/functions/v1/' + endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        apikey: env.publicKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    })
    return { status: r.status, body: await r.json().catch(() => null) }
  }
  const retryHttp = async <T extends { status: number }>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    for (let attempt = 0; attempt < 8; attempt++) {
      let result: T | undefined
      try {
        result = await fn()
      } catch (e) {
        if (!(e instanceof TypeError || e instanceof DOMException || e instanceof SyntaxError))
          throw e
      }
      const status = result?.status ?? 0,
        key = label + ':' + status
      report.auxiliaryResponses[key] = (report.auxiliaryResponses[key] ?? 0) + 1
      if (result && status > 0 && status < 500) return result
      report.auxiliaryRetries++
      await wait(Math.min(10000, 500 * 2 ** attempt))
    }
    throw Error('LOAD_AUXILIARY_RETRY_EXHAUSTED')
  }
  const admin = createClient(env.url, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const authenticate = async (email: string, deviceId: string): Promise<Actor> => {
    if (!/^loopmark-load-[a-f0-9-]+@example\.invalid$/.test(email))
      throw Error('Synthetic owner required')
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (link.error || !link.data.properties.hashed_token)
      throw Error('Synthetic reauthentication failed')
    const client = createClient(env.url, env.publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const login = await client.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: 'magiclink',
    })
    if (login.error || !login.data.session) throw Error('Synthetic reauthentication failed')
    const token = login.data.session.access_token
    const session = await retryHttp('account-session', () =>
      boundedRequest(token, 'account-session', { deviceId }),
    )
    expect(session.status).toBe(200)
    return { id: login.data.user!.id, token, client, session: session.body, sequence: 2 }
  }
  const makeActor = async (): Promise<Actor> => {
    const email = 'loopmark-load-' + randomUUID() + '@example.invalid'
    const user = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: 'LocalTest-' + randomUUID(),
    })
    if (user.error) throw Error('Synthetic creation failed')
    const a = await authenticate(email, randomUUID())
    a.sequence = 0
    return a
  }
  const rows = JSON.parse(
    await sql(
      `select coalesce(jsonb_agg(jsonb_build_object('owner',u.id,'email',u.email,'receipts',(select jsonb_agg(to_jsonb(r) order by sequence) from loopmark_private.operation_receipts r where r.owner_id=u.id),'project',(select to_jsonb(p) from loopmark_private.projects p where p.owner_id=u.id),'checkpoint',(select to_jsonb(c) from loopmark_private.checkpoints c where c.owner_id=u.id))), '[]') from auth.users u where u.email like 'loopmark-load-%@example.invalid' and u.created_at>=${quote(prior.startedAt)}::timestamptz and u.created_at<=${quote(marker.preparedAt)}::timestamptz`,
    ),
  )
  expect(rows).toHaveLength(1000)
  const prepared: Array<{
    a: Actor
    value: any
    checkpoint: any
    cmd: Command
    checkpointCommand: Command
    email: string
  }> = []
  for (const row of rows) {
    expect(row.receipts).toHaveLength(2)
    const [r1, r2] = row.receipts
    expect([r1.sequence, r2.sequence]).toEqual([1, 2])
    const value = { ...r1.receipt.changes.find((c: any) => c.kind === 'project.put').value }
    delete value.revision
    const checkpoint = { ...r2.receipt.changes.find((c: any) => c.kind === 'checkpoint.put').value }
    delete checkpoint.revision
    expect(value).toEqual({
      id: value.id,
      code: 'LM-' + value.id.slice(0, 8).toUpperCase(),
      name: 'Synthetic scarf 🧶',
      craft: 'Knitting',
      color: 'sage',
      yarn: 'Test yarn',
      toolSize: '4 mm',
      notes: '',
      status: 'active',
      createdAt: value.createdAt,
      updatedAt: value.createdAt,
    })
    expect(checkpoint).toEqual({
      id: checkpoint.id,
      projectId: value.id,
      createdAt: checkpoint.createdAt,
      position: '12',
      toolSize: '4mm',
      nextStep: 'Concurrent restart',
      notes: '',
    })
    expect(row.project.data).toEqual({ ...value, updatedAt: checkpoint.createdAt })
    expect(row.project.revision).toBe(2)
    expect(row.checkpoint.data).toEqual(checkpoint)
    expect(row.checkpoint.revision).toBe(2)
    expect(row.project.owner_id).toBe(row.owner)
    expect(row.checkpoint.owner_id).toBe(row.owner)
    const common = {
      protocolVersion: 2 as const,
      payloadVersion: 1 as const,
      collectionId: r1.collection_id,
      epoch: r1.epoch,
      deviceId: r1.device_id,
      deviceGeneration: r1.device_generation,
    }
    expect([r2.collection_id, r2.epoch, r2.device_id, r2.device_generation]).toEqual([
      common.collectionId,
      common.epoch,
      common.deviceId,
      common.deviceGeneration,
    ])
    const cmd = await signCommand({
      ...common,
      sequence: '1',
      operationId: r1.operation_id,
      base: null,
      kind: 'project.create',
      payload: { project: value },
    })
    const checkpointCommand = await signCommand({
      ...common,
      sequence: '2',
      operationId: r2.operation_id,
      base: { afterOperationId: cmd.operationId },
      kind: 'checkpoint.create',
      payload: { checkpoint, updatedAt: checkpoint.createdAt },
    })
    expect([cmd.sha256, checkpointCommand.sha256]).toEqual([r1.sha256, r2.sha256])
    expect([r1.receipt.sha256, r2.receipt.sha256]).toEqual([cmd.sha256, checkpointCommand.sha256])
    expect([r1.receipt.resultId, r2.receipt.resultId]).toEqual([value.id, checkpoint.id])
    // Authentication is deferred until the explicit continuation phase. Read-only audit
    // never creates a session or repeats a previously successful mutation.
    prepared.push({
      a: { id: row.owner } as Actor,
      value,
      checkpoint,
      cmd,
      checkpointCommand,
      email: row.email,
    })
  }
  const owners = rows.map((r: any) => quote(r.owner) + '::uuid').join(','),
    count = rows.length
  report.committedInvariants = JSON.parse(
    await sql(
      `select jsonb_build_object('receipts',(select count(*) from loopmark_private.operation_receipts where owner_id in (${owners})),'feed',(select count(*) from loopmark_private.change_feed where owner_id in (${owners})),'projects',(select count(*) from loopmark_private.projects where owner_id in (${owners})),'checkpoints',(select count(*) from loopmark_private.checkpoints where owner_id in (${owners})),'pending',(select count(*) from loopmark_private.sync_pending where owner_id in (${owners})),'maximumPendingPerOwner',(select coalesce(max(n),0) from (select count(*) n from loopmark_private.sync_pending where owner_id in (${owners}) group by owner_id)t),'crossOwnerCollectionMismatch',(select count(*) from loopmark_private.projects p join loopmark_private.collections c on c.id=p.collection_id where p.owner_id in (${owners}) and p.owner_id<>c.owner_id),'receiptFeedMismatch',(select count(*) from loopmark_private.operation_receipts r left join loopmark_private.change_feed f on f.owner_id=r.owner_id and f.receipt->>'operationId'=r.operation_id where r.owner_id in (${owners}) and f.receipt is distinct from r.receipt))`,
    ),
  )
  expect(report.committedInvariants).toEqual({
    receipts: 2000,
    feed: 2000,
    projects: 1000,
    checkpoints: 1000,
    pending: 0,
    maximumPendingPerOwner: 0,
    crossOwnerCollectionMismatch: 0,
    receiptFeedMismatch: 0,
  })
  report.reconstructedOriginalCommandHashesVerified = 2000
  report.exactMaterializedEntitiesVerified = 2000
  report.ownerCohortSha256 = createHash('sha256')
    .update(
      rows
        .map((r: any) => r.owner)
        .sort()
        .join('\n'),
    )
    .digest('hex')
  report.readOnly = true
  report.finishedAt = new Date().toISOString()
  report.success = true
  await writeFile(directory + '/read-only-audit.json', JSON.stringify(report, null, 2) + '\n')
  if (process.env.LOOPMARK_LOAD_CONTINUE_EXECUTE !== '1') return
  report.readOnly = false
  report.success = false
  report.auxiliaryStartedAt = new Date().toISOString()
  report.auxiliaryScope = {
    existingSyntheticOwnersReauthenticated: 11,
    additionalSyntheticRateLimitOwners: 1,
    profileWideOperations: [
      'synthetic billing seed',
      'bounded purchase reconciliation',
      'fair retention compaction',
    ],
    originalMutationRecoveryReplays: 0,
    postCompactionOriginalCommandRefusalProbes: 1,
  }
  try {
    await mapLimit(
      prepared.filter((_, i) => i < 10 || i === count - 1),
      2,
      async (p) => {
        const owner = p.a.id
        p.a = await authenticate(p.email, p.cmd.deviceId)
        expect(p.a.id).toBe(owner)
        expect(p.a.session.device.generation).toBe(p.cmd.deviceGeneration)
      },
    )
    const credentials = prepared.map((p) => p.a)
    const send = async (a: Actor, endpoint: string, body: unknown) => {
      const result = await retryHttp(endpoint, () => boundedRequest(a.token, endpoint, body))
      expect(result.status).toBe(200)
      return result
    }
    const reserveMedia = (a: Actor, media: ReturnType<typeof audioFixture>['ref']) => {
      const input = {
        action: 'reserve',
        requestId: randomUUID(),
        upload: {
          collectionId: a.session.collection.collectionId,
          epoch: a.session.collection.epoch,
          media,
        },
      }
      return retryHttp('media-reserve', () => boundedRequest(a.token, 'media-upload', input))
    }
    const uploadMedia = (a: Actor, reservationId: string, bytes: Uint8Array<ArrayBuffer>) =>
      retryHttp('media-upload', async () => {
        const r = await fetch(env.url + '/functions/v1/media-upload', {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + a.token,
            apikey: env.publicKey,
            'content-type': 'application/octet-stream',
            'x-loopmark-reservation-id': reservationId,
          },
          body: bytes,
          signal: AbortSignal.timeout(60000),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
      })
    report.phase = 'interrupted-media'
    await mapLimit(prepared.slice(0, 10), 2, async ({ a, value }, index) => {
      const media = audioFixture(index + 1, 65536),
        reservation = await reserveMedia(a, media.ref)
      expect(reservation.status).toBe(200)
      const partial = await uploadMedia(a, reservation.body.id, media.bytes.slice(0, 1024))
      expect(partial.status).toBe(400)
      const retry = await reserveMedia(a, media.ref)
      expect(retry.status).toBe(200)
      expect((await uploadMedia(a, retry.body.id, media.bytes)).status).toBe(200)
      const cp = {
        id: randomUUID(),
        projectId: value.id,
        createdAt: new Date().toISOString(),
        position: '13',
        toolSize: '4mm',
        nextStep: 'Recovered upload',
        notes: '',
        voice: media.ref,
      }
      await send(
        a,
        'sync-push',
        await command(
          a,
          { kind: 'checkpoint.create', payload: { checkpoint: cp, updatedAt: cp.createdAt } },
          { revision: '2' },
        ),
      )
      const bytes = await retryHttp('media-download', () => download(a, media.ref))
      expect(bytes.status).toBe(200)
      expect(createHash('sha256').update(bytes.bytes).digest('hex')).toBe(media.ref.sha256)
    })
    report.remainingStagedObjects = Number(
      await sql(
        `select count(*) from loopmark_private.media_objects where owner_id in (${owners}) and state='staged'`,
      ),
    )
    expect(report.remainingStagedObjects).toBeLessThanOrEqual(10)
    report.phase = 'duplicate-webhook'
    await seedBilling()
    const attemptId = randomUUID(),
      checkout = await retryHttp('checkout', () =>
        boundedRequest(credentials[0].token, 'checkout', {
          action: 'prepare',
          attemptId,
          productId: webProduct.id,
          collection: credentials[0].session.collection,
        }),
      )
    expect(checkout.status).toBe(200)
    expect(checkout.body.status).toBe('ready')
    const payment = await fixture({ action: 'payment', attemptId }),
      event = 'evt_' + randomUUID().replaceAll('-', ''),
      body = {
        event: 'payment.captured',
        payload: { payment: { entity: { id: payment.paymentId } } },
      }
    const raw = JSON.stringify(body),
      signature = createHmac('sha256', await fixtureSecret())
        .update(raw)
        .digest('hex')
    const duplicates = await Promise.all(
      Array.from({ length: 20 }, () =>
        retryHttp('webhook', async () => {
          const response = await fetch(env.url + '/functions/v1/billing-webhook/razorpay', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-razorpay-event-id': event,
              'x-razorpay-signature': signature,
            },
            body: raw,
            signal: AbortSignal.timeout(60000),
          })
          return { status: response.status, body: await response.json().catch(() => null) }
        }),
      ),
    )
    expect(duplicates.every((x) => x.status === 200)).toBe(true)
    let reconciled = false
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(
        (
          await retryHttp('jobs', () =>
            boundedRequest(env.serviceKey, 'jobs', { action: 'reconcile-purchases', limit: 20 }),
          )
        ).status,
      ).toBe(200)
      if (
        (await sql(
          `select count(*) from loopmark_private.webhook_inbox where event_id=${quote(event)} and status='done'`,
        )) === '1'
      ) {
        reconciled = true
        break
      }
      await wait(250)
    }
    expect(reconciled).toBe(true)
    expect(
      Number(
        await sql(
          `select count(*) from loopmark_private.webhook_inbox where event_id=${quote(event)}`,
        ),
      ),
    ).toBe(1)
    expect(
      await sql(
        `select count(*) from loopmark_private.purchase_grants where provider='razorpay' and environment='sandbox' and canonical_purchase_id=${quote(payment.paymentId)}`,
      ),
    ).toBe('1')
    // Hold only this synthetic account's exhausted bucket for a bounded window. On a contended
    // host even 25 concurrent requests can arrive more slowly than the real one-token/sec refill.
    // This controlled refusal proves the HTTP error type independently from arrival timing.
    report.phase = 'typed-overload'
    const limited = await makeActor()
    await sql(
      `insert into loopmark_private.rate_buckets values(${quote(limited.id)}::uuid,'command',0,now()+interval '5 minutes') on conflict(owner_id,kind) do update set tokens=0,refilled_at=excluded.refilled_at`,
    )
    let burst
    try {
      burst = await Promise.all(
        Array.from({ length: 25 }, async () => {
          const cmd = await command(limited, {
            kind: 'project.create',
            payload: { project: project('finished') },
          })
          return retryHttp('controlled-overload', () =>
            boundedRequest(limited.token, 'sync-push', cmd),
          )
        }),
      )
    } finally {
      await sql(
        `delete from loopmark_private.rate_buckets where owner_id=${quote(limited.id)}::uuid and kind='command'`,
      )
    }
    expect(
      burst.every(
        (x) => x.status === 429 && x.body.error.code === 'RATE_LIMITED' && x.body.error.retryable,
      ),
    ).toBe(true)
    report.controlledTypedOverloadResponses = burst.length
    report.phase = 'retention-compaction'
    await sql(
      `update loopmark_private.operation_receipts set created_at=now()-interval '91 days' where owner_id in (${owners});update loopmark_private.change_feed set created_at=now()-interval '91 days' where owner_id in (${owners});`,
    )
    await sql(
      `update loopmark_private.devices set last_seen=now()-interval '91 days' where owner_id in (${credentials
        .filter((_, i) => i % 2 === 0)
        .map((a) => quote(a.id) + '::uuid')
        .join(',')})`,
    )
    report.dormantRetainedAccounts = count / 2
    const rounds =
      Math.ceil(
        Number(await sql("select count(*) from loopmark_private.accounts where state='active'")) /
          100,
      ) + 2
    for (let i = 0; i < rounds; i++) await rpc(ctx, 'loopmark_compact', { p_limit: 100 })
    expect(
      Number(
        await sql(
          `select count(*) from loopmark_private.operation_receipts where owner_id in (${owners})`,
        ),
      ),
    ).toBe(0)
    expect(
      (
        await retryHttp('compacted-replay', () =>
          boundedRequest(prepared.at(-1)!.a.token, 'sync-push', prepared.at(-1)!.cmd),
        )
      ).body.error.code,
    ).toBe('SYNC_REBASE_REQUIRED')
    report.interruptedMediaRecovered = 10
    report.duplicateWebhookDeliveries = 20
    report.compactionRounds = rounds
    report.recoveryAndInvariantsComplete = true
    report.success = true
    report.phase = 'complete'
  } finally {
    report.finishedAt = new Date().toISOString()
    await writeFile(directory + '/continuation.json', JSON.stringify(report, null, 2) + '\n')
  }
})
