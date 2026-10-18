import { beforeAll, describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { actor, createProject, request, command, quote, localEnvironment } from './helpers'
import { context, rpc, sql, type OpsContext } from '../../scripts/ops/common.mjs'
import { rollbackCheck } from '../../scripts/ops/rollback.mjs'
import { encodeCursor } from '../../scripts/ops/cursor.mjs'
import { seedBilling, prepare, webhook } from './billing-fixtures'
let ctx: OpsContext
beforeAll(async () => {
  ctx = await context()
  await seedBilling()
})
describe('I11 actual operational control and compatible runtime rollback', () => {
  it('runs default-local dry-run and returns resumable partial and denied CLI exit contracts on actual services', async () => {
    const cli = (args: string[]) =>
      new Promise<{ code: number; body: any; stderr: string }>((resolve, reject) => {
        execFile(
          process.execPath,
          ['scripts/ops.mjs', ...args],
          { timeout: 60000, maxBuffer: 1024 * 1024 },
          (error, stdout, stderr) => {
            try {
              resolve({ code: error ? Number(error.code) : 0, body: JSON.parse(stdout), stderr })
            } catch {
              reject(new Error('Operator CLI did not return bounded JSON'))
            }
          },
        )
      })
    const initial = await cli(['status', '--target', 'all', '--json'])
    expect(initial.code).toBe(0)
    expect(initial.body).toMatchObject({
      environment: 'local',
      dryRun: true,
      counts: { changed: 0 },
    })
    const event = 'evt_' + randomUUID().replaceAll('-', '')
    expect(
      (
        await webhook(event, {
          event: 'payment.captured',
          payload: { payment: { entity: { id: 'pay_' + randomUUID().replaceAll('-', '') } } },
        })
      ).status,
    ).toBe(200)
    await sql(
      ctx,
      `update loopmark_private.webhook_inbox set next_attempt=now()-interval '1 day' where provider='razorpay' and environment='sandbox' and event_id=${quote(event)}`,
    )
    try {
      const dry = await cli(['replay-webhooks', '--target', 'all', '--limit', '1', '--json'])
      expect(dry.code).toBe(0)
      expect(dry.body.preview.phases.webhooks).toBe(1)
      expect(dry.body.preview.selectedWorkItems).toBeGreaterThanOrEqual(1)
      expect(
        await sql(
          ctx,
          `select fence from loopmark_private.webhook_inbox where event_id=${quote(event)}`,
        ),
      ).toBe('0')
      const partial = await cli([
        'replay-webhooks',
        '--target',
        'all',
        '--limit',
        '1',
        '--execute',
        '--json',
      ])
      expect(partial.code).toBe(4)
      expect(partial.body.status).toBe('partial')
      expect(partial.body.counts.failed).toBeGreaterThan(0)
      expect(partial.body.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
      expect(partial.stderr).toBe('')
      const dryResume = await cli([
        'replay-webhooks',
        '--target',
        'all',
        '--cursor',
        partial.body.nextCursor,
        '--json',
      ])
      expect(dryResume.code).toBe(0)
      expect(dryResume.body.jobId).toBe(partial.body.jobId)
      expect(dryResume.body.counts.changed).toBe(0)
      const denied = await cli([
        'resume-deletions',
        '--target',
        'all',
        '--cursor',
        partial.body.nextCursor,
        '--execute',
        '--json',
      ])
      expect(denied.code).toBe(5)
      expect(denied.body.errors).toEqual([{ code: 'NOT_AVAILABLE' }])
      expect(denied.body.counts.changed).toBe(0)
      const position = Number(
        await sql(
          ctx,
          "select ledger_cursor from loopmark_private.operation_schedules where kind='maintenance'",
        ),
      )
      const skipped = encodeCursor(
        ctx,
        { command: 'maintenance', target: 'all' },
        randomUUID(),
        position + 1,
      )
      const noSkip = await cli([
        'maintenance',
        '--target',
        'all',
        '--cursor',
        skipped,
        '--execute',
        '--json',
      ])
      expect(noSkip.code).toBe(5)
      expect(noSkip.body.errors).toEqual([{ code: 'NOT_AVAILABLE' }])
      expect(
        Number(
          await sql(
            ctx,
            "select ledger_cursor from loopmark_private.operation_schedules where kind='maintenance'",
          ),
        ),
      ).toBe(position)
    } finally {
      await sql(
        ctx,
        `update loopmark_private.webhook_inbox set status='done',lease_until=null where provider='razorpay' and environment='sandbox' and event_id=${quote(event)}`,
      )
    }
  })
  it('records bounded redacted phase/queue projections and protects them from direct client writes', async () => {
    const a = await actor(),
      operation = 'a'.repeat(64)
    expect(
      (
        await a.client.rpc('loopmark_ops_observe', {
          p_owner: a.id,
          p_route: 'sync',
          p_phase: 'start',
          p_operation: operation,
          p_elapsed: 0,
        })
      ).error,
    ).toBeTruthy()
    await rpc(ctx, 'loopmark_ops_observe', {
      p_owner: a.id,
      p_route: 'sync',
      p_phase: 'start',
      p_operation: operation,
      p_elapsed: 0,
    })
    await sql(
      ctx,
      `update loopmark_private.sync_pending set first_seen=now()-interval '6 minutes' where owner_id=${quote(a.id)}::uuid`,
    )
    expect(
      (await rpc(ctx, 'loopmark_ops_status')).oldestReceivedSyncSeconds,
    ).toBeGreaterThanOrEqual(360)
    await rpc(ctx, 'loopmark_ops_observe', {
      p_owner: a.id,
      p_route: 'sync',
      p_phase: 'retry',
      p_operation: operation,
      p_elapsed: 9,
    })
    expect(
      await sql(
        ctx,
        `select count(*) from loopmark_private.sync_pending where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('1')
    await rpc(ctx, 'loopmark_ops_observe', {
      p_owner: a.id,
      p_route: 'sync',
      p_phase: 'conflict',
      p_operation: operation,
      p_elapsed: 10,
    })
    expect(
      await sql(
        ctx,
        `select count(*) from loopmark_private.sync_pending where owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('0')
    const before = await rpc(ctx, 'loopmark_ops_status')
    await createProject(a)
    const after = await rpc(ctx, 'loopmark_ops_status')
    expect(after.syncRequests15m).toBeGreaterThan(before.syncRequests15m)
    expect(after.syncConflicts15m).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(after)).not.toContain(a.id)
  })
  it('pauses new enrollment/payment within fifteen minutes while existing sessions, writes, reads and export snapshots remain available', async () => {
    const a = await actor(),
      created = await createProject(a),
      started = Date.now(),
      env = await localEnvironment(),
      admin = createClient(env.url, env.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      email = `loopmark-ops-${randomUUID()}@example.invalid`,
      password = randomUUID() + 'Local1!'
    const user = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    expect(user.error).toBeNull()
    const client = createClient(env.url, env.publicKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      login = await client.auth.signInWithPassword({ email, password })
    expect(login.error).toBeNull()
    const prior = await rpc(ctx, 'loopmark_ops_control')
    try {
      await rpc(ctx, 'loopmark_ops_control', { p_cloud: false, p_payments: false })
      expect(
        (
          await request(login.data.session!.access_token, 'account-session', {
            deviceId: randomUUID(),
          })
        ).body.error.code,
      ).toBe('CAPABILITY_UNAVAILABLE')
      expect((await prepare(a)).response.body.error.code).toBe('CAPABILITY_UNAVAILABLE')
      expect(
        (
          await request(a.token, 'account-session', {
            deviceId: a.session.device.id,
            deviceGeneration: a.session.device.generation,
          })
        ).status,
      ).toBe(200)
      const checkpoint = {
        id: randomUUID(),
        projectId: created.project.id,
        createdAt: new Date().toISOString(),
        position: '18',
        toolSize: '4mm',
        nextStep: 'Preserved during pause',
        notes: '',
      }
      expect(
        (
          await request(
            a.token,
            'sync-push',
            await command(
              a,
              {
                kind: 'checkpoint.create',
                payload: { checkpoint, updatedAt: checkpoint.createdAt },
              },
              { revision: '1' },
            ),
          )
        ).status,
      ).toBe(200)
      const snap = await request(a.token, 'sync-snapshot', {
        action: 'create',
        collectionId: a.session.collection.collectionId,
        purpose: 'export',
      })
      expect(snap.status).toBe(200)
      expect(snap.body.projects.length + snap.body.checkpoints.length).toBeGreaterThan(0)
      expect(
        (
          await request(a.token, 'sync-snapshot', {
            action: 'release',
            snapshotId: snap.body.snapshotId,
          })
        ).status,
      ).toBe(200)
      expect(Date.now() - started).toBeLessThan(900000)
    } finally {
      await rpc(ctx, 'loopmark_ops_control', {
        p_cloud: prior.cloudEnrollment,
        p_payments: prior.paymentInitiation,
      })
    }
    expect(
      (
        await request(login.data.session!.access_token, 'account-session', {
          deviceId: randomUUID(),
        })
      ).status,
    ).toBe(200)
    expect((await prepare(a)).response.status).toBe(200)
  })
  it('runs the preceding protocol-2 function artifact on the additive current schema and restores current runtime', async () => {
    const a = await actor(),
      created = await createProject(a)
    const result = await rollbackCheck(ctx, {
      verify: async (phase) => {
        if (phase === 'previous') await expect(rollbackCheck(ctx)).rejects.toThrow('RATE_LIMITED')
        const session = await request(a.token, 'account-session', {
          deviceId: a.session.device.id,
          deviceGeneration: a.session.device.generation,
        })
        expect(session.status).toBe(200)
        const checkpoint = {
          id: randomUUID(),
          projectId: created.project.id,
          createdAt: new Date().toISOString(),
          position: phase,
          toolSize: '4mm',
          nextStep: 'Compatible rollback',
          notes: '',
        }
        expect(
          (
            await request(
              a.token,
              'sync-push',
              await command(
                a,
                {
                  kind: 'checkpoint.create',
                  payload: { checkpoint, updatedAt: checkpoint.createdAt },
                },
                { revision: phase === 'previous' ? '1' : '2' },
              ),
            )
          ).status,
        ).toBe(200)
        const snap = await request(a.token, 'sync-snapshot', {
          action: 'create',
          collectionId: a.session.collection.collectionId,
          purpose: 'export',
        })
        expect(snap.status).toBe(200)
        expect(snap.body.checkpoints.some((x: { id: string }) => x.id === checkpoint.id)).toBe(true)
        await request(a.token, 'sync-snapshot', {
          action: 'release',
          snapshotId: snap.body.snapshotId,
        })
      },
    })
    expect(result.ready).toBe(true)
    expect(result.restoredCurrent).toBe(true)
    expect(result.oneHourTargetMet).toBe(true)
    expect(result.currentHash).not.toBe(result.previousHash)
  }, 180000)
})
