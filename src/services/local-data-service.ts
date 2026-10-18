import type { DataAdapter } from '../data'
import { parseBackup } from '../data'
import type { Repository } from '../repositories/contracts'
import type { PlatformMedia } from '../platform/contracts'
import type { OperationPlanStore } from './operation-plans'
import type {
  Project,
  Checkpoint,
  ProjectInput,
  CheckpointInput,
  CollectionView,
  SessionScope,
  ProjectRecord,
  CheckpointRecord,
  LocalIntent,
  Base,
  Backup,
  LocalCollectionCandidate,
} from '../domain/contracts'
import { canonicalHash } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import { projectInputSchema, checkpointInputSchema, supportedTimestamp } from '../domain/schema'
import { MAX_BACKUP_BYTES, utf8Bytes } from '../domain/policy'
import { validateBackupMedia } from '../media-validation'
import { limiter, mapBounded } from './concurrency'
import { describeInline, inlineMedia, storeInline } from './media-codec'

export interface LocalDataDependencies {
  repository: Repository
  media: PlatformMedia
  plans: OperationPlanStore
  /** Capture a copy at action start. Every persistence port fences this exact scope. */
  scope: () => SessionScope
}
function freshTimestamp(view: CollectionView): string {
  const value = new Date(
    Math.max(Date.now(), ...view.projects.map((p) => Date.parse(p.updatedAt) + 1)),
  ).toISOString()
  if (!supportedTimestamp(value)) throw new DomainError('VALIDATION')
  return value
}
function projectBase(view: CollectionView, project: ProjectRecord): Base {
  for (let i = view.pending.length - 1; i >= 0; i--) {
    const { intent } = view.pending[i]
    if (
      (intent.kind === 'project.create' && intent.payload.project.id === project.id) ||
      (intent.kind === 'checkpoint.create' && intent.payload.checkpoint.projectId === project.id) ||
      (intent.kind !== 'project.create' &&
        intent.kind !== 'checkpoint.create' &&
        intent.kind !== 'collection.replace' &&
        intent.payload.projectId === project.id)
    )
      return { afterOperationId: intent.operationId }
  }
  return { revision: project.revision }
}
async function expandProject(
  project: ProjectRecord,
  checkpoints: CheckpointRecord[],
  deps: LocalDataDependencies,
  scope: SessionScope,
  allowMissing: boolean,
  limit: ReturnType<typeof limiter>,
): Promise<Project> {
  const { revision: _revision, ...fields } = project
  const inline = async (ref: NonNullable<CheckpointRecord['photo']>) => {
    try {
      return await limit(() => inlineMedia(ref, deps.media, scope))
    } catch (error) {
      if (allowMissing && error instanceof DomainError && error.detail.code === 'BACKUP_INCOMPLETE')
        return undefined
      throw error
    }
  }
  const children: Checkpoint[] = await mapBounded(
    checkpoints.filter((c) => c.projectId === project.id),
    async (c) => {
      const { revision: _rev, projectId: _id, photo, voice, ...fields } = c
      const p = photo ? await inline(photo) : undefined,
        v = voice ? await inline(voice) : undefined
      return { ...fields, ...(p ? { photo: p } : {}), ...(v ? { voice: v } : {}) }
    },
  )
  return {
    ...fields,
    checkpoints: children.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  }
}
export async function prepareBackupRecords(
  backup: Backup,
  media: PlatformMedia,
  scope: SessionScope,
): Promise<{
  projects: ProjectRecord[]
  checkpoints: CheckpointRecord[]
  provenance: LocalCollectionCandidate['provenance']
}> {
  const validated = parseBackup(JSON.stringify(backup))
  await validateBackupMedia(validated)
  const projects: ProjectRecord[] = [],
    checkpoints: CheckpointRecord[] = []
  for (const project of validated.projects) {
    const { checkpoints: children, ...fields } = project
    projects.push({ ...fields, revision: '0' })
    for (const checkpoint of children) {
      const { photo, voice, ...fields } = checkpoint
      const p = photo ? await storeInline(photo, 'photo', media, scope) : undefined
      const v = voice ? await storeInline(voice, 'voice', media, scope) : undefined
      checkpoints.push({
        ...fields,
        projectId: project.id,
        revision: '0',
        ...(p ? { photo: p } : {}),
        ...(v ? { voice: v } : {}),
      })
    }
  }
  return {
    projects,
    checkpoints,
    provenance: {
      kind: 'backup',
      sourceId: `backup_${(await canonicalHash(validated)).slice(0, 40)}`,
      capturedAt: validated.exportedAt,
    },
  }
}
export async function normalizeBackup(
  backup: Backup,
  deps: Pick<LocalDataDependencies, 'repository' | 'media'>,
  scope: SessionScope,
): Promise<LocalCollectionCandidate> {
  const view = await deps.repository.readView(scope.key)
  if (view.info.kind === 'connected') throw new DomainError('SYNC_REBASE_REQUIRED')
  return { info: view.info, ...(await prepareBackupRecords(backup, deps.media, scope)) }
}
export function createLocalDataAdapter(deps: LocalDataDependencies): DataAdapter {
  const { repository, media, plans } = deps
  const scope = () => structuredClone(deps.scope())
  const limit = limiter(2)
  const list = async (bound: SessionScope) => {
    const view = await repository.readView(bound.key)
    return view.projects
      .map(({ revision: _revision, ...project }) => ({
        ...project,
        checkpoints: view.checkpoints
          .filter((c) => c.projectId === project.id)
          .map(
            ({ revision: _revision, projectId: _projectId, photo: _photo, voice: _voice, ...c }) =>
              c,
          )
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      }))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }
  const resultProject = async (bound: SessionScope, id: string) => {
    const view = await repository.readView(bound.key),
      project = view.projects.find((p) => p.id === id)
    if (!project) throw new DomainError('NOT_AVAILABLE')
    return expandProject(project, view.checkpoints, deps, bound, true, limit)
  }
  async function planned(
    bound: SessionScope,
    kind: string,
    token: string,
    input: unknown,
    build: (operationId: string) => Promise<LocalIntent>,
  ) {
    const operationId = `op_${(await canonicalHash({ scope: bound.key, kind, token })).slice(0, 48)}`
    const inputHash = await canonicalHash(JSON.parse(JSON.stringify(input)))
    const existing = await plans.read(bound, operationId)
    if (existing) {
      if (existing.inputHash !== inputHash) throw new DomainError('OPERATION_REUSED')
      return existing.intent
    }
    return (
      await plans.putIfAbsent(bound, { operationId, inputHash, intent: await build(operationId) })
    ).intent
  }
  async function change(
    id: string,
    expected: string,
    build: (project: ProjectRecord, view: CollectionView) => LocalIntent,
  ) {
    const bound = scope(),
      view = await repository.readView(bound.key),
      project = view.projects.find((p) => p.id === id)
    if (!project) throw new DomainError('NOT_AVAILABLE')
    if (project.updatedAt !== expected) throw new DomainError('REVISION_CONFLICT')
    await repository.commitLocal(bound.key, build(project, view), bound.generation)
    return resultProject(bound, id)
  }
  return {
    listProjects: () => list(scope()),
    async getProject(id) {
      const bound = scope(),
        view = await repository.readView(bound.key),
        project = view.projects.find((p) => p.id === id)
      return project ? expandProject(project, view.checkpoints, deps, bound, true, limit) : null
    },
    async mediaAvailability(projectId) {
      const bound = scope(),
        view = await repository.readView(bound.key)
      const refs = view.checkpoints
        .filter((c) => c.projectId === projectId)
        .flatMap((c) =>
          (['photo', 'voice'] as const).flatMap((kind) =>
            c[kind] ? [{ checkpointId: c.id, kind, ref: c[kind] }] : [],
          ),
        )
      return mapBounded(refs, async ({ ref, ...item }) => {
        try {
          await limit(async () => (await media.open(ref, bound.key)).cancel())
          return { ...item, state: 'available' as const }
        } catch (error) {
          if (error instanceof DomainError && error.detail.code === 'BACKUP_INCOMPLETE')
            return { ...item, state: 'missing' as const }
          throw error
        }
      })
    },
    async getLibraryState() {
      const view = await repository.readView(scope().key)
      return {
        revision: view.revision,
        projects: view.projects.length,
        checkpoints: view.checkpoints.length,
      }
    },
    async createProject(input: ProjectInput, operationToken = crypto.randomUUID()) {
      const parsed = projectInputSchema.safeParse(input)
      if (!parsed.success) throw new DomainError('VALIDATION')
      const bound = scope()
      const intent = await planned(
        bound,
        'project.create',
        operationToken,
        parsed.data,
        async (operationId) => {
          const view = await repository.readView(bound.key),
            timestamp = freshTimestamp(view),
            hash = await canonicalHash({ operationId })
          return {
            kind: 'project.create',
            operationId,
            createdAt: timestamp,
            base: null,
            payload: {
              project: {
                ...parsed.data,
                id: `project_${hash.slice(0, 40)}`,
                code: `LM-${hash.slice(0, 8).toUpperCase()}`,
                status: 'active',
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            },
          }
        },
      )
      await repository.commitLocal(bound.key, intent, bound.generation)
      if (intent.kind !== 'project.create') throw new DomainError('INVARIANT_VIOLATION')
      return resultProject(bound, intent.payload.project.id)
    },
    async updateProject(id, input, expected) {
      const parsed = projectInputSchema.safeParse(input)
      if (!parsed.success) throw new DomainError('VALIDATION')
      return change(id, expected, (p, v) => {
        const timestamp = freshTimestamp(v)
        return {
          kind: 'project.update',
          operationId: crypto.randomUUID(),
          createdAt: timestamp,
          base: projectBase(v, p),
          payload: { projectId: id, fields: parsed.data, updatedAt: timestamp },
        }
      })
    },
    setProjectStatus(id, status, expected) {
      return change(id, expected, (p, v) => {
        const timestamp = freshTimestamp(v)
        return {
          kind: 'project.status',
          operationId: crypto.randomUUID(),
          createdAt: timestamp,
          base: projectBase(v, p),
          payload: { projectId: id, status, updatedAt: timestamp },
        }
      })
    },
    async deleteProject(id, expected) {
      const bound = scope(),
        view = await repository.readView(bound.key),
        project = view.projects.find((p) => p.id === id)
      if (!project) throw new DomainError('NOT_AVAILABLE')
      if (project.updatedAt !== expected) throw new DomainError('REVISION_CONFLICT')
      await repository.commitLocal(
        bound.key,
        {
          kind: 'project.delete',
          operationId: crypto.randomUUID(),
          createdAt: freshTimestamp(view),
          base: projectBase(view, project),
          payload: { projectId: id },
        },
        bound.generation,
      )
    },
    async addCheckpoint(id, input: CheckpointInput, operationToken = crypto.randomUUID()) {
      const parsed = checkpointInputSchema.safeParse(input)
      if (!parsed.success) throw new DomainError('VALIDATION')
      const bound = scope()
      const intent = await planned(
        bound,
        'checkpoint.create',
        operationToken,
        { projectId: id, input: parsed.data },
        async (operationId) => {
          const view = await repository.readView(bound.key),
            project = view.projects.find((p) => p.id === id)
          if (!project) throw new DomainError('NOT_AVAILABLE')
          const timestamp = freshTimestamp(view),
            { photo, voice, ...fields } = parsed.data
          const p = photo ? (await describeInline(photo, 'photo')).ref : undefined,
            v = voice ? (await describeInline(voice, 'voice')).ref : undefined
          return {
            kind: 'checkpoint.create',
            operationId,
            createdAt: timestamp,
            base: projectBase(view, project),
            payload: {
              updatedAt: timestamp,
              checkpoint: {
                ...fields,
                id: `checkpoint_${(await canonicalHash({ operationId })).slice(0, 40)}`,
                projectId: id,
                createdAt: timestamp,
                ...(p ? { photo: p } : {}),
                ...(v ? { voice: v } : {}),
              },
            },
          }
        },
      )
      if (parsed.data.photo) await storeInline(parsed.data.photo, 'photo', media, bound)
      if (parsed.data.voice) await storeInline(parsed.data.voice, 'voice', media, bound)
      await repository.commitLocal(bound.key, intent, bound.generation)
      return resultProject(bound, id)
    },
    async exportBackup() {
      const bound = scope(),
        snapshot = await repository.snapshot(bound.key)
      try {
        const backup: Backup = {
          format: 'loopmark',
          version: 1,
          exportedAt: new Date().toISOString(),
          projects: await mapBounded(snapshot.view.projects, (p) =>
            expandProject(p, snapshot.view.checkpoints, deps, bound, false, limit),
          ),
        }
        if (utf8Bytes(backup) > MAX_BACKUP_BYTES)
          throw new DomainError('TECHNICAL_CAPACITY_REACHED')
        const validated = parseBackup(JSON.stringify(backup))
        await validateBackupMedia(validated)
        return validated
      } finally {
        await repository.releaseSnapshot(snapshot.id)
      }
    },
    async restoreBackup(backup, expectedRevision) {
      const bound = scope(),
        view = await repository.readView(bound.key)
      if (expectedRevision !== undefined && view.revision !== expectedRevision)
        throw new DomainError('REVISION_CONFLICT')
      const candidate = await normalizeBackup(backup, deps, bound)
      await repository.importLocal(candidate, {
        generation: bound.generation,
        replace: { key: bound.key, revision: view.revision },
      })
    },
    async seedSamples(backup) {
      const bound = scope(),
        view = await repository.readView(bound.key)
      if (view.projects.length) return
      const candidate = await normalizeBackup(backup, deps, bound)
      await repository.importLocal(candidate, {
        generation: bound.generation,
        replace: { key: bound.key, revision: view.revision },
      })
    },
    subscribe: (listener) => repository.subscribe(listener),
  }
}
