import { useEffect, useRef, useState } from 'react'
import {
  IconDownload,
  IconUpload,
  IconShieldCheck,
  IconDeviceDesktop,
  IconCheck,
  IconFileDescription,
} from '@tabler/icons-react'
import {
  exportBackup,
  getLibraryState,
  LibraryChangedError,
  parseBackup,
  restoreBackup,
  validateBackupMedia,
} from '../data'
import type { LibraryState } from '../data'
import type { Backup } from '../types'
import { Dialog, ErrorMessage, errorText, fullDate } from './ui'
import type { SharePort } from '../platform/contracts'
import type { ExportProgress } from '../services/backup-service'
export function BackupView({
  onMessage,
  connected = false,
  accountEmail,
  collectionName,
  restoreRecovered,
  share,
  native = false,
  exportComplete,
}: {
  onMessage: (s: string) => void
  connected?: boolean
  accountEmail?: string
  collectionName?: string
  restoreRecovered?: (backup: Backup, operationToken: string) => Promise<void>
  share?: SharePort
  native?: boolean
  exportComplete?: (
    signal: AbortSignal,
    onProgress: (progress: ExportProgress) => void,
  ) => Promise<Backup>
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState<Backup | null>(null),
    [currentCollection, setCurrentCollection] = useState<LibraryState | null>(null),
    [changed, setChanged] = useState(false),
    [protectedStorage, setProtected] = useState(false),
    [storageStatus, setStorageStatus] = useState<'checking' | 'ready' | 'unsupported' | 'error'>(
      'checking',
    ),
    [storageFeedback, setStorageFeedback] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const restoreToken = useRef(crypto.randomUUID())
  const exportAbort = useRef<AbortController | null>(null)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [exportMessage, setExportMessage] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      exportAbort.current?.abort()
    }
  }, [])
  useEffect(() => {
    let active = true
    if (!navigator.storage?.persisted || !navigator.storage?.persist) {
      setStorageStatus('unsupported')
      return
    }
    void navigator.storage
      .persisted()
      .then((value) => {
        if (active) {
          setProtected(value)
          setStorageStatus('ready')
        }
      })
      .catch(() => {
        if (active) {
          setStorageStatus('error')
          setStorageFeedback(
            'Storage protection could not be checked. You can try requesting it below. Keep a downloaded backup.',
          )
        }
      })
    return () => {
      active = false
    }
  }, [])
  async function download() {
    if (busy) return
    const abort = new AbortController()
    exportAbort.current = abort
    setExportProgress({ stage: 'checking', done: 0, total: 0 })
    setExportMessage('')
    setBusy(true)
    setError('')
    try {
      const backup = exportComplete
        ? await exportComplete(abort.signal, (value) => {
            if (mounted.current) setExportProgress(value)
          })
        : await exportBackup()
      abort.signal.throwIfAborted()
      if (!mounted.current) return
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
      abort.signal.throwIfAborted()
      setExportProgress(null)
      if (share) {
        const result = await share.shareFile({
          name: `loopmark-backup-${new Date().toISOString().slice(0, 10)}.json`,
          mimeType: 'application/json',
          bytes: blob,
        })
        if ('error' in result) throw new Error(`${result.error.problem} ${result.error.nextAction}`)
        if (result.status === 'ok')
          onMessage(
            'The backup was handed to the share sheet. Check that it was saved where you chose.',
          )
        return
      }
      const url = URL.createObjectURL(blob),
        link = document.createElement('a')
      link.href = url
      link.download = `loopmark-backup-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      onMessage('Backup download started. Keep it somewhere safe.')
    } catch (e) {
      if (mounted.current) {
        if (abort.signal.aborted)
          setExportMessage('Export cancelled. Your projects and saved checkpoints are unchanged.')
        else setError(errorText(e))
      }
    } finally {
      exportAbort.current = null
      if (mounted.current) {
        setBusy(false)
        setExportProgress(null)
      }
    }
  }
  async function importFile(file?: Blob) {
    if (!file) return
    setError('')
    setBusy(true)
    try {
      // Capture before reading/decoding so even writes during validation invalidate this preview.
      const current = await getLibraryState()
      if (file.size > 50 * 1024 * 1024)
        throw new Error('Choose a Loopmark backup smaller than 50 MB.')
      const backup = parseBackup(await file.text())
      await validateBackupMedia(backup)
      setCurrentCollection(current)
      setChanged(false)
      restoreToken.current = crypto.randomUUID()
      setPending(backup)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  async function restore() {
    if (!pending || !currentCollection) return
    setBusy(true)
    setError('')
    try {
      if (changed) {
        setCurrentCollection(await getLibraryState())
        setChanged(false)
        return
      }
      if (restoreRecovered) await restoreRecovered(pending, restoreToken.current)
      else await restoreBackup(pending, currentCollection.revision)
      setPending(null)
      onMessage('Your projects and their checkpoints have been restored.')
    } catch (e) {
      if (e instanceof LibraryChangedError) setChanged(true)
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">A LITTLE PEACE OF MIND</div>
          <h1>Keep your making safe.</h1>
          <p>A complete backup gives your saved notes and attachments another place to live.</p>
        </div>
      </header>
      <div className="backup-intro">
        <span className="round-icon">
          <IconShieldCheck size={28} />
        </span>
        <div>
          <h2>Yours, and only yours.</h2>
          <p>
            {connected ? (
              <>
                This collection syncs privately to <strong>{accountEmail || 'your account'}</strong>
                . A synced copy is not a backup. A complete export must include every referenced
                photo and voice note; missing files must finish downloading first.
              </>
            ) : (
              <>
                This collection stays on this device. It is not uploaded to an account. Clearing app
                or browser data can remove it. Download a backup regularly.
              </>
            )}
            {collectionName && (
              <>
                {' '}
                Selected collection: <strong>{collectionName}</strong>.
              </>
            )}
          </p>
        </div>
      </div>
      <div className="backup-grid">
        <section className="settings-card">
          <IconDownload size={28} />
          <h2>Pack up a backup</h2>
          <p>
            One file with all your saved projects, checkpoints, photos, and voice notes. Ready for a
            fresh start on another device. Unfinished drafts are not included; save them before
            downloading a backup.
          </p>
          <button className="button primary" onClick={download} disabled={busy}>
            <IconDownload size={18} />
            {busy ? 'Working…' : 'Download full backup'}
          </button>
          {exportProgress && (
            <>
              <p role="status">
                {exportProgress.stage === 'checking'
                  ? 'Checking attachments'
                  : exportProgress.stage === 'downloading'
                    ? 'Downloading missing attachments'
                    : 'Preparing complete backup'}
                {exportProgress.total
                  ? ` · ${exportProgress.done} of ${exportProgress.total}`
                  : '…'}
              </p>
              <button
                className="button secondary"
                onClick={() => {
                  exportAbort.current?.abort()
                  setExportMessage('Stopping export…')
                }}
              >
                Cancel export
              </button>
            </>
          )}
          {exportMessage && <p role="status">{exportMessage}</p>}
          <small>
            Your downloaded file contains your personal notes and media. Store it privately.
          </small>
        </section>
        <section className="settings-card">
          <IconUpload size={28} />
          <h2>Unpack your projects</h2>
          <p>
            {restoreRecovered
              ? 'Choose a Loopmark backup. We’ll check it, then restore it as a separate collection on this device. Your current collection stays intact.'
              : 'Choose a Loopmark backup. We’ll check it before you decide to replace the projects currently on this device.'}
          </p>
          <button
            className="button secondary"
            onClick={() => {
              if (!share) {
                input.current?.click()
                return
              }
              void share
                .chooseFile()
                .then((result) => {
                  if (result.status === 'ok') void importFile(result.value)
                  else if ('error' in result)
                    setError(`${result.error.problem} ${result.error.nextAction}`)
                })
                .catch((error) => setError(errorText(error)))
            }}
            disabled={busy}
          >
            <IconUpload size={18} />
            Choose backup file
          </button>
          <input
            ref={input}
            className="sr-only"
            tabIndex={-1}
            aria-label="Restore backup file"
            type="file"
            accept="application/json,.json"
            onChange={(e) => importFile(e.target.files?.[0])}
          />
          <small>Loopmark JSON files · up to 50 MB</small>
        </section>
      </div>
      <ErrorMessage message={pending ? '' : error} />
      {!native && (
        <section className="storage-note">
          <IconDeviceDesktop size={23} />
          <div>
            <h3>A little extra protection</h3>
            <p>
              You can ask your browser to keep this site’s storage. It helps reduce automatic
              cleanup, but a downloaded backup is still essential.
            </p>
            <p role="status">
              {storageStatus === 'checking'
                ? 'Checking storage protection…'
                : storageStatus === 'unsupported'
                  ? 'This browser does not support storage protection. Keep a downloaded backup.'
                  : storageFeedback ||
                    (protectedStorage
                      ? 'Storage protection is enabled on this device.'
                      : 'Storage protection is not enabled on this device.')}
            </p>
            <button
              className="text-button"
              disabled={
                protectedStorage || storageStatus === 'checking' || storageStatus === 'unsupported'
              }
              onClick={async () => {
                setStorageStatus('checking')
                setStorageFeedback('')
                try {
                  if (!navigator.storage?.persist) {
                    setStorageStatus('unsupported')
                    return
                  }
                  const granted = await navigator.storage.persist()
                  setProtected(granted)
                  setStorageStatus('ready')
                  setStorageFeedback(
                    granted
                      ? 'Storage protection is enabled. Keep making regular backups.'
                      : 'Your browser did not grant storage protection. Download a backup to keep your projects safe.',
                  )
                } catch {
                  setStorageStatus('error')
                  setStorageFeedback(
                    'Storage protection could not be requested. Try again or download a backup to keep your projects safe.',
                  )
                }
              }}
            >
              {protectedStorage ? (
                <>
                  <IconCheck size={16} />
                  Storage protection enabled
                </>
              ) : (
                'Ask to keep this device’s data'
              )}
            </button>
          </div>
        </section>
      )}
      {pending && (
        <Dialog
          title="Restore this little collection?"
          onClose={() => {
            if (!busy) {
              setPending(null)
              setError('')
            }
          }}
        >
          <div className="restore-preview">
            <IconFileDescription size={30} />
            <div>
              <strong>
                {pending.projects.length} projects ·{' '}
                {pending.projects.reduce((sum, p) => sum + p.checkpoints.length, 0)} checkpoints
              </strong>
              <p>Backup saved {fullDate(pending.exportedAt)}</p>
            </div>
          </div>
          {restoreRecovered ? (
            <p>
              This creates a <strong>separate recovered collection on this device</strong>. Your
              current collection and account stay intact. Restoring a file does not upload it or
              grant paid access.
            </p>
          ) : (
            <p>
              This will <strong>replace every project in the selected collection</strong>, including
              its photos and voice notes. Download a backup of your current collection first if you
              want to keep it.
            </p>
          )}
          {currentCollection && (
            <p>
              Current collection: {currentCollection.projects} projects ·{' '}
              {currentCollection.checkpoints} checkpoints.
            </p>
          )}
          <ErrorMessage message={error} />
          <div className="dialog-actions">
            <button className="button subtle" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </button>
            <button className="button primary" disabled={busy} onClick={restore}>
              {busy
                ? 'Working…'
                : changed
                  ? 'Review latest collection'
                  : restoreRecovered
                    ? 'Restore as separate collection'
                    : 'Replace and restore'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}
