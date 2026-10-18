import type { CollectionKey, MediaRef } from '../../domain/contracts'
import { DomainError } from '../../domain/errors'
import { canonicalJson } from '../../domain/canonical-json'
import { id } from '../../domain/schema'
import { NativeDatabase } from './database'
import { assertGeneration, scopeKey } from './recovery-journal'

export interface NativeDraft {
  id: string
  scope: CollectionKey
  revision: string
  value: unknown
  media: MediaRef[]
  updatedAt: string
}
/** Draft payload + attachment pins commit together. Drafts never enter saved-work snapshots. */
export class NativeDraftStore {
  constructor(private database: NativeDatabase) {}
  private key(draftId: string, scope: CollectionKey) {
    if (!id.safeParse(draftId).success) throw new DomainError('VALIDATION')
    return `draft:${scopeKey(scope)}:${draftId}`
  }
  async read(draftId: string, scope: CollectionKey): Promise<NativeDraft | null> {
    return this.database.serial(async (db) => {
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
        revision: crypto.randomUUID(),
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
    expectedRevision: string,
  ): Promise<void> {
    const key = this.key(draftId, scope)
    await this.database.transaction(async (db) => {
      await assertGeneration(db, scope, generation, true)
      const row = (await db.query('SELECT body FROM metadata WHERE key=?', [key])).values?.[0]
      if (!row) return
      if ((JSON.parse(row.body as string) as NativeDraft).revision !== expectedRevision)
        throw new DomainError('REVISION_CONFLICT')
      await db.run('DELETE FROM metadata WHERE key=?', [key], false)
      await db.run(
        'DELETE FROM pins WHERE owner=? AND scope=?',
        [`draft:${draftId}`, scopeKey(scope)],
        false,
      )
    })
  }
}
