import type { CollectionInfo, LocalIntent, ProjectRecord, Receipt } from '../../domain/contracts'
export const now = '2026-01-01T00:00:00.000Z'
export const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQmcAAAAASUVORK5CYII='
export const wav =
  'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA=='
export function info(connected = false, suffix = ''): CollectionInfo {
  return {
    key: {
      namespace: `${connected ? 'account' : 'guest'}_fixture${suffix}`,
      collectionId: `collection${suffix}`,
      epoch: 'epoch',
    },
    name: 'Fixture',
    kind: connected ? 'connected' : 'guest',
    accountId: connected ? 'account' : null,
    createdAt: now,
    legacyAccess: false,
  }
}
export function project(id = 'project', revision = '0'): ProjectRecord {
  return {
    id,
    code: `CODE-${id.toUpperCase()}`,
    name: 'Moss scarf',
    craft: 'Crochet',
    color: 'sage',
    yarn: 'Cotton',
    toolSize: '4 mm',
    notes: '',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    revision,
  }
}
export function create(id = 'project', operationId = `create-${id}`): LocalIntent {
  const { revision: _revision, ...fields } = project(id)
  return {
    operationId,
    createdAt: now,
    base: null,
    kind: 'project.create',
    payload: { project: fields },
  }
}
export function receipt(
  operationId: string,
  sha256: string,
  revision = '1',
  changes: Receipt['changes'] = [{ kind: 'project.put', value: project('project', revision) }],
): Receipt {
  return {
    operationId,
    sha256,
    epoch: 'epoch',
    revision,
    cursor: revision,
    resultId: 'project',
    changes,
  }
}
