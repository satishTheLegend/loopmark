/** Copy-only legacy migration. Source schema versions fence the version-1 writers. */
import { z } from 'zod'
import type {
  CollectionInfo,
  CollectionKey,
  DeviceIdentity,
  MediaRef,
  Project,
} from '../../domain/contracts'
import { backupSchema, checkpointInputSchema, projectInputSchema, id } from '../../domain/schema'
import { canonicalHash, sha256Bytes, canonicalJson } from '../../domain/canonical-json'
import { validateBackupMedia } from '../../media-validation'
import { DomainError } from '../../domain/errors'
import { emptyCollection, assertRecords, keyOf } from '../state'
import { BrowserRepository } from './repository'
import { dataUrlToBlob, bytesToDataUrl, verifyBytes } from './media-store'
import {
  transaction,
  requestResult,
  putState,
  getState,
  activeScope,
  mediaKey,
  type MediaRow,
  type MetaRow,
} from './schema'

export interface LegacySourceNames {
  projects: string
  drafts: string
}
export const LEGACY_SOURCES: LegacySourceNames = { projects: 'loopmark', drafts: 'loopmark-drafts' }
export interface LegacyDraft {
  key: string
  value: unknown
  revision: string
  baseRevision?: string
}
export interface LegacySnapshot {
  projects: Project[]
  drafts: LegacyDraft[]
  metadata: unknown[]
  versions: { projects: number | null; drafts: number | null }
}
export interface MigrationReceipt {
  id: string
  schemaVersion: 1
  destination: CollectionKey
  sourceNames: LegacySourceNames
  sources: LegacySnapshot['versions']
  originalSources: LegacySnapshot['versions']
  sourceRevision: string
  sourceHash: string
  draftHash: string
  projectCount: number
  checkpointCount: number
  draftCount: number
  media: Array<{ checkpointId: string; kind: 'photo' | 'voice'; sha256: string; bytes: number }>
  destinationRevision: string
  status: 'copied' | 'selected'
  copiedAt: string
  selectedAt?: string
}
const draftSchema = z
  .object({
    key: z.string().min(1).max(100),
    value: z.unknown(),
    revision: id,
    baseRevision: z.string().max(100).optional(),
  })
  .strict()
function parseDraft(input: unknown): LegacyDraft {
  const parsed = draftSchema.safeParse(input)
  if (!parsed.success) throw new DomainError('BACKUP_INVALID')
  const draft = parsed.data
  const fields =
    draft.key === 'new-project' ||
    draft.key === 'project:new' ||
    draft.key === 'new' ||
    draft.key.startsWith('edit:')
      ? projectInputSchema.extend({ name: z.string().max(100) })
      : draft.key.startsWith('checkpoint:')
        ? checkpointInputSchema.safeExtend({ nextStep: z.string().max(1000) })
        : null
  if (!fields || !fields.safeParse(draft.value).success) throw new DomainError('BACKUP_INVALID')
  return draft
}
async function openExisting(factory: IDBFactory, name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name)
    let absent = false
    request.onupgradeneeded = (event) => {
      if ((event as IDBVersionChangeEvent).oldVersion === 0) {
        absent = true
        request.transaction!.abort()
      }
    }
    request.onerror = (event) => {
      if (absent) {
        event.preventDefault()
        resolve(null)
      } else reject(new DomainError('LOCAL_STORAGE_FAILED'))
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}
async function readStore(db: IDBDatabase | null, name: string): Promise<unknown[]> {
  if (!db) return []
  if (!db.objectStoreNames.contains(name)) throw new DomainError('BACKUP_INVALID')
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name),
      request = tx.objectStore(name).getAll()
    let values: unknown[] = []
    request.onsuccess = () => {
      values = request.result
    }
    tx.oncomplete = () => resolve(values)
    tx.onabort = tx.onerror = () => reject(new DomainError('LOCAL_STORAGE_FAILED'))
  })
}
export async function readLegacySnapshot(
  factory: IDBFactory = indexedDB,
  names = LEGACY_SOURCES,
): Promise<LegacySnapshot> {
  const projectsDb = await openExisting(factory, names.projects)
  let draftsDb: IDBDatabase | null = null
  try {
    draftsDb = await openExisting(factory, names.drafts)
    // Frozen original stores have no supported writers. Read transactions never change sources.
    const projects = await readStore(projectsDb, 'projects')
    const metadata = await readStore(projectsDb, 'meta')
    const drafts = await readStore(draftsDb, 'drafts')
    const backup = backupSchema.safeParse({
      format: 'loopmark',
      version: 1,
      exportedAt: new Date().toISOString(),
      projects,
    })
    if (!backup.success || canonicalJson(backup.data.projects) !== canonicalJson(projects))
      throw new DomainError('BACKUP_INVALID')
    await validateBackupMedia(backup.data)
    return {
      projects: backup.data.projects,
      metadata,
      drafts: drafts.map(parseDraft),
      versions: { projects: projectsDb?.version ?? null, drafts: draftsDb?.version ?? null },
    }
  } finally {
    projectsDb?.close()
    draftsDb?.close()
  }
}
interface SourceFence {
  originalVersion: number | null
  frozenVersion: number
}
const FENCE_STORE = 'loopmark_migration_fence'
async function freezeExisting(
  factory: IDBFactory,
  name: string,
  kind: 'projects' | 'drafts',
): Promise<SourceFence> {
  const db = await openExisting(factory, name)
  const next = db ? db.version + 1 : 2
  db?.close()
  return new Promise((resolve, reject) => {
    const request = factory.open(name, next)
    let abandoned = false
    request.onblocked = () => {
      abandoned = true
      reject(new DomainError('LOCAL_STORAGE_FAILED'))
    }
    request.onupgradeneeded = (event) => {
      if (abandoned) {
        request.transaction!.abort()
        return
      }
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion
      const source = request.result,
        tx = request.transaction!
      // A deliberately created empty version-2 fence prevents old idle tabs creating a v1 DB.
      // Presence is captured at the actual barrier, atomically with its version, not at discovery.
      if (oldVersion === 0) {
        if (kind === 'projects') {
          source.createObjectStore('projects', { keyPath: 'id' })
          source.createObjectStore('meta', { keyPath: 'key' })
        } else source.createObjectStore('drafts', { keyPath: 'key' })
      }
      const store = source.objectStoreNames.contains(FENCE_STORE)
        ? tx.objectStore(FENCE_STORE)
        : source.createObjectStore(FENCE_STORE, { keyPath: 'key' })
      const previous = store.get('original')
      previous.onsuccess = () => {
        if (!previous.result) store.add({ key: 'original', originalVersion: oldVersion || null })
      }
    }
    request.onerror = () => reject(new DomainError('LOCAL_STORAGE_FAILED'))
    request.onsuccess = () => {
      const source = request.result
      if (abandoned) {
        source.close()
        return
      }
      if (!source.objectStoreNames.contains(FENCE_STORE)) {
        source.close()
        reject(new DomainError('INVARIANT_VIOLATION'))
        return
      }
      const tx = source.transaction(FENCE_STORE),
        read = tx.objectStore(FENCE_STORE).get('original')
      let originalVersion: number | null
      read.onsuccess = () => {
        originalVersion = read.result?.originalVersion
      }
      tx.oncomplete = () => {
        source.close()
        if (
          originalVersion !== null &&
          (!Number.isSafeInteger(originalVersion) || originalVersion < 1)
        )
          reject(new DomainError('INVARIANT_VIOLATION'))
        else resolve({ originalVersion, frozenVersion: source.version })
      }
      tx.onerror = tx.onabort = () => {
        source.close()
        reject(new DomainError('LOCAL_STORAGE_FAILED'))
      }
    }
  })
}

const legacyHash = (value: unknown) => canonicalHash(JSON.parse(JSON.stringify(value)))
const hashSource = (source: LegacySnapshot) =>
  legacyHash({ projects: source.projects, metadata: source.metadata })
export async function portableProjects(
  repository: BrowserRepository,
  key: CollectionKey,
): Promise<Project[]> {
  const snapshot = await repository.snapshot(key)
  try {
    return await Promise.all(
      snapshot.view.projects.map(async ({ revision: _revision, ...project }) => ({
        ...project,
        checkpoints: await Promise.all(
          snapshot.view.checkpoints
            .filter((c) => c.projectId === project.id)
            .map(async (c) => {
              const { revision: _rev, projectId: _id, photo, voice, ...checkpoint } = c
              const inline = async (ref: MediaRef) =>
                bytesToDataUrl(
                  new Uint8Array(
                    await new Response(await repository.media.open(ref, key)).arrayBuffer(),
                  ),
                  ref.mimeType,
                )
              return {
                ...checkpoint,
                ...(photo ? { photo: await inline(photo) } : {}),
                ...(voice ? { voice: await inline(voice) } : {}),
              }
            }),
        ),
      })),
    )
  } finally {
    await repository.releaseSnapshot(snapshot.id)
  }
}
export async function readMigrationSelection(
  repository: BrowserRepository,
): Promise<CollectionKey | null> {
  return transaction(repository.database, 'readonly', async (tx) => {
    const row = await requestResult<MetaRow | undefined>(
      tx.objectStore('meta').get('migration-selection'),
    )
    return (row?.value as CollectionKey) ?? null
  })
}
export async function readMigratedDraft(
  repository: BrowserRepository,
  key: CollectionKey,
  draftKey: string,
): Promise<LegacyDraft | undefined> {
  return transaction(repository.database, 'readonly', async (tx) => {
    const row = await requestResult<{ value: LegacyDraft } | undefined>(
      tx.objectStore('drafts').get(JSON.stringify([keyOf(key), draftKey])),
    )
    return row?.value
  })
}
export async function migrateLegacy(options: {
  repository: BrowserRepository
  factory?: IDBFactory
  sourceNames?: LegacySourceNames
  destination: CollectionInfo
  generation: number
  device: DeviceIdentity
}): Promise<MigrationReceipt> {
  const { repository, destination, generation, device } = options
  const factory = options.factory ?? indexedDB,
    names = options.sourceNames ?? LEGACY_SOURCES
  if (destination.kind !== 'guest' || destination.accountId !== null)
    throw new DomainError('VALIDATION')
  if (
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    !id.safeParse(device.id).success ||
    !id.safeParse(device.generation).success
  )
    throw new DomainError('VALIDATION')
  const migrationId = await canonicalHash({ names, key: destination.key })
  const existing = await transaction(repository.database, 'readonly', (tx) =>
    requestResult<{ value: MigrationReceipt } | undefined>(
      tx.objectStore('migrations').get(migrationId),
    ),
  )
  if (existing?.value.status === 'selected') return existing.value
  const projectFence = await freezeExisting(factory, names.projects, 'projects')
  const draftFence = await freezeExisting(factory, names.drafts, 'drafts')
  const source = await readLegacySnapshot(factory, names)
  const sourceHash = await hashSource(source),
    draftHash = await legacyHash(source.drafts)
  const candidate = emptyCollection({
    ...destination,
    legacyAccess: projectFence.originalVersion !== null && source.projects.length > 0,
  })
  const rows: MediaRow[] = [],
    media: MigrationReceipt['media'] = []
  for (const project of source.projects) {
    const { checkpoints, ...fields } = project
    candidate.projects.push({ ...fields, revision: '0' })
    for (const checkpoint of checkpoints) {
      const { photo, voice, ...fields } = checkpoint
      const refs: { photo?: MediaRef; voice?: MediaRef } = {}
      for (const kind of ['photo', 'voice'] as const) {
        const value = kind === 'photo' ? photo : voice
        if (!value) continue
        const bytes = dataUrlToBlob(value),
          sha256 = await sha256Bytes(new Uint8Array(await bytes.arrayBuffer()))
        const ref = {
          id: `legacy_${kind}_${(await canonicalHash({ id: checkpoint.id, sha256 })).slice(0, 40)}`,
          kind,
          mimeType: bytes.type,
          bytes: bytes.size,
          sha256,
        }
        await verifyBytes(ref, bytes)
        refs[kind] = ref
        rows.push({
          key: mediaKey(destination.key, ref.id),
          scope: destination.key,
          ref,
          bytes: await bytes.arrayBuffer(),
          preparedAt: new Date().toISOString(),
        })
        media.push({ checkpointId: checkpoint.id, kind, sha256, bytes: bytes.size })
      }
      candidate.checkpoints.push({ ...fields, ...refs, projectId: project.id, revision: '0' })
    }
  }
  assertRecords(candidate.projects, candidate.checkpoints)
  candidate.version = '1'
  candidate.provenance = {
    kind: 'legacy',
    sourceId: names.projects,
    capturedAt: new Date().toISOString(),
  }
  const stats = source.metadata.find(
    (m) => typeof m === 'object' && m !== null && 'key' in m && m.key === 'library',
  ) as { revision?: string; lastUpdatedAt?: string } | undefined
  const receipt: MigrationReceipt = {
    id: migrationId,
    schemaVersion: 1,
    destination: destination.key,
    sourceNames: names,
    sources: source.versions,
    originalSources: { projects: projectFence.originalVersion, drafts: draftFence.originalVersion },
    sourceRevision: stats?.revision ?? stats?.lastUpdatedAt ?? 'empty',
    sourceHash,
    draftHash,
    projectCount: source.projects.length,
    checkpointCount: candidate.checkpoints.length,
    draftCount: source.drafts.length,
    media,
    destinationRevision: '1',
    status: 'copied',
    copiedAt: new Date().toISOString(),
  }
  await transaction(repository.database, 'readwrite', async (tx) => {
    const active = await activeScope(tx)
    if (
      active &&
      canonicalJson(active) !== canonicalJson({ key: destination.key, generation, device })
    )
      throw new DomainError('ACCOUNT_CHANGED')
    const previous = await requestResult<{ value: MigrationReceipt } | undefined>(
      tx.objectStore('migrations').get(migrationId),
    )
    const current = await requestResult<{ value: { version: string } } | undefined>(
      tx.objectStore('collections').get(keyOf(destination.key)),
    )
    if (
      current &&
      (!previous ||
        previous.value.status !== 'copied' ||
        current.value.version !== previous.value.destinationRevision)
    )
      throw new DomainError('REVISION_CONFLICT')
    if (
      previous &&
      (previous.value.sourceHash !== sourceHash || previous.value.draftHash !== draftHash)
    )
      throw new DomainError('REVISION_CONFLICT')
    putState(tx, candidate)
    for (const row of rows) tx.objectStore('media').put(row)
    for (const draft of source.drafts)
      tx.objectStore('drafts').put({
        key: JSON.stringify([keyOf(destination.key), draft.key]),
        scope: destination.key,
        value: draft,
      })
    tx.objectStore('migrations').put({ key: migrationId, value: receipt })
  })
  // Fresh durable reads compare complete normalized content and every attachment byte.
  const copied = await portableProjects(repository, destination.key)
  if ((await canonicalHash(copied)) !== (await canonicalHash(source.projects)))
    throw new DomainError('INVARIANT_VIOLATION')
  const copiedDrafts: LegacyDraft[] = []
  for (const draft of source.drafts) {
    const copiedDraft = await readMigratedDraft(repository, destination.key, draft.key)
    if (!copiedDraft) throw new DomainError('INVARIANT_VIOLATION')
    copiedDrafts.push(copiedDraft)
  }
  if ((await legacyHash(copiedDrafts)) !== draftHash) throw new DomainError('INVARIANT_VIOLATION')
  const latest = await readLegacySnapshot(factory, names)
  if ((await hashSource(latest)) !== sourceHash || (await legacyHash(latest.drafts)) !== draftHash)
    throw new DomainError('REVISION_CONFLICT')
  await transaction(repository.database, 'readwrite', async (tx) => {
    const state = await getState(tx, destination.key),
      active = await activeScope(tx)
    const durable = await requestResult<{ value: MigrationReceipt } | undefined>(
      tx.objectStore('migrations').get(migrationId),
    )
    if (
      state.version !== receipt.destinationRevision ||
      !durable ||
      durable.value.sourceHash !== sourceHash ||
      durable.value.draftHash !== draftHash
    )
      throw new DomainError('REVISION_CONFLICT')
    if (
      active &&
      canonicalJson(active) !== canonicalJson({ key: destination.key, generation, device })
    )
      throw new DomainError('ACCOUNT_CHANGED')
    receipt.status = 'selected'
    receipt.selectedAt = new Date().toISOString()
    tx.objectStore('migrations').put({ key: migrationId, value: receipt })
    tx.objectStore('meta').put({ key: 'migration-selection', value: destination.key })
    tx.objectStore('meta').put({
      key: 'active',
      value: { key: destination.key, generation, device },
    })
  })
  return receipt
}
