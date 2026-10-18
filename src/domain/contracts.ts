import type { Checkpoint, Project } from './portable'
import type { SafeError } from './errors'
export type {
  Backup,
  Checkpoint,
  Project,
  ProjectInput,
  CheckpointInput,
  Craft,
  ProjectColor,
} from './portable'

// Validated at every persistence/network boundary. Never convert these values to Number.
export type Revision = string
export type Generation = number
export type CollectionKey = { namespace: string; collectionId: string; epoch: string }
export type Base = { revision: Revision } | { afterOperationId: string }
export type CollectionKind = 'guest' | 'connected' | 'retained' | 'recovered'
export interface CollectionInfo {
  key: CollectionKey
  name: string
  kind: CollectionKind
  accountId: string | null
  createdAt: string
  legacyAccess: boolean
}
export type MediaKind = 'photo' | 'voice'
export interface MediaRef {
  id: string
  kind: MediaKind
  mimeType: string
  bytes: number
  sha256: string
}
export type ProjectRecord = Omit<Project, 'checkpoints'> & { revision: Revision }
export type CheckpointRecord = Omit<Checkpoint, 'photo' | 'voice'> & {
  projectId: string
  revision: Revision
  photo?: MediaRef
  voice?: MediaRef
}
export type ProjectCreate = Omit<ProjectRecord, 'revision' | 'sample'>
export type ProjectFields = Pick<
  Project,
  'name' | 'craft' | 'color' | 'yarn' | 'toolSize' | 'notes'
>
export type CheckpointCreate = Omit<CheckpointRecord, 'revision'>
export type Mutation =
  | { kind: 'project.create'; payload: { project: ProjectCreate } }
  | {
      kind: 'project.update'
      payload: { projectId: string; fields: ProjectFields; updatedAt: string }
    }
  | {
      kind: 'project.status'
      payload: { projectId: string; status: Project['status']; updatedAt: string }
    }
  | { kind: 'project.delete'; payload: { projectId: string } }
  | { kind: 'checkpoint.create'; payload: { checkpoint: CheckpointCreate; updatedAt: string } }
  | {
      kind: 'media.attach'
      payload: { projectId: string; checkpointId: string; reservationId: string; media: MediaRef }
    }
  | {
      kind: 'collection.replace'
      payload: { reservationId: string; candidateSha256: string; nextEpoch: string }
    }
export type CommandKind = Mutation['kind']
export type Command = Mutation & {
  protocolVersion: 2
  payloadVersion: 1
  collectionId: string
  epoch: string
  deviceId: string
  deviceGeneration: string
  sequence: Revision
  operationId: string
  base: Base | null
  sha256: string
}
export type UnsignedCommand = Command extends infer C
  ? C extends Command
    ? Omit<C, 'sha256'>
    : never
  : never
export type LocalIntent = Mutation & { operationId: string; base: Base | null; createdAt: string }
export type EntityChange =
  | { kind: 'project.put'; value: ProjectRecord }
  | { kind: 'project.delete'; id: string; revision: Revision }
  | { kind: 'checkpoint.put'; value: CheckpointRecord }
  | { kind: 'checkpoint.delete'; id: string; projectId: string; revision: Revision }
  | { kind: 'collection.replaced'; nextEpoch: string }
export interface Receipt {
  operationId: string
  sha256: string
  epoch: string
  revision: Revision
  cursor: Revision
  resultId: string
  changes: EntityChange[]
}
export interface PullRequest {
  collectionId: string
  epoch: string
  afterCursor: Revision
  deviceId: string
  deviceGeneration: string
}
export interface PullPage {
  protocolVersion: 2
  collectionId: string
  epoch: string
  afterCursor: Revision
  nextCursor: Revision
  hasMore: boolean
  entries: Receipt[]
}
export type SnapshotRequest =
  | { action: 'create'; collectionId: string; purpose: 'hydrate' | 'export' }
  | { action: 'page'; snapshotId: string; after: string | null }
  | { action: 'renew'; snapshotId: string }
export interface SnapshotManifest {
  protocolVersion: 2
  snapshotId: string
  collectionId: string
  epoch: string
  cursor: Revision
  revision: Revision
  expiresAt: string
  projects: ProjectRecord[]
  checkpoints: CheckpointRecord[]
  media: MediaRef[]
  nextPage: string | null
}
export type PendingState = 'queued' | 'attempted' | 'conflict' | 'rejected'
export interface PendingIntent {
  intent: LocalIntent
  command: Command
  state: PendingState
  error?: SafeError
}
export interface CollectionView {
  info: CollectionInfo
  revision: Revision
  cursor: Revision
  projects: ProjectRecord[]
  checkpoints: CheckpointRecord[]
  pending: PendingIntent[]
  hydration: 'empty' | 'loading' | 'ready'
}
export interface LocalCommit {
  operationId: string
  savedAt: string
  view: CollectionView
}
export interface LocalSnapshot {
  id: string
  view: CollectionView
  media: MediaRef[]
  createdAt: string
}
export interface LocalCollectionCandidate {
  info: CollectionInfo
  projects: ProjectRecord[]
  checkpoints: CheckpointRecord[]
  provenance: {
    kind: 'backup' | 'legacy' | 'retained' | 'recovered'
    sourceId: string
    capturedAt: string
  }
}
export type RecoveryReason =
  'epoch-changed' | 'device-retired' | 'account-changed' | 'server-conflict'
export interface DeviceIdentity {
  id: string
  generation: string
}
export interface SessionScope {
  key: CollectionKey
  generation: Generation
  device: DeviceIdentity
}
export interface AccountSession {
  accountId: string
  billingPrincipalId: string
  deletionGeneration: Revision
  collection: CollectionKey
  device: DeviceIdentity
  expiresAt: string
}
export type AuthState =
  | { state: 'guest' }
  | { state: 'code-sent'; retryAt: string }
  | { state: 'authenticated'; session: AccountSession }
  | { state: 'expired' }
export interface ReauthenticationProof {
  challengeId: string
  proof: string
  expiresAt: string
}
export interface Conflict {
  operationId: string
  current: ProjectRecord | CheckpointRecord | null
  expected: Base | null
}
export type BoundaryResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'cancelled'; mayHaveCommitted: boolean; operationId?: string }
  | { status: 'conflict'; conflict: Conflict; error: SafeError }
  | { status: 'retryable' | 'rejected' | 'unavailable'; error: SafeError }

export interface UploadRequest {
  collectionId: string
  epoch: string
  media: MediaRef
}
export interface UploadReservation {
  id: string
  collectionId: string
  epoch: string
  media: MediaRef
  expiresAt: string
  deletionGeneration: Revision
}
export interface ReplacementPreview {
  reservationId: string
  collectionId: string
  epoch: string
  revision: Revision
  candidateSha256: string
  projects: number
  checkpoints: number
  mediaBytes: number
  portableBytes: number
  expiresAt: string
}
export type DeletionReceipt =
  | { status: 'pending'; requestedAt: string }
  | { status: 'live-data-removed'; removedAt: string; backupExpiresAt: string }
  | { status: 'complete'; completedAt: string }
  | { status: 'needs-help'; helpRef: 'account#deletion'; correlationId: string }
export interface ErasureIntent {
  accountId: string
  deletionGeneration: Revision
  requestId: string
  receiptTokenHash: string
  requestedAt: string
  retainUntil: string
}
export interface ErasureInventory {
  watermark: string
  asOf: string
  entries: ErasureIntent[]
  nextCursor: string | null
}
export interface ErasureLedger {
  append(intent: ErasureIntent): Promise<{ watermark: string }>
  inventory(cursor: string | null): Promise<ErasureInventory>
  currentWatermark(): Promise<string>
}

export type PurchaseProvider = 'razorpay' | 'revenuecat'
export type PurchaseEnvironment = 'sandbox' | 'production'
export interface LocalizedProduct {
  id: string
  title: string
  displayPrice: string
  currency: string
  amountMinor: number
  provider: PurchaseProvider
}
export interface PurchaseIntent {
  attemptId: string
  accountId: string
  billingPrincipalId: string
  productId: string
  collection: CollectionKey
  generation: Generation
  returnAction: 'new-project' | 'reopen-project' | 'settings'
  draftKey?: string
  projectId?: string
}
export type PurchaseOutcome =
  | { status: 'submitted' | 'pending'; attemptId: string }
  | { status: 'cancelled' }
  | { status: 'none' }
  | { status: 'account-mismatch'; error: SafeError }
  | { status: 'unavailable' | 'failed'; error: SafeError }
// Adapter outcomes do not include "paid". Only the server's ledger establishes access.
export interface PurchaseGrant {
  provider: PurchaseProvider
  environment: PurchaseEnvironment
  canonicalPurchaseId: string
  billingPrincipalId: string
  productId: string
  state: 'valid' | 'pending' | 'failed' | 'disputed' | 'refunded' | 'revoked'
  observedAt: string
  observationId: string
}
export interface EntitlementProjection {
  billingPrincipalId: string
  accountId: string
  upgraded: boolean
  revision: Revision
  verifiedAt: string
}
export interface PurchaseRecoveryRequest {
  requestId: string
  reauthentication: ReauthenticationProof
  provider: PurchaseProvider
  evidenceId: string
  recoveryKey?: string
}
export type PurchaseRecoveryOutcome =
  | { status: 'pending'; caseId: string }
  | { status: 'recovered'; entitlement: EntitlementProjection; recoveryKey: string }
  | { status: 'denied'; error: SafeError }
export interface WorkerLease {
  id: string
  fence: Revision
  expiresAt: string
}
export interface OperationReport {
  schemaVersion: 1
  status: 'ok' | 'partial' | 'denied' | 'unavailable'
  dryRun: boolean
  counts: { examined: number; changed: number; failed: number }
  nextCursor: string | null
  jobId: string | null
  errors: SafeError[]
}
