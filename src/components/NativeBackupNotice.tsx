import { useEffect, useRef, useState } from 'react'
import type { IncomingBackup, NativeBackupInbox } from '../platform/native/backup-inbox'
import type { SessionScope } from '../domain/contracts'
import { canonicalJson } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import { errorHelp } from '../help/errors'
import { ErrorMessage, errorText } from './ui'

export function NativeBackupNotice({
  inbox,
  scope,
  collectionName,
  onReview,
}: {
  inbox: NativeBackupInbox & { subscribe: (listener: () => void) => () => void }
  scope: SessionScope
  collectionName: string
  onReview: (item: IncomingBackup, file: Blob) => void
}) {
  const [item, setItem] = useState<IncomingBackup | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'review' | 'dismiss' | null>(null)
  const [reload, setReload] = useState(0)
  const scopeJson = canonicalJson(scope)
  const selected = useRef(scopeJson)
  selected.current = scopeJson
  const lifetime = useRef(0),
    refreshRequest = useRef(0),
    actionRequest = useRef(0)
  const locked = useRef(false)
  useEffect(() => {
    const life = ++lifetime.current
    setItem(null)
    setError('')
    setBusy(null)
    locked.current = false
    async function refresh() {
      const request = ++refreshRequest.current
      try {
        const next = await inbox.pending()
        if (
          lifetime.current === life &&
          refreshRequest.current === request &&
          selected.current === scopeJson
        ) {
          setItem(next)
          setError('')
        }
      } catch (failure) {
        if (
          lifetime.current === life &&
          refreshRequest.current === request &&
          selected.current === scopeJson
        )
          setError(errorText(failure))
      }
    }
    void refresh()
    const remove = inbox.subscribe(() => {
      if (lifetime.current !== life || selected.current !== scopeJson) return
      actionRequest.current++
      locked.current = false
      setBusy(null)
      void refresh()
    })
    return () => {
      lifetime.current++
      refreshRequest.current++
      actionRequest.current++
      locked.current = false
      remove()
    }
  }, [inbox, scopeJson, reload])

  async function act(action: 'review' | 'dismiss') {
    if (!item || locked.current) return
    const life = lifetime.current,
      request = ++actionRequest.current
    const boundScope = structuredClone(scope),
      id = item.id
    const current = () =>
      lifetime.current === life &&
      actionRequest.current === request &&
      selected.current === scopeJson
    locked.current = true
    setBusy(action)
    setError('')
    try {
      if (action === 'dismiss') {
        await inbox.finish(id, boundScope, { state: 'dismissed' })
        if (current()) setReload((value) => value + 1)
        return
      }
      const bound = await inbox.bind(id, boundScope)
      if (!current()) return
      setItem(bound)
      if (bound.state !== 'ready') return
      if (
        bound.id !== id ||
        bound.operationToken !== item.operationToken ||
        canonicalJson(bound.source ?? null) !== canonicalJson(boundScope)
      )
        throw new DomainError('ACCOUNT_CHANGED')
      const file = await inbox.read(id)
      if (!current()) return
      const latest = await inbox.pending()
      if (!current()) return
      if (
        !latest ||
        latest.id !== id ||
        latest.state !== 'ready' ||
        latest.operationToken !== bound.operationToken ||
        canonicalJson(latest.source ?? null) !== canonicalJson(boundScope)
      ) {
        setItem(latest)
        throw new DomainError('NOT_AVAILABLE')
      }
      onReview(bound, file)
    } catch (failure) {
      if (current()) setError(errorText(failure))
    } finally {
      if (current()) {
        locked.current = false
        setBusy(null)
      }
    }
  }
  if (!item && !error) return null
  const otherCollection =
    item?.source && canonicalJson(item.source.key) !== canonicalJson(scope.key)
  const failureCode =
    item?.errorCode && Object.hasOwn(errorHelp, item.errorCode)
      ? item.errorCode
      : 'BACKUP_INCOMPLETE'
  return (
    <section
      className="account-section readable-controls native-backup-notice"
      aria-label="Incoming backup file"
    >
      <h2>
        {item?.state === 'already-handled'
          ? 'Backup file already handled'
          : 'A backup file is waiting'}
      </h2>
      {item && (
        <>
          <p style={{ overflowWrap: 'anywhere' }}>
            <strong>{item.name || 'Incoming backup'}</strong> · {item.bytes.toLocaleString()} bytes
          </p>
          {item.state === 'ready' ? (
            <>
              <p>
                This file has been kept on this device for review. Nothing has been imported or
                uploaded. Review its contents before restoring it as a separate local collection.
              </p>
              {otherCollection ? (
                <p role="status">
                  This backup was opened for review in another collection. Return to that collection
                  to continue, or dismiss this file.
                </p>
              ) : (
                <p>
                  Review from <strong>{collectionName}</strong>. Your saved projects will stay
                  unchanged until you choose an import action.
                </p>
              )}
            </>
          ) : item.state === 'already-handled' ? (
            <p role="status">
              This backup was already imported or dismissed. Receiving it again has not imported
              another copy.
            </p>
          ) : (
            <>
              <p>
                This incoming file could not be prepared. Your saved projects are unchanged. Dismiss
                this notice to return to any file that was already waiting.
              </p>
              <ErrorMessage message={errorText(new DomainError(failureCode))} />
            </>
          )}
          <div className="account-actions">
            {item.state === 'ready' && (
              <button
                className="button primary"
                disabled={!!busy || !!otherCollection}
                onClick={() => void act('review')}
              >
                {busy === 'review' ? 'Opening backup preview…' : 'Review backup file'}
              </button>
            )}
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => void act('dismiss')}
            >
              {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss backup file'}
            </button>
          </div>
        </>
      )}
      <ErrorMessage message={error} />
      {!item && error && (
        <button className="text-button" onClick={() => setReload((value) => value + 1)}>
          Check incoming file again
        </button>
      )}
    </section>
  )
}
