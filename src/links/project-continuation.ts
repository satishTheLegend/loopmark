import { z } from 'zod'
import type { ProjectRecord, SessionScope } from '../domain/contracts'
import { canonicalJson } from '../domain/canonical-json'
import { DomainError, safeError, type SafeError } from '../domain/errors'
import { id, timestamp } from '../domain/schema'
import type { Repository } from '../repositories/contracts'
import type { WorkflowRecord, WorkflowStore } from '../services/workflow-store'
import { resolveProjectLink, type ProjectLink } from './link-service'

const recordId = 'project_link_continuation'
const localOwner = 'local_navigation'
const ttl = 24 * 60 * 60 * 1000
const targetSchema = z.object({ kind: z.enum(['project', 'legacy']), projectId: id }).strict()
const pendingSchema = targetSchema
  .extend({ token: z.uuid(), createdAt: timestamp, expiresAt: timestamp })
  .strict()
const storedSchema = z
  .object({ type: z.literal('project-link'), version: z.literal(1), pending: pendingSchema })
  .strict()
export type PendingProjectContinuation = z.infer<typeof pendingSchema>
type Stored = z.infer<typeof storedSchema>
export interface ProjectContinuationState {
  pending: PendingProjectContinuation | null
  busy: boolean
  error: SafeError | null
}

/** One public parsed target, never an arbitrary redirect, account identifier, auth token or craft metadata. */
export function createProjectContinuation(options: {
  repository: Repository
  workflows: WorkflowStore
  current: () => { scope: SessionScope; accountId: string | null }
  hydrate?: (signal: AbortSignal) => Promise<void>
  now?: () => number
}) {
  const now = options.now ?? Date.now
  const listeners = new Set<() => void>()
  const continuations = new Map<string, Promise<ProjectRecord>>()
  let state: ProjectContinuationState = { pending: null, busy: false, error: null }
  let active = 0,
    disposed = false
  const publish = (patch: Partial<ProjectContinuationState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const current = () => {
    if (disposed) throw new DomainError('NOT_AVAILABLE')
    return structuredClone(options.current())
  }
  const check = async (captured: ReturnType<typeof current>, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (
      canonicalJson(current()) !== canonicalJson(captured) ||
      canonicalJson(await options.repository.readActive()) !== canonicalJson(captured.scope)
    )
      throw new DomainError('ACCOUNT_CHANGED')
    signal?.throwIfAborted()
  }
  async function load(): Promise<WorkflowRecord<Stored> | null> {
    const captured = current(),
      row = await options.workflows.read<Stored>(recordId)
    await check(captured)
    if (!row) {
      publish({ pending: null })
      return null
    }
    const parsed = storedSchema.safeParse(row.value)
    if (
      row.kind !== 'navigation' ||
      row.accountId !== localOwner ||
      row.collection !== null ||
      !parsed.success
    )
      throw new DomainError('VALIDATION')
    const { pending } = parsed.data,
      clock = now()
    const created = Date.parse(pending.createdAt),
      expires = Date.parse(pending.expiresAt)
    if (expires - created !== ttl || expires <= clock || created > clock) {
      await options.workflows.remove(row.id, row.revision, captured.scope)
      publish({ pending: null })
      return null
    }
    publish({ pending: structuredClone(pending) })
    return row
  }
  async function refreshAfterFailure(error: unknown) {
    try {
      await load()
    } catch {
      /* Preserve the original safe error; no content leaves the record. */
    }
    publish({ error: safeError(error) })
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async initialize() {
      try {
        await load()
        publish({ error: null })
      } catch (error) {
        publish({ pending: null, error: safeError(error) })
      }
    },
    async capture(target: ProjectLink): Promise<PendingProjectContinuation> {
      const parsed = targetSchema.safeParse(target)
      if (!parsed.success) throw new DomainError('NOT_AVAILABLE')
      const captured = current(),
        previous = await load()
      await check(captured)
      if (
        previous &&
        previous.value.pending.kind === target.kind &&
        previous.value.pending.projectId === target.projectId
      )
        return structuredClone(previous.value.pending)
      const clock = now(),
        pending = pendingSchema.parse({
          ...parsed.data,
          token: crypto.randomUUID(),
          createdAt: new Date(clock).toISOString(),
          expiresAt: new Date(clock + ttl).toISOString(),
        })
      try {
        await options.workflows.write(
          recordId,
          previous?.revision ?? null,
          {
            kind: 'navigation',
            accountId: localOwner,
            collection: null,
            value: { type: 'project-link', version: 1, pending },
          },
          captured.scope,
        )
      } catch (error) {
        const winner = await load()
        if (
          error instanceof DomainError &&
          error.detail.code === 'REVISION_CONFLICT' &&
          winner?.value.pending.kind === target.kind &&
          winner.value.pending.projectId === target.projectId
        )
          return structuredClone(winner.value.pending)
        throw error
      }
      await check(captured)
      publish({ pending: structuredClone(pending), error: null })
      return structuredClone(pending)
    },
    continue(token: string, signal = AbortSignal.timeout(60000)) {
      const captured = current(),
        identity = canonicalJson({ token, ...captured })
      const existing = continuations.get(identity)
      if (existing) return existing
      const work = (async () => {
        active++
        publish({ busy: true, error: null })
        try {
          const row = await load()
          if (!row || row.value.pending.token !== token) throw new DomainError('NOT_AVAILABLE')
          await check(captured, signal)
          const project = await resolveProjectLink({
            target: row.value.pending,
            scope: captured.scope,
            accountId: captured.accountId,
            repository: options.repository,
            hydrate: options.hydrate,
            signal,
          })
          await check(captured, signal)
          // Revision CAS prevents an old completion from consuming a newer scan in another tab.
          await options.workflows.remove(row.id, row.revision, captured.scope)
          await check(captured, signal)
          publish({ pending: null, error: null })
          return project
        } catch (error) {
          await refreshAfterFailure(error)
          throw error
        } finally {
          publish({ busy: --active > 0 })
        }
      })()
      continuations.set(identity, work)
      const clear = () => {
        if (continuations.get(identity) === work) continuations.delete(identity)
      }
      void work.then(clear, clear)
      return work
    },
    async dismiss(token: string) {
      const captured = current(),
        row = await load()
      if (!row) return
      if (row.value.pending.token !== token) throw new DomainError('NOT_AVAILABLE')
      await check(captured)
      await options.workflows.remove(row.id, row.revision, captured.scope)
      await check(captured)
      publish({ pending: null, error: null })
    },
    dispose() {
      disposed = true
      listeners.clear()
    },
  }
}
