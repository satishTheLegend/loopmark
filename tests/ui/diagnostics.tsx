import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import '../../src/styles.css'
import { DiagnosticsView } from '../../src/components/DiagnosticsView'
import { ErrorMessage, errorText } from '../../src/components/ui'
import { createDiagnosticReport } from '../../src/services/diagnostics'

function Fixture() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  return (
    <main>
      <h1>Diagnostic boundary fixture</h1>
      <button
        onClick={() =>
          setError(
            errorText(
              new Error(
                'private@example.invalid Bearer secret https://private.invalid/?token=secret',
              ),
            ),
          )
        }
      >
        Inject unexpected error
      </button>
      <ErrorMessage message={error} />
      <button onClick={() => setOpen(true)}>Preview native sharing</button>
      {open && (
        <DiagnosticsView
          report={createDiagnosticReport(
            { kind: 'local', label: '', items: [], actionable: false, lastSyncedAt: null },
            'ios',
          )}
          share={{
            shareFile: async () => ({ status: 'cancelled', mayHaveCommitted: false }),
            chooseFile: async () => ({ status: 'cancelled', mayHaveCommitted: false }),
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
