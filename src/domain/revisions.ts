import type { Command, Receipt, Revision } from './contracts'
import { DomainError } from './errors'

export function revisionTarget(command: Command): {
  kind: 'project' | 'checkpoint' | 'collection'
  id: string
} {
  switch (command.kind) {
    case 'project.create':
      return { kind: 'project', id: command.payload.project.id }
    case 'project.update':
    case 'project.status':
    case 'project.delete':
      return { kind: 'project', id: command.payload.projectId }
    case 'checkpoint.create':
      return { kind: 'project', id: command.payload.checkpoint.projectId }
    case 'media.attach':
      return { kind: 'checkpoint', id: command.payload.checkpointId }
    case 'collection.replace':
      return { kind: 'collection', id: command.collectionId }
  }
}
export function predecessorRevision(command: Command, receipt: Receipt): Revision {
  if (
    !command.base ||
    !('afterOperationId' in command.base) ||
    command.base.afterOperationId !== receipt.operationId ||
    command.epoch !== receipt.epoch
  )
    throw new DomainError('REVISION_CONFLICT')
  const target = revisionTarget(command)
  for (const change of receipt.changes) {
    if (target.kind === 'project' && change.kind === 'project.put' && change.value.id === target.id)
      return change.value.revision
    if (
      target.kind === 'checkpoint' &&
      change.kind === 'checkpoint.put' &&
      change.value.id === target.id
    )
      return change.value.revision
  }
  // Deleted entities and replacement epochs cannot be mutated using an old predecessor.
  throw new DomainError('REVISION_CONFLICT')
}
