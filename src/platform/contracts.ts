import type {
  AccountSession,
  BoundaryResult,
  CollectionKey,
  Command,
  Generation,
  LocalizedProduct,
  MediaKind,
  MediaRef,
  PullPage,
  PullRequest,
  PurchaseIntent,
  PurchaseOutcome,
  ReauthenticationProof,
  Receipt,
  SnapshotManifest,
  SnapshotRequest,
} from '../domain/contracts'

export interface MediaInput {
  bytes: Blob
  kind: MediaKind
}
export interface PreparedMedia {
  ref: MediaRef
  scope: CollectionKey
  preparedAt: string
}
export interface PlatformMedia {
  prepare(input: MediaInput, scope: CollectionKey, generation: Generation): Promise<PreparedMedia>
  storeVerified(
    ref: MediaRef,
    bytes: Blob,
    scope: CollectionKey,
    generation: Generation,
    options?: { downloaded?: true },
  ): Promise<void>
  open(ref: MediaRef, scope: CollectionKey): Promise<ReadableStream<Uint8Array>>
  release(ref: MediaRef, scope: CollectionKey, generation: Generation): Promise<void>
}
export interface SyncTransport {
  releaseSnapshot(snapshotId: string, signal: AbortSignal): Promise<void>
  push(command: Command, signal: AbortSignal): Promise<Receipt>
  pull(input: PullRequest, signal: AbortSignal): Promise<PullPage>
  snapshot(input: SnapshotRequest, signal: AbortSignal): Promise<SnapshotManifest>
}
export interface BillingAdapter {
  products(): Promise<LocalizedProduct[]>
  purchase(intent: PurchaseIntent): Promise<PurchaseOutcome>
  restore(): Promise<PurchaseOutcome>
}
export interface CredentialStore {
  read(): Promise<string | null>
  write(value: string): Promise<void>
  clear(): Promise<void>
}
export interface AuthPort {
  requestCode(email: string, signal: AbortSignal): Promise<{ retryAt: string }>
  verifyCode(email: string, code: string, signal: AbortSignal): Promise<AccountSession>
  currentSession(signal: AbortSignal): Promise<AccountSession | null>
  reauthenticate(code: string, signal: AbortSignal): Promise<ReauthenticationProof>
  signOut(): Promise<void>
}
export interface CapturePort {
  photo(): Promise<BoundaryResult<MediaInput>>
  startRecording(): Promise<BoundaryResult<void>>
  stopRecording(): Promise<BoundaryResult<MediaInput>>
  cancelRecording(): Promise<void>
}
export interface SharePort {
  shareFile(input: { name: string; mimeType: string; bytes: Blob }): Promise<BoundaryResult<void>>
  chooseFile(): Promise<BoundaryResult<Blob>>
}
