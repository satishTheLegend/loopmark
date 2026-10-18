// Test-only entry point. No network/provider actions; never a production build entry.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/lora/latin-400.css'
import '../../src/styles.css'
import { AccountDeletion } from '../../src/components/AccountDeletion'
import { DeletionReceiptView } from '../../src/components/DeletionReceiptView'
import { AccountView } from '../../src/components/AccountView'
import { ConnectionPreview } from '../../src/components/ConnectionPreview'
import { ConflictReview } from '../../src/components/ConflictReview'
import { SignOutReview } from '../../src/components/SignOutReview'
import { info, project, now } from '../../src/repositories/browser/fixtures.test-support'
import type { CollectionView, PendingIntent } from '../../src/domain/contracts'
import type { AttachPreview } from '../../src/services/controller-contract'

const email = 'maker.with.a.long.address@example.test'
const cloud = project('project', '4')
const device = {
  ...cloud,
  name: 'A cardigan for a quiet autumn weekend',
  toolSize: '5 mm hook',
  notes: 'Continue with the extra repeat along the shoulder.',
}
const intent: PendingIntent['intent'] = {
  operationId: 'edit-project',
  kind: 'project.update',
  createdAt: now,
  base: { revision: '3' },
  payload: {
    projectId: 'project',
    updatedAt: now,
    fields: {
      name: device.name,
      craft: device.craft,
      color: device.color,
      yarn: device.yarn,
      toolSize: device.toolSize,
      notes: device.notes,
    },
  },
}
const pending: PendingIntent = {
  intent,
  state: 'conflict',
  command: {
    ...intent,
    protocolVersion: 2,
    payloadVersion: 1,
    collectionId: 'collection',
    epoch: 'epoch',
    deviceId: 'device',
    deviceGeneration: 'generation',
    sequence: '1',
    sha256: 'a'.repeat(64),
  },
}
const view: CollectionView = {
  info: info(true),
  revision: '5',
  cursor: '4',
  projects: [device],
  checkpoints: [],
  pending: [pending],
  hydration: 'ready',
}
const acknowledged: CollectionView = { ...view, projects: [cloud], pending: [] }
const preview: AttachPreview = {
  id: 'preview',
  source: { key: info().key, name: 'My unfinished winter projects', revision: '2' },
  destination: { key: info(true).key, name: 'Personal projects', revision: '4', email },
  additions: 2,
  matches: 1,
  copies: 1,
  mappings: [
    { sourceId: 'a', sourceCode: 'LM-OLD', destinationId: 'b', destinationCode: 'LM-NEW' },
  ],
  resulting: { projects: 6, activeProjects: 5, checkpoints: 28, portableBytes: 14 * 1024 * 1024 },
  expiresAt: '2099-01-01T12:00:00.000Z',
}
function Harness() {
  const scenario = new URLSearchParams(location.search).get('scenario') || 'account'
  const [open, setOpen] = useState(true)
  const [stale, setStale] = useState(scenario === 'conflict-stale')
  const [result, setResult] = useState('')
  const done = async (value: unknown) => {
    setResult(JSON.stringify(value))
    setOpen(false)
  }
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px' }}>
      <h1 className="sr-only">Component verification fixture</h1>
      <output aria-label="Action result">{result}</output>
      {open && scenario === 'deletion' && (
        <AccountDeletion
          accountEmail={email}
          counts={{
            drafts: 2,
            unsentProjectChanges: 1,
            unsentCheckpoints: 3,
            pendingAttachments: 1,
            failedAttachments: 0,
            recoveredCollections: 1,
            missingAttachments: 2,
          }}
          missingAttachments={
            new URLSearchParams(location.search).get('missing') === 'unknown' ? null : 2
          }
          onRequestCode={async () => ({ retryAt: new Date(Date.now() + 60_000).toISOString() })}
          onDelete={done}
          onBackup={() => void done('backup')}
          onClose={() => setOpen(false)}
        />
      )}
      {scenario === 'receipt' && (
        <DeletionReceiptView
          receipt={
            new URLSearchParams(location.search).get('receipt') === 'unknown'
              ? null
              : { status: 'pending', requestedAt: now }
          }
          requestedAt={now}
          localOutcome="not-completed"
          onRefresh={async () => {
            setResult('status-refreshed')
          }}
          onDownload={async () => {
            setResult('receipt-export-requested')
          }}
        />
      )}
      {open && scenario === 'account' && (
        <AccountView
          cloudAvailable
          signedIn={false}
          onSignOut={() => {}}
          onRequestCode={async () => ({ retryAt: new Date(Date.now() + 60000).toISOString() })}
          onVerifyCode={async () => {
            await done('verified-code-ui-only')
          }}
        />
      )}
      {open && scenario === 'connection' && (
        <ConnectionPreview
          preview={preview}
          stale={false}
          mode={
            new URLSearchParams(location.search).get('mode') === 'replace' ? 'replace' : 'attach'
          }
          phase={
            new URLSearchParams(location.search).get('phase') === 'queued' ? 'queued' : 'preview'
          }
          onRefresh={async () => {}}
          onConfirm={done}
          onCancel={() => done('request-cancelled')}
          onClose={() => setOpen(false)}
        />
      )}
      {open && scenario === 'signout' && (
        <SignOutReview
          accountEmail={email}
          counts={{
            unsentProjectChanges: 1,
            drafts: 2,
            unsentCheckpoints: 3,
            pendingAttachments: 1,
            failedAttachments: 2,
            missingAttachments: 0,
            recoveredCollections: 1,
          }}
          onConfirm={done}
          onBackup={() => void done('backup')}
          onClose={() => setOpen(false)}
        />
      )}
      {open && scenario.startsWith('conflict') && (
        <ConflictReview
          operationId="edit-project"
          view={view}
          acknowledged={acknowledged}
          stale={stale}
          onRefresh={async () => setStale(false)}
          onResolve={async (_id, _revision, choice) => {
            await done(choice)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Harness />)
