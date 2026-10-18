import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { actor, createProject, request, command, quote } from './helpers'
import { audioFixture, reserve, upload } from './media-fixtures'
import { recent, adminClient } from './billing-fixtures'
import {
  context,
  sql,
  ledger,
  currentLedger,
  rpc,
  job,
  run,
  type OpsContext,
} from '../../scripts/ops/common.mjs'
import {
  backupSnapshot,
  verifyPoint,
  restoreCheck,
  recoveredBytes,
  expirePoints,
  cleanupExpiredDrills,
  replayErasure,
} from '../../scripts/ops/recovery.mjs'
let ctx: OpsContext
beforeAll(async () => {
  ctx = await context()
})
async function ownerWithMedia(seed: number) {
  const a = await actor(),
    created = await createProject(a),
    fixture = audioFixture(seed),
    reservation = await reserve(a, fixture.ref)
  expect((await upload(a, reservation.body, fixture.bytes)).status).toBe(200)
  const checkpoint = {
    id: randomUUID(),
    projectId: created.project.id,
    createdAt: new Date().toISOString(),
    position: '12',
    toolSize: '4mm',
    nextStep: 'Resume here',
    notes: 'Recovery fixture',
    voice: fixture.ref,
  }
  const mutation = await command(
    a,
    { kind: 'checkpoint.create', payload: { checkpoint, updatedAt: checkpoint.createdAt } },
    { revision: '1' },
  )
  expect((await request(a.token, 'sync-push', mutation)).status).toBe(200)
  const objectKey = await sql(
    ctx,
    `select object_key from loopmark_private.media where owner_id=${quote(a.id)}::uuid and id=${quote(fixture.ref.id)}`,
  )
  return { a, fixture, objectKey }
}
describe('I11 real encrypted database/object recovery with current independent erasure ledger', () => {
  it('makes dry-run status parseable without modifying catalogs or schedules', async () => {
    const before = await sql(
      ctx,
      'select row_to_json(x) from (select (select count(*) from loopmark_private.recovery_points) points,(select sum(fence) from loopmark_private.operation_schedules) fences) x',
    )
    const result = JSON.parse(
      (
        await run(process.execPath, [
          'scripts/ops.mjs',
          'backup-snapshot',
          '--environment',
          'local',
          '--target',
          'all',
          '--limit',
          '20',
          '--json',
        ])
      ).toString(),
    )
    expect(result.dryRun).toBe(true)
    expect(result.counts.changed).toBe(0)
    expect(
      await sql(
        ctx,
        'select row_to_json(x) from (select (select count(*) from loopmark_private.recovery_points) points,(select sum(fence) from loopmark_private.operation_schedules) fences) x',
      ),
    ).toBe(before)
  })
  it('copies verified bytes, restores an isolated database, and applies an intent appended after the snapshot before traffic readiness', async () => {
    const survivor = await ownerWithMedia(70),
      deleted = await ownerWithMedia(71),
      id = randomUUID()
    const point = await backupSnapshot(ctx, { id })
    expect(point.state).toBe('complete')
    expect(point.objectCount).toBeGreaterThanOrEqual(2)
    expect((await backupSnapshot(ctx, { id })).manifestHash).toBe(point.manifestHash)
    const token = randomBytes(32).toString('hex'),
      requestId = randomUUID(),
      input = {
        requestId,
        receiptTokenHash: createHash('sha256').update(token).digest('hex'),
        reauthentication: await recent(deleted.a),
      }
    const prepared = await deleted.a.client.rpc('loopmark_delete_prepare', { request: input })
    expect(prepared.error).toBeNull()
    await ledger(ctx, '/append', prepared.data)
    // The authorized intent exists only in the independent ledger at this crash boundary.
    expect(
      await sql(
        ctx,
        `select state from loopmark_private.accounts where id=${quote(deleted.a.id)}::uuid`,
      ),
    ).toBe('active')
    let inspected = 0
    for (let repeat = 0; repeat < 2; repeat++) {
      const restored = await restoreCheck(ctx, id, {
        inspect: async (value) => {
          inspected++
          expect(value.ready).toBe(true)
          expect(
            await sql(
              ctx,
              "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'loopmark_%' and has_function_privilege('anon',p.oid,'execute')",
              value.database,
            ),
          ).toBe('0')
          expect(await recoveredBytes(ctx, value, survivor.objectKey)).toEqual(
            Buffer.from(survivor.fixture.bytes),
          )
          await expect(recoveredBytes(ctx, value, deleted.objectKey)).rejects.toThrow()
          expect(
            await sql(
              ctx,
              `select count(*) from auth.users where id=${quote(deleted.a.id)}::uuid`,
              value.database,
            ),
          ).toBe('0')
          expect(
            await sql(
              ctx,
              `select count(*) from loopmark_private.projects where owner_id=${quote(deleted.a.id)}::uuid`,
              value.database,
            ),
          ).toBe('0')
          expect(
            await sql(
              ctx,
              `select receipt_token_hash from loopmark_private.deletion_requests where request_id=${quote(requestId)}`,
              value.database,
            ),
          ).toBe(input.receiptTokenHash)
        },
      })
      expect(restored.rpoTargetMet).toBe(true)
      expect(restored.rtoTargetMet).toBe(true)
      expect(
        await sql(
          ctx,
          `select count(*) from pg_database where datname=${quote(restored.database)}`,
        ),
      ).toBe('0')
      await expect(readdir(restored.destination)).rejects.toThrow()
      expect(
        await sql(
          ctx,
          `select removed_at is not null from loopmark_private.restore_drills where id=${quote(restored.id)}::uuid`,
        ),
      ).toBe('t')
    }
    expect(inspected).toBe(2)
  }, 180000)
  it('rejects unavailable or changing current ledgers and corrupted persisted objects without a ready gate', async () => {
    const id = randomUUID(),
      point = await backupSnapshot(ctx, { id }),
      before = await readdir(resolve('.gstack/restore-evidence', ctx.config.profile)).catch(
        (): string[] => [],
      )
    await expect(
      restoreCheck(ctx, id, {
        ledgerReader: async () => {
          throw new Error('unavailable')
        },
      }),
    ).rejects.toThrow()
    let reads = 0
    await expect(
      restoreCheck(ctx, id, {
        ledgerReader: async () => {
          const inventory = await currentLedger(ctx)
          if (++reads > 1) inventory.watermark = '1:' + 'a'.repeat(64)
          return inventory
        },
      }),
    ).rejects.toThrow()
    expect(reads).toBe(2)
    const after = await readdir(resolve('.gstack/restore-evidence', ctx.config.profile))
    for (const folder of after.filter((x) => !before.includes(x)))
      expect(
        JSON.parse(
          await readFile(resolve('.gstack/restore-evidence', ctx.config.profile, folder), 'utf8'),
        ).ready,
      ).toBe(false)
    const verified = await verifyPoint(ctx, id),
      object = verified.manifest.objects[0],
      path = resolve(verified.directory, object.file),
      bytes = await readFile(path),
      corrupt = Buffer.from(bytes)
    corrupt[corrupt.length - 1] ^= 1
    await writeFile(path, corrupt)
    try {
      await expect(verifyPoint(ctx, id)).rejects.toThrow()
      expect(point.state).toBe('complete')
    } finally {
      await writeFile(path, bytes)
    }
  }, 180000)
  it('cancels before new erasure work and leaves persisted cursor retryable', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      replayErasure(
        ctx,
        { watermark: '0:' + '0'.repeat(64), entries: [{}] },
        'postgres',
        controller.signal,
      ),
    ).rejects.toThrow('CANCELLED')
  })
  it('fences scheduled work so simultaneous claims and stale completions cannot repeat effects', async () => {
    await sql(
      ctx,
      "update loopmark_private.operation_schedules set next_attempt=now()-interval '1 second',lease_until=null where kind='maintenance'",
    )
    const claims = await Promise.all([
      rpc(ctx, 'loopmark_ops_claim', { p_kind: 'maintenance' }),
      rpc(ctx, 'loopmark_ops_claim', { p_kind: 'maintenance' }),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const lease = claims.find(Boolean)
    await rpc(ctx, 'loopmark_ops_finish', {
      p_kind: 'maintenance',
      p_fence: lease.fence,
      p_success: true,
      p_invariant_failure: false,
    })
    await expect(
      rpc(ctx, 'loopmark_ops_finish', {
        p_kind: 'maintenance',
        p_fence: lease.fence,
        p_success: true,
        p_invariant_failure: false,
      }),
    ).rejects.toThrow()
  })
  it('keeps partial copies incomplete and resumes the same operation after source repair', async () => {
    const owned = await ownerWithMedia(72),
      client = await adminClient(),
      id = randomUUID(),
      bad = owned.fixture.bytes.slice()
    bad[bad.length - 1] ^= 1
    expect(
      (
        await client.storage
          .from('loopmark-private')
          .upload(owned.objectKey, bad, { upsert: true, contentType: owned.fixture.ref.mimeType })
      ).error,
    ).toBeNull()
    try {
      await expect(
        backupSnapshot(ctx, {
          id,
          beforeCopy: async () => {
            const indexPath = resolve(ctx.recovery, id, 'index.json'),
              before = await readFile(indexPath)
            await expect(backupSnapshot(ctx, { id })).rejects.toThrow('RATE_LIMITED')
            expect(await readFile(indexPath)).toEqual(before)
            expect(
              await rpc(ctx, 'loopmark_media_sweep_claim', { p_limit: 20, p_owner: null }),
            ).toEqual([])
          },
        }),
      ).rejects.toThrow('MEDIA_INVALID')
      expect(
        await sql(
          ctx,
          `select state from loopmark_private.recovery_points where id=${quote(id)}::uuid`,
        ),
      ).toBe('incomplete')
      await expect(verifyPoint(ctx, id)).rejects.toThrow()
    } finally {
      expect(
        (
          await client.storage
            .from('loopmark-private')
            .upload(owned.objectKey, owned.fixture.bytes, {
              upsert: true,
              contentType: owned.fixture.ref.mimeType,
            })
        ).error,
      ).toBeNull()
    }
    expect((await backupSnapshot(ctx, { id })).state).toBe('complete')
  }, 180000)
  it('cleans registered interrupted drill databases and copies before allowing retention completion', async () => {
    const point = await backupSnapshot(ctx),
      id = randomUUID(),
      database = 'lm_restore_' + id.replaceAll('-', ''),
      directory = resolve('.gstack/restores', ctx.config.profile, id)
    await mkdir(directory, { recursive: true })
    await writeFile(resolve(directory, 'orphan.enc'), randomBytes(64))
    await sql(
      ctx,
      `insert into loopmark_private.restore_drills(id,point_id,expires_at,owner_pid) values(${quote(id)}::uuid,${quote(point.id)}::uuid,now()-interval '1 second',2147483647)`,
    )
    await sql(ctx, `create database ${database} template template0;`)
    expect(await cleanupExpiredDrills(ctx, 1)).toBe(1)
    expect(
      await sql(ctx, `select count(*) from pg_database where datname=${quote(database)}`),
    ).toBe('0')
    await expect(readdir(directory)).rejects.toThrow()
    expect(
      await sql(
        ctx,
        `select removed_at is not null from loopmark_private.restore_drills where id=${quote(id)}::uuid`,
      ),
    ).toBe('t')
  }, 180000)
  it('does not expire a live paused restore owner then allow untracked artifacts to reappear', async () => {
    const point = await backupSnapshot(ctx),
      inventory = await currentLedger(ctx)
    let release!: () => void, entered!: () => void
    const paused = new Promise<void>((r) => {
        release = r
      }),
      started = new Promise<void>((r) => {
        entered = r
      })
    let reads = 0
    const running = restoreCheck(ctx, point.id, {
      ledgerReader: async () => {
        if (++reads === 1) {
          entered()
          await paused
        }
        return inventory
      },
    })
    await started
    try {
      expect(await cleanupExpiredDrills(ctx, 100, Date.now() + 86400000)).toBe(0)
      expect(
        await sql(
          ctx,
          `select count(*) from loopmark_private.restore_drills where point_id=${quote(point.id)}::uuid and removed_at is null`,
        ),
      ).toBe('1')
    } finally {
      release()
    }
    const result = await running
    expect(result.ready).toBe(true)
    expect(
      await sql(ctx, `select count(*) from pg_database where datname=${quote(result.database)}`),
    ).toBe('0')
    await expect(readdir(result.destination)).rejects.toThrow()
  }, 180000)
  it('completes a text-only deletion only after containing recovery bytes are physically expired', async () => {
    const a = await actor()
    await createProject(a)
    const id = randomUUID(),
      point = await backupSnapshot(ctx, { id }),
      token = randomBytes(32).toString('hex'),
      requestId = randomUUID()
    expect(
      await sql(
        ctx,
        `select count(*) from loopmark_private.recovery_accounts where point_id=${quote(id)}::uuid and owner_id=${quote(a.id)}::uuid`,
      ),
    ).toBe('1')
    expect(
      (
        await request(a.token, 'account-delete', {
          requestId,
          receiptTokenHash: createHash('sha256').update(token).digest('hex'),
          reauthentication: await recent(a),
        })
      ).status,
    ).toBe(200)
    await sql(
      ctx,
      `update loopmark_private.deletion_requests set purge_after=now()-interval '1 second' where owner_id=${quote(a.id)}::uuid;update loopmark_private.jobs set next_attempt=now()-interval '1 second' where owner_id=${quote(a.id)}::uuid`,
    )
    expect((await job(ctx, 'resume-deletions', 1, a.id)).counts.failed).toBe(0)
    // Explicit synthetic aging; no claim that a week elapsed during this test.
    await sql(
      ctx,
      `update loopmark_private.deletion_requests set removed_at=now()-interval '8 days',backup_expires_at=now()-interval '1 day' where owner_id=${quote(a.id)}::uuid`,
    )
    await rpc(ctx, 'loopmark_ops_retention', { p_limit: 100 })
    expect(
      (await request('', 'deletion-status', { requestId, receiptToken: token })).body.status,
    ).toBe('live-data-removed')
    expect(await expirePoints(ctx, 100, Date.parse(point.expiresAt) + 86400000)).toBeGreaterThan(0)
    await expect(readFile(resolve(ctx.recovery, id, 'database.enc'))).rejects.toThrow()
    const completed = await request('', 'deletion-status', { requestId, receiptToken: token })
    expect(completed.body.status).toBe('complete')
    expect(Object.keys(completed.body).sort()).toEqual(['completedAt', 'status'])
  }, 180000)
})
