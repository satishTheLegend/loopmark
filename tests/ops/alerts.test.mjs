import test from 'node:test'
import assert from 'node:assert/strict'
import { alerts, parsePolicy } from '../../scripts/ops/policy.mjs'
test('operating alerts cover observed queues, conflicts, media, verification, deletion and backup', () => {
  const metrics = {
    oldestReceivedSyncSeconds: 301,
    oldestWebhookSeconds: 301,
    oldestDeletionSeconds: 86401,
    lastCompleteBackupAt: null,
    oldestVerificationSeconds: 3601,
    syncRequests15m: 20,
    syncConflicts15m: 2,
    mediaFailures15m: 5,
    quarantinedJobs: 1,
    liveObjectBytes: 90,
    retainedRecoveryBytes: 10,
  }
  assert.deepEqual(alerts(metrics), [
    'OPERATIONS_OWNER_UNASSIGNED',
    'RECEIVED_SYNC_BACKLOG',
    'WEBHOOK_BACKLOG',
    'DELETION_PURGE_DELAY',
    'DAILY_BACKUP_MISSING',
    'ENTITLEMENT_VERIFICATION_LAG',
    'SYNC_CONFLICT_RATE',
    'MEDIA_FAILURES',
    'QUARANTINED_JOB',
    'OPERATING_BUDGET_UNCONFIGURED',
  ])
  const policy = parsePolicy({
    owner: 'Synthetic drill owner',
    thresholds: { syncSeconds: 600, mediaFailures: 10 },
    storageBudgetBytes: 100,
    operatingBudget: {
      currency: 'INR',
      approvedMonthlyMinor: 10000,
      spentMinor: 8000,
      observedAt: '2026-10-18T00:00:00Z',
      fundedThrough: '2026-11-01T00:00:00Z',
    },
  })
  const actual = alerts(metrics, policy, Date.parse('2026-10-18T00:00:01Z'))
  assert(!actual.includes('RECEIVED_SYNC_BACKLOG'))
  assert(!actual.includes('MEDIA_FAILURES'))
  assert.deepEqual(
    actual.filter((x) => x.startsWith('STORAGE_')),
    ['STORAGE_CAPACITY_50', 'STORAGE_CAPACITY_80', 'STORAGE_CAPACITY_100'],
  )
  assert.deepEqual(
    actual.filter((x) => x.startsWith('OPERATING_BUDGET_')),
    ['OPERATING_BUDGET_50', 'OPERATING_BUDGET_80'],
  )
  policy.operatingBudget.spentMinor = 10000
  assert(
    alerts(metrics, policy, Date.parse('2026-11-02T00:00:00Z')).includes('OPERATING_BUDGET_100'),
  )
  assert(
    alerts(metrics, policy, Date.parse('2026-11-02T00:00:00Z')).includes('FUNDING_PERIOD_EXPIRED'),
  )
  assert.throws(() => parsePolicy({ owner: 'person@example.invalid' }))
  assert.throws(() => parsePolicy({ owner: '   ' }))
  assert.throws(() => parsePolicy({ thresholds: { unknown: 1 } }))
  assert.throws(() => parsePolicy({ operatingBudget: { spentMinor: 1 } }))
})
