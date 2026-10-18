import { describe, expect, it } from 'vitest'
import type { CollectionView, PendingIntent } from '../domain/contracts'
import { DomainError, type ErrorCode } from '../domain/errors'
import { canRetryTransient, summarizeSync, type SyncItem } from './sync-summary'
import { create, info, now, project } from '../repositories/browser/fixtures.test-support'

function pending(code?: ErrorCode): PendingIntent {
  const intent = create()
  return {
    intent,
    command: {
      ...intent,
      protocolVersion: 2,
      payloadVersion: 1,
      collectionId: 'collection',
      epoch: 'epoch',
      deviceId: 'device',
      deviceGeneration: 'generation',
      sequence: '1',
      sha256: 'a'.repeat(64),
    },
    state: code === 'REVISION_CONFLICT' ? 'conflict' : code ? 'rejected' : 'queued',
    ...(code ? { error: new DomainError(code).detail } : {}),
  }
}
function view(items: PendingIntent[] = []): CollectionView {
  return {
    info: info(true),
    revision: '1',
    cursor: '0',
    projects: [project()],
    checkpoints: [],
    pending: items,
    hydration: 'ready',
  }
}
describe('sync status preserves independent work and priority', () => {
  it('uses auth before conflict before quota without hiding lower-priority items', () => {
    const input = view([
      pending('REVISION_CONFLICT'),
      pending('MEDIA_CAPACITY_REACHED'),
      pending('SERVICE_UNAVAILABLE'),
    ])
    const auth = summarizeSync({ view: input, online: false, working: true, authRequired: true })
    expect(auth.kind).toBe('account')
    expect(auth.items.map((item) => item.category)).toEqual(['conflict', 'quota', 'failed'])
    expect(summarizeSync({ view: input, online: false, working: true }).kind).toBe('conflict')
    expect(summarizeSync({ view: input, online: true, working: false, disabled: true }).kind).toBe(
      'disabled',
    )
  })
  it('keeps attachment failure visible after metadata has been acknowledged', () => {
    const attachment: SyncItem = {
      id: 'photo',
      title: 'Moss scarf',
      kind: 'attachment',
      createdAt: now,
      category: 'failed',
      error: new DomainError('SERVICE_UNAVAILABLE').detail,
      retryable: false,
    }
    const summary = summarizeSync({
      view: view(),
      online: false,
      working: false,
      lastSyncedAt: now,
      attachments: [attachment],
    })
    expect(summary.kind).toBe('failed')
    expect(summary.items[0].retryable).toBe(true)
    expect(summary.lastSyncedAt).toBe(now)
  })
  it('does not announce a cloud success before confirmation or first hydration', () => {
    expect(summarizeSync({ view: view(), online: true, working: false }).label).toBe(
      'Ready to sync',
    )
    expect(
      summarizeSync({ view: { ...view(), hydration: 'empty' }, online: true, working: false })
        .label,
    ).toBe('Loading your projects')
    expect(
      summarizeSync({ view: view(), online: true, working: false, lastSyncedAt: now }).label,
    ).toBe('Synced to your account')
    expect(
      summarizeSync({
        view: { ...view(), info: info() },
        online: true,
        working: false,
        lastSyncedAt: now,
      }).kind,
    ).toBe('local')
  })
  it('never retries permanent remedies even if an upstream error incorrectly marks them retryable', () => {
    for (const code of [
      'AUTH_REQUIRED',
      'ACCOUNT_CHANGED',
      'REVISION_CONFLICT',
      'UPGRADE_REQUIRED',
      'TECHNICAL_CAPACITY_REACHED',
      'MEDIA_CAPACITY_REACHED',
      'VALIDATION',
      'MEDIA_INVALID',
      'SYNC_REBASE_REQUIRED',
    ] as const) {
      expect(
        canRetryTransient({
          category: 'failed',
          error: { ...new DomainError(code).detail, retryable: true },
        }),
      ).toBe(false)
    }
    expect(
      canRetryTransient({
        category: 'conflict',
        error: new DomainError('SERVICE_UNAVAILABLE').detail,
      }),
    ).toBe(false)
  })
})
