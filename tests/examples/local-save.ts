import type { CheckpointCreate, ProjectCreate, SessionScope } from '../../src/domain/contracts'
import type { Repository } from '../../src/repositories/contracts'

/** Caller persists these IDs before retrying; this function never invents a new intent on retry. */
export async function localSave(
  repository: Repository,
  scope: SessionScope,
  project: ProjectCreate,
  checkpoint: CheckpointCreate,
  operations: { project: string; checkpoint: string },
) {
  await repository.commitLocal(
    scope.key,
    {
      kind: 'project.create',
      operationId: operations.project,
      base: null,
      createdAt: project.createdAt,
      payload: { project },
    },
    scope.generation,
  )
  await repository.commitLocal(
    scope.key,
    {
      kind: 'checkpoint.create',
      operationId: operations.checkpoint,
      base: { afterOperationId: operations.project },
      createdAt: checkpoint.createdAt,
      payload: { checkpoint, updatedAt: checkpoint.createdAt },
    },
    scope.generation,
  )
  return repository.readView(scope.key)
}
