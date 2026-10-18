import { useId, useState } from 'react'
import { IconCheck, IconArrowsExchange } from '@tabler/icons-react'
import type { CollectionInfo, CollectionKey } from '../domain/contracts'
import { safeError } from '../domain/errors'
import { Dialog, ErrorMessage } from './ui'

export interface CollectionSummary {
  info: CollectionInfo
  projects: number
  checkpoints: number
  available: boolean
}
const same = (a: CollectionKey, b: CollectionKey) =>
  a.namespace === b.namespace && a.collectionId === b.collectionId && a.epoch === b.epoch
export function collectionDestination(info: CollectionInfo, accountEmail?: string): string {
  return info.kind === 'connected' ? accountEmail || 'Your account' : 'On this device'
}

export function CollectionPicker({
  collections,
  selected,
  accountEmail,
  loading,
  onSelect,
}: {
  collections: CollectionSummary[]
  selected?: CollectionInfo
  accountEmail?: string
  loading: boolean
  onSelect: (key: CollectionKey) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const title = useId()
  async function select(key: CollectionKey) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onSelect(key)
      setOpen(false)
    } catch (failure) {
      const detail = safeError(failure)
      setError(`${detail.problem} ${detail.nextAction}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="collection-heading readable-controls">
        <p>
          {selected ? (
            <>
              <strong>{selected.name}</strong>
              <span> · {collectionDestination(selected, accountEmail)}</span>
            </>
          ) : loading ? (
            'Loading your collections…'
          ) : (
            'No collection selected'
          )}
        </p>
        <button
          className="button secondary"
          onClick={() => {
            setOpen(true)
            setError('')
          }}
          disabled={loading}
        >
          <IconArrowsExchange aria-hidden size={18} /> Change collection
        </button>
      </div>
      {open && (
        <Dialog
          title="Choose a collection"
          onClose={() => {
            if (!busy) setOpen(false)
          }}
        >
          <div className="readable-controls">
            <p id={title}>
              Each collection keeps its own projects and drafts. Choosing one does not move or
              upload anything.
            </p>
            <ErrorMessage message={error} />
            <ul className="collection-list" aria-describedby={title}>
              {collections.map(({ info, projects, checkpoints, available }) => (
                <li key={JSON.stringify(info.key)}>
                  <button
                    type="button"
                    className="collection-option"
                    disabled={busy || !available}
                    onClick={() => void select(info.key)}
                    aria-current={selected && same(selected.key, info.key) ? 'true' : undefined}
                  >
                    <span>
                      <strong>{info.name}</strong>
                      <span>{collectionDestination(info, accountEmail)}</span>
                      <span>
                        {projects} {projects === 1 ? 'project' : 'projects'} · {checkpoints}{' '}
                        {checkpoints === 1 ? 'checkpoint' : 'checkpoints'}
                        {!available ? ' · Connect to open' : ''}
                      </span>
                    </span>
                    {selected && same(selected.key, info.key) && (
                      <>
                        <IconCheck aria-hidden size={22} />
                        <span className="sr-only">Selected</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <p role="status">{busy ? 'Opening collection…' : ''}</p>
            <button className="button secondary" disabled={busy} onClick={() => setOpen(false)}>
              Keep current collection
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}
