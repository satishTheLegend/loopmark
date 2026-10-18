import { useEffect, useState } from 'react'
import type { AppRuntime } from '../runtime'
import type { AttachPreview } from '../domain/remote-contracts'
import { ErrorMessage, errorText } from './ui'
export interface PendingConnection {
  preview: AttachPreview
  mode: 'attach' | 'replace'
  phase: 'preview' | 'prepared' | 'queued'
}
export function PendingConnections({
  runtime,
  onReview,
}: {
  runtime: AppRuntime
  onReview: (item: PendingConnection) => void
}) {
  const [pending, setPending] = useState<PendingConnection[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const items = (await runtime.connections?.list()) ?? []
        if (alive) {
          setPending(
            items.filter((item): item is PendingConnection =>
              ['preview', 'prepared', 'queued'].includes(item.phase),
            ),
          )
          setError('')
        }
      } catch (failure) {
        if (alive) setError(errorText(failure))
      }
    }
    void load()
    const remove = runtime.subscribeConnections(() => void load())
    return () => {
      alive = false
      remove()
    }
  }, [runtime])
  if (!pending.length && !error) return null
  return (
    <section
      className="account-section readable-controls"
      aria-label="Unfinished collection requests"
    >
      <h2>Continue a collection request</h2>
      <p>
        These saved requests belong to this account. Review a request to resume it or cancel work
        that has not committed.
      </p>
      <ErrorMessage message={error} />
      <ul className="collection-list">
        {pending.map((item) => (
          <li key={item.preview.id}>
            <button className="collection-option" onClick={() => onReview(item)}>
              <span>
                <strong>{item.preview.source.name}</strong>
                <span>
                  {item.mode === 'attach' ? 'Connect to account' : 'Replace account collection'} ·{' '}
                  {item.phase === 'preview'
                    ? 'Awaiting your confirmation'
                    : 'Confirmed; check or resume'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
