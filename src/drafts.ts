import { useEffect, useRef, useState } from 'react'

interface Draft<T> {
  key: string
  value: T
  revision: string
  baseRevision?: string
}
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('loopmark-drafts', 1)
    let abandoned = false
    const timeout = setTimeout(() => {
      abandoned = true
      reject(new Error('Draft storage is busy. Keep this form open until you save.'))
    }, 5000)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' })
    request.onsuccess = () => {
      clearTimeout(timeout)
      if (abandoned) request.result.close()
      else resolve(request.result)
    }
    request.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Draft recovery is unavailable. Keep this form open until you save.'))
    }
  })
async function read<T>(key: string): Promise<Draft<T> | undefined> {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
async function write<T>(key: string, previous: string | undefined, draft?: Draft<T>) {
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite')
      const store = tx.objectStore('drafts')
      let conflict = false
      const request = store.get(key)
      request.onsuccess = () => {
        try {
          if (request.result?.revision !== previous) {
            conflict = true
            tx.abort()
            return
          }
          if (draft) store.put(draft)
          else store.delete(key)
        } catch {
          tx.abort()
        }
      }
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () =>
        reject(
          new Error(
            conflict
              ? 'This draft changed in another tab. Your input is still here. Save it as a project or checkpoint, or close and reopen to recover the other draft.'
              : 'The draft could not be kept on this device. Keep this form open until you save.',
          ),
        )
    })
  } finally {
    db.close()
  }
}

export async function deleteProjectDrafts(projectId: string) {
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite')
      tx.objectStore('drafts').delete(`edit:${projectId}`)
      tx.objectStore('drafts').delete(`checkpoint:${projectId}`)
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () =>
        reject(
          new Error(
            'Project deleted, but its unsaved draft could not be cleared. Retry clearing site data after making a full backup.',
          ),
        )
    })
  } finally {
    db.close()
  }
}

/** Drafts are separate from saved records and exports; writes never replace another tab's draft. */
export function useDraft<T>(key: string, initial: T, baseRevision?: string) {
  const [value, setValue] = useState(initial)
  const [ready, setReady] = useState(false)
  const [recovered, setRecovered] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [discarding, setDiscarding] = useState(false)
  const discardLock = useRef(false)
  const revision = useRef<string | undefined>(undefined)
  const base = useRef(baseRevision)
  const queue = useRef(Promise.resolve())
  const pending = useRef(0)
  const blocked = useRef(false)
  const commitToken = useRef(crypto.randomUUID())
  const savedValue = useRef<T | undefined>(undefined)
  const current = useRef(initial)
  const initialValue = useRef(initial)
  useEffect(() => {
    let alive = true
    read<T>(key)
      .then((draft) => {
        if (!alive) return
        if (draft) {
          revision.current = draft.revision
          savedValue.current = draft.value
          base.current = draft.baseRevision
          current.current = draft.value
          setValue(draft.value)
          setRecovered(true)
          setStatus('Draft recovered on this device. Review it, then save when ready.')
        }
      })
      .catch((e: Error) => {
        if (alive) {
          blocked.current = true
          setError(e.message)
        }
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    const protect = (e: BeforeUnloadEvent) => {
      if (pending.current || blocked.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', protect)
    return () => {
      alive = false
      window.removeEventListener('beforeunload', protect)
    }
  }, [key])
  function change<K extends keyof T>(field: K, next: T[K]) {
    if (discardLock.current) return
    const updated = { ...current.current, [field]: next }
    current.current = updated
    commitToken.current = crypto.randomUUID()
    setValue(updated)
    if (!ready || blocked.current) return
    setStatus('Keeping your draft…')
    pending.current++
    queue.current = queue.current
      .then(async () => {
        if (blocked.current) return
        const nextRevision = crypto.randomUUID()
        await write(key, revision.current, {
          key,
          value: updated,
          revision: nextRevision,
          baseRevision: base.current,
        })
        revision.current = nextRevision
        savedValue.current = updated
        setStatus('Draft kept on this device. Save to add it to your backup.')
      })
      .catch((e: Error) => {
        blocked.current = true
        setError(e.message)
      })
      .finally(() => {
        pending.current--
      })
  }
  async function flush() {
    for (;;) {
      const tail = queue.current
      await tail
      if (tail === queue.current) return
    }
  }
  async function clear() {
    await flush()
    await write(key, revision.current)
    revision.current = undefined
  }
  async function discard() {
    if (discardLock.current) return
    discardLock.current = true
    setDiscarding(true)
    try {
      await clear()
      current.current = initialValue.current
      base.current = baseRevision
      setValue(initialValue.current)
      setRecovered(false)
      blocked.current = false
      setError('')
      setStatus('Draft discarded.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not discard the draft.')
    } finally {
      discardLock.current = false
      setDiscarding(false)
    }
  }
  async function prepareCommit() {
    await flush()
    return revision.current &&
      JSON.stringify(current.current) === JSON.stringify(savedValue.current)
      ? revision.current
      : commitToken.current
  }
  async function canClose() {
    if (discardLock.current) return false
    await flush()
    return (
      !blocked.current ||
      window.confirm(
        'This draft could not be kept. Close anyway and lose your latest unsaved changes?',
      )
    )
  }
  async function closeSafely(onClose: () => void) {
    if (await canClose()) onClose()
  }
  return {
    prepareCommit,
    closeSafely,
    canClose,
    discarding,
    value,
    change,
    ready,
    recovered,
    status,
    error,
    clear,
    discard,
    baseRevision: base.current,
  }
}
