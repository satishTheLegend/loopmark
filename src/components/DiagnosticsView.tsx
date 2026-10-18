import { useRef, useState } from 'react'
import type { DiagnosticReport } from '../services/diagnostics'
import type { SharePort } from '../platform/contracts'
import { DomainError } from '../domain/errors'
import { Dialog, ErrorMessage, errorText } from './ui'

export function DiagnosticsView({
  report,
  share,
  onClose,
}: {
  report: DiagnosticReport
  share?: SharePort
  onClose: () => void
}) {
  // The same frozen preview bytes are exported even if background sync changes.
  const text = useRef(JSON.stringify(report, null, 2)).current
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function download() {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const bytes = new Blob([text], { type: 'application/json' })
      const name = 'loopmark-diagnostics.json'
      if (share) {
        const result = await share.shareFile({ name, mimeType: 'application/json', bytes })
        if ('error' in result) throw new DomainError(result.error.code)
        setMessage(
          result.status === 'cancelled'
            ? 'Sharing cancelled.'
            : 'The report was handed to the share sheet. Check where you saved or shared it.',
        )
      } else {
        const url = URL.createObjectURL(bytes)
        const link = document.createElement('a')
        link.href = url
        link.download = name
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setMessage('Diagnostic download started. Nothing was sent to support.')
      }
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title="Diagnostic preview" onClose={onClose} wide>
      <div className="readable-controls diagnostic-preview">
        <p>
          Review the complete report below before exporting. It contains the app version, platform,
          queue counts and error codes with diagnostic IDs. Project notes, photos, voice notes,
          account details and credentials are excluded.
        </p>
        <p>This snapshot covers the selected collection. Nothing is sent automatically.</p>
        <label htmlFor="diagnostic-json">Diagnostic JSON</label>
        <textarea id="diagnostic-json" readOnly value={text} rows={14} spellCheck={false} />
        <ErrorMessage message={error} />
        {message && <p role="status">{message}</p>}
        <button className="button primary" disabled={busy} onClick={() => void download()}>
          {busy
            ? 'Preparing report…'
            : share
              ? 'Share diagnostic file'
              : 'Download diagnostic file'}
        </button>
      </div>
    </Dialog>
  )
}
