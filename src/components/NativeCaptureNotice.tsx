import { useEffect, useState } from 'react'
import type { AppRuntime } from '../runtime'
import type { PendingNativeCapture } from '../platform/native/capture-recovery'
import { readFile } from '../media'
import { ErrorMessage, errorText } from './ui'

/** Only the selected source collection can see or explicitly apply a restored camera result. */
export function NativeCaptureNotice({ runtime }: { runtime: AppRuntime }) {
  const [pending, setPending] = useState<PendingNativeCapture | null>(null)
  const [photo, setPhoto] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const scope = runtime.scope()
        const value = (await runtime.captureRecovery?.pending(scope)) ?? null
        const image =
          value?.state === 'ready'
            ? await readFile((await runtime.captureRecovery!.photo(value.id, scope)).bytes)
            : ''
        if (alive) {
          setPending(value)
          setPhoto(image)
          setError('')
        }
      } catch (failure) {
        if (alive) setError(errorText(failure))
      }
    }
    void load()
    const remove = runtime.subscribeCapture(() => void load())
    return () => {
      alive = false
      remove()
    }
  }, [runtime])
  async function finish(apply: boolean) {
    if (!pending || busy) return
    setBusy(true)
    setError('')
    try {
      const scope = runtime.scope()
      if (apply) await runtime.captureRecovery!.applyToDraft(pending.id, scope)
      else await runtime.acknowledgePhoto(pending.id, scope)
      setPending(null)
      setPhoto('')
      setMessage(
        apply
          ? 'Photo kept in its original checkpoint draft. Open that project and add a checkpoint to review the draft before saving.'
          : 'Interrupted photo discarded. Your saved projects and other draft text remain.',
      )
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }
  if (!pending && !message && !error) return null
  return (
    <section
      className="account-section readable-controls capture-recovery"
      aria-label="Interrupted photo recovery"
    >
      <h2>{pending ? 'An interrupted photo' : 'Photo recovery'}</h2>
      {pending && (
        <>
          <p>
            {pending.state === 'ready'
              ? 'This photo belongs to a checkpoint draft in this collection. Keep it only after checking the preview.'
              : pending.state === 'failed'
                ? 'The interrupted camera result could not be recovered. Discard it to take another photo; your draft text is still separate.'
                : 'A camera request was interrupted before its result arrived. Wait for the result, or discard this request to take another photo.'}
          </p>
          {photo && <img src={photo} alt="Recovered checkpoint photo to review" width={200} />}
          <div className="account-actions">
            {pending.state === 'ready' && (
              <button className="button primary" disabled={busy} onClick={() => void finish(true)}>
                Keep photo in original draft
              </button>
            )}
            <button className="button secondary" disabled={busy} onClick={() => void finish(false)}>
              Discard interrupted photo
            </button>
          </div>
        </>
      )}
      {message && <p role="status">{message}</p>}
      <ErrorMessage message={error} />
    </section>
  )
}
