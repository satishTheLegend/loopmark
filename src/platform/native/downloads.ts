import type { SessionScope } from '../../domain/contracts'
import { canonicalJson } from '../../domain/canonical-json'
import { DomainError } from '../../domain/errors'
import { id } from '../../domain/schema'
import { candidateBlocksRebase } from '../../repositories/rebase'
import { removableDownloads, workflowDownloadPins } from '../../repositories/downloads'
import type { StoredCollection } from '../../repositories/state'
import type { NativeDatabase } from './database'
import { activeScope, scopeKey } from './recovery-journal'
import { durableFiles } from './files-bridge'

/** Retire only verified remote cache. A durable cleanup journal makes a failed file deletion retryable. */
export async function removeNativeDownloads(
  database: NativeDatabase,
  scope: SessionScope,
  projectId: string,
  removeFile: (key: string) => Promise<void> = (key) => durableFiles.remove({ key }),
) {
  if (!id.safeParse(projectId).success) throw new DomainError('VALIDATION')
  scope = structuredClone(scope)
  return database.serial(async (db) => {
    await db.beginTransaction()
    let result: { removed: number; retained: number }
    let cleanup: { key: string; fileKey: string }[]
    try {
      if (canonicalJson(await activeScope(db)) !== canonicalJson(scope))
        throw new DomainError('ACCOUNT_CHANGED')
      const key = scopeKey(scope.key)
      const row = (await db.query('SELECT body FROM collections WHERE key=?', [key])).values?.[0]
      if (!row) throw new DomainError('NOT_AVAILABLE')
      const state = JSON.parse(row.body as string) as StoredCollection
      const rows =
        (await db.query('SELECT id,body,file_key,downloaded FROM media WHERE scope=?', [key]))
          .values ?? []
      const cached = rows.map((row) => ({
        ref: JSON.parse(row.body as string),
        ...(row.downloaded === 1 ? { downloaded: true as const } : {}),
      }))
      const pinned = new Set(
        ((await db.query('SELECT media_id FROM pins WHERE scope=?', [key])).values ?? []).map(
          (row) => String(row.media_id),
        ),
      )
      const metadata = (await db.query('SELECT key,body FROM metadata')).values ?? []
      for (const item of metadata) {
        if (!String(item.key).startsWith('workflow:')) continue
        const workflow = JSON.parse(item.body as string)
        if (candidateBlocksRebase({ value: workflow }, scope.key))
          for (const row of rows) pinned.add(String(row.id))
        if (workflow.collection && scopeKey(workflow.collection) === key)
          for (const ref of workflowDownloadPins(workflow)) pinned.add(ref.id)
      }
      const eligible = removableDownloads(state, projectId, cached, pinned)
      const prefix = `download-eviction:${key}:${projectId}:`
      cleanup = metadata
        .filter((row) => String(row.key).startsWith(prefix))
        .map((row) => ({
          key: String(row.key),
          fileKey: String(JSON.parse(row.body as string).fileKey),
        }))
      if (!eligible.remove.length && !cleanup.length) throw new DomainError('DOWNLOADS_PROTECTED')
      for (const ref of eligible.remove) {
        const saved = rows.find((row) => row.id === ref.id)!
        const fileKey = String(saved.file_key),
          journalKey = `${prefix}${fileKey}`
        await db.run(
          'INSERT INTO metadata(key,body) VALUES(?,?)',
          [journalKey, JSON.stringify({ scope: scope.key, projectId, fileKey, ref })],
          false,
        )
        await db.run('DELETE FROM media WHERE scope=? AND id=?', [key, ref.id], false)
        cleanup.push({ key: journalKey, fileKey })
      }
      result = { removed: cleanup.length, retained: eligible.retained }
      await db.commitTransaction()
    } catch (error) {
      await db.rollbackTransaction().catch(() => undefined)
      throw error
    }
    // The application queue still fences scope changes. SQL rollback never follows physical deletion.
    for (const item of cleanup) {
      if (
        (await db.query('SELECT file_key FROM media WHERE file_key=?', [item.fileKey])).values
          ?.length
      )
        throw new DomainError('INVARIANT_VIOLATION')
      await removeFile(item.fileKey)
      await db.run('DELETE FROM metadata WHERE key=?', [item.key])
    }
    return result
  })
}
