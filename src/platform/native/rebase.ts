import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import type { CollectionKey, MediaRef, SessionScope } from '../../domain/contracts'
import type { LocalCollectionReview, RebaseInput, RebaseResult } from '../../repositories/contracts'
import { DomainError } from '../../domain/errors'
import { canonicalHash, canonicalJson, sha256Bytes } from '../../domain/canonical-json'
import { mediaRefSchema } from '../../domain/schema'
import { candidateBlocksRebase, prepareRebase, rebaseIdentity } from '../../repositories/rebase'
import { mediaRefs, viewOf, type StoredCollection } from '../../repositories/state'
import { verifyMediaBytes } from '../../services/media-codec'
import { decodeBase64Bytes } from '../../media-validation'
import type { NativeDatabase } from './database'
import type { NativeDraft } from './drafts'
import { activeScope, scopeKey } from './recovery-journal'
import { durableFiles } from './files-bridge'

type Metadata = { key: string; body: string }
type MediaRow = { id: string; body: string; file_key: string; prepared_at: number }
type Review = (db: SQLiteDBConnection, key: CollectionKey) => Promise<LocalCollectionReview>
const metadata = async (db: SQLiteDBConnection) =>
  ((await db.query('SELECT key,body FROM metadata ORDER BY key')).values ?? []) as Metadata[]
const cached = async (db: SQLiteDBConnection, key: CollectionKey) =>
  ((
    await db.query('SELECT id,body,file_key,prepared_at FROM media WHERE scope=? ORDER BY id', [
      scopeKey(key),
    ])
  ).values ?? []) as MediaRow[]
const state = async (db: SQLiteDBConnection, key: CollectionKey): Promise<StoredCollection> => {
  const row = (await db.query('SELECT body FROM collections WHERE key=?', [scopeKey(key)]))
    .values?.[0]
  if (!row) throw new DomainError('NOT_AVAILABLE')
  return JSON.parse(row.body as string)
}
const blocks = (rows: Metadata[], key: CollectionKey) =>
  rows.some(
    (row) =>
      row.key.startsWith('workflow:') &&
      candidateBlocksRebase({ value: JSON.parse(row.body) }, key),
  )

export async function nativeRebaseBlocked(database: NativeDatabase, key: CollectionKey) {
  return database.serial(
    async (db) =>
      (await state(db, key)).pending.some((p) => p.intent.kind === 'collection.replace') ||
      blocks(await metadata(db), key),
  )
}

/** Immutable files publish first; the exact reviewed state, archive, drafts and selection commit together. */
export async function completeNativeRebase(
  database: NativeDatabase,
  reviewIn: Review,
  expected: SessionScope,
  review: LocalCollectionReview,
  input: RebaseInput,
): Promise<RebaseResult> {
  expected = structuredClone(expected)
  review = structuredClone(review)
  input = structuredClone(input)
  const fingerprint = await canonicalHash(rebaseIdentity(expected, review, input))
  const receiptKey = JSON.stringify(['rebase-complete', input.recoveryId])
  return database.serial(async (db) => {
    const receipt = (await db.query('SELECT body FROM metadata WHERE key=?', [receiptKey]))
      .values?.[0]
    if (receipt) {
      const previous = JSON.parse(receipt.body as string)
      if (previous.fingerprint !== fingerprint) throw new DomainError('OPERATION_REUSED')
      if (canonicalJson(await activeScope(db)) !== canonicalJson(previous.value.scope))
        throw new DomainError('ACCOUNT_CHANGED')
      return previous.value as RebaseResult
    }
    const fence = async () => {
      if (canonicalJson(await activeScope(db)) !== canonicalJson(expected))
        throw new DomainError('ACCOUNT_CHANGED')
      if (canonicalJson(await reviewIn(db, expected.key)) !== canonicalJson(review))
        throw new DomainError('REVISION_CONFLICT')
    }
    await fence()
    const source = await state(db, expected.key),
      prepared = prepareRebase(source, expected, review, input, Date.now())
    const rows = await cached(db, expected.key),
      before = await metadata(db)
    if (blocks(before, expected.key)) throw new DomainError('SYNC_REBASE_REQUIRED')
    const prefix = `draft:${scopeKey(expected.key)}:`
    const drafts = before
      .filter((row) => row.key.startsWith(prefix))
      .map((row) => JSON.parse(row.body) as NativeDraft)
    const required = new Map<string, MediaRef>(),
      draftIds = new Set<string>()
    for (const ref of [
      ...mediaRefs(viewOf(source).checkpoints),
      ...drafts.flatMap((d) => d.media),
    ]) {
      const prior = required.get(ref.id)
      if (prior && canonicalJson(prior) !== canonicalJson(ref))
        throw new DomainError('MEDIA_INVALID')
      required.set(ref.id, ref)
    }
    for (const draft of drafts) for (const ref of draft.media) draftIds.add(ref.id)
    for (const ref of required.values())
      if (!rows.some((row) => row.id === ref.id)) {
        if (!input.allowMissingMedia || draftIds.has(ref.id))
          throw new DomainError('BACKUP_INCOMPLETE')
      }
    const files: { scope: CollectionKey; ref: MediaRef; fileKey: string }[] = []
    const available = new Set((await durableFiles.list()).files.map((file) => file.key))
    const nextRefs = new Map(mediaRefs(prepared.next.checkpoints).map((ref) => [ref.id, ref]))
    const oldKey = scopeKey(expected.key),
      recoveredKey = scopeKey(prepared.result.recovered),
      nextKey = scopeKey(prepared.result.scope.key)
    const archiveRefs: MediaRef[] = []
    for (const row of rows) {
      const parsed = mediaRefSchema.safeParse(JSON.parse(row.body))
      if (!parsed.success || parsed.data.id !== row.id) throw new DomainError('MEDIA_INVALID')
      const ref = parsed.data,
        needed = required.get(ref.id)
      if (needed && canonicalJson(needed) !== canonicalJson(ref))
        throw new DomainError('MEDIA_INVALID')
      archiveRefs.push(ref)
      let encoded: string
      try {
        if (!available.has(row.file_key)) throw new DomainError('BACKUP_INCOMPLETE')
        encoded = (await durableFiles.read({ key: row.file_key })).base64
        await verifyMediaBytes(ref, new Blob([decodeBase64Bytes(encoded)], { type: ref.mimeType }))
      } catch (error) {
        if (
          error instanceof DomainError &&
          ['BACKUP_INCOMPLETE', 'MEDIA_INVALID'].includes(error.detail.code) &&
          !draftIds.has(ref.id) &&
          (!needed || input.allowMissingMedia)
        )
          continue
        throw error
      }
      const destinations = [prepared.result.recovered]
      if (nextKey !== oldKey && canonicalJson(nextRefs.get(ref.id) ?? null) === canonicalJson(ref))
        destinations.push(prepared.result.scope.key)
      for (const destination of destinations) {
        const fileKey = await canonicalHash({
          scope: destination,
          id: ref.id,
          publication: crypto.randomUUID(),
        })
        await db.run(
          'INSERT INTO prepared_files(file_key,scope,media_id,created_at) VALUES(?,?,?,?)',
          [fileKey, scopeKey(destination), ref.id, Date.now()],
        )
        await durableFiles.put({ key: fileKey, base64: encoded, sha256: ref.sha256 })
        files.push({ scope: destination, ref, fileKey })
      }
    }
    const captureRow = before.find((row) => row.key === 'native-camera-continuation')
    const capture = captureRow ? JSON.parse(captureRow.body) : null
    const movingCapture = capture && scopeKey(capture.source.scope.key) === oldKey
    if (movingCapture && capture.state === 'ready') {
      const raw = decodeBase64Bytes((await durableFiles.read({ key: capture.fileKey })).base64)
      if (raw.length !== capture.bytes || (await sha256Bytes(raw)) !== capture.sha256)
        throw new DomainError('MEDIA_INVALID')
    }
    await db.beginTransaction()
    try {
      await fence()
      if (canonicalJson(await cached(db, expected.key)) !== canonicalJson(rows))
        throw new DomainError('REVISION_CONFLICT')
      const currentMetadata = await metadata(db)
      if (blocks(currentMetadata, expected.key)) throw new DomainError('SYNC_REBASE_REQUIRED')
      if (
        (await db.query('SELECT key FROM collections WHERE key=?', [recoveredKey])).values?.length
      )
        throw new DomainError('REVISION_CONFLICT')
      if (nextKey !== oldKey) {
        const row = (await db.query('SELECT body FROM collections WHERE key=?', [nextKey]))
          .values?.[0]
        if (row) {
          const destination = JSON.parse(row.body as string) as StoredCollection
          if (
            destination.info.accountId !== input.session.accountId ||
            destination.version !== '0' ||
            destination.projects.length ||
            destination.checkpoints.length ||
            destination.pending.length ||
            (await reviewIn(db, input.session.collection)).drafts.length
          )
            throw new DomainError('REVISION_CONFLICT')
        }
      }
      const archived = currentMetadata.filter((row) => {
        if (
          ['operation-plan', 'resolution', 'replacement-complete'].some((kind) =>
            row.key.startsWith(`${kind}:${oldKey}:`),
          )
        )
          return true
        if (!row.key.startsWith('workflow:')) return false
        const workflow = JSON.parse(row.body)
        return (
          workflow.collection &&
          scopeKey(workflow.collection) === oldKey &&
          !['purchase', 'deletion'].includes(workflow.kind)
        )
      })
      for (const file of files) {
        const target = scopeKey(file.scope)
        const prior = (
          await db.query('SELECT body FROM media WHERE scope=? AND id=?', [target, file.ref.id])
        ).values?.[0]
        if (prior && canonicalJson(JSON.parse(prior.body as string)) !== canonicalJson(file.ref))
          throw new DomainError('MEDIA_INVALID')
        await db.run(
          'INSERT INTO media(scope,id,body,file_key,prepared_at) VALUES(?,?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET file_key=excluded.file_key,prepared_at=excluded.prepared_at',
          [target, file.ref.id, JSON.stringify(file.ref), file.fileKey, Date.now()],
          false,
        )
        await db.run('DELETE FROM prepared_files WHERE file_key=?', [file.fileKey], false)
      }
      for (const draft of drafts) {
        await db.run(
          'INSERT INTO metadata(key,body) VALUES(?,?)',
          [
            `draft:${recoveredKey}:${draft.id}`,
            JSON.stringify({ ...draft, scope: prepared.result.recovered }),
          ],
          false,
        )
        await db.run('DELETE FROM metadata WHERE key=?', [`draft:${oldKey}:${draft.id}`], false)
        await db.run(
          'DELETE FROM pins WHERE owner=? AND scope=?',
          [`draft:${draft.id}`, oldKey],
          false,
        )
        for (const ref of draft.media)
          await db.run(
            'INSERT INTO pins(owner,scope,media_id) VALUES(?,?,?)',
            [`draft:${draft.id}`, recoveredKey, ref.id],
            false,
          )
      }
      for (const row of archived) await db.run('DELETE FROM metadata WHERE key=?', [row.key], false)
      await db.run(
        "DELETE FROM pins WHERE scope=? AND owner LIKE 'operation-plan:%'",
        [oldKey],
        false,
      )
      for (const ref of archiveRefs)
        await db.run(
          'INSERT INTO pins(owner,scope,media_id) VALUES(?,?,?)',
          [`rebase-archive:${input.recoveryId}`, recoveredKey, ref.id],
          false,
        )
      await db.run(
        'INSERT INTO metadata(key,body) VALUES(?,?)',
        [
          JSON.stringify(['rebase-archive', input.recoveryId]),
          JSON.stringify({
            scope: prepared.result.recovered,
            media: archiveRefs,
            value: { source, metadata: archived },
          }),
        ],
        false,
      )
      if (movingCapture) {
        capture.source.scope.key = prepared.result.recovered
        await db.run(
          "UPDATE metadata SET body=? WHERE key='native-camera-continuation'",
          [JSON.stringify(capture)],
          false,
        )
      }
      if (nextKey !== oldKey) await db.run('DELETE FROM collections WHERE key=?', [oldKey], false)
      for (const next of [prepared.recovered, prepared.next])
        await db.run(
          'INSERT OR REPLACE INTO collections(key,body) VALUES(?,?)',
          [scopeKey(next.info.key), JSON.stringify(next)],
          false,
        )
      await db.run(
        "UPDATE metadata SET body=? WHERE key='active'",
        [JSON.stringify(prepared.result.scope)],
        false,
      )
      await db.run(
        'INSERT INTO metadata(key,body) VALUES(?,?)',
        [
          receiptKey,
          JSON.stringify({ scope: prepared.result.recovered, fingerprint, value: prepared.result }),
        ],
        false,
      )
      await db.commitTransaction()
      return prepared.result
    } catch (error) {
      await db.rollbackTransaction().catch(() => undefined)
      throw error
    }
  })
}
