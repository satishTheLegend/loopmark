import type { CollectionKey, MediaRef, SessionScope } from '../../domain/contracts'
import type { DraftRecord } from '../../repositories/drafts'
import { createPortableDraftStore } from '../../services/portable-draft-store'
import type { NativeRepository } from './repository'
import { DomainError } from '../../domain/errors'
import { canonicalJson } from '../../domain/canonical-json'
import { id } from '../../domain/schema'
import { NativeDatabase } from './database'
import { assertGeneration, scopeKey } from './recovery-journal'

export interface NativeDraft {
  id: string
  scope: CollectionKey
  revision: string
  baseRevision?: string
  value: unknown
  media: MediaRef[]
  updatedAt: string
}
/** Draft payload + attachment pins commit together. Drafts never enter saved-work snapshots. */
export class NativeDraftStore {
  constructor(private database: NativeDatabase) {}
  private key(draftId: string, scope: CollectionKey) {
    if (!draftId || draftId.length > 100 || draftId.includes('\0'))
      throw new DomainError('VALIDATION')
    return `draft:${scopeKey(scope)}:${draftId}`
  }
  async read(
    draftId: string,
    scope: CollectionKey,
    generation?: number,
  ): Promise<NativeDraft | null> {
    return this.database.serial(async (db) => {
      if (generation !== undefined) await assertGeneration(db, scope, generation, true)
      const row = (
        await db.query('SELECT body FROM metadata WHERE key=?', [this.key(draftId, scope)])
      ).values?.[0]
      return row ? (JSON.parse(row.body as string) as NativeDraft) : null
    })
  }
  async save(
    draftId: string,
    scope: CollectionKey,
    generation: number,
    value: unknown,
    media: MediaRef[],
    expectedRevision: string | null,
    identity?: Pick<DraftRecord<unknown>, 'revision' | 'baseRevision'>,
  ): Promise<NativeDraft> {
    const key = this.key(draftId, scope)
    const body = canonicalJson(value)
    if (new TextEncoder().encode(body).length > 262144) throw new DomainError('VALIDATION')
    return this.database.transaction(async (db) => {
      await assertGeneration(db, scope, generation, true)
      const row = (await db.query('SELECT body FROM metadata WHERE key=?', [key])).values?.[0]
      const current = row ? (JSON.parse(row.body as string) as NativeDraft) : null
      if ((current?.revision ?? null) !== expectedRevision)
        throw new DomainError('REVISION_CONFLICT')
      for (const ref of media) {
        const found = (
          await db.query('SELECT body FROM media WHERE scope=? AND id=?', [scopeKey(scope), ref.id])
        ).values?.[0]
        if (!found || canonicalJson(JSON.parse(found.body as string)) !== canonicalJson(ref))
          throw new DomainError('MEDIA_INVALID')
      }
      const draft = {
        id: draftId,
        scope,
        revision: identity?.revision ?? crypto.randomUUID(),
        ...(identity?.baseRevision === undefined ? {} : { baseRevision: identity.baseRevision }),
        value: JSON.parse(body) as unknown,
        media,
        updatedAt: new Date().toISOString(),
      }
      await db.run(
        'INSERT OR REPLACE INTO metadata(key,body) VALUES(?,?)',
        [key, JSON.stringify(draft)],
        false,
      )
      await db.run(
        'DELETE FROM pins WHERE owner=? AND scope=?',
        [`draft:${draftId}`, scopeKey(scope)],
        false,
      )
      for (const ref of media)
        await db.run(
          'INSERT INTO pins(owner,scope,media_id) VALUES(?,?,?)',
          [`draft:${draftId}`, scopeKey(scope), ref.id],
          false,
        )
      return draft
    })
  }
  async clear(
    draftId: string,
    scope: CollectionKey,
    generation: number,
    expectedRevision: string | undefined,
  ): Promise<void> {
    const key = this.key(draftId, scope)
    await this.database.transaction(async (db) => {
      await assertGeneration(db, scope, generation, true)
      const row = (await db.query('SELECT body FROM metadata WHERE key=?', [key])).values?.[0]
      if (
        (row ? (JSON.parse(row.body as string) as NativeDraft).revision : undefined) !==
        expectedRevision
      )
        throw new DomainError('REVISION_CONFLICT')
      await db.run('DELETE FROM metadata WHERE key=?', [key], false)
      await db.run(
        'DELETE FROM pins WHERE owner=? AND scope=?',
        [`draft:${draftId}`, scopeKey(scope)],
        false,
      )
    })
  }
  async removeProjectDrafts(projectId: string, scope: CollectionKey, generation: number) {
    if (!id.safeParse(projectId).success) throw new DomainError('VALIDATION')
    await this.database.transaction(async (db) => {
      await assertGeneration(db, scope, generation, true)
      for (const draftId of [`edit:${projectId}`, `checkpoint:${projectId}`]) {
        await db.run('DELETE FROM metadata WHERE key=?', [this.key(draftId, scope)], false)
        await db.run(
          'DELETE FROM pins WHERE owner=? AND scope=?',
          [`draft:${draftId}`, scopeKey(scope)],
          false,
        )
      }
    })
  }
}

/** Permanently bound to the form's opening scope; inline media is never stored in SQLite metadata. */
export function createNativeDraftStore(repository: NativeRepository, scope: SessionScope) {
  const bound = structuredClone(scope)
  return createPortableDraftStore(
    {
      async read<T>(key: string) {
        const draft = await repository.drafts.read(key, bound.key, bound.generation)
        return draft
          ? {
              key,
              value: draft.value as T,
              revision: draft.revision,
              ...(draft.baseRevision === undefined ? {} : { baseRevision: draft.baseRevision }),
            }
          : undefined
      },
      async write<T>(
        key: string,
        previous: string | undefined,
        draft: DraftRecord<T> | undefined,
        refs: MediaRef[],
      ) {
        if (!draft) {
          await repository.drafts.clear(key, bound.key, bound.generation, previous)
          return
        }
        if (draft.key !== key || !draft.revision) throw new DomainError('VALIDATION')
        await repository.drafts.save(
          key,
          bound.key,
          bound.generation,
          draft.value,
          refs,
          previous ?? null,
          draft,
        )
      },
      removeProjectDrafts: (id) =>
        repository.drafts.removeProjectDrafts(id, bound.key, bound.generation),
    },
    repository.media,
    bound,
  )
}
