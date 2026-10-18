import type {
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

export interface Repository {
  listCollections(): Promise<CollectionInfo[]>
  createCollection(info: CollectionInfo): Promise<void>
  importLocal(
    candidate: LocalCollectionCandidate,
    options: { generation: Generation; replace?: { key: CollectionKey; revision: string } },
  ): Promise<CollectionView>
  retainLocal(
    key: CollectionKey,
    name: string,
    expectedRevision: string,
    generation: Generation,
  ): Promise<CollectionKey>
  removeLocal(key: CollectionKey, expectedRevision: string, generation: Generation): Promise<void>
  activate(scope: SessionScope): Promise<void>
  commitLocal(key: CollectionKey, intent: LocalIntent, generation: Generation): Promise<LocalCommit>
  readView(key: CollectionKey): Promise<CollectionView>
  applyPage(key: CollectionKey, page: PullPage, generation: Generation): Promise<void>
  acknowledge(key: CollectionKey, receipt: Receipt, generation: Generation): Promise<void>
  hydrate(key: CollectionKey, pages: SnapshotManifest[], generation: Generation): Promise<void>
  recoverPending(key: CollectionKey, reason: RecoveryReason): Promise<CollectionKey>
  snapshot(key: CollectionKey): Promise<LocalSnapshot>
  releaseSnapshot(id: string): Promise<void>
  pending(key: CollectionKey): Promise<PendingIntent[]>
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
