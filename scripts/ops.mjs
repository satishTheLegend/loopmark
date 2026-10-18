import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { context, uuid, OpsError, rpc, job, currentLedger, sql } from './ops/common.mjs'
import { rollbackCheck, rollbackResume } from './ops/rollback.mjs'
import { alerts, loadPolicy } from './ops/policy.mjs'
export { alerts } from './ops/policy.mjs'
import { backupSnapshot, restoreCheck, expirePoints, replayErasure } from './ops/recovery.mjs'
export function parseArguments(args) {
  const command = args[0],
    allowed = [
      'status',
      'replay-webhooks',
      'reconcile-purchases',
      'resume-deletions',
      'backup-snapshot',
      'restore-check',
      'maintenance',
      'schedule',
      'rollback-check',
      'rollback-resume',
      'pause-enrollment',
      'resume-enrollment',
      'pause-payments',
      'resume-payments',
    ]
  if (!allowed.includes(command)) throw new OpsError('VALIDATION')
  const parsed = {
    command,
    environment: null,
    target: null,
    limit: 20,
    json: false,
    execute: false,
    jobId: null,
  }
  const seen = new Set()
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]
    if (
      seen.has(flag) ||
      !['--environment', '--target', '--limit', '--json', '--execute', '--job-id'].includes(flag)
    )
      throw new OpsError('VALIDATION')
    seen.add(flag)
    if (flag === '--json' || flag === '--execute') {
      parsed[flag.slice(2)] = true
      continue
    }
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new OpsError('VALIDATION')
    if (flag === '--environment') parsed.environment = value
    if (flag === '--target') parsed.target = value
    if (flag === '--job-id') parsed.jobId = value
    if (flag === '--limit') {
      if (!/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > 100) throw new OpsError('VALIDATION')
      parsed.limit = Number(value)
    }
  }
  if (parsed.environment !== 'local') throw new OpsError('CAPABILITY_UNAVAILABLE')
  if (parsed.target !== 'all' && !uuid.test(parsed.target ?? '')) throw new OpsError('VALIDATION')
  if (parsed.jobId !== null && !uuid.test(parsed.jobId)) throw new OpsError('VALIDATION')
  if (command === 'restore-check' && parsed.target === 'all') throw new OpsError('VALIDATION')
  if (!['restore-check', 'resume-deletions'].includes(command) && parsed.target !== 'all')
    throw new OpsError('VALIDATION')
  return parsed
}
export async function operate(options, { ctx, signal } = {}) {
  ctx ??= await context()
  const result = {
    schemaVersion: 1,
    command: options.command,
    environment: 'local',
    projectId: ctx.config.projectId,
    status: 'ok',
    dryRun: !options.execute,
    counts: { examined: 0, changed: 0, failed: 0 },
    nextCursor: null,
    jobId: options.jobId,
    errors: [],
  }
  // Read-only status is useful even in dry-run; no key/file/job creation occurs here.
  const metrics = await rpc(ctx, 'loopmark_ops_status')
  const policy = await loadPolicy(ctx)
  result.diagnostics = {
    ...metrics,
    policy,
    alerts: alerts(metrics, policy),
    syncQueueScope:
      'received-commands-only; unsent device outboxes are not observable by the server',
  }
  if (!options.execute || options.command === 'status') return result
  if (signal?.aborted) throw new OpsError('CANCELLED')
  if (/^(pause|resume)-(enrollment|payments)$/.test(options.command)) {
    const enabled = options.command.startsWith('resume-')
    result.controls = await rpc(ctx, 'loopmark_ops_control', {
      p_cloud: options.command.endsWith('enrollment') ? enabled : null,
      p_payments: options.command.endsWith('payments') ? enabled : null,
    })
    result.counts.changed = 1
  } else if (options.command === 'rollback-resume') {
    result.rollback = await rollbackResume(ctx)
    result.counts.changed = 1
  } else if (options.command === 'rollback-check') {
    result.rollback = await rollbackCheck(ctx, { signal })
    result.counts = { examined: 2, changed: 2, failed: 0 }
  } else if (options.command === 'backup-snapshot') {
    const point = await backupSnapshot(ctx, { id: options.jobId ?? randomUUID(), signal })
    result.jobId = point.id
    result.counts = { examined: point.objectCount, changed: point.objectCount + 1, failed: 0 }
  } else if (options.command === 'restore-check') {
    const drill = await restoreCheck(ctx, options.target, { signal })
    result.jobId = drill.id
    result.counts = {
      examined: drill.objectCount + drill.erasedAccounts,
      changed: drill.objectCount + drill.erasedAccounts,
      failed: 0,
    }
    result.recovery = {
      pointId: drill.pointId,
      ready: drill.ready,
      rpoMs: drill.rpoMs,
      rtoMs: drill.rtoMs,
      rpoTargetMet: drill.rpoTargetMet,
      rtoTargetMet: drill.rtoTargetMet,
      ledgerWatermark: drill.ledgerWatermark,
    }
  } else if (options.command === 'maintenance') {
    const inventory = await currentLedger(ctx)
    if (signal?.aborted) throw new OpsError('CANCELLED')
    const cursor = Number(
      await sql(
        ctx,
        "select ledger_cursor from loopmark_private.operation_schedules where kind='maintenance'",
      ),
    )
    if (cursor > inventory.entries.length) throw new OpsError('SERVICE_UNAVAILABLE')
    const batch = { ...inventory, entries: inventory.entries.slice(cursor, cursor + options.limit) }
    await replayErasure(ctx, batch, 'postgres', signal)
    await sql(
      ctx,
      `update loopmark_private.operation_schedules set ledger_cursor=greatest(ledger_cursor,${cursor + batch.entries.length}) where kind='maintenance'`,
    )
    result.nextCursor =
      cursor + batch.entries.length < inventory.entries.length
        ? String(cursor + batch.entries.length)
        : null
    if (signal?.aborted) throw new OpsError('CANCELLED')
    const expired = await expirePoints(ctx, options.limit)
    if (signal?.aborted) throw new OpsError('CANCELLED')
    const compacted = await rpc(ctx, 'loopmark_compact', { p_limit: options.limit })
    if (signal?.aborted) throw new OpsError('CANCELLED')
    const swept = await job(ctx, 'sweep-media', options.limit)
    result.counts = {
      examined: batch.entries.length + compacted + swept.counts.examined,
      changed: expired + compacted + swept.counts.changed,
      failed: swept.counts.failed,
    }
    result.errors = swept.errors
    result.status = swept.status
  } else if (options.command === 'schedule') {
    if (
      policy.operatingBudget &&
      policy.operatingBudget.spentMinor >= policy.operatingBudget.approvedMonthlyMinor
    )
      await rpc(ctx, 'loopmark_ops_control', { p_cloud: false, p_payments: null })
    for (const kind of ['maintenance', 'billing', 'backup']) {
      if (signal?.aborted) throw new OpsError('CANCELLED')
      const lease = await rpc(ctx, 'loopmark_ops_claim', { p_kind: kind })
      if (!lease) continue
      let success = false,
        invariant = false
      try {
        const nested = await operate(
          {
            ...options,
            command:
              kind === 'billing'
                ? 'reconcile-purchases'
                : kind === 'backup'
                  ? 'backup-snapshot'
                  : 'maintenance',
          },
          { ctx, signal },
        )
        success = nested.status === 'ok'
        for (const field of ['examined', 'changed', 'failed'])
          result.counts[field] += nested.counts[field]
      } catch (error) {
        invariant =
          error instanceof OpsError && ['MEDIA_INVALID', 'OPERATION_REUSED'].includes(error.code)
        result.counts.failed++
      } finally {
        await rpc(ctx, 'loopmark_ops_finish', {
          p_kind: kind,
          p_fence: lease.fence,
          p_success: success,
          p_invariant_failure: invariant,
        })
      }
    }
    if (result.counts.failed) result.status = 'partial'
  } else {
    const report = await job(
      ctx,
      options.command === 'replay-webhooks' ? 'reconcile-purchases' : options.command,
      options.limit,
      options.target,
    )
    Object.assign(result, { counts: report.counts, status: report.status, errors: report.errors })
  }
  return result
}
export async function main(args = process.argv.slice(2)) {
  let options
  const controller = new AbortController(),
    cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  process.once('SIGTERM', cancel)
  try {
    options = parseArguments(args)
    const result = await operate(options, { signal: controller.signal })
    process.stdout.write(JSON.stringify(result) + '\n')
    process.exitCode = result.status === 'ok' ? 0 : 1
  } catch (error) {
    const code = error instanceof OpsError ? error.code : 'SERVICE_UNAVAILABLE'
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: code === 'VALIDATION' ? 'denied' : 'unavailable',
        dryRun: !options?.execute,
        counts: { examined: 0, changed: 0, failed: 1 },
        nextCursor: null,
        jobId: options?.jobId ?? null,
        errors: [{ code }],
      }) + '\n',
    )
    process.exitCode = code === 'VALIDATION' ? 2 : code === 'CANCELLED' ? 130 : 3
  } finally {
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
