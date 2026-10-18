import { parseBackup } from '../data'
import { validateBackupMedia } from '../media-validation'
import { DomainError } from '../domain/errors'

/** Emergency read-only export of the old projects store, independent of drafts and v2 writes. */
export async function readLegacyBackup(factory: IDBFactory = indexedDB) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('loopmark')
    let absent = false,
      abandoned = false
    request.onupgradeneeded = () => {
      absent = true
      request.transaction!.abort()
    }
    request.onerror = () =>
      reject(new DomainError(absent ? 'NOT_AVAILABLE' : 'LOCAL_STORAGE_FAILED'))
    request.onblocked = () => {
      abandoned = true
      reject(new DomainError('LOCAL_STORAGE_FAILED'))
    }
    request.onsuccess = () => {
      if (abandoned) request.result.close()
      else resolve(request.result)
    }
  })
  try {
    if (
      (database.version > 2 && !database.objectStoreNames.contains('loopmark_migration_fence')) ||
      !database.objectStoreNames.contains('projects')
    )
      throw new DomainError('BACKUP_INVALID')
    const projects = await new Promise<unknown[]>((resolve, reject) => {
      const tx = database.transaction('projects', 'readonly'),
        request = tx.objectStore('projects').getAll()
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = tx.onerror = () => reject(new DomainError('LOCAL_STORAGE_FAILED'))
    })
    const backup = parseBackup(
      JSON.stringify({
        format: 'loopmark',
        version: 1,
        exportedAt: new Date().toISOString(),
        projects,
      }),
    )
    await validateBackupMedia(backup)
    return backup
  } finally {
    database.close()
  }
}
