import { it, expect } from 'vitest'
import { randomUUID, createHash, createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { cpus, totalmem, platform, arch, loadavg, freemem } from 'node:os'
import {
  command,
  project,
  pullRequest,
  quote,
  sql,
  type Actor,
  localEnvironment,
} from '../server/helpers'
import { audioFixture, download } from '../server/media-fixtures'
import { seedBilling, fixture, fixtureSecret, webProduct } from '../server/billing-fixtures'
import { context, rpc, run } from '../../scripts/ops/common.mjs'
import { backupSnapshot } from '../../scripts/ops/recovery.mjs'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function mapLimit<T, R>(
  values: T[],
  limit: number,
  fn: (value: T, index: number) => Promise<R>,
) {
  const result: R[] = new Array(values.length)
  let next = 0
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
const size = (value: string) => {
  const m = value.match(/^([0-9.]+)([KMGT]?i?B)/)
  if (!m) return 0
  return (
    Number(m[1]) *
    ((
      {
        B: 1,
        kB: 1000,
        KB: 1000,
        MB: 1e6,
        GB: 1e9,
        KiB: 1024,
        MiB: 1048576,
        GiB: 1073741824,
      } as Record<string, number>
    )[m[2]] ?? 1)
  )
}
it('real concurrent reconnects preserve owner effects under delayed commits, interrupted media and duplicate webhooks', async () => {
  const count = Number(process.env.LOOPMARK_LOAD_ACCOUNTS)
  expect([100, 1000]).toContain(count)
  const env = await localEnvironment()
  const boundedRequest = async (
    token: string,
    endpoint: string,
    body: unknown,
    timeout = 60000,
  ) => {
    const response = await fetch(env.url + '/functions/v1/' + endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        apikey: env.publicKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
    return {
      status: response.status,
      body: await response.json().catch(() => ({ error: { code: 'UNTYPED' } })),
    }
  }
  const ctx = await context(),
    id = randomUUID(),
    started = new Date().toISOString(),
    report: any = {
      schemaVersion: 2,
      id,
      accounts: count,
      concurrency: count,
      startedAt: started,
      synthetic: true,
      hardware: {
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        cores: cpus().length,
        hostMemoryBytes: totalmem(),
      },
      latenciesMs: [],
      responseCodes: {},
      responseKinds: {},
      retryCount: 0,
      auxiliaryResponses: {},
      auxiliaryRetries: 0,
      phase: 'setup',
      queueAgeSeconds: 0,
      maximumWaitingLocks: 0,
      peakContainerBytes: {},
      peakHarnessRss: 0,
      success: false,
      measurementScope:
        'Shared local host; engineering fixture, not clean or hosted capacity qualification',
      hostAtStart: {
        loadAverage: loadavg(),
        freeMemoryBytes: freemem(),
        swapUsage: (await run('sysctl', ['-n', 'vm.swapusage'])).toString().trim(),
        dockerMemoryBytes: Number(
          (await run('docker', ['info', '--format', '{{.MemTotal}}'])).toString().trim(),
        ),
      },
    }
  const directory = '.gstack/load/' + id
  await mkdir(directory, { recursive: true })
  const retryHttp = async <T extends { status: number }>(
    label: string,
    action: () => Promise<T>,
  ): Promise<T> => {
    for (let attempt = 0; attempt < 8; attempt++) {
      let result: T | null = null
      try {
        result = await action()
      } catch (error) {
        if (!(
          error instanceof TypeError ||
          error instanceof SyntaxError ||
          error instanceof DOMException
        ))
          throw error
      }
      const status = result?.status ?? 0,
        kind = `${label}:${status}`
      report.auxiliaryResponses[kind] = (report.auxiliaryResponses[kind] ?? 0) + 1
      if (result && status !== 0 && status < 500) return result
      report.auxiliaryRetries++
      await wait(Math.min(10000, 500 * 2 ** attempt) + Math.random() * 1000)
    }
    throw new Error('LOAD_AUXILIARY_RETRY_EXHAUSTED')
  }
  const makeActor = async (): Promise<Actor> => {
    const admin = createClient(env.url, env.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      email = `loopmark-load-${randomUUID()}@example.invalid`,
      password = 'LocalTest-' + randomUUID()
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error || !created.data.user) throw new Error('LOAD_AUTH_CREATE_FAILED')
    const client = createClient(env.url, env.publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const login = await client.auth.signInWithPassword({ email, password })
    if (login.error || !login.data.session) throw new Error('LOAD_AUTH_LOGIN_FAILED')
    const token = login.data.session.access_token,
      deviceId = randomUUID()
    const session = await retryHttp('account-session', () =>
      boundedRequest(token, 'account-session', { deviceId }),
    )
    if (session.status !== 200) throw new Error('LOAD_ACCOUNT_SESSION_FAILED')
    return { id: created.data.user.id, token, client, session: session.body, sequence: 0 }
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
      const response = await fetch(env.url + '/functions/v1/media-upload', {
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
      return { status: response.status, body: await response.json().catch(() => null) }
    })
  const credentials: Actor[] = []
  console.log(JSON.stringify({ loadPhase: 'preparing', accounts: count, run: id }))
  credentials.push(
    ...(await mapLimit(
      Array.from({ length: count }, (_, i) => i),
      8,
      () => makeActor(),
    )),
  )
  const prepared = await mapLimit(credentials, 16, async (a) => {
    const value = project(),
      cmd = await command(a, { kind: 'project.create', payload: { project: value } }),
      checkpoint = {
        id: randomUUID(),
        projectId: value.id,
        createdAt: new Date().toISOString(),
        position: '12',
        toolSize: '4mm',
        nextStep: 'Concurrent restart',
        notes: '',
      },
      checkpointCommand = await command(
        a,
        { kind: 'checkpoint.create', payload: { checkpoint, updatedAt: checkpoint.createdAt } },
        { afterOperationId: cmd.operationId },
      )
    // Keep both immutable commands in memory through burst and bounded recovery.
    // No auth credentials or command bodies are written to load evidence.
    return { a, value, cmd, checkpointCommand }
  })
  const owners = credentials.map((a) => quote(a.id) + '::uuid').join(',')
  report.retainedActiveAccountsAtBurst = Number(
    await sql("select count(*) from loopmark_private.accounts where state='active'"),
  )
  if (process.env.LOOPMARK_LOAD_WAIT_FOR_START === '1') {
    const startPath = directory + '/start'
    await writeFile(
      directory + '/prepared.json',
      JSON.stringify({ run: id, accounts: count, startPath, preparedAt: new Date().toISOString() }),
    )
    console.log(JSON.stringify({ loadPhase: 'prepared', accounts: count, run: id, startPath }))
    const deadline = Date.now() + 900000
    while (
      !(await access(startPath)
        .then(() => true)
        .catch(() => false))
    ) {
      if (Date.now() > deadline) throw new Error('Local capture observer barrier timed out')
      await wait(100)
    }
  }
  await sql(
    `create table loopmark_private.load_delay_owners(owner_id uuid primary key);insert into loopmark_private.load_delay_owners values ${credentials
      .filter((_, i) => i % 10 === 0)
      .map((a) => '(' + quote(a.id) + '::uuid)')
      .join(
        ',',
      )};create function loopmark_private.load_delay() returns trigger language plpgsql set search_path='' as $$begin if exists(select 1 from loopmark_private.load_delay_owners where owner_id=new.owner_id) then perform pg_sleep(0.1);end if;return new;end$$;create trigger load_delay before insert on loopmark_private.operation_receipts for each row execute function loopmark_private.load_delay();`,
  )
  let sampling = true
  const sample = async () => {
    while (sampling) {
      try {
        const stats = (
          await run(
            'docker',
            [
              'stats',
              '--no-stream',
              '--format',
              '{{json .}}',
              `supabase_db_${ctx.config.projectId}`,
              `supabase_edge_runtime_${ctx.config.projectId}`,
              `supabase_auth_${ctx.config.projectId}`,
            ],
            { timeout: 10000 },
          )
        )
          .toString()
          .trim()
          .split('\n')
          .map((x) => JSON.parse(x))
        for (const stat of stats) {
          const name = stat.Name.split('_').slice(0, -1).join('_')
          report.peakContainerBytes[name] = Math.max(
            report.peakContainerBytes[name] ?? 0,
            size(stat.MemUsage.split(' / ')[0]),
          )
        }
        report.peakHarnessRss = Math.max(report.peakHarnessRss, process.memoryUsage().rss)
        report.maximumWaitingLocks = Math.max(
          report.maximumWaitingLocks,
          Number(
            await sql(
              "select count(*) from pg_stat_activity where datname='postgres' and wait_event_type='Lock'",
            ),
          ),
        )
        report.queueAgeSeconds = Math.max(
          report.queueAgeSeconds,
          Number(
            await sql(
              `select coalesce(extract(epoch from now()-min(first_seen)),0)::bigint from loopmark_private.sync_pending where owner_id in (${owners})`,
            ),
          ),
        )
      } catch {
        report.samplingFailures = (report.samplingFailures ?? 0) + 1
      }
      await wait(1000)
    }
  }
  const sampler = sample(),
    begin = performance.now()
  let metrics = report
  const send = async (a: Actor, endpoint: string, body: unknown, deadline = Infinity) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      if (Date.now() >= deadline) throw new Error('LOAD_RECOVERY_DEADLINE')
      const start = performance.now()
      let result: { status: number; body: any }
      try {
        result = await boundedRequest(
          a.token,
          endpoint,
          body,
          Math.max(1, Math.min(60000, deadline - Date.now())),
        )
      } catch (error) {
        const candidate =
          (error as { cause?: { code?: string }; name?: string })?.cause?.code ??
          (error as Error)?.name
        const code =
          /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EMFILE|ENFILE|UND_ERR_[A-Z_]+|TimeoutError|AbortError|TypeError)$/.test(
            candidate ?? '',
          )
            ? candidate!
            : 'UNKNOWN'
        metrics.transportErrors ??= {}
        metrics.transportErrors[code] = (metrics.transportErrors[code] ?? 0) + 1
        result = { status: 0, body: { error: { code: 'TRANSPORT' } } }
      }
      metrics.latenciesMs.push(performance.now() - start)
      metrics.responseCodes[result.status] = (metrics.responseCodes[result.status] ?? 0) + 1
      const code = /^[A-Z_]{1,60}$/.test(result.body?.error?.code ?? '')
        ? result.body.error.code
        : 'UNTYPED'
      const kind = `${endpoint}:${result.status}:${result.status === 200 ? 'OK' : code}`
      metrics.responseKinds[kind] = (metrics.responseKinds[kind] ?? 0) + 1
      if (result.status === 200) return result
      // Network/gateway failures are transient even when they occur before the Edge error envelope.
      // Retry the exact immutable command, as the production durable queue does after an unknown outcome.
      if (
        result.status === 0 ||
        result.status >= 500 ||
        (result.status === 429 && result.body?.error?.retryable)
      ) {
        metrics.retryCount++
        await wait(Math.min(10000, 500 * 2 ** attempt) + Math.random() * 1000)
        continue
      }
      throw new Error(
        `LOAD_${endpoint.toUpperCase().replaceAll('-', '_')}_${result.status}_${code}`,
      )
    }
    throw new Error('LOAD_RETRY_EXHAUSTED')
  }
  try {
    report.phase = 'concurrent-reconnect'
    report.burstStartedAt = new Date().toISOString()
    console.log(
      JSON.stringify({
        loadPhase: 'burst-start',
        accounts: count,
        run: id,
        at: new Date().toISOString(),
      }),
    )
    const backupId = randomUUID()
    const backup = backupSnapshot(ctx, { id: backupId }).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({
        ok: false as const,
        code: /^[A-Z_]{1,60}$/.test(error?.code ?? '') ? error.code : 'UNCLASSIFIED',
      }),
    )
    const outcomes = await Promise.allSettled(
      prepared.map(async ({ a, cmd, checkpointCommand }, index) => {
        const first = await send(a, 'sync-push', cmd)
        if (index % 10 === 0) {
          const repeated = await send(a, 'sync-push', cmd)
          expect(repeated.body).toEqual(first.body)
        }
        await send(a, 'sync-push', checkpointCommand)
        const page = await send(a, 'sync-pull', pullRequest(a))
        expect(
          page.body.entries.map((entry: { operationId: string }) => entry.operationId),
        ).toEqual([cmd.operationId, checkpointCommand.operationId])
        // Verify ownership after the burst below, so an overloaded gateway cannot masquerade as authorization denial.
      }),
    )
    report.burstElapsedMs = performance.now() - begin
    const recovery = await backup
    report.concurrentBackupComplete = recovery.ok
    if (recovery.ok) report.concurrentRecoveryBytes = recovery.value.bytes
    else report.concurrentBackupError = recovery.code
    const failed = outcomes.filter((value) => value.status === 'rejected')
    report.failedAccounts = failed.length
    report.failureKinds = {}
    for (const value of failed) {
      const reason = String(value.reason?.message ?? '')
      const kind = /^LOAD_[A-Z0-9_]+$/.test(reason)
        ? reason
        : value.reason?.name === 'AssertionError'
          ? 'ASSERTION'
          : 'UNCLASSIFIED'
      report.failureKinds[kind] = (report.failureKinds[kind] ?? 0) + 1
    }
    report.burstSuccess = failed.length === 0 && recovery.ok
    report.burstFinishedAt = new Date().toISOString()
    metrics = { latenciesMs: [], responseCodes: {}, responseKinds: {}, retryCount: 0 }
    report.postPressure = metrics
    if (failed.length) {
      report.phase = 'bounded-post-pressure-recovery'
      report.recoveryStartedAt = new Date().toISOString()
      const deadline = Date.now() + 5 * 60_000
      const recovered = await mapLimit(prepared, 8, async ({ a, cmd, checkpointCommand }) => {
        try {
          await send(a, 'sync-push', cmd, deadline)
          await send(a, 'sync-push', checkpointCommand, deadline)
          const page = await send(a, 'sync-pull', pullRequest(a), deadline)
          expect(
            page.body.entries.map((entry: { operationId: string }) => entry.operationId),
          ).toEqual([cmd.operationId, checkpointCommand.operationId])
          return true
        } catch {
          return false
        }
      })
      report.recoveryFinishedAt = new Date().toISOString()
      report.recoveredAccounts = recovered.filter(Boolean).length
      report.recoveryConcurrency = 8
      report.recoveryDeadlineMs = 300000
      expect(report.recoveredAccounts).toBe(count)
    }
    if (!recovery.ok) {
      // Retry the same recovery-point identity after burst pressure, preserving
      // the failed concurrent-backup result above and its original raw timings.
      const resumed = await backupSnapshot(ctx, { id: backupId })
      report.postPressureBackupComplete = true
      report.postPressureRecoveryBytes = resumed.bytes
    }
    await mapLimit(prepared, 8, async ({ a }, index) => {
      const denied = await retryHttp('cross-owner-pull', () =>
        boundedRequest(credentials[(index + 1) % count].token, 'sync-pull', pullRequest(a)),
      )
      expect(denied.status).toBe(404)
      expect(denied.body.error.code).toBe('NOT_AVAILABLE')
    })
    report.burstAndBackupElapsedMs = performance.now() - begin
    expect(
      Number(
        await sql(
          `select count(*) from loopmark_private.operation_receipts where owner_id in (${owners})`,
        ),
      ),
    ).toBe(count * 2)
    expect(
      Number(
        await sql(`select count(*) from loopmark_private.projects where owner_id in (${owners})`),
      ),
    ).toBe(count)
    expect(
      Number(
        await sql(
          `select count(*) from loopmark_private.checkpoints where owner_id in (${owners})`,
        ),
      ),
    ).toBe(count)
    report.committedInvariants = JSON.parse(
      await sql(`select jsonb_build_object(
      'receipts',(select count(*) from loopmark_private.operation_receipts where owner_id in (${owners})),
      'feed',(select count(*) from loopmark_private.change_feed where owner_id in (${owners})),
      'projects',(select count(*) from loopmark_private.projects where owner_id in (${owners})),
      'checkpoints',(select count(*) from loopmark_private.checkpoints where owner_id in (${owners})),
      'pending',(select count(*) from loopmark_private.sync_pending where owner_id in (${owners})),
      'maximumPendingPerOwner',(select coalesce(max(n),0) from (select count(*) n from loopmark_private.sync_pending where owner_id in (${owners}) group by owner_id)t),
      'crossOwnerCollectionMismatch',(select count(*) from loopmark_private.projects p join loopmark_private.collections c on c.id=p.collection_id where p.owner_id in (${owners}) and p.owner_id<>c.owner_id))`),
    )
    expect(report.committedInvariants).toMatchObject({
      receipts: count * 2,
      feed: count * 2,
      projects: count,
      checkpoints: count,
      crossOwnerCollectionMismatch: 0,
    })
    expect(report.committedInvariants.maximumPendingPerOwner).toBeLessThanOrEqual(2)
    report.crossOwnerDenials = count
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
    report.success = report.burstSuccess
    report.phase = 'complete'
    // A recovered overload run is not relabeled a successful simultaneous burst.
    expect(
      report.burstSuccess,
      'Original simultaneous burst exceeded this local runtime capacity; recovery evidence is reported separately',
    ).toBe(true)
  } finally {
    sampling = false
    await sampler
    await sql(
      'drop trigger if exists load_delay on loopmark_private.operation_receipts;drop function if exists loopmark_private.load_delay();drop table if exists loopmark_private.load_delay_owners;',
    )
    const ordered = report.latenciesMs.sort((a: number, b: number) => a - b),
      total = ordered.length
    report.requests = total
    report.p50Ms = ordered[Math.floor((total - 1) * 0.5)] ?? null
    report.p95Ms = ordered[Math.floor((total - 1) * 0.95)] ?? null
    report.errorRate =
      Object.entries(report.responseCodes)
        .filter(([code]) => code !== '200')
        .reduce((sum, [, n]) => sum + Number(n), 0) / Math.max(1, total)
    delete report.latenciesMs
    if (report.postPressure) {
      const values = report.postPressure.latenciesMs.sort((a: number, b: number) => a - b)
      report.postPressure.requests = values.length
      report.postPressure.p50Ms = values[Math.floor((values.length - 1) * 0.5)] ?? null
      report.postPressure.p95Ms = values[Math.floor((values.length - 1) * 0.95)] ?? null
      delete report.postPressure.latenciesMs
    }
    report.elapsedMs = performance.now() - begin
    report.finishedAt = new Date().toISOString()
    await writeFile(directory + '/result.json', JSON.stringify(report, null, 2))
    console.log(
      JSON.stringify({
        loadPhase: 'finished',
        accounts: count,
        run: id,
        success: report.success,
        p50Ms: report.p50Ms,
        p95Ms: report.p95Ms,
        errorRate: report.errorRate,
      }),
    )
  }
})
