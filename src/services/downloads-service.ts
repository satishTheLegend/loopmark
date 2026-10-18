import type { SessionScope } from '../domain/contracts'
import type { Repository, DownloadRemoval } from '../repositories/contracts'
import type { PlatformMedia } from '../platform/contracts'
import type { RemoteMediaService } from './media-service'
import { canonicalJson } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import { mediaRefs } from '../repositories/state'
import { mapBounded } from './concurrency'

export interface ProjectOfflineAvailability {
  scope: SessionScope
  projectId: string
  revision: string
  state: 'available' | 'partial' | 'unavailable'
  total: number
  available: number
  missing: number
}
export interface DownloadsService {
  inspect(projectId: string): Promise<ProjectOfflineAvailability>
  download(projectId: string, signal?: AbortSignal): Promise<ProjectOfflineAvailability>
  remove(projectId: string): Promise<ProjectOfflineAvailability & DownloadRemoval>
}
export function createDownloadsService(options: {
  repository: Repository
  media: PlatformMedia
  scope: () => SessionScope
  remote?: RemoteMediaService
  mediaConcurrency?: number
}): DownloadsService {
  const { repository, media } = options
  const scope = () => structuredClone(options.scope())
  const check = async (bound: SessionScope) => {
    if (canonicalJson(await repository.readActive()) !== canonicalJson(bound))
      throw new DomainError('ACCOUNT_CHANGED')
  }
  async function read(bound: SessionScope, projectId: string) {
    await check(bound)
    const view = await repository.readView(bound.key)
    if (!view.projects.some((p) => p.id === projectId)) throw new DomainError('NOT_AVAILABLE')
    return { view, refs: mediaRefs(view.checkpoints.filter((c) => c.projectId === projectId)) }
  }
  async function inspect(
    bound: SessionScope,
    projectId: string,
  ): Promise<ProjectOfflineAvailability> {
    const { view, refs } = await read(bound, projectId)
    const found = await mapBounded(
      refs,
      async (ref) => {
        try {
          // Both adapters verify actual length/hash before opening, including after a process restart.
          await (await media.open(ref, bound.key)).cancel()
          return true
        } catch (error) {
          if (
            error instanceof DomainError &&
            ['BACKUP_INCOMPLETE', 'MEDIA_INVALID'].includes(error.detail.code)
          )
            return false
          throw error
        }
      },
      options.mediaConcurrency ?? 2,
    )
    await check(bound)
    if ((await repository.readView(bound.key)).revision !== view.revision)
      throw new DomainError('REVISION_CONFLICT')
    const available = found.filter(Boolean).length
    return {
      scope: bound,
      projectId,
      revision: view.revision,
      state: available === refs.length ? 'available' : available ? 'partial' : 'unavailable',
      total: refs.length,
      available,
      missing: refs.length - available,
    }
  }
  return {
    inspect: (projectId) => inspect(scope(), projectId),
    async download(projectId, signal = new AbortController().signal) {
      const bound = scope(),
        { view, refs } = await read(bound, projectId)
      signal.throwIfAborted()
      if (!options.remote || view.info.kind !== 'connected') {
        const result = await inspect(bound, projectId)
        if (result.missing) throw new DomainError('BACKUP_INCOMPLETE')
        return result
      }
      await mapBounded(
        refs,
        async (ref) => {
          signal.throwIfAborted()
          await check(bound)
          await options.remote!.ensureAvailable(ref, bound, signal)
        },
        options.mediaConcurrency ?? 2,
      )
      signal.throwIfAborted()
      return inspect(bound, projectId)
    },
    async remove(projectId) {
      const bound = scope()
      const result = await repository.removeDownloads(bound, projectId)
      return { ...(await inspect(bound, projectId)), ...result }
    },
  }
}
