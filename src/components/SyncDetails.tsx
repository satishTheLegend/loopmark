import { useState } from 'react'
import type { SyncCategory, SyncItem, SyncSummary } from './sync-summary'
import { Dialog, ErrorMessage, errorText, formatSafeError, fullDate } from './ui'

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
  onSync,
  onDiagnostics,
}: {
  summary: SyncSummary
  onClose: () => void
  onRetry: (items: SyncItem[]) => Promise<void>
  onReview: (operationId: string) => void
  onSignIn: () => void
  onCapacity: () => void
  onSync?: () => Promise<void>
  onDiagnostics?: () => void
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
      setError(errorText(failure))
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
        <ErrorMessage message={error || (summary.error ? formatSafeError(summary.error) : '')} />
        {summary.items.length === 0 && (
          <p>
            {summary.kind === 'current' || summary.kind === 'local'
              ? 'No local changes are waiting.'
              : 'No local changes are queued; account updates may still be waiting.'}{' '}
            Each attachment still needs to be downloaded before it is available offline on this
            device.
          </p>
        )}
        {summary.kind === 'account' && (
          <button className="button primary" onClick={onSignIn}>
            Sign in to continue
          </button>
        )}
        {onSync &&
          ['failed', 'waiting'].includes(summary.kind) &&
          (!summary.error || summary.error.retryable) && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                setError('')
                void onSync()
                  .catch((failure) => {
                    setError(errorText(failure))
                  })
                  .finally(() => setBusy(false))
              }}
            >
              {busy ? 'Syncing…' : 'Try syncing now'}
            </button>
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
                    {item.error && <p>{formatSafeError(item.error)}</p>}
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
        {onDiagnostics && (
          <button className="button secondary" onClick={onDiagnostics}>
            Preview diagnostic report
          </button>
        )}
      </div>
    </Dialog>
  )
}
