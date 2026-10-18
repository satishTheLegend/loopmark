import { id } from '../domain/schema'
import { DomainError } from '../domain/errors'
import type { SessionScope, ProjectRecord } from '../domain/contracts'
import type { Repository } from '../repositories/contracts'
import { canonicalJson } from '../domain/canonical-json'
export interface ProjectLink {
  kind: 'project' | 'legacy'
  projectId: string
}
/** Only an owned origin and this small grammar can enter the application; never an arbitrary next URL. */
export function parseProjectLink(value: string, appOrigin: string): ProjectLink {
  let url: URL, allowed: URL
  try {
    url = new URL(value)
    allowed = new URL(appOrigin)
  } catch {
    throw new DomainError('NOT_AVAILABLE')
  }
  if (url.origin !== allowed.origin || url.username || url.password || url.search)
    throw new DomainError('NOT_AVAILABLE')
  let projectId: string, kind: ProjectLink['kind']
  try {
    if (url.pathname === '/' && url.hash.startsWith('#project=')) {
      projectId = decodeURIComponent(url.hash.slice(9))
      kind = 'legacy'
    } else if (!url.hash && /^\/p\/[^/]+$/.test(url.pathname)) {
      projectId = decodeURIComponent(url.pathname.slice(3))
      kind = 'project'
    } else throw new Error()
  } catch {
    throw new DomainError('NOT_AVAILABLE')
  }
  if (!id.safeParse(projectId).success) throw new DomainError('NOT_AVAILABLE')
  return { kind, projectId }
}
export function projectLink(projectId: string, appOrigin: string): string {
  if (!id.safeParse(projectId).success) throw new DomainError('VALIDATION')
  const origin = new URL(appOrigin)
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !['https:', 'http:'].includes(origin.protocol)
  )
    throw new DomainError('VALIDATION')
  return `${origin.origin}/p/${encodeURIComponent(projectId)}`
}
export async function resolveProjectLink(options: {
  target: ProjectLink
  scope: SessionScope
  accountId: string | null
  repository: Repository
  hydrate?: (signal: AbortSignal) => Promise<void>
  signal: AbortSignal
}): Promise<ProjectRecord> {
  const { repository, scope, signal, target } = options
  if (!id.safeParse(target.projectId).success) throw new DomainError('NOT_AVAILABLE')
  const check = async () => {
    signal.throwIfAborted()
    if (canonicalJson(await repository.readActive()) !== canonicalJson(scope))
      throw new DomainError('ACCOUNT_CHANGED')
  }
  await check()
  let view = await repository.readView(scope.key)
  if (view.info.kind === 'connected' && view.info.accountId !== options.accountId)
    throw new DomainError('NOT_AVAILABLE')
  let project = view.projects.find((p) => p.id === target.projectId)
  if (!project && view.info.kind === 'connected' && options.hydrate) {
    await options.hydrate(signal)
    await check()
    view = await repository.readView(scope.key)
    project = view.projects.find((p) => p.id === target.projectId)
  }
  await check()
  if (!project) throw new DomainError('NOT_AVAILABLE')
  return project
}
