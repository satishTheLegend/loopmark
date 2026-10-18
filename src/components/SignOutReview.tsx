import { useState } from 'react'
import type { LocalWorkCounts } from '../services/controller-contract'
import { safeError } from '../domain/errors'
import { Dialog, ErrorMessage } from './ui'

export function SignOutReview({
  counts,
  accountEmail,
  onConfirm,
  onBackup,
  onClose,
}: {
  counts: LocalWorkCounts
  accountEmail: string
  onConfirm: (options: { keepLocal: boolean; discardUniqueWork?: boolean }) => Promise<void>
  onBackup: () => void
  onClose: () => void
}) {
  const [keepLocal, setKeepLocal] = useState(true)
  const [discard, setDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const unique =
    counts.drafts +
    counts.unsentProjectChanges +
    counts.unsentCheckpoints +
    counts.pendingAttachments +
    counts.failedAttachments
  async function confirm() {
    if (busy || (!keepLocal && unique > 0 && !discard)) return
    setBusy(true)
    setError('')
    try {
      await onConfirm({ keepLocal, discardUniqueWork: !keepLocal && discard })
    } catch (failure) {
      const detail = safeError(failure)
      setError(`${detail.problem} ${detail.nextAction}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Sign out of this account?"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="readable-controls">
        <p>
          Signed in as <strong>{accountEmail}</strong>. Choose what happens to this account’s copy
          on this device.
        </p>
        <dl className="review-counts">
          <div>
            <dt>Unsent project changes</dt>
            <dd>{counts.unsentProjectChanges}</dd>
          </div>
          <div>
            <dt>Unsent checkpoints</dt>
            <dd>{counts.unsentCheckpoints}</dd>
          </div>
          <div>
            <dt>Attachments waiting</dt>
            <dd>{counts.pendingAttachments}</dd>
          </div>
          <div>
            <dt>Failed attachments</dt>
            <dd>{counts.failedAttachments}</dd>
          </div>
          <div>
            <dt>Saved drafts</dt>
            <dd>{counts.drafts}</dd>
          </div>
          <div>
            <dt>Recovered local collections</dt>
            <dd>{counts.recoveredCollections}</dd>
          </div>
        </dl>
        <fieldset className="choice-list" disabled={busy}>
          <legend>Device copy</legend>
          <label>
            <input
              type="radio"
              name="device-copy"
              checked={keepLocal}
              onChange={() => {
                setKeepLocal(true)
                setDiscard(false)
              }}
            />
            <span>
              <strong>Keep on this device</strong>
              <span>
                A separate local collection remains available. It will not automatically upload to
                another account.
              </span>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="device-copy"
              checked={!keepLocal}
              onChange={() => setKeepLocal(false)}
            />
            <span>
              <strong>Remove device copy</strong>
              <span>
                Synced records remain in your account. Unsent work in this copy is removed. Existing
                recovered collections remain separate.
              </span>
            </span>
          </label>
        </fieldset>
        {!keepLocal && unique > 0 && (
          <label className="confirm-choice">
            <input
              type="checkbox"
              checked={discard}
              disabled={busy}
              onChange={(event) => setDiscard(event.target.checked)}
            />
            <span>
              Discard the unsent project changes, checkpoints, attachments and drafts listed above
              that exist only on this device.
            </span>
          </label>
        )}
        <button className="text-button" disabled={busy} onClick={onBackup}>
          Create complete backup first
        </button>
        <ErrorMessage message={error} />
        <div className="dialog-actions">
          <button className="button secondary" disabled={busy} onClick={onClose}>
            Keep signed in
          </button>
          <button
            className={`button ${keepLocal ? 'primary' : 'danger'}`}
            disabled={busy || (!keepLocal && unique > 0 && !discard)}
            onClick={() => void confirm()}
          >
            {busy
              ? 'Signing out…'
              : keepLocal
                ? 'Sign out and keep copy'
                : 'Sign out and remove copy'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
