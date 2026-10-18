import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles.css'
import { BackupView } from '../../src/components/BackupView'
import backup from '../fixtures/expansion/portable-v1.json'
const operationToken = '6ca923e0-61b7-4dda-8c56-37ee045fe368'
function Fixture() {
  const [incoming, setIncoming] = useState<{
    reviewId: string
    file: Blob
    operationToken: string
  }>()
  const [result, setResult] = useState('No restore')
  const review = () =>
    setIncoming({
      reviewId: crypto.randomUUID(),
      operationToken,
      file: new Blob(
        [new URLSearchParams(location.search).has('invalid') ? 'invalid' : JSON.stringify(backup)],
        { type: 'application/json' },
      ),
    })
  return (
    <main>
      <button onClick={review}>Review received backup</button>
      <output aria-label="Restore result">{result}</output>
      <BackupView
        incomingFile={incoming}
        onIncomingCancel={() => setIncoming(undefined)}
        onMessage={() => {}}
        restoreRecovered={async (value, token) => {
          setResult(JSON.stringify({ projects: value.projects.length, token }))
          setIncoming(undefined)
        }}
      />
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
