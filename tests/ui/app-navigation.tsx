// Actual App, browser repository and forms. Only async URL delivery is gated by this fixture.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../src/App'
import { createRuntime } from '../../src/runtime'
import { createProject } from '../../src/data'
import type { NativeLifecycleEvent } from '../../src/platform/native/lifecycle'
import '../../src/styles.css'

const scenario = new URLSearchParams(location.search).get('scenario')
const runtime = await createRuntime({})
const project = await createProject({
  name: 'Navigation scarf',
  craft: 'Knitting',
  color: 'sage',
  toolSize: '4 mm',
  yarn: '',
  notes: '',
})
const projectRoute = `project=${project.id}` as const
history.replaceState(null, '', scenario === 'initial-link' ? `/#${projectRoute}` : '/')
let release!: () => void
const gate = new Promise<void>((resolve) => {
  release = resolve
})
const pending: Promise<unknown>[] = []
const openUrl = runtime.openUrl
runtime.openUrl = async (url) => {
  const work = (async () => {
    const target = await openUrl(url)
    await gate
    return target
  })()
  pending.push(work)
  return work
}
let platformListener: ((event: NativeLifecycleEvent) => void) | undefined
runtime.subscribePlatform = (listener) => {
  platformListener = listener
  return () => {
    if (platformListener === listener) platformListener = undefined
  }
}
let holdHashes = false
const hashes: { oldURL: string; newURL: string }[] = []
window.addEventListener(
  'hashchange',
  (event) => {
    if (!holdHashes) return
    event.stopImmediatePropagation()
    hashes.push({ oldURL: event.oldURL, newURL: event.newURL })
  },
  true,
)
const paint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
const fixture = {
  projectRoute,
  get linkCalls() {
    return pending.length
  },
  get heldHashes() {
    return hashes.length
  },
  async releaseLinks() {
    release()
    await Promise.all(pending)
    await paint()
  },
  emitLink() {
    platformListener?.({ type: 'url', url: `${location.origin}/p/${project.id}` })
  },
  holdHashes() {
    holdHashes = true
  },
  async releaseHashes() {
    holdHashes = false
    for (const event of hashes.splice(0))
      window.dispatchEvent(new HashChangeEvent('hashchange', event))
    await paint()
  },
}
declare global {
  interface Window {
    navigationFixture: typeof fixture
  }
}
window.navigationFixture = fixture
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App runtime={runtime} controller={runtime.controller} />
  </StrictMode>,
)
