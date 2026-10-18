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
export function BackupView({ onMessage }: { onMessage: (s: string) => void }) {
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
    setBusy(true)
    setError('')
    try {
      const backup = await exportBackup()
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
        url = URL.createObjectURL(blob),
        link = document.createElement('a')
      link.href = url
      link.download = `loopmark-backup-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      onMessage('Backup download started. Keep it somewhere safe.')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function importFile(file?: File) {
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
      await restoreBackup(pending, currentCollection.revision)
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
          <p>Your notes stay on this device. A backup gives them another place to live.</p>
        </div>
      </header>
      <div className="backup-intro">
        <span className="round-icon">
          <IconShieldCheck size={28} />
        </span>
        <div>
          <h2>Yours, and only yours.</h2>
          <p>
            No account. No cloud uploads. Loopmark saves your projects in this browser. Clearing
            browser data, changing devices, or private browsing can remove them. Download a backup
            regularly.
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
          <small>
            Your downloaded file contains your personal notes and media. Store it privately.
          </small>
        </section>
        <section className="settings-card">
          <IconUpload size={28} />
          <h2>Unpack your projects</h2>
          <p>
            Choose a Loopmark backup. We’ll check it before you decide to replace the projects
            currently on this device.
          </p>
          <button
            className="button secondary"
            onClick={() => input.current?.click()}
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
      <section className="storage-note">
        <IconDeviceDesktop size={23} />
        <div>
          <h3>A little extra protection</h3>
          <p>
            You can ask your browser to keep this site’s storage. It helps reduce automatic cleanup,
            but a downloaded backup is still essential.
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
          <p>
            This will <strong>replace every project currently in this browser</strong>, including
            its photos and voice notes. Download a backup of your current collection first if you
            want to keep it.
          </p>
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
              {busy ? 'Working…' : changed ? 'Review latest collection' : 'Replace and restore'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}
