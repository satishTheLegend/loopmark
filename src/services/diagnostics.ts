import { version } from '../../package.json'
import type { SyncSummary } from '../components/sync-summary'
import { errorHelp } from '../help/errors'
import type { ErrorCode } from '../domain/errors'

const categories = ['account', 'conflict', 'quota', 'failed', 'waiting'] as const
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export interface DiagnosticReport {
  format: 'loopmark-diagnostics'
  version: 1
  appVersion: string
  platform: 'web' | 'ios' | 'android'
  queue: {
    total: number
    projectChanges: number
    checkpoints: number
    attachments: number
    account: number
    conflict: number
    quota: number
    failed: number
    waiting: number
  }
  errors: { code: ErrorCode; correlationId: string }[]
  errorsOmitted: number
}

/** Project only allowlisted scalars. Never serialize the source summary, error or device state. */
export function createDiagnosticReport(summary: SyncSummary, platform: string): DiagnosticReport {
  const queue: DiagnosticReport['queue'] = {
    total: summary.items.length,
    projectChanges: 0,
    checkpoints: 0,
    attachments: 0,
    account: 0,
    conflict: 0,
    quota: 0,
    failed: 0,
    waiting: 0,
  }
  const errors: DiagnosticReport['errors'] = []
  const seen = new Set<string>()
  let errorsOmitted = 0
  for (const item of summary.items) {
    if (item.kind === 'project') queue.projectChanges++
    if (item.kind === 'checkpoint') queue.checkpoints++
    if (item.kind === 'attachment') queue.attachments++
    if (categories.includes(item.category)) queue[item.category]++
  }
  for (const error of [summary.error, ...summary.items.map((item) => item.error)]) {
    if (!error) continue
    const code = Object.hasOwn(errorHelp, error.code) ? error.code : 'UNEXPECTED'
    const correlationId = uuid.test(error.correlationId) ? error.correlationId : 'redacted'
    const key = `${code}:${correlationId}`
    if (seen.has(key)) continue
    seen.add(key)
    if (errors.length < 100) errors.push({ code, correlationId })
    else errorsOmitted++
  }
  return {
    format: 'loopmark-diagnostics',
    version: 1,
    appVersion: version,
    platform: platform === 'ios' || platform === 'android' ? platform : 'web',
    queue,
    errors,
    errorsOmitted,
  }
}
