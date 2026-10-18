import { z } from 'zod'
import type { Backup, CheckpointInput, Project, ProjectInput } from './types'
import { validateBackupMedia } from './media-validation'
import {
  id,
  projectInputSchema,
  checkpointInputSchema,
  backupSchema,
  supportedTimestamp,
  validated,
} from './domain/portable-schema'
import { MAX_BACKUP_BYTES, MAX_LIBRARY_BYTES, MAX_PROJECTS, MAX_CHECKPOINTS } from './domain/policy'
export { MAX_BACKUP_BYTES, MAX_LIBRARY_BYTES, MAX_PROJECTS, MAX_CHECKPOINTS } from './domain/policy'
export { validateBackupMedia } from './media-validation'

const DATABASE = 'loopmark'
const VERSION = 1
const encoder = new TextEncoder()

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
