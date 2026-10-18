/** Pure validation and archive semantics shared by durable adapters. */
import type { CollectionKey, SessionScope } from '../domain/contracts'
import type { RebaseInput, LocalCollectionReview } from './contracts'
import { canonicalJson } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import { id, timestamp, collectionKeySchema } from '../domain/schema'
import {
  emptyCollection,
  hydrateState,
  keyOf,
  localRevision,
  viewOf,
  type StoredCollection,
} from './state'

export function rebaseIdentity(
  expected: SessionScope,
  review: LocalCollectionReview,
  input: RebaseInput,
) {
  const { accountId, collection, device, deletionGeneration } = input.session
  return {
    expected,
    review,
    session: { accountId, collection, device, deletionGeneration },
    recoveryId: input.recoveryId,
    recoveryName: input.recoveryName,
    allowMissingMedia: input.allowMissingMedia === true,
  }
}
export function prepareRebase(
  source: StoredCollection,
  expected: SessionScope,
  review: LocalCollectionReview,
  input: RebaseInput,
  now: number,
) {
  const session = input.session
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      input.recoveryId,
    ) ||
    typeof input.recoveryName !== 'string' ||
    !input.recoveryName.trim() ||
    !timestamp.safeParse(session.expiresAt).success ||
    !collectionKeySchema.safeParse(session.collection).success ||
    !id.safeParse(session.accountId).success ||
    input.recoveryName.length > 100 ||
    !id.safeParse(session.device.id).success ||
    !id.safeParse(session.device.generation).success
  )
    throw new DomainError('VALIDATION')
  if (
    source.info.kind !== 'connected' ||
    source.info.accountId !== session.accountId ||
    source.info.key.namespace !== session.collection.namespace ||
    source.info.key.collectionId !== session.collection.collectionId ||
    keyOf(source.info.key) !== keyOf(expected.key) ||
    keyOf(review.key) !== keyOf(expected.key) ||
    Date.parse(session.expiresAt) <= now
  )
    throw new DomainError('ACCOUNT_CHANGED')
  if (source.version !== review.revision) throw new DomainError('REVISION_CONFLICT')
  if (source.pending.some((p) => p.intent.kind === 'collection.replace'))
    throw new DomainError('SYNC_REBASE_REQUIRED')
  const recoveredKey: CollectionKey = {
    namespace: `guest_rebase_${input.recoveryId}`,
    collectionId: input.recoveryId,
    epoch: 'initial',
  }
  const visible = viewOf(source)
  const recovered = emptyCollection({
    ...source.info,
    key: recoveredKey,
    kind: 'recovered',
    accountId: null,
    name: input.recoveryName,
    legacyAccess: false,
    createdAt: new Date(now).toISOString(),
  })
  recovered.projects = visible.projects
  recovered.checkpoints = visible.checkpoints
  recovered.version = localRevision(
    source.version,
    ...visible.projects.map((p) => p.revision),
    ...visible.checkpoints.map((c) => c.revision),
  )
  recovered.provenance = {
    kind: 'recovered',
    sourceId: source.info.key.collectionId,
    capturedAt: recovered.info.createdAt,
  }
  const next = emptyCollection({ ...source.info, key: session.collection })
  hydrateState(next, input.pages, now)
  next.version = localRevision(source.version, next.serverRevision ?? '0')
  // For unchanged server device identity, sequence admission remains monotonic after cursor rebase.
  next.sequences = structuredClone(source.sequences)
  next.sequence = source.sequence
  const scope = {
    key: session.collection,
    device: session.device,
    generation: expected.generation + 1,
  }
  if (!Number.isSafeInteger(scope.generation)) throw new DomainError('INVARIANT_VIOLATION')
  return { recovered, next, result: { scope, recovered: recoveredKey } }
}
export function candidateBlocksRebase(row: { value?: unknown }, source: CollectionKey): boolean {
  const entry = row.value as
    | {
        kind?: string
        value?: {
          phase?: string
          preview?: { source?: { key?: CollectionKey }; destination?: { key?: CollectionKey } }
        }
      }
    | undefined
  const work = entry?.value
  if (entry?.kind !== 'candidate' || ['complete', 'cancelled'].includes(work?.phase ?? ''))
    return false
  return [work?.preview?.source?.key, work?.preview?.destination?.key].some(
    (key) => key && canonicalJson(key) === canonicalJson(source),
  )
}
