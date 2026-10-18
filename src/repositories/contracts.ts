import type {
  AccountSession,
  CollectionInfo,
  CollectionKey,
  CollectionView,
  Generation,
  LocalCommit,
  LocalCollectionCandidate,
  LocalIntent,
  LocalSnapshot,
  PendingIntent,
  PullPage,
  Receipt,
  RecoveryReason,
  SessionScope,
  SnapshotManifest,
} from '../domain/contracts'
import type { SafeError } from '../domain/errors'

export interface LocalCollectionReview {
  key: CollectionKey
  revision: string
  drafts: Array<{ key: string; revision: string }>
}
export interface RebaseInput {
  session: AccountSession
  pages: SnapshotManifest[]
  recoveryId: string
  recoveryName: string
  allowMissingMedia?: boolean
}
export interface RebaseResult {
  scope: SessionScope
  recovered: CollectionKey
}
export interface Repository {
  rebaseBlocked(key: CollectionKey): Promise<boolean>
  completeRebase(
    expected: SessionScope,
    review: LocalCollectionReview,
    input: RebaseInput,
  ): Promise<RebaseResult>

  readActive(): Promise<SessionScope | null>
  reviewLocal(key: CollectionKey): Promise<LocalCollectionReview>
  /** Atomic complete-scope CAS, optional collection/draft-set CAS, and generation increment. */
  transition(
    expected: SessionScope | null,
    target: Pick<SessionScope, 'key' | 'device'>,
    review?: LocalCollectionReview,
  ): Promise<SessionScope>
  listCollections(): Promise<CollectionInfo[]>
  createCollection(info: CollectionInfo): Promise<void>
  importLocal(
    candidate: LocalCollectionCandidate,
    options: {
      generation: Generation
      replace?: { key: CollectionKey; revision: string }
      mediaSource?: CollectionKey
    },
  ): Promise<CollectionView>
  retainLocal(
    key: CollectionKey,
    name: string,
    expectedRevision: string,
    generation: Generation,
    options?: { allowMissingMedia?: boolean },
  ): Promise<CollectionKey>
  removeLocal(key: CollectionKey, expectedRevision: string, generation: Generation): Promise<void>
  activate(scope: SessionScope): Promise<void>
  commitLocal(key: CollectionKey, intent: LocalIntent, generation: Generation): Promise<LocalCommit>
  readView(key: CollectionKey): Promise<CollectionView>
  /** Durable server shadow, never the local pending overlay; pending is always empty. */
  readAcknowledged(key: CollectionKey): Promise<CollectionView>
  resolvePending(
    key: CollectionKey,
    resolution: {
      operationId: string
      expectedRevision: string
      recoveryName: string
      replacement?: LocalIntent
    },
    generation: Generation,
  ): Promise<{ recovered: CollectionKey | null; commit: LocalCommit | null }>
  completeReplacement(
    key: CollectionKey,
    input: { operationId: string; receipt: Receipt; pages: SnapshotManifest[] },
    generation: Generation,
  ): Promise<SessionScope>
  applyPage(key: CollectionKey, page: PullPage, generation: Generation): Promise<void>
  acknowledge(key: CollectionKey, receipt: Receipt, generation: Generation): Promise<void>
  hydrate(key: CollectionKey, pages: SnapshotManifest[], generation: Generation): Promise<void>
  recoverPending(key: CollectionKey, reason: RecoveryReason): Promise<CollectionKey>
  /** Recovery mode pins saved refs even if matching cached bytes are absent/corrupt; descriptor collisions still reject. */
  snapshot(key: CollectionKey, options?: { allowMissingMedia?: boolean }): Promise<LocalSnapshot>
  releaseSnapshot(id: string): Promise<void>
  pending(key: CollectionKey): Promise<PendingIntent[]>
  resumeAfterAuthentication(key: CollectionKey, generation: Generation): Promise<void>
  markAttempt(key: CollectionKey, operationId: string, generation: Generation): Promise<void>
  markFailure(
    key: CollectionKey,
    operationId: string,
    error: SafeError,
    generation: Generation,
  ): Promise<void>
  subscribe(listener: () => void): () => void
  close(): Promise<void>
}
