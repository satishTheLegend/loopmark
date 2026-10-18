import type { SessionScope } from '../domain/contracts'
import { DomainError } from '../domain/errors'
import { keyOf } from '../repositories/state'
export interface TabLease {
  run(scope: SessionScope, signal: AbortSignal, work: () => Promise<void>): Promise<boolean>
}
/** Web Locks holds ownership for the entire promise, including foreground retry waits. */
export function createTabLease(
  locks: LockManager | undefined = globalThis.navigator?.locks,
): TabLease {
  return {
    async run(scope, signal, work) {
      if (!locks) throw new DomainError('CAPABILITY_UNAVAILABLE')
      signal.throwIfAborted()
      const name = JSON.stringify(['loopmark-sync', keyOf(scope.key), scope.device])
      return locks.request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) return false
        signal.throwIfAborted()
        await work()
        return true
      })
    },
  }
}
