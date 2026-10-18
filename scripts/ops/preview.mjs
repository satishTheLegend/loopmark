import { sql, quote, OpsError } from './common.mjs'
/** Read-only work inventory. Counts describe selected work units, never successful mutations. */
export async function previewWork(ctx, options) {
  const count = async (query) => Number(await sql(ctx, `select count(*) from (${query}) work`))
  const limit = options.limit,
    phases = {}
  if (['replay-webhooks', 'reconcile-purchases'].includes(options.command)) {
    phases.webhooks = await count(
      `select 1 from loopmark_private.webhook_inbox where status<>'done' and next_attempt<=now() and (lease_until is null or lease_until<=now()) limit ${Math.min(limit, 4)}`,
    )
    phases.verifications = await count(
      `select 1 from loopmark_private.purchase_leases where next_attempt<=now() and (expires_at is null or expires_at<=now()) limit ${Math.min(limit, 4)}`,
    )
    phases.discovery = await count(
      `select 1 from loopmark_private.billing_discovery where next_attempt<=now() and (lease_until is null or lease_until<=now()) limit ${limit}`,
    )
    phases.disputeScan = await count(
      'select 1 from loopmark_private.billing_dispute_scan where next_attempt<=now() and (lease_until is null or lease_until<=now()) limit 1',
    )
  } else if (options.command === 'resume-deletions') {
    phases.deletions = await count(
      `select 1 from loopmark_private.jobs where kind='delete-account' and status in ('pending','running') and next_attempt<=now() and (lease_expires_at is null or lease_expires_at<=now()) ${options.target === 'all' ? '' : 'and owner_id=' + quote(options.target) + '::uuid'} limit ${limit}`,
    )
  } else if (options.command === 'backup-snapshot') {
    phases.database = 1
    phases.objects = await count(
      "select 1 from loopmark_private.media_objects where state='ready' limit 100001",
    )
    if (phases.objects > 100000) throw new OpsError('TECHNICAL_CAPACITY_REACHED')
  } else if (options.command === 'restore-check') {
    const rows = JSON.parse(
      await sql(
        ctx,
        `select coalesce(jsonb_agg(object_count),'[]') from loopmark_private.recovery_points where id=${quote(options.target)}::uuid and state='complete' and removed_at is null and expires_at>now()`,
      ),
    )
    if (rows.length !== 1) throw new OpsError('NOT_AVAILABLE')
    phases.isolatedDatabase = 1
    phases.objects = rows[0]
  } else if (options.command === 'schedule') {
    phases.dueSchedules = await count(
      'select 1 from loopmark_private.operation_schedules where not quarantined and next_attempt<=now() and (lease_until is null or lease_until<=now()) limit 3',
    )
  } else if (options.command === 'maintenance') {
    phases.compactionAccounts = await count(
      `select 1 from loopmark_private.accounts where state='active' limit ${limit}`,
    )
    phases.expiringRecoveryPoints = await count(
      `select 1 from loopmark_private.recovery_points where removed_at is null and expires_at<=now() limit ${limit}`,
    )
  } else if (options.command !== 'status') phases.controlOrRollback = 1
  return {
    selectedWorkItems: Object.values(phases).reduce((sum, value) => sum + value, 0),
    phases,
    semantics:
      'Read-only eligible work inventory; execution rechecks leases, eligibility and integrity. Provider results and current-ledger/media sweep work are determined at execution.',
    maximumLedgerAndMediaItems: options.command === 'maintenance' ? limit * 2 : 0,
  }
}
