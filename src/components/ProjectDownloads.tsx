import { useEffect, useRef, useState } from 'react'
import type { DownloadsService, ProjectOfflineAvailability } from '../services/downloads-service'
import { Dialog, ErrorMessage, errorText } from './ui'

export function ProjectDownloads({
  service,
  projectId,
  revision,
  connected,
  online,
  onChange,
}: {
  service: DownloadsService
  projectId: string
  revision: string
  connected: boolean
  online: boolean
  onChange: () => Promise<void>
}) {
  const [availability, setAvailability] = useState<ProjectOfflineAvailability | null>(null)
  const [busy, setBusy] = useState<'download' | 'remove' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [checkRevision, setCheckRevision] = useState(0)
  const lifecycle = useRef(0)
  const inspection = useRef(0)
  const action = useRef<AbortController | null>(null)
  useEffect(() => {
    lifecycle.current++
    setAvailability(null)
    setError('')
    setNotice('')
    setConfirm(false)
    setBusy(null)
    return () => {
      lifecycle.current++
      inspection.current++
      action.current?.abort()
      action.current = null
    }
  }, [service, projectId])

  // A data refresh can be caused by our own successful action. It must not change
  // the action's identity or cancel its completion notice.
  useEffect(() => {
    const token = lifecycle.current,
      request = ++inspection.current
    if (action.current) return
    void service
      .inspect(projectId)
      .then((value) => {
        if (lifecycle.current === token && inspection.current === request && !action.current) {
          setAvailability(value)
          setError('')
        }
      })
      .catch((failure) => {
        if (lifecycle.current === token && inspection.current === request && !action.current)
          setError(errorText(failure))
      })
    return () => {
      inspection.current++
    }
  }, [service, projectId, revision, checkRevision])

  async function run(kind: 'download' | 'remove') {
    if (action.current) return
    const token = lifecycle.current,
      controller = new AbortController()
    action.current = controller
    inspection.current++
    setBusy(kind)
    setError('')
    setNotice('')
    setAvailability(null)
    const current = () => lifecycle.current === token && !controller.signal.aborted
    try {
      let removal: Awaited<ReturnType<DownloadsService['remove']>> | undefined
      if (kind === 'download') await service.download(projectId, controller.signal)
      else removal = await service.remove(projectId)
      if (!current()) return
      await onChange()
      if (!current()) return
      const value = await service.inspect(projectId)
      if (!current()) return
      setAvailability(value)
      setConfirm(false)
      if (removal)
        setNotice(
          `${removal.removed} ${removal.removed === 1 ? 'download removed' : 'downloads removed'} from this device. ` +
            (removal.retained
              ? `${removal.retained} ${removal.retained === 1 ? 'attachment was' : 'attachments were'} kept for local work or a backup in progress.`
              : 'Your account files are unchanged.'),
        )
    } catch (failure) {
      if (lifecycle.current !== token) return
      setConfirm(false)
      if (controller.signal.aborted)
        setNotice('Download cancelled. Files already saved on this device are kept.')
      else setError(errorText(failure))
      // A failed or cancelled batch can still have cached verified files successfully.
      try {
        if (kind === 'download') await onChange()
        const value = await service.inspect(projectId)
        if (lifecycle.current === token) setAvailability(value)
      } catch {
        /* Keep the original action error; availability remains unknown. */
      }
    } finally {
      if (lifecycle.current === token) {
        action.current = null
        setBusy(null)
      }
    }
  }
  return (
    <section
      className="project-details-card project-downloads readable-controls"
      aria-label="Project files"
    >
      <h2>Project files</h2>
      <p role="status">
        {busy === 'download'
          ? 'Downloading project files…'
          : busy === 'remove'
            ? 'Removing eligible downloads…'
            : availability?.state === 'available'
              ? 'Available offline on this device'
              : availability
                ? `${availability.missing} ${availability.missing === 1 ? 'attachment needs' : 'attachments need'} downloading on this device.`
                : error
                  ? 'Offline availability could not be checked.'
                  : 'Checking files on this device…'}
      </p>
      {availability?.total === 0 && (
        <p className="hint">Your project and checkpoint text are saved on this device.</p>
      )}
      {!!availability?.missing && (
        <p className="hint">
          Your saved project text is available here.{' '}
          {online
            ? 'Download its photos and voice notes before going offline.'
            : 'Connect to download its photos and voice notes.'}
        </p>
      )}
      <ErrorMessage message={error} />
      {error && !availability && !busy && (
        <button className="text-button" onClick={() => setCheckRevision((value) => value + 1)}>
          Check files again
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      {connected ? (
        <div className="account-actions">
          <button
            className="button secondary"
            disabled={!online || !!busy || !availability || availability.missing === 0}
            onClick={() => void run('download')}
          >
            Download project files
          </button>
          <button
            className="text-button"
            disabled={!!busy || !availability?.available}
            onClick={() => setConfirm(true)}
          >
            Remove downloads
          </button>
          {busy === 'download' && (
            <button className="text-button" onClick={() => action.current?.abort()}>
              Cancel download
            </button>
          )}
        </div>
      ) : (
        <p className="hint">
          This local collection keeps its attachments on your device. Export a complete backup to
          keep another copy.
        </p>
      )}
      {confirm && (
        <Dialog
          title="Remove downloads from this device?"
          onClose={() => {
            if (!busy) setConfirm(false)
          }}
        >
          <p>
            Your account projects and cloud attachments will stay unchanged. You can download these
            files again when connected.
          </p>
          <p>
            Files needed by unsent changes, drafts, or a backup in progress will stay on this
            device.
          </p>
          <div className="account-actions">
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => setConfirm(false)}
            >
              Keep downloads
            </button>
            <button className="button primary" disabled={!!busy} onClick={() => void run('remove')}>
              {busy === 'remove' ? 'Removing…' : 'Remove downloaded files'}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
