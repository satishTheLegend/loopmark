import type {
  AccountSession,
  CollectionInfo,
  CollectionKey,
  CollectionView,
  ProjectFields,
  SessionScope,
} from '../domain/contracts'
import type { LocalCollectionReview, RebaseResult } from '../repositories/contracts'
import type { AttachmentItem } from './attachment-queue'
import type { SafeError } from '../domain/errors'
export interface LocalWorkCounts {
  drafts: number
  unsentProjectChanges: number
  unsentCheckpoints: number
  pendingAttachments: number
  failedAttachments: number
  missingAttachments: number | null
  recoveredCollections: number
}
export interface CollectionSummary extends CollectionInfo {
  projects: number
  checkpoints: number
  drafts: number
}
export type { AttachPreview } from '../domain/remote-contracts'
import type { AttachPreview } from '../domain/remote-contracts'
export interface ControllerState {
  phase: 'starting' | 'ready' | 'error'
  /** Local selection/authentication work must settle before automatic sync starts. */
  transitioning: boolean
  scope: SessionScope | null
  collections: CollectionSummary[]
  view: CollectionView | null
  account: { accountId: string; email: string } | null
  auth: 'guest' | 'sending-code' | 'code-sent' | 'authenticated' | 'expired'
  sync: {
    state: 'offline' | 'idle' | 'syncing' | 'pending' | 'conflict' | 'error'
    pending: number
    pendingAttachments?: number
    failedAttachments?: number
    lastSyncedAt: string | null
  }
  error: SafeError | null
}
export type ConflictChoice =
  | { action: 'cloud' }
  | { action: 'device' }
  | { action: 'merged'; fields: ProjectFields }
  | { action: 'later' }
export interface SyncRecoveryPreview {
  scope: SessionScope
  review: LocalCollectionReview
  recoveryId: string
  counts: {
    projects: number
    checkpoints: number
    drafts: number
    unsent: number
    missingAttachments: number | null
  }
  blockedByReplacement: boolean
}
export interface AppController {
  prepareSyncRecovery(): Promise<SyncRecoveryPreview>
  recoverSync(
    preview: SyncRecoveryPreview,
    options?: { allowMissingAttachments?: boolean },
  ): Promise<RebaseResult>

  initialize(): Promise<void>
  getSnapshot(): ControllerState
  getSession(): AccountSession | null
  subscribe(listener: () => void): () => void
  requestCode(email: string): Promise<{ retryAt: string }>
  verifyCode(email: string, code: string): Promise<void>
  completeCallback(url: string): Promise<void>
  refreshAuthentication(): Promise<void>
  prepareSignOut(): Promise<LocalWorkCounts>
  signOut(options: {
    keepLocal: boolean
    discardUniqueWork?: boolean
    allowMissingAttachments?: boolean
  }): Promise<void>
  deleteAccount(
    options: { keepLocal: boolean; discardUniqueWork?: boolean; allowMissingAttachments?: boolean },
    revoke: (scope: SessionScope) => Promise<void>,
  ): Promise<void>
  chooseCollection(key: CollectionKey, expectedSource?: SessionScope): Promise<void>
  runSync(): Promise<void>
  retryOperations(operationIds: string[]): Promise<void>
  listAttachments(): Promise<AttachmentItem[]>
  retryAttachments(ids: string[]): Promise<void>
  loadConflict(operationId: string): Promise<{ view: CollectionView; acknowledged: CollectionView }>
  previewAttach(source: CollectionKey): Promise<AttachPreview>
  confirmAttach(preview: AttachPreview): Promise<void>
  resolveConflict(
    operationId: string,
    expectedRevision: string,
    choice: ConflictChoice,
  ): Promise<void>
  dispose(): Promise<void>
}
