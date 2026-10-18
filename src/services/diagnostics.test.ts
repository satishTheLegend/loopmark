import { describe, expect, it } from 'vitest'
import { createDiagnosticReport } from './diagnostics'
import type { SyncSummary } from '../components/sync-summary'
import { DomainError } from '../domain/errors'

const summary = (): SyncSummary => ({
  kind: 'local',
  label: 'On this device',
  actionable: false,
  items: [],
  lastSyncedAt: null,
})
describe('diagnostic privacy projection', () => {
  it('keeps queue counts and valid error IDs while excluding content, arbitrary error text and invalid IDs', () => {
    const source = summary()
    const sentinel =
      'private-maker@example.invalid Bearer secret https://private.invalid/?token=secret'
    source.label = sentinel
    source.error = new DomainError('OFFLINE', { correlationId: sentinel }).detail
    source.items = [
      {
        id: sentinel,
        title: sentinel,
        kind: 'checkpoint',
        category: 'waiting',
        createdAt: sentinel,
        retryable: true,
        error: {
          ...new DomainError('SERVICE_UNAVAILABLE').detail,
          problem: sentinel,
          cause: sentinel,
          nextAction: sentinel,
          helpRef: sentinel,
        },
      },
      {
        id: sentinel,
        title: sentinel,
        kind: 'attachment',
        category: 'failed',
        createdAt: sentinel,
        retryable: false,
        error: {
          ...new DomainError('UNEXPECTED').detail,
          code: sentinel as never,
          correlationId: sentinel,
        },
      },
    ]
    const report = createDiagnosticReport(source, sentinel)
    expect(JSON.stringify(report)).not.toContain(sentinel)
    expect(report.platform).toBe('web')
    expect(report.queue).toMatchObject({
      total: 2,
      checkpoints: 1,
      attachments: 1,
      failed: 1,
      waiting: 1,
    })
    expect(report.errors).toEqual([
      { code: 'OFFLINE', correlationId: 'redacted' },
      { code: 'SERVICE_UNAVAILABLE', correlationId: source.items[0].error!.correlationId },
      { code: 'UNEXPECTED', correlationId: 'redacted' },
    ])
  })
  it('is an immutable preview snapshot and carries no prior collection errors into a new report', () => {
    const source = summary()
    source.error = new DomainError('AUTH_REQUIRED').detail
    const first = createDiagnosticReport(source, 'ios')
    source.error.correlationId = 'changed'
    source.items.push({
      id: 'private-id',
      title: 'private-name',
      kind: 'project',
      category: 'waiting',
      createdAt: '',
      retryable: false,
    })
    expect(first.queue.total).toBe(0)
    expect(first.errors[0].correlationId).not.toBe('changed')
    expect(createDiagnosticReport(summary(), 'android').errors).toEqual([])
  })
  it('deduplicates and bounds error IDs without truncating the queue count', () => {
    const source = summary()
    source.items = Array.from({ length: 120 }, () => ({
      id: crypto.randomUUID(),
      title: 'private',
      kind: 'project',
      category: 'failed',
      createdAt: '',
      retryable: false,
      error: new DomainError('SERVICE_UNAVAILABLE').detail,
    }))
    source.error = source.items[0].error
    const report = createDiagnosticReport(source, 'web')
    expect(report.errors).toHaveLength(100)
    expect(report.errorsOmitted).toBe(20)
    expect(report.queue.total).toBe(120)
  })
})
