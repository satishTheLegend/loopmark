import { useState } from 'react'
import { Dialog, ErrorMessage, errorText } from './ui'

export function SyncRecoveryReview({
  counts,
  blockedByReplacement,
  stale,
  onRefresh,
  onRecover,
  onBackup,
  onReviewReplacement,
  onClose,
}: {
  counts: {
    projects: number
    checkpoints: number
    drafts: number
    unsent: number
    missingAttachments: number | null
  }
  blockedByReplacement: boolean
  stale: boolean
  onRefresh: () => Promise<void>
  onRecover: (options: { allowMissingAttachments: boolean }) => Promise<void>
  onBackup: () => void
  onReviewReplacement: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [allowMissingAttachments, setAllowMissingAttachments] = useState(false)
  async function act(action: () => Promise<void>) {
    if (busy) return
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
    <Dialog
      title="Refresh this account safely"
      onClose={() => {
        if (!busy) onClose()
      }}
      wide
    >
      <div className="readable-controls">
        <p>This device needs a fresh account view before it can sync again.</p>
        <p>
          Keep the projects, saved checkpoints, drafts and available files from this device in a
          separate recovered collection. Then open the current account projects. Unsent changes stay
          in that device copy until you choose what to reconnect.
        </p>
        <dl className="version-fields">
          <div>
            <dt>Projects on this device</dt>
            <dd>{counts.projects}</dd>
          </div>
          <div>
            <dt>Saved checkpoints</dt>
            <dd>{counts.checkpoints}</dd>
          </div>
          <div>
            <dt>Drafts to keep</dt>
            <dd>{counts.drafts}</dd>
          </div>
          <div>
            <dt>Unsent changes to keep</dt>
            <dd>{counts.unsent}</dd>
          </div>
        </dl>
        <p>The account’s current projects will not be overwritten by this action.</p>
        {blockedByReplacement ? (
          <p role="status">
            A connection or replacement is still unfinished. Review and finish or cancel it before
            refreshing this account.
          </p>
        ) : counts.missingAttachments === null ? (
          <p role="alert">
            The available files could not be checked. Refresh this review before continuing. Your
            device work remains here.
          </p>
        ) : counts.missingAttachments > 0 ? (
          <div>
            <p>
              {counts.missingAttachments} saved{' '}
              {counts.missingAttachments === 1 ? 'attachment is' : 'attachments are'} missing from
              this device. The recovered copy will keep their references and the files that are
              available. Earlier files may no longer be available in the account.
            </p>
            <label className="confirm-choice">
              <input
                type="checkbox"
                checked={allowMissingAttachments}
                disabled={busy}
                onChange={(event) => setAllowMissingAttachments(event.target.checked)}
              />
              <span>
                Keep the available files and refresh even though some saved attachments are missing
              </span>
            </label>
          </div>
        ) : null}
        {stale && (
          <p className="error" role="alert">
            Your device work changed. Refresh this review before continuing.
          </p>
        )}
        <ErrorMessage message={error} />
        <div className="dialog-actions">
          <button className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button secondary" disabled={busy} onClick={onBackup}>
            Make a complete backup first
          </button>
          {blockedByReplacement ? (
            <button className="button primary" disabled={busy} onClick={onReviewReplacement}>
              Review unfinished connection
            </button>
          ) : stale || counts.missingAttachments === null ? (
            <button className="button primary" disabled={busy} onClick={() => void act(onRefresh)}>
              Refresh recovery review
            </button>
          ) : (
            <button
              className="button primary"
              disabled={busy || (!!counts.missingAttachments && !allowMissingAttachments)}
              onClick={() => void act(() => onRecover({ allowMissingAttachments }))}
            >
              {busy ? 'Keeping your work and refreshing…' : 'Keep device copy and refresh account'}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
