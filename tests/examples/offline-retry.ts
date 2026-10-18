import type { Command, Receipt, SessionScope } from '../../src/domain/contracts'
import { DomainError, safeError } from '../../src/domain/errors'
import type { Repository } from '../../src/repositories/contracts'

/** The real coordinator additionally owns a lease, bounded backoff and attachment work. */
export async function retryOne(
  repository: Repository,
  scope: SessionScope,
  operationId: string,
  push: (command: Command) => Promise<Receipt>,
) {
  const item = (await repository.pending(scope.key)).find(
    (p) => p.intent.operationId === operationId,
  )
  if (!item) return // Its original receipt may already have been durably applied.
  if (item.error && !item.error.retryable) throw new DomainError(item.error.code)
  await repository.markAttempt(scope.key, operationId, scope.generation)
  try {
    const receipt = await push(item.command)
    await repository.acknowledge(scope.key, receipt, scope.generation)
  } catch (error) {
    await repository.markFailure(scope.key, operationId, safeError(error), scope.generation)
    throw error
  }
}
