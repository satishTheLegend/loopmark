import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import '../../src/styles.css'
import { SyncRecoveryReview } from '../../src/components/SyncRecoveryReview'

function Fixture() {
  const mode = new URL(location.href).searchParams.get('mode')
  const [open, setOpen] = useState(false)
  const [stale, setStale] = useState(mode === 'stale')
  const [unknown, setUnknown] = useState(mode === 'unknown')
  const [result, setResult] = useState('No action')
  return (
    <main>
      <h1>Account refresh review</h1>
      <button
        onClick={(event) => {
          event.currentTarget.focus()
          setOpen(true)
        }}
      >
        Review account refresh
      </button>
      <output aria-label="Action result">{result}</output>
      {open && (
        <SyncRecoveryReview
          counts={{
            projects: 2,
            checkpoints: 8,
            drafts: 1,
            unsent: 3,
            missingAttachments: unknown ? null : mode === 'missing' ? 2 : 0,
          }}
          blockedByReplacement={mode === 'blocked'}
          stale={stale}
          onRefresh={async () => {
            setStale(false)
            setUnknown(false)
            setResult('Review refreshed')
          }}
          onRecover={async (options) => {
            setResult(JSON.stringify(options))
            setOpen(false)
          }}
          onBackup={() => {
            setResult('Backup requested')
            setOpen(false)
          }}
          onReviewReplacement={() => {
            setResult('Existing request review')
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
