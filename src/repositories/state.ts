/** Pure persisted collection semantics shared by IndexedDB and SQLite adapters. */
import { z } from 'zod'
import type {
  CollectionInfo,
  CollectionView,
  ProjectRecord,
  CheckpointRecord,
  PendingIntent,
  LocalIntent,
  Receipt,
  MediaRef,
  Command,
  SnapshotManifest,
  LocalCollectionCandidate,
} from '../domain/contracts'
import {
  collectionKeySchema,
  projectRecordSchema,
  checkpointRecordSchema,
  id,
  timestamp,
  parseCommand,
  parseReceipt,
  parseSnapshot,
} from '../domain/schema'
import {
  assertCapacity,
  assertActiveCapacity,
  portableMediaBytes,
  utf8Bytes,
} from '../domain/policy'
import { DomainError, ConflictError } from '../domain/errors'
import { canonicalJson } from '../domain/canonical-json'
import { predecessorRevision, revisionTarget } from '../domain/revisions'

export interface StoredCollection {
  info: CollectionInfo
  version: string
  cursor: string
  serverRevision?: string
  sequence: string
  sequences: Record<string, string>
  projects: ProjectRecord[]
  checkpoints: CheckpointRecord[]
  pending: PendingIntent[]
  receipts: Record<string, Receipt>
  operations: Record<string, { hash: string; savedAt: string }>
  tombstones: Record<string, string>
  anchors: { projects: ProjectRecord[]; checkpoints: CheckpointRecord[] }
  hydration: CollectionView['hydration']
  provenance?: LocalCollectionCandidate['provenance']
}
export const collectionInfoSchema = z
  .object({
    key: collectionKeySchema,
    name: z.string().min(1).max(100),
    kind: z.enum(['guest', 'connected', 'retained', 'recovered']),
    accountId: id.nullable(),
    createdAt: timestamp,
    legacyAccess: z.boolean(),
  })
  .strict()
  .refine((v) => (v.kind === 'connected') === (v.accountId !== null))
export function parseInfo(info: CollectionInfo): CollectionInfo {
  const parsed = collectionInfoSchema.safeParse(info)
  if (!parsed.success) throw new DomainError('VALIDATION')
  return parsed.data
}
export const keyOf = (key: CollectionInfo['key']) => JSON.stringify(collectionKeySchema.parse(key))
export const nextRevision = (revision: string): string => {
  const next = BigInt(revision) + 1n
  if (next > 9223372036854775807n) throw new DomainError('TECHNICAL_CAPACITY_REACHED')
  return String(next)
}
export function localRevision(...values: string[]): string {
  return nextRevision(values.reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b), '0'))
}
export const deviceKey = (device: { id: string; generation: string }) =>
  JSON.stringify([device.id, device.generation])
export function emptyCollection(info: CollectionInfo): StoredCollection {
  return {
    info: parseInfo(info),
    version: '0',
    cursor: '0',
    serverRevision: '0',
    sequence: '0',
    sequences: {},
    projects: [],
    checkpoints: [],
    pending: [],
    receipts: {},
    operations: {},
    tombstones: {},
    anchors: { projects: [], checkpoints: [] },
    hydration: info.kind === 'connected' ? 'empty' : 'ready',
  }
}
export function mediaRefs(checkpoints: CheckpointRecord[]): MediaRef[] {
  const refs = new Map<string, MediaRef>()
  for (const checkpoint of checkpoints)
    for (const ref of [checkpoint.photo, checkpoint.voice])
      if (ref) {
        const previous = refs.get(ref.id)
        if (previous && canonicalJson(previous) !== canonicalJson(ref))
          throw new DomainError('MEDIA_INVALID')
        refs.set(ref.id, ref)
      }
  return [...refs.values()]
}
export function assertRecords(projects: ProjectRecord[], checkpoints: CheckpointRecord[]): void {
  const ids = new Set<string>(),
    codes = new Set<string>()
  for (const p of projects) {
    if (!projectRecordSchema.safeParse(p).success || ids.has(p.id) || codes.has(p.code))
      throw new DomainError('VALIDATION')
    ids.add(p.id)
    codes.add(p.code)
  }
  const projectIds = new Set(ids)
  for (const c of checkpoints) {
    if (
      !checkpointRecordSchema.safeParse(c).success ||
      ids.has(c.id) ||
      !projectIds.has(c.projectId)
    )
      throw new DomainError('VALIDATION')
    ids.add(c.id)
  }
  mediaRefs(checkpoints)
  let portableBytes = 0
  for (const { revision: _revision, ...project } of projects) {
    const children = checkpoints
      .filter((c) => c.projectId === project.id)
      .map((c) => {
        const { projectId: _id, revision: _rev, photo, voice, ...rest } = c
        return { ...rest, ...(photo ? { photo: '' } : {}), ...(voice ? { voice: '' } : {}) }
      })
    portableBytes += utf8Bytes({ ...project, checkpoints: children })
    for (const c of checkpoints.filter((c) => c.projectId === project.id))
      for (const ref of [c.photo, c.voice])
        if (ref) portableBytes += portableMediaBytes(ref.bytes, ref.mimeType) - 2
  }
  assertCapacity({ projects: projects.length, checkpoints: checkpoints.length, portableBytes })
}
export function intentCommand(intent: LocalIntent): Command {
  const { createdAt, ...mutation } = intent
  if (!timestamp.safeParse(createdAt).success) throw new DomainError('VALIDATION')
  return parseCommand({
    ...mutation,
    protocolVersion: 2,
    payloadVersion: 1,
    collectionId: 'validation',
    epoch: 'validation',
    deviceId: 'validation',
    deviceGeneration: 'validation',
    sequence: '1',
    sha256: '0'.repeat(64),
  })
}
function mutateRecords(
  state: Pick<StoredCollection, 'projects' | 'checkpoints'>,
  intent: LocalIntent,
  revision: string,
  overlay: boolean,
): void {
  const needProject = (id: string) => {
    const p = state.projects.find((p) => p.id === id)
    if (!p) throw new DomainError('NOT_AVAILABLE')
    return p
  }
  switch (intent.kind) {
    case 'project.create': {
      if (state.projects.some((p) => p.id === intent.payload.project.id)) {
        if (overlay) return
        throw new DomainError('REVISION_CONFLICT')
      }
      state.projects.push({ ...intent.payload.project, revision })
      break
    }
    case 'project.update': {
      let p = state.projects.find((p) => p.id === intent.payload.projectId)
      if (!p && overlay) return
      p = needProject(intent.payload.projectId)
      Object.assign(p, intent.payload.fields, { updatedAt: intent.payload.updatedAt, revision })
      break
    }
    case 'project.status': {
      if (overlay && !state.projects.some((p) => p.id === intent.payload.projectId)) return
      Object.assign(needProject(intent.payload.projectId), {
        status: intent.payload.status,
        updatedAt: intent.payload.updatedAt,
        revision,
      })
      break
    }
    case 'project.delete': {
      if (!overlay) needProject(intent.payload.projectId)
      state.projects = state.projects.filter((p) => p.id !== intent.payload.projectId)
      state.checkpoints = state.checkpoints.filter((c) => c.projectId !== intent.payload.projectId)
      break
    }
    case 'checkpoint.create': {
      if (overlay && state.checkpoints.some((c) => c.id === intent.payload.checkpoint.id)) return
      if (overlay && !state.projects.some((p) => p.id === intent.payload.checkpoint.projectId))
        return
      const p = needProject(intent.payload.checkpoint.projectId)
      if (state.checkpoints.some((c) => c.id === intent.payload.checkpoint.id))
        throw new DomainError('REVISION_CONFLICT')
      state.checkpoints.push({ ...intent.payload.checkpoint, revision })
      p.updatedAt = p.updatedAt > intent.payload.updatedAt ? p.updatedAt : intent.payload.updatedAt
      p.revision = revision
      break
    }
    case 'media.attach': {
      const c = state.checkpoints.find(
        (c) => c.id === intent.payload.checkpointId && c.projectId === intent.payload.projectId,
      )
      if (!c && overlay) return
      if (!c) throw new DomainError('NOT_AVAILABLE')
      c[intent.payload.media.kind] = intent.payload.media
      c.revision = revision
      needProject(c.projectId).revision = revision
      break
    }
    case 'collection.replace':
      if (overlay) return
      throw new DomainError('SYNC_REBASE_REQUIRED')
  }
}
export function viewOf(state: StoredCollection): CollectionView {
  const result = structuredClone({
    info: state.info,
    revision: state.version,
    cursor: state.cursor,
    projects: state.projects,
    checkpoints: state.checkpoints,
    pending: state.pending,
    hydration: state.hydration,
  })
  if (state.pending.length) {
    const projectIds = new Set<string>(),
      checkpointIds = new Set<string>()
    for (const { intent } of state.pending) {
      if (intent.kind === 'project.create') projectIds.add(intent.payload.project.id)
      else if (intent.kind === 'checkpoint.create')
        projectIds.add(intent.payload.checkpoint.projectId)
      else if (intent.kind === 'media.attach') {
        projectIds.add(intent.payload.projectId)
        checkpointIds.add(intent.payload.checkpointId)
      } else if (intent.kind !== 'collection.replace') projectIds.add(intent.payload.projectId)
    }
    for (const project of state.anchors.projects)
      if (projectIds.has(project.id) && !result.projects.some((p) => p.id === project.id))
        result.projects.push(structuredClone(project))
    for (const checkpoint of state.anchors.checkpoints)
      if (
        checkpointIds.has(checkpoint.id) &&
        !result.checkpoints.some((c) => c.id === checkpoint.id) &&
        result.projects.some((p) => p.id === checkpoint.projectId)
      )
        result.checkpoints.push(structuredClone(checkpoint))
  }
  for (const pending of state.pending)
    mutateRecords(result, pending.intent, localOverlayRevision(result, pending.command), true)
  return result
}
function localOverlayRevision(
  state: Pick<StoredCollection, 'projects' | 'checkpoints'>,
  command: Command,
): string {
  const target = revisionTarget(command)
  return (
    (target.kind === 'checkpoint' ? state.checkpoints : state.projects).find(
      (p) => p.id === target.id,
    )?.revision ?? '0'
  )
}
export function acknowledgedRevision(state: StoredCollection): string {
  return [
    state.serverRevision ?? '0',
    state.cursor,
    ...Object.values(state.receipts).map((r) => r.revision),
    ...state.projects.map((p) => p.revision),
    ...state.checkpoints.map((c) => c.revision),
    ...Object.values(state.tombstones),
  ].reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b), '0')
}
export function assertIntentBase(state: StoredCollection, intent: LocalIntent): void {
  if (intent.kind === 'collection.replace') {
    if (
      state.info.kind !== 'connected' ||
      state.pending.length ||
      !intent.base ||
      !('revision' in intent.base) ||
      intent.base.revision !== acknowledgedRevision(state)
    )
      throw new DomainError('REVISION_CONFLICT')
    return
  }
  const command = {
    ...intentCommand(intent),
    collectionId: state.info.key.collectionId,
    epoch: state.info.key.epoch,
  }
  if (command.kind === 'project.create') return
  const view = viewOf(state),
    target = revisionTarget(command)
  const current =
    target.kind === 'project'
      ? view.projects.find((p) => p.id === target.id)
      : target.kind === 'checkpoint'
        ? view.checkpoints.find((c) => c.id === target.id)
        : null
  // Local immutable appends commute. Keep the captured intent/hash intact while transaction
  // retries include another tab's append; a removed parent is never recreated by this rule.
  if (
    state.info.kind !== 'connected' &&
    intent.kind === 'checkpoint.create' &&
    current &&
    intent.base &&
    'revision' in intent.base &&
    BigInt(intent.base.revision) <= BigInt(current.revision) &&
    (intent.base.revision === current.revision ||
      ('status' in current && current.status === 'active'))
  ) {
    const baseRevision = BigInt(intent.base.revision)
    const deleted = Object.values(state.receipts).some((receipt) =>
      receipt.changes.some(
        (change) =>
          change.kind === 'project.delete' &&
          change.id === intent.payload.checkpoint.projectId &&
          BigInt(change.revision) > baseRevision,
      ),
    )
    if (!deleted) return
  }
  if (intent.base && 'afterOperationId' in intent.base) {
    const previous = state.pending.find(
      (p) =>
        p.command.operationId === (intent.base as { afterOperationId: string }).afterOperationId,
    )
    if (previous) {
      const previousTarget = revisionTarget(previous.command)
      const produced =
        (previousTarget.kind === target.kind &&
          previousTarget.id === target.id &&
          previous.command.kind !== 'project.delete') ||
        (target.kind === 'checkpoint' &&
          previous.command.kind === 'checkpoint.create' &&
          previous.command.payload.checkpoint.id === target.id) ||
        (target.kind === 'project' &&
          previous.command.kind === 'media.attach' &&
          previous.command.payload.projectId === target.id)
      if (produced && current) return
    }
    const receipt = Object.hasOwn(state.receipts, intent.base.afterOperationId)
      ? state.receipts[intent.base.afterOperationId]
      : undefined
    if (receipt && current && predecessorRevision(command, receipt) === current.revision) return
  } else if (
    intent.base &&
    'revision' in intent.base &&
    current &&
    intent.base.revision === current.revision
  )
    return
  throw new ConflictError({
    operationId: intent.operationId,
    current: current ?? null,
    expected: intent.base,
  })
}
export function applyIntent(
  state: StoredCollection,
  intent: LocalIntent,
  options: { upgraded: boolean },
): void {
  intentCommand(intent)
  if (state.pending.some((p) => p.intent.kind === 'collection.replace'))
    throw new DomainError('SYNC_REBASE_REQUIRED')
  assertIntentBase(state, intent)
  if (intent.kind === 'collection.replace') return
  const view = viewOf(state)
  if (state.info.kind === 'connected') {
    const target = revisionTarget(intentCommand(intent))
    const checkpoint =
      target.kind === 'checkpoint' ? view.checkpoints.find((c) => c.id === target.id) : undefined
    const projectId = checkpoint?.projectId ?? target.id
    const project = view.projects.find((p) => p.id === projectId)
    if (project && !state.anchors.projects.some((p) => p.id === project.id))
      state.anchors.projects.push(structuredClone(project))
    if (checkpoint && !state.anchors.checkpoints.some((c) => c.id === checkpoint.id))
      state.anchors.checkpoints.push(structuredClone(checkpoint))
  }
  const action =
    intent.kind === 'project.create' && intent.payload.project.status === 'active'
      ? 'create'
      : intent.kind === 'project.status' &&
          intent.payload.status === 'active' &&
          view.projects.find((p) => p.id === intent.payload.projectId)?.status === 'finished'
        ? 'reopen'
        : 'edit'
  assertActiveCapacity({
    action,
    activeProjects: view.projects.filter((p) => p.status === 'active').length,
    upgraded: options.upgraded,
    connected: state.info.kind === 'connected',
    legacyLocalAccess: state.info.legacyAccess,
  })
  mutateRecords(
    view,
    intent,
    state.info.kind === 'connected'
      ? localOverlayRevision(view, intentCommand(intent))
      : nextRevision(state.version),
    false,
  )
  assertRecords(view.projects, view.checkpoints)
  if (state.info.kind !== 'connected') {
    state.projects = view.projects
    state.checkpoints = view.checkpoints
  }
}
export function applyReceipt(state: StoredCollection, input: Receipt): void {
  const receipt = parseReceipt(input)
  if (receipt.epoch !== state.info.key.epoch) throw new DomainError('SYNC_REBASE_REQUIRED')
  const existing = Object.hasOwn(state.receipts, receipt.operationId)
    ? state.receipts[receipt.operationId]
    : undefined
  if (existing && canonicalJson(existing) !== canonicalJson(receipt))
    throw new DomainError('OPERATION_REUSED')
  const pending = state.pending.find((p) => p.command.operationId === receipt.operationId)
  if (pending && pending.command.sha256 !== receipt.sha256)
    throw new DomainError('OPERATION_REUSED')
  for (const change of receipt.changes) {
    if (change.kind === 'collection.replaced') throw new DomainError('SYNC_REBASE_REQUIRED')
    const revision = 'value' in change ? change.value.revision : change.revision
    if (revision !== receipt.revision) throw new DomainError('SYNC_PAGE_INVALID')
    const id = 'value' in change ? change.value.id : change.id
    const kind = change.kind.startsWith('project.') ? 'project' : 'checkpoint'
    const tombstone = state.tombstones[`${kind}:${id}`] ?? '0'
    if (
      change.kind === 'checkpoint.put' &&
      BigInt(state.tombstones[`project:${change.value.projectId}`] ?? '0') >= BigInt(revision)
    )
      continue
    const current = (kind === 'project' ? state.projects : state.checkpoints).find(
      (p) => p.id === id,
    )
    if (
      BigInt(revision) < BigInt(current?.revision ?? '0') ||
      BigInt(revision) <= BigInt(tombstone)
    )
      continue
    switch (change.kind) {
      case 'project.put':
        state.projects = [...state.projects.filter((p) => p.id !== id), change.value]
        break
      case 'checkpoint.put':
        state.checkpoints = [...state.checkpoints.filter((c) => c.id !== id), change.value]
        break
      case 'project.delete':
        state.projects = state.projects.filter((p) => p.id !== id)
        state.checkpoints = state.checkpoints.filter((c) => c.projectId !== id)
        state.tombstones[`project:${id}`] = revision
        break
      case 'checkpoint.delete':
        state.checkpoints = state.checkpoints.filter((c) => c.id !== id)
        state.tombstones[`checkpoint:${id}`] = revision
        break
    }
  }
  state.serverRevision =
    BigInt(receipt.revision) > BigInt(state.serverRevision ?? '0')
      ? receipt.revision
      : (state.serverRevision ?? '0')
  state.receipts[receipt.operationId] = receipt
  state.pending = state.pending.filter((p) => p.command.operationId !== receipt.operationId)
  if (!state.pending.length) state.anchors = { projects: [], checkpoints: [] }
  assertRecords(state.projects, state.checkpoints)
}
export function hydrateState(
  state: StoredCollection,
  input: SnapshotManifest[],
  now: number,
): void {
  if (!input.length || state.pending.length) throw new DomainError('SYNC_REBASE_REQUIRED')
  const pages = input.map(parseSnapshot),
    first = pages[0]
  if (Date.parse(first.expiresAt) <= now) throw new DomainError('SNAPSHOT_EXPIRED')
  const cursors = new Set<string>()
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    if (p.nextPage !== null) {
      if (cursors.has(p.nextPage)) throw new DomainError('SYNC_PAGE_INVALID')
      cursors.add(p.nextPage)
    }
    if (
      p.after !== (i === 0 ? null : pages[i - 1].nextPage) ||
      p.snapshotId !== first.snapshotId ||
      p.collectionId !== state.info.key.collectionId ||
      p.epoch !== state.info.key.epoch ||
      p.cursor !== first.cursor ||
      p.revision !== first.revision ||
      p.expiresAt !== first.expiresAt ||
      (i === pages.length - 1 ? p.nextPage !== null : p.nextPage === null)
    )
      throw new DomainError('SYNC_PAGE_INVALID')
  }
  const projects = pages.flatMap((p) => p.projects),
    checkpoints = pages.flatMap((p) => p.checkpoints)
  assertRecords(projects, checkpoints)
  const refs = mediaRefs(checkpoints),
    declared = pages.flatMap((p) => p.media)
  if (
    new Set(declared.map((r) => r.id)).size !== declared.length ||
    refs.length !== declared.length ||
    refs.some((r) => !declared.some((d) => canonicalJson(d) === canonicalJson(r)))
  )
    throw new DomainError('SYNC_PAGE_INVALID')
  if ([...projects, ...checkpoints].some((r) => BigInt(r.revision) > BigInt(first.revision)))
    throw new DomainError('SYNC_PAGE_INVALID')
  state.projects = projects
  state.checkpoints = checkpoints
  state.cursor = first.cursor
  state.serverRevision = first.revision
  state.receipts = {}
  state.tombstones = {}
  state.anchors = { projects: [], checkpoints: [] }
  state.hydration = 'ready'
}

export interface ConflictResolution {
  operationId: string
  expectedRevision: string
  recoveryName: string
  replacement?: LocalIntent
}
/** Validate and detach exactly one rejected/conflicting operation and its dependent closure. */
export function prepareResolution(
  state: StoredCollection,
  resolution: ConflictResolution,
): { projects: ProjectRecord[]; checkpoints: CheckpointRecord[]; retired: string[] } {
  if (state.info.kind !== 'connected' || state.version !== resolution.expectedRevision)
    throw new DomainError('REVISION_CONFLICT')
  const first = state.pending.find((p) => p.intent.operationId === resolution.operationId)
  if (!first) throw new DomainError('NOT_AVAILABLE')
  if (first.state !== 'conflict' && first.state !== 'rejected')
    throw new DomainError('REVISION_CONFLICT')
  const retired = new Set([resolution.operationId])
  for (let changed = true; changed;) {
    changed = false
    for (const pending of state.pending)
      if (
        pending.intent.base &&
        'afterOperationId' in pending.intent.base &&
        retired.has(pending.intent.base.afterOperationId) &&
        !retired.has(pending.intent.operationId)
      ) {
        retired.add(pending.intent.operationId)
        changed = true
      }
  }
  const affected = new Set<string>()
  for (const pending of state.pending)
    if (retired.has(pending.intent.operationId)) {
      if (pending.state === 'attempted') throw new DomainError('REVISION_CONFLICT')
      const intent = pending.intent
      if (intent.kind === 'project.create') affected.add(intent.payload.project.id)
      else if (intent.kind === 'checkpoint.create')
        affected.add(intent.payload.checkpoint.projectId)
      else if (intent.kind !== 'collection.replace') affected.add(intent.payload.projectId)
    }
  const view = viewOf(state)
  const projects = view.projects.filter((p) => affected.has(p.id)),
    checkpoints = view.checkpoints.filter((c) => affected.has(c.projectId))
  if (resolution.replacement) {
    const intent = resolution.replacement,
      command = {
        ...intentCommand(intent),
        collectionId: state.info.key.collectionId,
        epoch: state.info.key.epoch,
      }
    if (
      retired.has(intent.operationId) ||
      Object.hasOwn(state.operations, intent.operationId) ||
      Object.hasOwn(state.receipts, intent.operationId)
    )
      throw new DomainError('OPERATION_REUSED')
    if (
      intent.kind === 'project.create' ||
      intent.kind === 'collection.replace' ||
      !intent.base ||
      !('revision' in intent.base)
    )
      throw new DomainError('REVISION_CONFLICT')
    const target = revisionTarget(command)
    const current = (target.kind === 'checkpoint' ? state.checkpoints : state.projects).find(
      (p) => p.id === target.id,
    )
    if (!current || current.revision !== intent.base.revision)
      throw new DomainError('REVISION_CONFLICT')
    const projectId = 'projectId' in current ? current.projectId : current.id
    if (!affected.has(projectId)) throw new DomainError('REVISION_CONFLICT')
  }
  state.pending = state.pending.filter((p) => !retired.has(p.intent.operationId))
  if (!state.pending.length) state.anchors = { projects: [], checkpoints: [] }
  return { projects, checkpoints, retired: [...retired] }
}

export function completeReplacementState(
  source: StoredCollection,
  operationId: string,
  receiptInput: Receipt,
  pages: SnapshotManifest[],
  device: { id: string; generation: string },
  now: number,
): { old: StoredCollection; next: StoredCollection } {
  const receipt = parseReceipt(receiptInput),
    pending = source.pending.find((p) => p.intent.operationId === operationId)
  if (
    source.info.kind !== 'connected' ||
    source.pending.length !== 1 ||
    !pending ||
    pending.command.kind !== 'collection.replace' ||
    pending.command.deviceId !== device.id ||
    pending.command.deviceGeneration !== device.generation ||
    receipt.operationId !== operationId ||
    receipt.sha256 !== pending.command.sha256 ||
    receipt.epoch !== source.info.key.epoch ||
    receipt.changes.length !== 1 ||
    receipt.changes[0].kind !== 'collection.replaced' ||
    receipt.changes[0].nextEpoch !== pending.command.payload.nextEpoch
  )
    throw new DomainError('SYNC_PAGE_INVALID')
  const next = emptyCollection({
    ...source.info,
    key: { ...source.info.key, epoch: pending.command.payload.nextEpoch },
  })
  hydrateState(next, pages, now)
  if (BigInt(pages[0].revision) < BigInt(receipt.revision))
    throw new DomainError('SYNC_PAGE_INVALID')
  next.sequences = { ...source.sequences }
  next.sequence = source.sequence
  next.version = localRevision(
    source.version,
    ...next.projects.map((p) => p.revision),
    ...next.checkpoints.map((c) => c.revision),
  )
  const old = structuredClone(source)
  old.info = {
    ...old.info,
    kind: 'recovered',
    accountId: null,
    name: `Previous ${old.info.name}`.slice(0, 100),
    legacyAccess: false,
  }
  old.pending = []
  old.anchors = { projects: [], checkpoints: [] }
  old.receipts[operationId] = receipt
  old.version = nextRevision(old.version)
  return { old, next }
}
