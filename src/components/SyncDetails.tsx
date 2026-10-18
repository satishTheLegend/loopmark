import { useState } from 'react'
import type { SyncCategory, SyncItem, SyncSummary } from './sync-summary'
import { safeError } from '../domain/errors'
import { Dialog, ErrorMessage, fullDate } from './ui'

const labels: Record<SyncCategory, string> = {
  account: 'Account access',
  conflict: 'Changes to review',
  quota: 'Capacity',
  failed: 'Failed items',
  waiting: 'Waiting items',
}
export function SyncDetails({
  summary,
  onClose,
  onRetry,
  onReview,
  onSignIn,
  onCapacity,
}: {
  summary: SyncSummary
  onClose: () => void
  onRetry: (items: SyncItem[]) => Promise<void>
  onReview: (operationId: string) => void
  onSignIn: () => void
  onCapacity: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const retryable = summary.items.filter((item) => item.retryable)
  async function retry(items: SyncItem[]) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onRetry(items)
    } catch (failure) {
      const detail = safeError(failure)
      setError(`${detail.problem} ${detail.nextAction}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title="Sync details" onClose={onClose} wide>
      <div className="readable-controls sync-details">
        <p>{summary.label}. Local saves and cloud sync have separate status.</p>
        {summary.lastSyncedAt && (
          <p>
            Last confirmed sync:{' '}
            <time dateTime={summary.lastSyncedAt}>{fullDate(summary.lastSyncedAt)}</time>.
          </p>
        )}
        <ErrorMessage message={error} />
        {summary.items.length === 0 && (
          <p>
            Nothing is waiting. Each attachment still needs to be downloaded before it is available
            offline on this device.
          </p>
        )}
        {(['account', 'conflict', 'quota', 'failed', 'waiting'] as const).map((kind) => {
          const group = summary.items.filter((item) => item.category === kind)
          if (!group.length) return null
          const oldest = group.reduce((a, b) =>
            Date.parse(a.createdAt) < Date.parse(b.createdAt) ? a : b,
          )
          return (
            <section className="sync-group" key={kind}>
              <h3>
                {labels[kind]} <span>({group.length})</span>
              </h3>
              <p>
                Oldest waiting since{' '}
                <time dateTime={oldest.createdAt}>{fullDate(oldest.createdAt)}</time>.
              </p>
              <ul>
                {group.map((item) => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    <span className="sync-item-kind">
                      {item.kind === 'attachment'
                        ? 'Photo or voice note'
                        : item.kind === 'checkpoint'
                          ? 'Checkpoint'
                          : 'Project change'}
                    </span>
                    {item.error && (
                      <p>
                        {item.error.problem} {item.error.nextAction}
                      </p>
                    )}
                    {kind === 'conflict' ? (
                      <button className="button secondary" onClick={() => onReview(item.id)}>
                        Review versions
                      </button>
                    ) : kind === 'account' ? (
                      <button className="button secondary" onClick={onSignIn}>
                        Sign in
                      </button>
                    ) : kind === 'quota' ? (
                      <button className="button secondary" onClick={onCapacity}>
                        Review capacity
                      </button>
                    ) : item.retryable ? (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void retry([item])}
                      >
                        Retry this item
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
        {!!retryable.length && (
          <button className="button primary" disabled={busy} onClick={() => void retry(retryable)}>
            {busy ? 'Retrying…' : 'Retry all transient failures'}
          </button>
        )}
        <p className="hint">
          Conflicts, account access, invalid files and capacity limits need their own action.
        </p>
      </div>
    </Dialog>
  )
}
