import type { DraftRecord, DraftStore } from '../repositories/drafts'
import type { MediaRef, SessionScope } from '../domain/contracts'
import type { PlatformMedia } from '../platform/contracts'
import { mediaRefSchema } from '../domain/schema'
import { DomainError } from '../domain/errors'
import { inlineMedia, storeInline } from './media-codec'
/** Scope-bound metadata and reference updates must commit atomically in the underlying adapter. */
export interface ReferencedDraftStore {
  read<T>(key: string): Promise<DraftRecord<T> | undefined>
  write<T>(
    key: string,
    previous: string | undefined,
    draft: DraftRecord<T> | undefined,
    media: MediaRef[],
  ): Promise<void>
  removeProjectDrafts(projectId: string): Promise<void>
}
export function createPortableDraftStore(
  storage: ReferencedDraftStore,
  media: PlatformMedia,
  scope: SessionScope,
): DraftStore {
  const bound = structuredClone(scope)
  return {
    async read<T>(key: string) {
      const draft = await storage.read<unknown>(key)
      if (!draft) return undefined
      const value = draft.value
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        return draft as DraftRecord<T>
      const restored = { ...value } as Record<string, unknown>
      for (const kind of ['photo', 'voice'] as const)
        if (restored[kind] !== undefined) {
          const result = mediaRefSchema.safeParse(restored[kind])
          if (!result.success || result.data.kind !== kind) throw new DomainError('MEDIA_INVALID')
          restored[kind] = await inlineMedia(result.data, media, bound)
        }
      return { ...draft, value: restored } as DraftRecord<T>
    },
    async write<T>(key: string, previous: string | undefined, draft?: DraftRecord<T>) {
      if (!draft) {
        await storage.write(key, previous, undefined, [])
        return
      }
      const value = draft.value
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        await storage.write(key, previous, draft, [])
        return
      }
      const normalized = { ...value } as Record<string, unknown>,
        refs: MediaRef[] = []
      for (const kind of ['photo', 'voice'] as const) {
        if (normalized[kind] !== undefined) {
          if (typeof normalized[kind] !== 'string') throw new DomainError('MEDIA_INVALID')
          const ref = await storeInline(normalized[kind] as string, kind, media, bound)
          normalized[kind] = ref
          refs.push(ref)
        } else delete normalized[kind]
      }
      await storage.write(key, previous, { ...draft, value: normalized }, refs)
    },
    removeProjectDrafts: (projectId) => storage.removeProjectDrafts(projectId),
  }
}
