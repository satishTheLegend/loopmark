import type {
  Backup,
  CollectionKey,
  SessionScope,
  AccountSession,
  MediaRef,
  LocalSnapshot,
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
import { verifyMediaBytes } from './media-codec'
export interface MissingBackupAttachment {
  projectId: string
  projectName: string
  checkpointId: string
  checkpointCreatedAt: string
  position: string
  kind: 'photo' | 'voice'
}
export class IncompleteBackupError extends DomainError {
  readonly scope: SessionScope
  readonly snapshotRevision: string
  readonly missing: MissingBackupAttachment[]
  readonly total: number
  constructor(scope: SessionScope, snapshot: LocalSnapshot, unavailable: ReadonlySet<string>) {
    super('BACKUP_INCOMPLETE')
    this.name = 'IncompleteBackupError'
    this.scope = structuredClone(scope)
    this.snapshotRevision = snapshot.view.revision
    const projects = new Map(snapshot.view.projects.map((project) => [project.id, project]))
    const missing: MissingBackupAttachment[] = []
    let total = 0
    for (const checkpoint of snapshot.view.checkpoints)
      for (const kind of ['photo', 'voice'] as const) {
        const ref = checkpoint[kind]
        if (!ref || !unavailable.has(ref.id)) continue
        total++
        if (missing.length < 20)
          missing.push({
            projectId: checkpoint.projectId,
            projectName: projects.get(checkpoint.projectId)?.name.slice(0, 100) ?? '',
            checkpointId: checkpoint.id,
            checkpointCreatedAt: checkpoint.createdAt,
            position: checkpoint.position.slice(0, 200),
            kind,
          })
      }
    this.missing = missing
    this.total = total
  }
}
const unavailableMedia = (error: unknown) =>
  error instanceof DomainError && ['BACKUP_INCOMPLETE', 'MEDIA_INVALID'].includes(error.detail.code)
const preserveFailure = (error: unknown, signal: AbortSignal) =>
  signal.aborted ||
  (error instanceof Error && error.name === 'AbortError') ||
  (error instanceof DomainError && ['ACCOUNT_CHANGED', 'AUTH_REQUIRED'].includes(error.detail.code))
export interface ExportProgress {
  stage: 'checking' | 'downloading' | 'encoding'
  done: number
  total: number
}
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
    async exportComplete(
      signal = new AbortController().signal,
      onProgress?: (progress: ExportProgress) => void,
    ): Promise<Backup> {
      signal.throwIfAborted()
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
      const refs = mediaRefs(local.view.checkpoints)
      const findMissing = async (strict = false) => {
        const missing: MediaRef[] = []
        await mapBounded(
          refs,
          async (ref) => {
            await check()
            try {
              const stream = await options.media.open(ref, scope.key)
              if (strict)
                await verifyMediaBytes(
                  ref,
                  new Blob([await new Response(stream).arrayBuffer()], { type: ref.mimeType }),
                )
              else await stream.cancel()
            } catch (error) {
              if (unavailableMedia(error)) missing.push(ref)
              else throw error
            }
            await check()
          },
          options.mediaConcurrency ?? 2,
        )
        return missing
      }
      const incomplete = (missing: MediaRef[]) =>
        new IncompleteBackupError(scope, local, new Set(missing.map((ref) => ref.id)))
      try {
        await check()
        const missing: MediaRef[] = []
        let checked = 0
        onProgress?.({ stage: 'checking', done: 0, total: refs.length })
        await mapBounded(
          refs,
          async (ref) => {
            await check()
            try {
              await (await options.media.open(ref, scope.key)).cancel()
            } catch (error) {
              if (unavailableMedia(error)) missing.push(ref)
              else throw error
            }
            signal.throwIfAborted()
            onProgress?.({ stage: 'checking', done: ++checked, total: refs.length })
          },
          options.mediaConcurrency ?? 2,
        )
        if (missing.length) {
          if (!remote || local.view.info.kind !== 'connected' || !owned()) throw incomplete(missing)
          const pages = await collectSnapshot(
            remote.transport,
            { collectionId: scope.key.collectionId, epoch: scope.key.epoch, purpose: 'export' },
            signal,
            check,
            owned,
          ).catch(async (error) => {
            if (preserveFailure(error, signal)) throw error
            await check()
            if (error instanceof DomainError && error.detail.code === 'SYNC_PAGE_INVALID')
              throw error
            throw incomplete(await findMissing())
          })
          remoteId = pages[0].snapshotId
          const inventory = new Map(pages.flatMap((page) => page.media).map((ref) => [ref.id, ref]))
          let downloaded = 0
          onProgress?.({ stage: 'downloading', done: 0, total: missing.length })
          await mapBounded(
            missing,
            async (ref) => {
              await check()
              if (canonicalJson(inventory.get(ref.id) ?? null) !== canonicalJson(ref)) return
              try {
                await remote.media.ensureAvailable(ref, scope, signal, remoteId)
              } catch (error) {
                if (preserveFailure(error, signal)) throw error
                // Other items can still finish and become durable retry cache entries.
                return
              }
              await check()
              onProgress?.({ stage: 'downloading', done: ++downloaded, total: missing.length })
            },
            options.mediaConcurrency ?? 2,
          )
          const remaining = await findMissing(true)
          if (remaining.length) throw incomplete(remaining)
        }
        await check()
        onProgress?.({ stage: 'encoding', done: 0, total: local.view.projects.length })
        const backup = await encodeSnapshotBackup(
          local,
          options.media,
          scope,
          options.mediaConcurrency,
          { signal, onProject: (done, total) => onProgress?.({ stage: 'encoding', done, total }) },
        ).catch(async (error) => {
          if (preserveFailure(error, signal) || !unavailableMedia(error)) throw error
          await check()
          throw incomplete(await findMissing(true))
        })
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
