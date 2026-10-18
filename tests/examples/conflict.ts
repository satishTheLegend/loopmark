import type { SessionScope } from '../../src/domain/contracts'
import type { Repository } from '../../src/repositories/contracts'

/** Invoke only after showing both readView and readAcknowledged and the user chooses cloud. */
export async function useCloud(
  repository: Repository,
  scope: SessionScope,
  operationId: string,
  reviewedRevision: string,
) {
  return repository.resolvePending(
    scope.key,
    {
      operationId,
      expectedRevision: reviewedRevision,
      recoveryName: 'Device work before choosing cloud',
    },
    scope.generation,
  )
}
