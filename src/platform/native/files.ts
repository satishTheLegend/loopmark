import type { CollectionKey, Generation, MediaRef } from '../../domain/contracts'
import type { MediaInput, PlatformMedia, PreparedMedia } from '../contracts'
import { canonicalHash } from '../../domain/canonical-json'
import { mediaRefSchema } from '../../domain/schema'
import { DomainError } from '../../domain/errors'
import { validMedia } from '../../media-validation'
import { readFile } from '../../media'
import { durableFiles } from './files-bridge'
import { NativeDatabase } from './database'
import { assertGeneration, referenced, scopeKey, activeScope } from './recovery-journal'

const digest = async (bytes: Blob) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', await bytes.arrayBuffer())),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
const sameRef = (a: MediaRef, b: MediaRef) =>
  a.id === b.id &&
  a.sha256 === b.sha256 &&
  a.bytes === b.bytes &&
  a.kind === b.kind &&
  a.mimeType === b.mimeType

export class NativeMedia implements PlatformMedia {
  constructor(readonly database: NativeDatabase) {}
  async prepare(
    input: MediaInput,
    scope: CollectionKey,
    generation: Generation,
  ): Promise<PreparedMedia> {
    const ref = mediaRefSchema.parse({
      id: crypto.randomUUID(),
      kind: input.kind,
      mimeType: input.bytes.type,
      bytes: input.bytes.size,
      sha256: await digest(input.bytes),
    })
    await this.storeVerified(ref, input.bytes, scope, generation)
    return { ref, scope, preparedAt: new Date().toISOString() }
  }
  async storeVerified(
    ref: MediaRef,
    bytes: Blob,
    scope: CollectionKey,
    generation: Generation,
  ): Promise<void> {
    mediaRefSchema.parse(ref)
    if (
      bytes.size !== ref.bytes ||
      bytes.type !== ref.mimeType ||
      (await digest(bytes)) !== ref.sha256
    )
      throw new DomainError('VALIDATION')
    const dataUrl = await readFile(bytes)
    if (!validMedia(dataUrl, ref.kind)) throw new DomainError('VALIDATION')
    if (ref.kind === 'photo') await this.decodePhoto(bytes)
    const scopeId = scopeKey(scope)
    const fileKey = await canonicalHash({ scope, id: ref.id })
    await this.database.transaction(async (db) => {
      await assertGeneration(db, scope, generation)
      const existing = (
        await db.query('SELECT body FROM media WHERE scope=? AND id=?', [scopeId, ref.id])
      ).values?.[0]
      if (existing && !sameRef(JSON.parse(existing.body as string) as MediaRef, ref))
        throw new DomainError('VALIDATION')
      await db.run(
        'INSERT OR IGNORE INTO prepared_files(file_key,scope,media_id,created_at) VALUES(?,?,?,?)',
        [fileKey, scopeId, ref.id, Date.now()],
        false,
      )
    })
    // Native flush/close/same-volume publication occurs before any visible record can reference it.
    await durableFiles.put({
      key: fileKey,
      base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      sha256: ref.sha256,
    })
    await this.database.transaction(async (db) => {
      await assertGeneration(db, scope, generation)
      const existing = (
        await db.query('SELECT body FROM media WHERE scope=? AND id=?', [scopeId, ref.id])
      ).values?.[0]
      if (existing && !sameRef(JSON.parse(existing.body as string) as MediaRef, ref))
        throw new DomainError('VALIDATION')
      await db.run(
        'INSERT OR IGNORE INTO media(scope,id,body,file_key,prepared_at) VALUES(?,?,?,?,?)',
        [scopeId, ref.id, JSON.stringify(ref), fileKey, Date.now()],
        false,
      )
      await db.run('DELETE FROM prepared_files WHERE file_key=?', [fileKey], false)
    })
  }
  async open(ref: MediaRef, scope: CollectionKey): Promise<ReadableStream<Uint8Array>> {
    mediaRefSchema.parse(ref)
    // Hold the database queue while reading so destructive cleanup cannot race an open.
    return this.database.serial(async (db) => {
      const active = await activeScope(db)
      if (!active) throw new DomainError('ACCOUNT_CHANGED')
      const collection = (
        await db.query('SELECT key FROM collections WHERE key=?', [scopeKey(scope)])
      ).values?.length
      if (collection) await assertGeneration(db, scope, active.generation)
      else {
        const pin = (
          await db.query(
            "SELECT owner FROM pins WHERE scope=? AND media_id=? AND owner LIKE 'snapshot:%'",
            [scopeKey(scope), ref.id],
          )
        ).values?.length
        if (!pin) throw new DomainError('NOT_AVAILABLE')
        if (scope.namespace.startsWith('account_') && active.key.namespace !== scope.namespace)
          throw new DomainError('ACCOUNT_CHANGED')
      }
      const record = (
        await db.query('SELECT body,file_key FROM media WHERE scope=? AND id=?', [
          scopeKey(scope),
          ref.id,
        ])
      ).values?.[0]
      if (!record || !sameRef(JSON.parse(record.body as string) as MediaRef, ref))
        throw new DomainError('NOT_AVAILABLE')
      const result = await durableFiles.read({ key: record.file_key as string })
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: ref.mimeType })
      if (blob.size !== ref.bytes || (await digest(blob)) !== ref.sha256)
        throw new DomainError('VALIDATION')
      return blob.stream()
    })
  }
  async release(ref: MediaRef, scope: CollectionKey, generation: Generation): Promise<void> {
    const scopeId = scopeKey(scope)
    await this.database.transaction(async (db) => {
      await assertGeneration(db, scope, generation)
      if (await referenced(db, scopeId, ref.id)) return
      const row = (
        await db.query('SELECT file_key,prepared_at FROM media WHERE scope=? AND id=?', [
          scopeId,
          ref.id,
        ])
      ).values?.[0]
      if (!row || Number(row.prepared_at) > Date.now() - 86400000) return
      // Remove metadata first; a failed native remove leaves only an orphan, never a dangling ref.
      await db.run('DELETE FROM media WHERE scope=? AND id=?', [scopeId, ref.id], false)
    })
    await this.reconcile()
  }
  async pin(
    owner: string,
    refs: MediaRef[],
    scope: CollectionKey,
    generation: Generation,
  ): Promise<void> {
    if (!/^(draft|snapshot):[A-Za-z0-9_-]{1,80}$/.test(owner)) throw new DomainError('VALIDATION')
    await this.database.transaction(async (db) => {
      await assertGeneration(db, scope, generation)
      for (const ref of refs) {
        const row = (
          await db.query('SELECT body FROM media WHERE scope=? AND id=?', [scopeKey(scope), ref.id])
        ).values?.[0]
        if (!row || !sameRef(JSON.parse(row.body as string) as MediaRef, ref))
          throw new DomainError('NOT_AVAILABLE')
        await db.run(
          'INSERT OR IGNORE INTO pins(owner,scope,media_id) VALUES(?,?,?)',
          [owner, scopeKey(scope), ref.id],
          false,
        )
      }
    })
  }
  async unpin(owner: string): Promise<void> {
    await this.database.transaction(async (db) => {
      await db.run('DELETE FROM pins WHERE owner=?', [owner], false)
    })
  }
  async reconcile(): Promise<void> {
    await this.database.serial(async (db) => {
      const cutoff = Date.now() - 86400000
      for (const row of (await db.query('SELECT scope,id,file_key,prepared_at FROM media'))
        .values ?? []) {
        if (
          Number(row.prepared_at) < cutoff &&
          !(await referenced(db, row.scope as string, row.id as string))
        ) {
          await db.run('DELETE FROM media WHERE scope=? AND id=?', [row.scope, row.id])
        }
      }
      const captureRow = (
        await db.query("SELECT body FROM metadata WHERE key='native-camera-continuation'")
      ).values?.[0]
      const captureFile = captureRow
        ? (JSON.parse(captureRow.body as string) as { fileKey?: string }).fileKey
        : undefined
      for (const file of (await durableFiles.list()).files) {
        if (!/^[a-f0-9]{64}$/.test(file.key) || file.modifiedAt >= cutoff) continue
        if (file.key === captureFile) continue
        const live = (await db.query('SELECT file_key FROM media WHERE file_key=?', [file.key]))
          .values?.length
        const journal = (
          await db.query('SELECT created_at FROM prepared_files WHERE file_key=?', [file.key])
        ).values?.[0]
        if (!live && (!journal || Number(journal.created_at) < cutoff)) {
          await durableFiles.remove({ key: file.key })
          await db.run('DELETE FROM prepared_files WHERE file_key=?', [file.key])
        }
      }
      await durableFiles.sweepTemporary()
    })
  }
  private async decodePhoto(blob: Blob) {
    const url = URL.createObjectURL(blob)
    try {
      await new Promise<void>((resolve, reject) => {
        const image = new Image()
        const timer = setTimeout(() => done(false), 10000)
        function done(ok: boolean) {
          clearTimeout(timer)
          image.onload = image.onerror = null
          image.src = ''
          ok ? resolve() : reject(new DomainError('VALIDATION'))
        }
        image.onload = () => done(image.naturalWidth > 0 && image.naturalHeight > 0)
        image.onerror = () => done(false)
        image.src = url
      })
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}
