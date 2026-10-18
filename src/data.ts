import { z } from 'zod'
import type { Backup, CheckpointInput, Project, ProjectInput } from './types'
import { validMedia, validateBackupMedia } from './media-validation'
export { validateBackupMedia } from './media-validation'

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024
export const MAX_LIBRARY_BYTES = 48 * 1024 * 1024
export const MAX_PROJECTS = 200
export const MAX_CHECKPOINTS = 1000
const DATABASE = 'loopmark'
const VERSION = 1
const encoder = new TextEncoder()
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/, 'Invalid record ID')
function supportedTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  // Do not allow an imported date to move the persistent revision clock near Date's limit.
  // A century of clock skew still permits ordinary backups from devices with incorrect clocks.
  return (
    /^\d{4}-/.test(value) &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString() === value &&
    parsed.getTime() <= Date.now() + 100 * 366 * 24 * 60 * 60 * 1000
  )
}
const timestamp = z.string().refine(supportedTimestamp, 'Invalid date')
const nonBlank = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, 'Must not be blank')

const projectFields = {
  name: nonBlank(100),
  craft: z.enum(['Crochet', 'Knitting', 'Other']),
  color: z.enum(['clay', 'sage', 'lavender', 'ochre']),
  yarn: z.string().max(200),
  toolSize: z.string().max(80),
  notes: z.string().max(2000),
}
const projectInputSchema = z.object(projectFields).strict()
const checkpointInputSchema = z
  .object({
    position: z.string().max(100),
    toolSize: z.string().max(80),
    nextStep: nonBlank(1000),
    notes: z.string().max(2000),
    photo: z
      .string()
      .max(6 * 1024 * 1024)
      .refine(
        (value) => validMedia(value, 'photo'),
        'Photo must be a valid JPEG, PNG or WebP data URL up to 4 MiB',
      )
      .optional(),
    voice: z
      .string()
      .max(12 * 1024 * 1024)
      .refine(
        (value) => validMedia(value, 'voice'),
        'Voice note must be a supported audio data URL up to 8 MiB',
      )
      .optional(),
  })
  .strict()
const checkpointSchema = checkpointInputSchema.extend({ id, createdAt: timestamp })
const projectSchema = projectInputSchema.extend({
  id,
  code: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,23}$/, 'Invalid project code'),
  status: z.enum(['active', 'finished']),
  createdAt: timestamp,
  updatedAt: timestamp,
  checkpoints: z.array(checkpointSchema).max(MAX_CHECKPOINTS),
  sample: z.boolean().optional(),
})
const backupSchema = z
  .object({
    format: z.literal('loopmark'),
    version: z.literal(1),
    exportedAt: timestamp,
    projects: z.array(projectSchema).max(MAX_PROJECTS),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>()
    const codes = new Set<string>()
    let count = 0
    for (const project of value.projects) {
      if (ids.has(project.id) || codes.has(project.code))
        context.addIssue({ code: 'custom', message: 'Project IDs and codes must be unique' })
      ids.add(project.id)
      codes.add(project.code)
      for (const checkpoint of project.checkpoints) {
        if (ids.has(checkpoint.id))
          context.addIssue({ code: 'custom', message: 'Checkpoint IDs must be unique' })
        ids.add(checkpoint.id)
        count++
      }
    }
    // Catch an earlier checkpoint ID that collides with a later project ID too.
    if (ids.size !== value.projects.length + count)
      context.addIssue({ code: 'custom', message: 'All record IDs must be unique' })
    if (count > MAX_CHECKPOINTS)
      context.addIssue({
        code: 'custom',
        message: `A library can contain up to ${MAX_CHECKPOINTS} checkpoints`,
      })
  })

function validated<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new Error(`${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
  }
  return result.data
}

interface Stats {
  key: 'library'
  bytes: number
  projects: number
  checkpoints: number
  lastUpdatedAt?: string
  revision?: string
}
const emptyStats = (): Stats => ({ key: 'library', bytes: 0, projects: 0, checkpoints: 0 })
const size = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength
function assertCapacity(stats: Stats) {
  if (stats.projects > MAX_PROJECTS)
    throw new Error(
      `This library can hold ${MAX_PROJECTS} projects. Export a backup before removing older projects.`,
    )
  if (stats.checkpoints > MAX_CHECKPOINTS)
    throw new Error(
      `This library can hold ${MAX_CHECKPOINTS} checkpoints. Export a backup before removing older projects.`,
    )
  if (stats.bytes > MAX_LIBRARY_BYTES)
    throw new Error(
      'This library is full (48 MiB). Export a backup, then remove an older project before saving more media.',
    )
}

let database: Promise<IDBDatabase> | undefined
function openDatabase(): Promise<IDBDatabase> {
  if (database) return database
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(
        new Error(
          'Local storage is unavailable in this browser. Your changes have not been saved.',
        ),
      )
      return
    }
    const request = indexedDB.open(DATABASE, VERSION)
    let blocked = false
    request.onupgradeneeded = () => {
      const db = request.result
      const projects = db.createObjectStore('projects', { keyPath: 'id' })
      projects.createIndex('code', 'code', { unique: true })
      db.createObjectStore('meta', { keyPath: 'key' })
    }
    request.onblocked = () => {
      blocked = true
      reject(new Error('Close other Loopmark tabs, then reload to finish opening local storage.'))
    }
    request.onerror = () => reject(request.error ?? new Error('Local storage could not be opened.'))
    request.onsuccess = () => {
      const db = request.result
      if (blocked) {
        db.close()
        return
      }
      db.onversionchange = () => {
        db.close()
        database = undefined
      }
      db.onclose = () => {
        database = undefined
      }
      resolve(db)
    }
  }).catch((error) => {
    database = undefined
    throw error
  })
  return database
}

function friendlyError(error: unknown): Error {
  if (error instanceof Error && error.name === 'QuotaExceededError')
    return new Error(
      'Your browser storage is full. Your changes were not saved. Export a backup and free some space, then try again.',
    )
  return error instanceof Error
    ? error
    : new Error('Local storage failed. Your changes were not saved.')
}

async function transaction<T>(
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void,
): Promise<T> {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(['projects', 'meta'], mode)
    let result: T
    let failure: unknown
    const fail = (error: unknown) => {
      failure = error
      try {
        tx.abort()
      } catch {
        reject(friendlyError(error))
      }
    }
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(friendlyError(failure ?? tx.error))
    tx.onerror = () => {
      failure ??= tx.error
    }
    try {
      work(
        tx,
        (value) => {
          result = value
        },
        fail,
      )
    } catch (error) {
      fail(error)
    }
  })
}

const listeners = new Set<() => void>()
let channel: BroadcastChannel | undefined
function dispatch() {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      /* One view must not prevent other views from refreshing. */
    }
  }
}
function publish() {
  dispatch()
  channel?.postMessage('changed')
}
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('focus', dispatch)
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('loopmark-changes')
      channel.onmessage = dispatch
    }
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      channel?.close()
      channel = undefined
      if (typeof window !== 'undefined') window.removeEventListener('focus', dispatch)
    }
  }
}

const nextTimestamp = (...previous: (string | undefined)[]) => {
  const next = new Date(
    Math.max(Date.now(), ...previous.flatMap((value) => (value ? [Date.parse(value) + 1] : []))),
  )
  if (!Number.isFinite(next.getTime()) || next.getUTCFullYear() > 9999 || next.getUTCFullYear() < 0)
    throw new Error(
      'The saved date is outside the supported range. Restore a backup with valid dates.',
    )
  return next.toISOString()
}
function requireCurrent(project: Project | undefined, expected?: string): Project {
  if (!project)
    throw new Error(
      'This project is no longer in your library. Refresh to see the current projects.',
    )
  if (expected !== undefined && project.updatedAt !== expected)
    throw new Error(
      'This project changed in another tab. Your other tab’s changes are safe. If an unfinished edit returns, copy anything you need, discard that draft, and reopen the latest details.',
    )
  return project
}

function writeProject(
  tx: IDBTransaction,
  previous: Project | undefined,
  next: Project | undefined,
  done: () => void,
  fail: (error: unknown) => void,
) {
  const request = tx.objectStore('meta').get('library')
  request.onsuccess = () => {
    try {
      const stats: Stats = request.result ?? emptyStats()
      stats.bytes += (next ? size(next) : 0) - (previous ? size(previous) : 0)
      stats.projects += Number(Boolean(next)) - Number(Boolean(previous))
      stats.checkpoints += (next?.checkpoints.length ?? 0) - (previous?.checkpoints.length ?? 0)
      stats.lastUpdatedAt = nextTimestamp(stats.lastUpdatedAt, previous?.updatedAt, next?.updatedAt)
      stats.revision = crypto.randomUUID()
      assertCapacity(stats)
      const store = tx.objectStore('projects')
      if (next && previous) store.put(next)
      else if (next) store.add(next)
      else if (previous) {
        store.delete(previous.id)
        const receipts = tx.objectStore('meta').openCursor()
        receipts.onsuccess = () => {
          const cursor = receipts.result
          if (!cursor) return
          if (String(cursor.key).startsWith('receipt:') && cursor.value.projectId === previous.id)
            cursor.delete()
          cursor.continue()
        }
      }
      tx.objectStore('meta').put(stats)
      done()
    } catch (error) {
      fail(error)
    }
  }
}

export async function listProjects(): Promise<Project[]> {
  return transaction('readonly', (tx, done) => {
    const request = tx.objectStore('projects').getAll()
    request.onsuccess = () =>
      done(
        (request.result as Project[]).sort(
          (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
        ),
      )
  })
}

export interface LibraryState {
  revision: string
  projects: number
  checkpoints: number
}
const revisionOf = (stats?: Stats) => stats?.revision ?? stats?.lastUpdatedAt ?? 'empty'
export async function getLibraryState(): Promise<LibraryState> {
  return transaction('readonly', (tx, done) => {
    const request = tx.objectStore('meta').get('library')
    request.onsuccess = () => {
      const stats = request.result as Stats | undefined
      done({
        revision: revisionOf(stats),
        projects: stats?.projects ?? 0,
        checkpoints: stats?.checkpoints ?? 0,
      })
    }
  })
}
export async function getLibraryRevision(): Promise<string> {
  return (await getLibraryState()).revision
}
export class LibraryChangedError extends Error {
  constructor() {
    super(
      'Your collection changed while this restore was open. Review the latest collection before confirming replacement again. Your newer changes are safe.',
    )
    this.name = 'LibraryChangedError'
  }
}

interface Operation {
  key: string
  fingerprint: string
}
interface Receipt extends Operation {
  projectId: string
  checkpointId?: string
}
async function operationFor(
  kind: 'create' | 'checkpoint',
  token: string | undefined,
  input: unknown,
): Promise<Operation | undefined> {
  if (token === undefined) return undefined
  validated(id, token)
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(input)))
  return {
    key: `receipt:${kind}:${token}`,
    fingerprint: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  }
}
function retryOrWrite(
  tx: IDBTransaction,
  operation: Operation | undefined,
  projectId: string | undefined,
  done: (project: Project) => void,
  write: () => void,
  fail: (error: unknown) => void,
) {
  if (!operation) {
    write()
    return
  }
  const request = tx.objectStore('meta').get(operation.key)
  request.onsuccess = () => {
    try {
      const receipt = request.result as Receipt | undefined
      if (!receipt) {
        write()
        return
      }
      if (
        receipt.fingerprint !== operation.fingerprint ||
        (projectId !== undefined && receipt.projectId !== projectId)
      )
        throw new Error(
          'This save token was already used for different input. Reopen the form before saving these changes.',
        )
      const saved = tx.objectStore('projects').get(receipt.projectId)
      saved.onsuccess = () => {
        const project = saved.result as Project | undefined
        if (
          !project ||
          (receipt.checkpointId &&
            !project.checkpoints.some((checkpoint) => checkpoint.id === receipt.checkpointId))
        ) {
          fail(
            new Error(
              'The previously saved result is no longer available. Reopen this form before trying again.',
            ),
          )
          return
        }
        done(project)
      }
    } catch (error) {
      fail(error)
    }
  }
}

export async function createProject(
  input: ProjectInput,
  operationToken?: string,
): Promise<Project> {
  const clean = validated(projectInputSchema, input)
  clean.name = clean.name.trim()
  const operation = operationToken ? await operationFor('create', operationToken, clean) : undefined
  const now = nextTimestamp()
  const project: Project = {
    ...clean,
    name: clean.name.trim(),
    id: crypto.randomUUID(),
    code: `LM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    checkpoints: [],
  }
  const saved = await transaction<Project>('readwrite', (tx, done, fail) => {
    retryOrWrite(
      tx,
      operation,
      undefined,
      done,
      () => {
        writeProject(
          tx,
          undefined,
          project,
          () => {
            if (operation)
              tx.objectStore('meta').put({ ...operation, projectId: project.id } satisfies Receipt)
            done(project)
          },
          fail,
        )
      },
      fail,
    )
  })
  publish()
  return saved
}

async function mutateProject(
  idValue: string,
  mutate: (project: Project) => Project | undefined,
  expected?: string,
  operation?: Operation,
): Promise<Project | undefined> {
  const result = await transaction<Project | undefined>('readwrite', (tx, done, fail) => {
    retryOrWrite(
      tx,
      operation,
      idValue,
      done,
      () => {
        const request = tx.objectStore('projects').get(idValue)
        request.onsuccess = () => {
          try {
            const previous = requireCurrent(request.result, expected)
            const next = mutate(previous)
            writeProject(
              tx,
              previous,
              next,
              () => {
                if (operation && next)
                  tx.objectStore('meta').put({
                    ...operation,
                    projectId: next.id,
                    checkpointId: next.checkpoints[0].id,
                  } satisfies Receipt)
                done(next)
              },
              fail,
            )
          } catch (error) {
            fail(error)
          }
        }
      },
      fail,
    )
  })
  publish()
  return result
}

export async function updateProject(
  idValue: string,
  input: ProjectInput,
  expectedUpdatedAt: string,
): Promise<Project> {
  const clean = validated(projectInputSchema, input)
  return (await mutateProject(
    idValue,
    (project) => ({
      ...project,
      ...clean,
      name: clean.name.trim(),
      updatedAt: nextTimestamp(project.updatedAt),
    }),
    expectedUpdatedAt,
  )) as Project
}

export async function setProjectStatus(
  idValue: string,
  status: Project['status'],
  expectedUpdatedAt: string,
): Promise<Project> {
  const clean = validated(z.enum(['active', 'finished']), status)
  return (await mutateProject(
    idValue,
    (project) => ({ ...project, status: clean, updatedAt: nextTimestamp(project.updatedAt) }),
    expectedUpdatedAt,
  )) as Project
}

export async function deleteProject(idValue: string, expectedUpdatedAt: string): Promise<void> {
  await mutateProject(idValue, () => undefined, expectedUpdatedAt)
}

export async function addCheckpoint(
  idValue: string,
  input: CheckpointInput,
  operationToken?: string,
): Promise<Project> {
  const clean = validated(checkpointInputSchema, input)
  clean.nextStep = clean.nextStep.trim()
  const operation = operationToken
    ? await operationFor('checkpoint', operationToken, clean)
    : undefined
  return (await mutateProject(
    idValue,
    (project) => {
      if (project.status === 'finished')
        throw new Error('This project is finished. Reopen it before saving another checkpoint.')
      const now = nextTimestamp(project.updatedAt)
      return {
        ...project,
        updatedAt: now,
        checkpoints: [
          { ...clean, nextStep: clean.nextStep.trim(), id: crypto.randomUUID(), createdAt: now },
          ...project.checkpoints,
        ],
      }
    },
    undefined,
    operation,
  )) as Project
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'loopmark',
    version: 1,
    exportedAt: new Date().toISOString(),
    projects: await listProjects(),
  }
}

export function parseBackup(text: string): Backup {
  if (encoder.encode(text).byteLength > MAX_BACKUP_BYTES)
    throw new Error('Choose a Loopmark backup smaller than 50 MiB.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON. Choose an exported Loopmark backup.')
  }
  const backup = validated(backupSchema, value)
  assertCapacity({
    key: 'library',
    bytes: backup.projects.reduce((sum, project) => sum + size(project), 0),
    projects: backup.projects.length,
    checkpoints: backup.projects.reduce((sum, project) => sum + project.checkpoints.length, 0),
  })
  for (const project of backup.projects)
    project.checkpoints.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return backup
}

async function applyBackup(
  backup: Backup,
  onlyWhenEmpty: boolean,
  expectedRevision?: string,
): Promise<void> {
  // Revalidate even callers that bypass the file picker. Nothing is cleared on validation failure.
  const clean = parseBackup(JSON.stringify(backup))
  if (clean.projects.some((project) => project.checkpoints.some((checkpoint) => checkpoint.photo)))
    await validateBackupMedia(clean)
  await transaction<void>('readwrite', (tx, done, fail) => {
    const store = tx.objectStore('projects')
    const request = store.getAll()
    request.onsuccess = () => {
      const metadata = tx.objectStore('meta').get('library')
      metadata.onsuccess = () => {
        try {
          if (expectedRevision !== undefined && revisionOf(metadata.result) !== expectedRevision)
            throw new LibraryChangedError()
          if (onlyWhenEmpty && request.result.length)
            throw new Error(
              'Sample projects can only be added to an empty collection. Your existing projects are safe.',
            )
          // Explicit restore can recover old releases that accepted impossible revision clocks.
          // Keep every supported existing/imported clock, including records removed by replacement,
          // so surviving drafts cannot regain a previously issued normal revision after recovery.
          const watermark = nextTimestamp(
            ...[
              (metadata.result as Stats | undefined)?.lastUpdatedAt,
              clean.exportedAt,
              ...[...(request.result as Project[]), ...clean.projects].flatMap((project) => [
                project.createdAt,
                project.updatedAt,
                ...project.checkpoints.map((checkpoint) => checkpoint.createdAt),
              ]),
            ].filter(supportedTimestamp),
          )
          // Retain the clock through empty restores so deleted/reintroduced IDs cannot reuse draft tokens.
          const projects = clean.projects.map((project) => ({
            ...project,
            updatedAt: nextTimestamp(
              project.updatedAt,
              project.createdAt,
              project.checkpoints[0]?.createdAt,
              watermark,
            ),
          }))
          store.clear()
          for (const project of projects) store.add(project)
          // A replacement starts a new library; old draft-save receipts must not replay into it.
          tx.objectStore('meta').clear()
          tx.objectStore('meta').put({
            key: 'library',
            bytes: projects.reduce((sum, project) => sum + size(project), 0),
            projects: projects.length,
            checkpoints: projects.reduce((sum, project) => sum + project.checkpoints.length, 0),
            revision: crypto.randomUUID(),
            lastUpdatedAt: nextTimestamp(
              watermark,
              ...projects.map((project) => project.updatedAt),
            ),
          } satisfies Stats)
          done()
        } catch (error) {
          fail(error)
        }
      }
    }
  })
  publish()
}

/** UI callers must pass the revision shown in their confirmation. Omission is for trusted reset/test callers. */
export async function restoreBackup(backup: Backup, expectedRevision?: string): Promise<void> {
  await applyBackup(backup, false, expectedRevision)
}

/** Adds opt-in examples only if the library is still empty when the write transaction runs. */
export async function seedSamples(backup: Backup): Promise<void> {
  await applyBackup(backup, true)
}
