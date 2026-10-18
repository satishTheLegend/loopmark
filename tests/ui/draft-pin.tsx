import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { installDraftStoreFactory, useDraft } from '../../src/drafts'
import type { DraftRecord, DraftStore } from '../../src/repositories/drafts'
let persisted: DraftRecord<unknown> | undefined
let release: (() => void) | undefined
let delay = true
const store: DraftStore = {
  async read<T>() {
    return persisted as DraftRecord<T> | undefined
  },
  async write(key, previous, value) {
    if (persisted?.revision !== previous) throw new Error('Draft CAS failed')
    if (delay) {
      delay = false
      document.documentElement.dataset.writing = 'true'
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
    persisted = value ? structuredClone({ ...value, key }) : undefined
  },
  async removeProjectDrafts() {},
}
installDraftStoreFactory(() => store)
function Fixture() {
  const draft = useDraft('checkpoint:sample', { nextStep: 'Initial step' }, 'base')
  const [pinned, setPinned] = useState('')
  const [saved, setSaved] = useState('')
  return (
    <>
      <label>
        Next step
        <input
          value={draft.value.nextStep}
          onChange={(event) => draft.change('nextStep', event.target.value)}
        />
      </label>
      <button
        disabled={!draft.ready}
        onClick={() => void draft.pin().then((value) => setPinned(JSON.stringify(value)))}
      >
        Pin capture source
      </button>
      <button onClick={() => release?.()}>Finish media persistence</button>
      <button
        onClick={() => void draft.prepareCommit().then(() => setSaved(JSON.stringify(persisted)))}
      >
        Read saved draft
      </button>
      <output aria-label="Pinned source">{pinned}</output>
      <output aria-label="Saved draft">{saved}</output>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
