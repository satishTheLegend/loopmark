import type { Backup, CollectionKey, SessionScope } from '../domain/contracts'
import type { Repository } from '../repositories/contracts'
import type { PlatformMedia } from '../platform/contracts'
import type { DataAdapter } from '../data'
import { parseBackup } from '../data'
import { validateBackupMedia } from '../media-validation'
import { canonicalHash, canonicalJson } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import { keyOf, mediaRefs } from '../repositories/state'
import { prepareBackupRecords } from './local-data-service'
export function createBackupService(options: {
  repository: Repository
  media: PlatformMedia
  data: DataAdapter
  scope: () => SessionScope
}) {
  return {
    exportComplete: () => options.data.exportBackup(),
    async restoreAsRecovered(
      backup: Backup,
      name: string,
      operationToken: string,
    ): Promise<CollectionKey> {
      const source = structuredClone(options.scope())
      if (!name.trim() || name.length > 100 || !operationToken) throw new DomainError('VALIDATION')
      const validated = parseBackup(JSON.stringify(backup))
      await validateBackupMedia(validated)
      const hash = await canonicalHash({ source: source.key, backup: validated, operationToken }),
        key: CollectionKey = {
          namespace: `guest_restore_${hash.slice(0, 40)}`,
          collectionId: `restore_${hash.slice(0, 40)}`,
          epoch: 'initial',
        }
      if (canonicalJson(await options.repository.readActive()) !== canonicalJson(source))
        throw new DomainError('ACCOUNT_CHANGED')
      if ((await options.repository.listCollections()).some((c) => keyOf(c.key) === keyOf(key)))
        return key
      const prepared = await prepareBackupRecords(validated, options.media, source)
      await options.repository.importLocal(
        {
          info: {
            key,
            name: name.trim(),
            kind: 'recovered',
            accountId: null,
            createdAt: new Date().toISOString(),
            legacyAccess: false,
          },
          ...prepared,
        },
        { generation: source.generation, mediaSource: source.key },
      )
      // The new candidate owns its copies; discard only unreferenced staging bytes in the old scope.
      for (const ref of mediaRefs(prepared.checkpoints))
        await options.media.release(ref, source.key, source.generation).catch(() => {})
      return key
    },
  }
}
