import { z } from 'zod'
import type { AccountSession, CollectionInfo, EntitlementProjection } from '../domain/contracts'
import type { WorkflowStore } from '../services/workflow-store'
import { canonicalHash, canonicalJson } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import { revisionSchema, timestamp } from '../domain/schema'
import { entitlementProjectionSchema } from '../domain/remote-schema'
const schema = z
  .object({
    type: z.literal('entitlement'),
    projection: entitlementProjectionSchema,
    deletionGeneration: revisionSchema,
    receivedAt: timestamp,
  })
  .strict()
type Cached = z.infer<typeof schema>
export interface AccessState {
  projection: EntitlementProjection | null
  receivedAt: string | null
  source: 'cache' | 'server' | null
}
const identity = (session: AccountSession | null) =>
  session
    ? {
        accountId: session.accountId,
        billingPrincipalId: session.billingPrincipalId,
        deletionGeneration: session.deletionGeneration,
      }
    : null
/** An offline convenience cache, never evidence for server authorization or a signed purchase grant. */
export function createEntitlementCache(options: {
  workflows: WorkflowStore
  current: () => AccountSession | null
}) {
  let cached: Cached | null = null,
    state: AccessState = { projection: null, receivedAt: null, source: null }
  const listeners = new Set<() => void>()
  const empty: AccessState = { projection: null, receivedAt: null, source: null }
  const publish = (value: Cached | null, source: AccessState['source']) => {
    cached = value
    state = {
      projection: value ? structuredClone(value.projection) : null,
      receivedAt: value?.receivedAt ?? null,
      source,
    }
    for (const listener of listeners) listener()
  }
  const bound = (session: AccountSession) => {
    if (canonicalJson(identity(options.current())) !== canonicalJson(identity(session)))
      throw new DomainError('ACCOUNT_CHANGED')
  }
  const key = async (session: AccountSession) =>
    `entitlement_${(await canonicalHash(identity(session))).slice(0, 48)}`
  return {
    getSnapshot: () => {
      const session = options.current()
      return session &&
        cached &&
        cached.projection.accountId === session.accountId &&
        cached.projection.billingPrincipalId === session.billingPrincipalId &&
        cached.deletionGeneration === session.deletionGeneration
        ? state
        : empty
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    hasAccess(info: CollectionInfo): boolean {
      const session = options.current()
      return (
        !!session &&
        (info.kind !== 'connected' || info.accountId === session.accountId) &&
        !!cached?.projection.upgraded &&
        cached.projection.accountId === session.accountId &&
        cached.projection.billingPrincipalId === session.billingPrincipalId &&
        cached.deletionGeneration === session.deletionGeneration
      )
    },
    clear() {
      publish(null, null)
    },
    async load() {
      const session = options.current()
      publish(null, null)
      if (!session) return
      const row = await options.workflows.read(await key(session))
      bound(session)
      if (!row) return
      const value = schema.safeParse(row.value)
      if (
        row.kind !== 'purchase' ||
        row.accountId !== session.accountId ||
        !value.success ||
        value.data.projection.accountId !== session.accountId ||
        value.data.projection.billingPrincipalId !== session.billingPrincipalId ||
        value.data.deletionGeneration !== session.deletionGeneration
      )
        throw new DomainError('VALIDATION')
      publish(value.data, 'cache')
    },
    /** Only call after validating an authenticated active-owner server status response. */
    async observe(input: EntitlementProjection, session: AccountSession) {
      const projection = entitlementProjectionSchema.parse(input)
      bound(session)
      if (
        projection.accountId !== session.accountId ||
        projection.billingPrincipalId !== session.billingPrincipalId
      )
        throw new DomainError('ACCOUNT_CHANGED')
      const id = await key(session)
      for (let attempt = 0; attempt < 4; attempt++) {
        const previous = await options.workflows.read<Cached>(id)
        bound(session)
        if (previous) {
          const parsed = schema.safeParse(previous.value)
          if (!parsed.success || previous.accountId !== session.accountId)
            throw new DomainError('VALIDATION')
          const old = parsed.data.projection
          if (BigInt(old.revision) > BigInt(projection.revision)) {
            publish(parsed.data, 'cache')
            return
          }
          if (old.revision === projection.revision && old.upgraded !== projection.upgraded)
            throw new DomainError('SYNC_PAGE_INVALID')
        }
        const value: Cached = {
          type: 'entitlement',
          projection,
          deletionGeneration: session.deletionGeneration,
          receivedAt: new Date().toISOString(),
        }
        try {
          await options.workflows.write(id, previous?.revision ?? null, {
            kind: 'purchase',
            accountId: session.accountId,
            collection: null,
            value,
          })
          bound(session)
          publish(value, 'server')
          return
        } catch (error) {
          if (
            !(error instanceof DomainError) ||
            error.detail.code !== 'REVISION_CONFLICT' ||
            attempt === 3
          )
            throw error
        }
      }
    },
  }
}
export type EntitlementCache = ReturnType<typeof createEntitlementCache>
