import { useState } from 'react'
import type { DeletionReceipt } from '../domain/contracts'
import { ErrorMessage, errorText, fullDate } from './ui'

export type LocalCopyOutcome = 'kept' | 'removed' | 'not-completed'
export function DeletionReceiptView({
  receipt,
  requestedAt,
  localOutcome,
  onRefresh,
  onDownload,
}: {
  receipt: DeletionReceipt | null
  requestedAt: string
  localOutcome: LocalCopyOutcome
  onRefresh: () => Promise<void>
  onDownload: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function act(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="account-section readable-controls" aria-label="Account deletion receipt">
      <h2>Deletion request</h2>
      <p>
        Requested <time dateTime={requestedAt}>{fullDate(requestedAt)}</time>.
      </p>
      <div role="status">
        {!receipt ? (
          <p>
            This request was saved on this device, but server acceptance has not been confirmed.
            Check its status to find out whether account removal has started.
          </p>
        ) : receipt.status === 'pending' ? (
          <p>Your request is accepted. Account access is disabled and removal is pending.</p>
        ) : receipt.status === 'live-data-removed' ? (
          <p>
            Live account data was removed{' '}
            <time dateTime={receipt.removedAt}>{fullDate(receipt.removedAt)}</time>. Backup
            retention ends{' '}
            <time dateTime={receipt.backupExpiresAt}>{fullDate(receipt.backupExpiresAt)}</time>.
          </p>
        ) : receipt.status === 'complete' ? (
          <p>
            Deletion completed{' '}
            <time dateTime={receipt.completedAt}>{fullDate(receipt.completedAt)}</time>.
          </p>
        ) : (
          <p>
            This request needs support. Reference: <code>{receipt.correlationId}</code>.
          </p>
        )}
      </div>
      <p>
        {localOutcome === 'kept'
          ? 'Saved notes and available attachments were kept as separate local collections.'
          : localOutcome === 'removed'
            ? 'This account’s device copies were removed. Existing separate local collections remain.'
            : 'Device-copy cleanup has not been confirmed. Your deletion request and local storage have separate status; review your collections before removing anything.'}
      </p>
      <p>
        The receipt can check deletion status without signing in. Its downloaded file contains a
        private status key; keep that file to yourself.
      </p>
      <ErrorMessage message={error} />
      <div className="account-actions">
        <button className="button secondary" disabled={busy} onClick={() => void act(onRefresh)}>
          {busy ? 'Working…' : 'Check deletion status'}
        </button>
        <button className="button secondary" disabled={busy} onClick={() => void act(onDownload)}>
          Save deletion receipt
        </button>
        <a href="/support">Get help</a>
      </div>
    </section>
  )
}
