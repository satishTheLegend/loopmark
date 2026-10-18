import type { OperationPlan, OperationPlanStore } from '../../services/operation-plans'
import type { SessionScope } from '../../domain/contracts'
import { DomainError } from '../../domain/errors'
import { hashSchema, id } from '../../domain/schema'
import { intentCommand, keyOf } from '../state'
import { transaction, requestResult, assertGeneration } from './schema'
import type { BrowserRepository } from './repository'
const address = (scope: SessionScope, operationId: string) =>
  JSON.stringify(['operation-plan', keyOf(scope.key), operationId])
export function createBrowserOperationPlanStore(repository: BrowserRepository): OperationPlanStore {
  return {
    async read(scope, operationId) {
      return transaction(repository.database, 'readonly', async (tx) => {
        await assertGeneration(tx, scope.key, scope.generation)
        const row = await requestResult<{ value: OperationPlan } | undefined>(
          tx.objectStore('meta').get(address(scope, operationId)),
        )
        return row?.value
      })
    },
    async putIfAbsent(scope, plan) {
      if (
        !id.safeParse(plan.operationId).success ||
        !hashSchema.safeParse(plan.inputHash).success ||
        plan.intent.operationId !== plan.operationId
      )
        throw new DomainError('VALIDATION')
      intentCommand(plan.intent)
      return transaction(repository.database, 'readwrite', async (tx) => {
        await assertGeneration(tx, scope.key, scope.generation)
        const key = address(scope, plan.operationId),
          row = await requestResult<{ value: OperationPlan } | undefined>(
            tx.objectStore('meta').get(key),
          )
        if (row) {
          if (row.value.inputHash !== plan.inputHash) throw new DomainError('OPERATION_REUSED')
          return row.value
        }
        tx.objectStore('meta').add({ key, value: plan })
        return plan
      })
    },
  }
}
