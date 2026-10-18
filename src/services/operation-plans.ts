import type { LocalIntent, SessionScope } from '../domain/contracts'
/** The durable immutable intent selected on first submission survives response loss and app restart. */
export interface OperationPlan {
  operationId: string
  inputHash: string
  intent: LocalIntent
}
export interface OperationPlanStore {
  read(scope: SessionScope, operationId: string): Promise<OperationPlan | undefined>
  /** Atomically return the existing equal-input plan or install this one. Reject changed-input reuse. */
  putIfAbsent(scope: SessionScope, plan: OperationPlan): Promise<OperationPlan>
}
