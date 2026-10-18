import { useState } from 'react'
import type { AttachPreview } from '../services/controller-contract'
import { safeError } from '../domain/errors'
import { Dialog, ErrorMessage, fullDate } from './ui'

export function ConnectionPreview({
  preview,
  stale,
  onRefresh,
  onConfirm,
  onClose,
}: {
  preview: AttachPreview
  stale: boolean
  onRefresh: () => Promise<void>
  onConfirm: (preview: AttachPreview) => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const overCapacity =
    preview.resulting.projects > 200 ||
    preview.resulting.checkpoints > 1000 ||
    preview.resulting.portableBytes > 48 * 1024 * 1024
  async function act(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      const detail = safeError(failure)
      setError(`${detail.problem} ${detail.nextAction}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Connect this collection?"
      wide
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="readable-controls">
        <p>
          Copy <strong>{preview.source.name}</strong> from this device into{' '}
          <strong>{preview.destination.name}</strong>, belonging to{' '}
          <strong>{preview.destination.email}</strong>.
        </p>
        <p>The source stays on this device. Nothing is uploaded until you confirm.</p>
        <dl className="review-counts">
          <div>
            <dt>Projects to add</dt>
            <dd>{preview.additions}</dd>
          </div>
          <div>
            <dt>Exact matches already in the account</dt>
            <dd>{preview.matches}</dd>
          </div>
          <div>
            <dt>Different versions kept as separate copies</dt>
            <dd>{preview.copies}</dd>
          </div>
          <div>
            <dt>Resulting active projects</dt>
            <dd>{preview.resulting.activeProjects}</dd>
          </div>
          <div>
            <dt>Total projects after connection</dt>
            <dd>{preview.resulting.projects} / 200</dd>
          </div>
          <div>
            <dt>Total checkpoints after connection</dt>
            <dd>{preview.resulting.checkpoints} / 1,000</dd>
          </div>
          <div>
            <dt>Portable project data after connection</dt>
            <dd>{(preview.resulting.portableBytes / 1024 / 1024).toFixed(2)} / 48 MiB</dd>
          </div>
        </dl>
        {!!preview.mappings.length && (
          <details>
            <summary>Review project code changes</summary>
            <ul>
              {preview.mappings.map((mapping) => (
                <li key={mapping.sourceId}>
                  {mapping.sourceCode} → {mapping.destinationCode}
                </li>
              ))}
            </ul>
            <p>
              Existing labels still identify the original local project. Print a new label for the
              connected copy.
            </p>
          </details>
        )}
        <p className="hint">
          Free access permits three active projects. An upgrade does not increase the technical
          storage limits shown here.
        </p>
        {overCapacity && (
          <p className="error" role="alert">
            This result exceeds a technical limit. Your source collection is intact. Reduce the
            amount to connect and review a new preview.
          </p>
        )}
        {stale && (
          <p className="error" role="alert">
            New changes arrived. Refresh this preview before connecting.
          </p>
        )}
        <ErrorMessage message={error} />
        <p className="hint">
          Preview valid until{' '}
          <time dateTime={preview.expiresAt}>{fullDate(preview.expiresAt)}</time>. Both collections
          are checked again when you confirm.
        </p>
        <div className="dialog-actions">
          <button className="button secondary" disabled={busy} onClick={onClose}>
            Keep using this device
          </button>
          {(stale || !!error) && (
            <button className="button primary" disabled={busy} onClick={() => void act(onRefresh)}>
              {busy ? 'Checking collections…' : 'Refresh preview'}
            </button>
          )}
          {!stale && (
            <button
              className="button primary"
              disabled={busy || overCapacity}
              onClick={() => void act(() => onConfirm(preview))}
            >
              {busy ? 'Connecting collection…' : 'Confirm connection'}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
