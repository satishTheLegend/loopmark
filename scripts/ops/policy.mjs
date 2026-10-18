import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { OpsError } from './common.mjs'
export const defaultThresholds = Object.freeze({
  syncSeconds: 300,
  webhookSeconds: 300,
  deletionSeconds: 86400,
  backupSeconds: 86400,
  verificationSeconds: 3600,
  conflictPercent: 10,
  conflictMinimum: 20,
  mediaFailures: 5,
})
export function parsePolicy(input = {}) {
  if (
    !input ||
    Array.isArray(input) ||
    typeof input !== 'object' ||
    Object.keys(input).some(
      (k) => !['owner', 'thresholds', 'storageBudgetBytes', 'operatingBudget'].includes(k),
    )
  )
    throw new OpsError('VALIDATION')
  const owner = typeof input.owner === 'string' ? input.owner.trim() : (input.owner ?? null)
  if (owner !== null && (typeof owner !== 'string' || !/^[- A-Za-z0-9_]{1,80}$/.test(owner)))
    throw new OpsError('VALIDATION')
  const thresholds = { ...defaultThresholds }
  if (input.thresholds !== undefined) {
    if (
      !input.thresholds ||
      Array.isArray(input.thresholds) ||
      typeof input.thresholds !== 'object'
    )
      throw new OpsError('VALIDATION')
    for (const [k, v] of Object.entries(input.thresholds)) {
      if (
        !Object.hasOwn(defaultThresholds, k) ||
        !Number.isSafeInteger(v) ||
        v < 1 ||
        v > 8640000 ||
        (k === 'conflictPercent' && v > 100)
      )
        throw new OpsError('VALIDATION')
      thresholds[k] = v
    }
  }
  const storageBudgetBytes = input.storageBudgetBytes ?? null
  if (
    storageBudgetBytes !== null &&
    (!Number.isSafeInteger(storageBudgetBytes) || storageBudgetBytes < 1)
  )
    throw new OpsError('VALIDATION')
  const operatingBudget = input.operatingBudget ?? null
  if (operatingBudget !== null) {
    if (
      Object.keys(operatingBudget).sort().join(',') !==
        'approvedMonthlyMinor,currency,fundedThrough,observedAt,spentMinor' ||
      !Number.isSafeInteger(operatingBudget.approvedMonthlyMinor) ||
      operatingBudget.approvedMonthlyMinor < 1 ||
      !Number.isSafeInteger(operatingBudget.spentMinor) ||
      operatingBudget.spentMinor < 0 ||
      !/^[A-Z]{3}$/.test(operatingBudget.currency) ||
      ![operatingBudget.observedAt, operatingBudget.fundedThrough].every(
        (x) => typeof x === 'string' && Number.isFinite(Date.parse(x)),
      )
    )
      throw new OpsError('VALIDATION')
  }
  return { owner, thresholds, storageBudgetBytes, operatingBudget }
}
export async function loadPolicy(ctx) {
  const input = await readFile(resolve(ctx.runtime, 'operations-policy.json'), 'utf8').catch(
    (error) => {
      if (error.code === 'ENOENT') return '{}'
      throw error
    },
  )
  try {
    return parsePolicy(JSON.parse(input))
  } catch {
    throw new OpsError('VALIDATION')
  }
}
export function alerts(metrics, policy = parsePolicy(), now = Date.now()) {
  const result = [],
    t = policy.thresholds
  if (!policy.owner) result.push('OPERATIONS_OWNER_UNASSIGNED')
  if (metrics.oldestReceivedSyncSeconds > t.syncSeconds) result.push('RECEIVED_SYNC_BACKLOG')
  if (metrics.oldestWebhookSeconds > t.webhookSeconds) result.push('WEBHOOK_BACKLOG')
  if (metrics.oldestDeletionSeconds > t.deletionSeconds) result.push('DELETION_PURGE_DELAY')
  if (
    !metrics.lastCompleteBackupAt ||
    now - Date.parse(metrics.lastCompleteBackupAt) > t.backupSeconds * 1000
  )
    result.push('DAILY_BACKUP_MISSING')
  if (metrics.oldestVerificationSeconds > t.verificationSeconds)
    result.push('ENTITLEMENT_VERIFICATION_LAG')
  if (
    metrics.syncRequests15m >= t.conflictMinimum &&
    (metrics.syncConflicts15m / metrics.syncRequests15m) * 100 >= t.conflictPercent
  )
    result.push('SYNC_CONFLICT_RATE')
  if (metrics.mediaFailures15m >= t.mediaFailures) result.push('MEDIA_FAILURES')
  if (metrics.quarantinedJobs) result.push('QUARANTINED_JOB')
  if (policy.storageBudgetBytes)
    for (const percent of [50, 80, 100])
      if (
        (metrics.liveObjectBytes + metrics.retainedRecoveryBytes) / policy.storageBudgetBytes >=
        percent / 100
      )
        result.push('STORAGE_CAPACITY_' + percent)
  const money = policy.operatingBudget
  if (!money) result.push('OPERATING_BUDGET_UNCONFIGURED')
  else {
    if (
      now - Date.parse(money.observedAt) > 86400000 ||
      Date.parse(money.observedAt) > now + 300000
    )
      result.push('OPERATING_SPEND_OBSERVATION_STALE')
    if (Date.parse(money.fundedThrough) < now) result.push('FUNDING_PERIOD_EXPIRED')
    for (const percent of [50, 80, 100])
      if (money.spentMinor / money.approvedMonthlyMinor >= percent / 100)
        result.push('OPERATING_BUDGET_' + percent)
  }
  return result
}
