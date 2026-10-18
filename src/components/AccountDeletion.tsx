import { useEffect, useState } from 'react'
import type { LocalWorkCounts } from '../services/controller-contract'
import { Dialog, ErrorMessage, errorText } from './ui'

export interface DeletionChoice {
  code: string
  keepLocal: boolean
  discardUniqueWork: boolean
  allowMissingAttachments: boolean
}
export function AccountDeletion({
  accountEmail,
  counts,
  missingAttachments,
  onRequestCode,
  onRefreshReview,
  onDelete,
  onBackup,
  onClose,
}: {
  accountEmail: string
  counts: LocalWorkCounts
  missingAttachments: number | null
  onRefreshReview?: () => Promise<void>
  onRequestCode: () => Promise<{ retryAt: string }>
  onDelete: (choice: DeletionChoice) => Promise<void>
  onBackup: () => void
  onClose: () => void
}) {
  const [keepLocal, setKeepLocal] = useState(true),
    [discard, setDiscard] = useState(false),
    [allowMissing, setAllowMissing] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [code, setCode] = useState(''),
    [sent, setSent] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState<'sending' | 'deleting' | 'reviewing' | null>(null),
    [retryAt, setRetryAt] = useState(0),
    [now, setNow] = useState(Date.now())
  const unique =
    counts.drafts +
    counts.unsentProjectChanges +
    counts.unsentCheckpoints +
    counts.pendingAttachments +
    counts.failedAttachments
  useEffect(() => {
    if (retryAt <= Date.now()) return
    const timer = setInterval(() => {
      const time = Date.now()
      setNow(time)
      if (time >= retryAt) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [retryAt])
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000))
  const allowed =
    confirmed &&
    /^[0-9]{6}$/.test(code) &&
    (keepLocal || unique === 0 || discard) &&
    (!keepLocal || (missingAttachments !== null && (missingAttachments === 0 || allowMissing)))
  async function send() {
    if (busy || wait) return
    setBusy('sending')
    setError('')
    try {
      const result = await onRequestCode()
      setRetryAt(Date.parse(result.retryAt))
      setNow(Date.now())
      setSent(true)
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(null)
    }
  }
  async function remove() {
    if (busy || !allowed) return
    setBusy('deleting')
    setError('')
    try {
      await onDelete({
        code,
        keepLocal,
        discardUniqueWork: !keepLocal && discard,
        allowMissingAttachments: keepLocal && allowMissing,
      })
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(null)
    }
  }
  return (
    <Dialog
      title="Delete this account?"
      wide
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="readable-controls">
        <p>
          Delete the cloud account for <strong>{accountEmail}</strong> and its saved projects,
          photos and voice notes. Account access stops when the request is accepted; deletion
          continues in the background.
        </p>
        <p>
          Other devices cannot keep syncing this account. Existing separate local and recovered
          collections remain on their devices. Payment records may be retained as described in{' '}
          <a href="/privacy">Privacy</a>.
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
          <div>
            <dt>Account attachments not on this device</dt>
            <dd>{missingAttachments ?? 'Could not check'}</dd>
          </div>
        </dl>
        <fieldset className="choice-list" disabled={!!busy}>
          <legend>What should remain on this device?</legend>
          <label>
            <input
              type="radio"
              name="deletion-copy"
              checked={keepLocal}
              onChange={() => {
                setKeepLocal(true)
                setDiscard(false)
              }}
            />
            <span>
              <strong>Keep a separate local copy</strong>
              <span>
                Saved records, cached attachments and drafts are retained before account access
                stops. This copy will not upload automatically.
              </span>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="deletion-copy"
              checked={!keepLocal}
              onChange={() => {
                setKeepLocal(false)
                setAllowMissing(false)
              }}
            />
            <span>
              <strong>Remove this account’s device copy</strong>
              <span>
                Unsent work in this copy will also be removed after the deletion request is
                accepted.
              </span>
            </span>
          </label>
        </fieldset>
        {!keepLocal && unique > 0 && (
          <label className="confirm-choice">
            <input
              type="checkbox"
              checked={discard}
              disabled={!!busy}
              onChange={(event) => setDiscard(event.target.checked)}
            />
            <span>
              Discard the unsent changes, checkpoints, attachments and drafts listed above that
              exist only on this device.
            </span>
          </label>
        )}
        {keepLocal && missingAttachments === null && (
          <p className="error" role="alert">
            Attachment availability could not be checked. Close this review and try again before
            keeping a local copy.
          </p>
        )}
        {keepLocal && missingAttachments !== null && missingAttachments > 0 && (
          <label className="confirm-choice">
            <input
              type="checkbox"
              checked={allowMissing}
              disabled={!!busy}
              onChange={(event) => setAllowMissing(event.target.checked)}
            />
            <span>
              I understand that {missingAttachments} missing{' '}
              {missingAttachments === 1 ? 'attachment will' : 'attachments will'} not be in the
              retained copy and cannot be downloaded after account access stops.
            </span>
          </label>
        )}
        <button className="text-button" disabled={!!busy} onClick={onBackup}>
          Create complete backup first
        </button>
        <section className="account-section">
          <h3>Confirm it’s you</h3>
          <p>Request a fresh code for this deletion. A previous sign-in code cannot be reused.</p>
          <button
            className="button secondary"
            disabled={!!busy || !!wait}
            onClick={() => void send()}
          >
            {busy === 'sending'
              ? 'Sending code…'
              : wait
                ? `Resend in ${wait}s`
                : sent
                  ? 'Resend deletion code'
                  : 'Send deletion code'}
          </button>
          {sent && (
            <label className="account-form">
              Deletion code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                value={code}
                disabled={!!busy}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
          )}
        </section>
        <label className="confirm-choice">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!!busy}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            Delete this cloud account and its project data. I have reviewed the device-copy choice
            above.
          </span>
        </label>
        <ErrorMessage message={error} />
        {error && onRefreshReview && (
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={async () => {
              setBusy('reviewing')
              try {
                await onRefreshReview()
                setConfirmed(false)
                setDiscard(false)
                setAllowMissing(false)
                setError('')
              } catch (failure) {
                setError(errorText(failure))
              } finally {
                setBusy(null)
              }
            }}
          >
            Review device copies again
          </button>
        )}
        <div className="dialog-actions">
          <button className="button secondary" disabled={!!busy} onClick={onClose}>
            Keep my account
          </button>
          <button
            className="button danger"
            disabled={!!busy || !allowed}
            onClick={() => void remove()}
          >
            {busy === 'deleting' ? 'Requesting deletion…' : 'Delete account'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
