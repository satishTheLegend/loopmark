import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ProjectDownloads } from '../../src/components/ProjectDownloads'
import type {
  DownloadsService,
  ProjectOfflineAvailability,
} from '../../src/services/downloads-service'
import { DomainError } from '../../src/domain/errors'
import '../../src/styles.css'
const scope = {
  key: { namespace: 'account', collectionId: 'fixture', epoch: 'epoch' },
  generation: 1,
  device: { id: 'device', generation: 'gen' },
}
const counts = new Map([
  ['one', 1],
  ['two', 0],
  ['text', 0],
])
let holdDownload = false,
  holdInspect = false,
  protectedFiles = false,
  releaseInspect = () => {}
const log: string[] = []
function result(id: string): ProjectOfflineAvailability {
  const total = id === 'text' ? 0 : 2,
    available = counts.get(id) ?? 0
  return {
    scope,
    projectId: id,
    revision: '1',
    total,
    available,
    missing: total - available,
    state: available === total ? 'available' : available ? 'partial' : 'unavailable',
  }
}
const service: DownloadsService = {
  async inspect(id) {
    const value = result(id)
    log.push(`inspect:${id}`)
    if (holdInspect) {
      holdInspect = false
      await new Promise<void>((resolve) => {
        releaseInspect = resolve
      })
    }
    return value
  },
  async download(id, signal) {
    log.push(`download:${id}`)
    if (holdDownload)
      await new Promise<void>((_resolve, reject) =>
        signal?.addEventListener(
          'abort',
          () => {
            log.push('aborted')
            reject(new DOMException('cancelled', 'AbortError'))
          },
          { once: true },
        ),
      )
    counts.set(id, 2)
    return result(id)
  },
  async remove(id) {
    log.push(`remove:${id}`)
    if (protectedFiles) throw new DomainError('DOWNLOADS_PROTECTED')
    counts.set(id, 1)
    return { ...result(id), removed: 1, retained: 1 }
  },
}
function Fixture() {
  const [id, setId] = useState('one'),
    [revision, setRevision] = useState(1),
    [online, setOnline] = useState(true),
    [connected, setConnected] = useState(true),
    [shown, setShown] = useState(true),
    [changes, setChanges] = useState(0)
  return (
    <main className="main-content">
      <h1>Project files component fixture</h1>
      <p>Synthetic service controls for UI lifetime and interaction checks.</p>
      <div className="account-actions">
        <button onClick={() => setOnline((v) => !v)}>Toggle connection</button>
        <button
          onClick={() => {
            holdDownload = true
          }}
        >
          Hold download
        </button>
        <button
          onClick={() => {
            holdInspect = true
            setRevision((v) => v + 1)
          }}
        >
          Hold inspection
        </button>
        <button
          onClick={() => {
            releaseInspect()
          }}
        >
          Release inspection
        </button>
        <button onClick={() => setId('two')}>Select other project</button>
        <button onClick={() => setId('text')}>Select text project</button>
        <button onClick={() => setShown(false)}>Unmount panel</button>
        <button
          onClick={() => {
            protectedFiles = true
          }}
        >
          Protect files
        </button>
        <button onClick={() => setConnected(false)}>Select local collection</button>
      </div>
      <p aria-label="Refresh count">{changes}</p>
      <output aria-label="Fixture action log">{JSON.stringify(log)}</output>
      <div style={{ maxWidth: 340 }}>
        {shown && (
          <ProjectDownloads
            service={service}
            projectId={id}
            revision={String(revision)}
            connected={connected}
            online={online}
            onChange={async () => {
              log.push('refresh')
              setChanges((v) => v + 1)
            }}
          />
        )}
      </div>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
)
