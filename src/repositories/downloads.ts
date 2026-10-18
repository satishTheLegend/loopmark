/** Shared eligibility policy; adapters gather pins and delete bytes in the same transaction. */
import type { MediaRef } from '../domain/contracts'
import { canonicalJson } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import { mediaRefs, viewOf, type StoredCollection } from './state'
import { mediaRefSchema } from '../domain/schema'

export function workflowDownloadPins(value: unknown): MediaRef[] {
  const entry = value as
    | {
        kind?: string
        value?: {
          state?: string
          verified?: boolean
          ref?: unknown
          reservation?: { media?: unknown }
        }
      }
    | undefined
  if (entry?.kind !== 'upload' || !entry.value) return []
  const work = entry.value
  if (['complete', 'cancelled'].includes(work.state ?? '') || work.verified === true) return []
  return [work.ref, work.reservation?.media].flatMap((candidate) => {
    const result = mediaRefSchema.safeParse(candidate)
    return result.success ? [result.data] : []
  })
}

export function removableDownloads(
  state: StoredCollection,
  projectId: string,
  cached: Array<{ ref: MediaRef; downloaded?: true }>,
  pinned: ReadonlySet<string>,
): { remove: MediaRef[]; retained: number } {
  if (state.info.kind !== 'connected') throw new DomainError('DOWNLOADS_PROTECTED')
  const view = viewOf(state)
  if (!view.projects.some((p) => p.id === projectId)) throw new DomainError('NOT_AVAILABLE')
  const wanted = mediaRefs(view.checkpoints.filter((c) => c.projectId === projectId))
  const shadow = new Map(mediaRefs(state.checkpoints).map((ref) => [ref.id, ref]))
  const pendingProjects = new Set<string>()
  let replacing = false
  for (const { command } of state.pending) {
    if (command.kind === 'collection.replace') replacing = true
    else if (command.kind === 'project.create') pendingProjects.add(command.payload.project.id)
    else if (command.kind === 'checkpoint.create')
      pendingProjects.add(command.payload.checkpoint.projectId)
    else pendingProjects.add(command.payload.projectId)
  }
  const pendingMedia = new Set(
    mediaRefs(
      [...state.checkpoints, ...view.checkpoints].filter((c) => pendingProjects.has(c.projectId)),
    ).map((ref) => ref.id),
  )
  const remove = wanted.filter((ref) => {
    const row = cached.find((item) => item.ref.id === ref.id)
    return (
      row?.downloaded === true &&
      canonicalJson(row.ref) === canonicalJson(ref) &&
      canonicalJson(shadow.get(ref.id) ?? null) === canonicalJson(ref) &&
      !replacing &&
      !pendingMedia.has(ref.id) &&
      !pinned.has(ref.id)
    )
  })
  return {
    remove,
    retained:
      wanted.filter((ref) => cached.some((row) => row.ref.id === ref.id)).length - remove.length,
  }
}
