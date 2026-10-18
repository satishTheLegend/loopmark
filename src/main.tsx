import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/lora/latin-400.css'
import '@fontsource/lora/latin-500.css'
import App from './App'
import './styles.css'
import { useState, useSyncExternalStore } from 'react'
import { Capacitor } from '@capacitor/core'
import { createRuntime, startupMessage, type AppRuntime } from './runtime'
import { Brand } from './components/ui'

const root = ReactDOM.createRoot(document.getElementById('root')!)
function Opening({ error }: { error?: string }) {
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState('')
  async function recover() {
    setExporting(true)
    setExportError('')
    try {
      const { readLegacyBackup } = await import('./services/legacy-recovery')
      const backup = await readLegacyBackup()
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup)], { type: 'application/json' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = `loopmark-previous-version-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) {
      setExportError(startupMessage(failure))
    } finally {
      setExporting(false)
    }
  }
  return (
    <main className="startup-screen readable-controls">
      <Brand />
      <h1>{error ? 'Your workbasket needs attention' : 'Opening your workbasket…'}</h1>
      {error && (
        <>
          <p role="alert">{error}</p>
          <p>
            Close other Loopmark tabs and reopen the app. Keep the app’s stored data while
            recovering your projects.
          </p>
          <button className="button primary" onClick={() => location.reload()}>
            Reopen Loopmark
          </button>
          {!Capacitor.isNativePlatform() && (
            <section className="account-section">
              <h2>Recover a previous version</h2>
              <p>
                If you used Loopmark before this update, you can try exporting its saved projects.
                This reads the old collection without changing it. Newer saves and unfinished drafts
                are not included in this export.
              </p>
              <button
                className="button secondary"
                disabled={exporting}
                onClick={() => void recover()}
              >
                {exporting ? 'Reading saved projects…' : 'Export previous-version projects'}
              </button>
              {exportError && (
                <p role="alert" className="error">
                  {exportError}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </main>
  )
}
function RuntimeApp({ runtime }: { runtime: AppRuntime }) {
  const state = useSyncExternalStore(runtime.controller.subscribe, runtime.controller.getSnapshot)
  if (state.phase !== 'ready' || !state.scope)
    return (
      <Opening
        error={
          state.phase === 'error' && state.error
            ? `${state.error.problem} ${state.error.nextAction}`
            : undefined
        }
      />
    )
  return (
    <App
      key={state.scope.generation}
      controller={runtime.controller}
      cloudAvailable={runtime.config.cloud.enabled}
      runtime={runtime}
    />
  )
}
root.render(<Opening />)
void createRuntime(import.meta.env)
  .then((runtime) => {
    root.render(
      <React.StrictMode>
        <RuntimeApp runtime={runtime} />
      </React.StrictMode>,
    )
  })
  .catch((error) => root.render(<Opening error={startupMessage(error)} />))
