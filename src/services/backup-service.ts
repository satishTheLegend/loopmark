import type {
  Backup,
  CollectionKey,
  SessionScope,
  AccountSession,
  MediaRef,
} from '../domain/contracts'
import type { Repository } from '../repositories/contracts'
import type { PlatformMedia, SyncTransport } from '../platform/contracts'
import type { DataAdapter } from '../data'
import { parseBackup } from '../data'
import { validateBackupMedia } from '../media-validation'
import { canonicalHash, canonicalJson } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import { keyOf, mediaRefs } from '../repositories/state'
import { prepareBackupRecords, encodeSnapshotBackup } from './local-data-service'
import type { RemoteMediaService } from './media-service'
import { collectSnapshot, releaseSnapshotQuietly } from '../sync/snapshots'
import { mapBounded } from './concurrency'
export function createBackupService(options: {
  repository: Repository
  media: PlatformMedia
  data: DataAdapter
  scope: () => SessionScope
  remote?: {
    media: RemoteMediaService
    transport: SyncTransport
    current: () => AccountSession | null
  }
  mediaConcurrency?: number
}) {
  return {
    async exportComplete(signal = new AbortController().signal): Promise<Backup> {
      const scope = structuredClone(options.scope()),
        local = await options.repository.snapshot(scope.key, { allowMissingMedia: true })
      let remoteId: string | undefined
      let failed = false
      const remote = options.remote,
        owner = local.view.info.accountId
      const owned = () => !!owner && remote?.current()?.accountId === owner
      const check = async () => {
        signal.throwIfAborted()
        if (canonicalJson(await options.repository.readActive()) !== canonicalJson(scope))
          throw new DomainError('ACCOUNT_CHANGED')
      }
      try {
        await check()
        const missing: MediaRef[] = []
        await mapBounded(
          mediaRefs(local.view.checkpoints),
          async (ref) => {
            try {
              await (await options.media.open(ref, scope.key)).cancel()
            } catch (error) {
              if (error instanceof DomainError && error.detail.code === 'BACKUP_INCOMPLETE')
                missing.push(ref)
              else throw error
            }
          },
          options.mediaConcurrency ?? 2,
        )
        if (missing.length) {
          if (!remote || local.view.info.kind !== 'connected' || !owned())
            throw new DomainError('BACKUP_INCOMPLETE')
          const pages = await collectSnapshot(
            remote.transport,
            { collectionId: scope.key.collectionId, epoch: scope.key.epoch, purpose: 'export' },
            signal,
            check,
            owned,
          )
          remoteId = pages[0].snapshotId
          const inventory = new Map(pages.flatMap((page) => page.media).map((ref) => [ref.id, ref]))
          if (
            missing.some(
              (ref) => canonicalJson(inventory.get(ref.id) ?? null) !== canonicalJson(ref),
            )
          )
            throw new DomainError('BACKUP_INCOMPLETE')
          await mapBounded(
            missing,
            async (ref) => {
              await check()
              await remote.media.ensureAvailable(ref, scope, signal, remoteId)
            },
            options.mediaConcurrency ?? 2,
          )
        }
        await check()
        const backup = await encodeSnapshotBackup(
          local,
          options.media,
          scope,
          options.mediaConcurrency,
        )
        await check()
        return backup
      } catch (error) {
        failed = true
        throw error
      } finally {
        let cleanupError: unknown
        try {
          await options.repository.releaseSnapshot(local.id)
        } catch (error) {
          cleanupError = error
        } finally {
          if (remoteId && remote) await releaseSnapshotQuietly(remote.transport, remoteId, owned)
        }
        if (!failed && cleanupError) throw cleanupError
      }
    },
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
