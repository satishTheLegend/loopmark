import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AppRuntime } from '../runtime'
import { ErrorMessage, errorText } from './ui'

export function PendingProjectLink({
  runtime,
  collectionName,
  onOpen,
  onAccount,
}: {
  runtime: AppRuntime
  collectionName?: string
  onOpen: (route: `project=${string}`) => void
  onAccount: () => void
}) {
  const state = useSyncExternalStore(runtime.links.subscribe, runtime.links.getSnapshot)
  const alive = useRef(true)
  const [error, setError] = useState('')
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  if (!state.pending) return null
  const token = state.pending.token
  async function open() {
    setError('')
    try {
      const route = await runtime.links.continue(token)
      if (alive.current) onOpen(route)
    } catch (failure) {
      if (alive.current) setError(errorText(failure))
    }
  }
  async function dismiss() {
    setError('')
    try {
      await runtime.links.dismiss(token)
    } catch (failure) {
      if (alive.current) setError(errorText(failure))
    }
  }
  return (
    <section className="project-link-notice readable-controls" aria-label="Saved project link">
      <h2>Open saved project link</h2>
      <p>
        A bag-label link is waiting on this device. Sign in if needed, choose the collection that
        contains the project, then open it. The link is kept for up to 24 hours.
      </p>
      {collectionName && (
        <p>
          Selected collection: <strong>{collectionName}</strong>.
        </p>
      )}
      <ErrorMessage
        message={error || (state.error ? `${state.error.problem} ${state.error.nextAction}` : '')}
      />
      <div className="account-actions">
        <button className="button primary" disabled={state.busy} onClick={() => void open()}>
          {state.busy ? 'Checking selected collection…' : 'Open in selected collection'}
        </button>
        <button className="button secondary" disabled={state.busy} onClick={onAccount}>
          Account &amp; sign-in
        </button>
        <button className="text-button" disabled={state.busy} onClick={() => void dismiss()}>
          Dismiss saved link
        </button>
      </div>
    </section>
  )
}
