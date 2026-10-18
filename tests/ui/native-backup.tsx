import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NativeBackupNotice } from '../../src/components/NativeBackupNotice'
import type { IncomingBackup, NativeBackupInbox } from '../../src/platform/native/backup-inbox'
import type { SessionScope } from '../../src/domain/contracts'
import '../../src/styles.css'
const scenario = new URLSearchParams(location.search).get('scenario')
const initialScope: SessionScope = {
  key: { namespace: 'guest', collectionId: 'personal', epoch: 'initial' },
  generation: 1,
  device: { id: 'device', generation: 'gen' },
}
const ready: IncomingBackup = {
  id: 'a'.repeat(64),
  operationToken: '11111111-1111-4111-8111-111111111111',
  name: 'my-scarf-backup.json',
  bytes: 24,
  receivedAt: '2026-10-01T00:00:00.000Z',
  state: 'ready',
}
let item: IncomingBackup | null =
  scenario === 'failed'
    ? {
        ...ready,
        id: 'f'.repeat(64),
        name: 'Incoming backup',
        bytes: 0,
        state: 'failed',
        errorCode: 'VALIDATION',
      }
    : scenario === 'duplicate'
      ? { ...ready, state: 'already-handled' }
      : scenario === 'other'
        ? {
            ...ready,
            source: { ...initialScope, key: { ...initialScope.key, collectionId: 'original' } },
          }
        : scenario === 'generation'
          ? { ...ready, source: { ...initialScope, generation: 0 } }
          : structuredClone(ready)
const listeners = new Set<() => void>(),
  log: Array<{ action: string; id?: string; scope?: SessionScope; outcome?: unknown }> = []
let renderLog = () => {},
  releaseRead = () => {}
const record = (entry: (typeof log)[number]) => {
  log.push(entry)
  renderLog()
}
const notify = () => {
  for (const listener of listeners) listener()
}
const inbox: NativeBackupInbox & { subscribe: (listener: () => void) => () => void } = {
  initialize: async () => {},
  dispose: async () => {},
  subscribe(listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  async pending() {
    return structuredClone(item)
  },
  async bind(id, scope) {
    record({ action: 'bind', id, scope })
    item = { ...item!, source: structuredClone(scope) }
    return structuredClone(item)
  },
  async read(id) {
    record({ action: 'read', id })
    if (scenario === 'late')
      await new Promise<void>((resolve) => {
        releaseRead = resolve
      })
    return new Blob(['{"format":"loopmark"}'], { type: 'application/json' })
  },
  async finish(id, scope, outcome) {
    record({ action: 'finish', id, scope, outcome })
    item = item?.state === 'failed' ? structuredClone(ready) : null
    notify()
  },
}
function Fixture() {
  const [scope, setScope] = useState(initialScope),
    [shown, setShown] = useState(true),
    [reviews, setReviews] = useState(0),
    [last, setLast] = useState(''),
    [, setVersion] = useState(0)
  renderLog = () => setVersion((value) => value + 1)
  return (
    <main className="main-content">
      <h1>Incoming backup component fixture</h1>
      <p>Synthetic inbox for explicit review and callback lifetime verification.</p>
      <div className="account-actions">
        <button onClick={() => setShown(false)}>Unmount notice</button>
        <button
          onClick={() =>
            setScope({
              ...scope,
              key: { ...scope.key, collectionId: 'other' },
              generation: scope.generation + 1,
            })
          }
        >
          Switch collection
        </button>
        <button
          onClick={() => {
            releaseRead()
          }}
        >
          Release file read
        </button>
        <button
          onClick={() => {
            item = { ...ready, id: 'b'.repeat(64), name: 'newer-backup.json' }
            notify()
          }}
        >
          Receive newer file
        </button>
      </div>
      <p aria-label="Review count">{reviews}</p>
      <output aria-label="Reviewed source">{last}</output>
      <output aria-label="Inbox calls">{JSON.stringify(log)}</output>
      {shown && (
        <NativeBackupNotice
          inbox={inbox}
          scope={scope}
          collectionName="My device projects"
          onReview={(bound, file) => {
            record({ action: 'review', id: bound.id, scope: bound.source })
            setReviews((value) => value + 1)
            setLast(
              JSON.stringify({
                source: bound.source,
                operationToken: bound.operationToken,
                type: file.type,
              }),
            )
          }}
        />
      )}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
)
