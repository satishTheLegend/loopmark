import type { AppController } from '../services/controller-contract'

/** Scheduling only: the controller retains scope and authority checks for each invocation. */
export function createRuntimeScheduler(options: {
  controller: Pick<AppController, 'getSnapshot' | 'subscribe' | 'runSync'>
  enabled: boolean
  foreground(): boolean
  online(): boolean
}) {
  const { controller } = options
  let timer: ReturnType<typeof setTimeout> | undefined,
    disposed = false,
    running = false,
    runAgain = false,
    lastWork = ''
  function request(delay = 150) {
    clearTimeout(timer)
    if (disposed || !options.foreground() || !options.enabled) return
    if (running) {
      runAgain = true
      return
    }
    timer = setTimeout(() => void cycle(), delay)
  }
  async function cycle() {
    if (disposed || !options.foreground() || running) return
    const state = controller.getSnapshot()
    if (
      state.phase !== 'ready' ||
      state.auth !== 'authenticated' ||
      state.view?.info.kind !== 'connected'
    )
      return
    running = true
    try {
      await controller.runSync()
    } catch {
      // The controller publishes a redacted, actionable error. Polls never dismiss it.
    } finally {
      running = false
      const followUp = runAgain
      runAgain = false
      if (!blocked()) request(followUp ? 150 : 45_000)
    }
  }
  function blocked() {
    const error = controller.getSnapshot().error
    return (
      error &&
      !error.retryable &&
      [
        'AUTH_REQUIRED',
        'ACCOUNT_CHANGED',
        'SYNC_REBASE_REQUIRED',
        'CAPABILITY_UNAVAILABLE',
      ].includes(error.code)
    )
  }
  const unsubscribe = controller.subscribe(() => {
    const state = controller.getSnapshot()
    const work = JSON.stringify([
      state.scope,
      state.auth,
      state.view?.pending.map((item) => item.intent.operationId),
    ])
    if (work !== lastWork) {
      lastWork = work
      request()
    }
  })
  request()
  return {
    request,
    cancel() {
      clearTimeout(timer)
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      unsubscribe()
    },
  }
}
