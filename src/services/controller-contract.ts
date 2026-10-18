import type {
  CollectionInfo,
  CollectionKey,
  CollectionView,
  ProjectFields,
  SessionScope,
} from '../domain/contracts'
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
  scope: SessionScope | null
  collections: CollectionSummary[]
  view: CollectionView | null
  account: { accountId: string; email: string } | null
  auth: 'guest' | 'sending-code' | 'code-sent' | 'authenticated' | 'expired'
  sync: {
    state: 'offline' | 'idle' | 'syncing' | 'pending' | 'conflict' | 'error'
    pending: number
    lastSyncedAt: string | null
  }
  error: SafeError | null
}
export type ConflictChoice =
  | { action: 'cloud' }
  | { action: 'device' }
  | { action: 'merged'; fields: ProjectFields }
  | { action: 'later' }
export interface AppController {
  initialize(): Promise<void>
  getSnapshot(): ControllerState
  subscribe(listener: () => void): () => void
  requestCode(email: string): Promise<{ retryAt: string }>
  verifyCode(email: string, code: string): Promise<void>
  completeCallback(url: string): Promise<void>
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
  chooseCollection(key: CollectionKey): Promise<void>
  runSync(): Promise<void>
  retryOperations(operationIds: string[]): Promise<void>
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
