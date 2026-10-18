import type {
  CheckpointCreate,
  CollectionKey,
  DeletionReceipt,
  MediaRef,
  ProjectCreate,
  ReauthenticationProof,
  Receipt,
  ReplacementPreview,
  Revision,
  UploadRequest,
  UploadReservation,
} from './contracts'
export interface AttachPreview {
  id: string
  source: { key: CollectionKey; name: string; revision: string }
  destination: { key: CollectionKey; name: string; revision: string; email: string }
  additions: number
  matches: number
  copies: number
  mappings: Array<{
    sourceId: string
    sourceCode: string
    destinationId: string
    destinationCode: string
  }>
  resulting: {
    projects: number
    activeProjects: number
    checkpoints: number
    portableBytes: number
  }
  expiresAt: string
}

/** Complete metadata only. Binary bytes use the authenticated media stream. */
export interface CandidateMetadata {
  projects: ProjectCreate[]
  checkpoints: CheckpointCreate[]
}
export interface CandidateDestination {
  collectionId: string
  epoch: string
  revision: Revision
}
export type CandidateRequest =
  | {
      action: 'prepare'
      requestId: string
      destination: CandidateDestination
      candidate: CandidateMetadata
    }
  | { action: 'status' | 'cancel'; reservationId: string }
export type AttachRequest =
  | {
      action: 'prepare'
      requestId: string
      source: AttachPreview['source']
      destination: CandidateDestination
      candidate: CandidateMetadata
    }
  | { action: 'status' | 'cancel'; reservationId: string }
export interface MediaMapping {
  /** ID in the submitted source candidate. Never a path or an authority claim. */
  sourceId: string
  destination: MediaRef
}
export interface CandidatePreparation {
  mode: 'attach' | 'replace'
  preview: AttachPreview | null
  replacement: ReplacementPreview
  nextEpoch: string
  /** Complete final mapped metadata, bound by replacement.candidateSha256. */
  candidate: CandidateMetadata
  mediaMappings: MediaMapping[]
  /** Distinct final references whose verified bytes are still required. */
  requiredMedia: MediaRef[]
  /** The exact committed command receipt, including after a lost response. */
  receipt: Receipt | null
}
export interface CancelledReservation {
  cancelled: true
}
export type MediaUploadRequest =
  | { action: 'reserve'; requestId: string; upload: UploadRequest; candidateId?: string }
  | { action: 'cancel'; reservationId: string }
export type MediaUploadResponse = UploadReservation | CancelledReservation
export interface MediaUploadVerified {
  reservationId: string
  verified: true
}
export interface MediaDownloadRequest {
  collectionId: string
  epoch: string
  mediaId: string
  snapshotId?: string
}
export interface AccountDeleteRequest {
  requestId: string
  receiptTokenHash: string
  reauthentication: ReauthenticationProof
}
export interface DeletionStatusRequest {
  requestId: string
  receiptToken: string
}
export type AccountDeleteResponse = DeletionReceipt
export interface NativeBillingConfigRequest {
  platform: 'ios' | 'android'
}
export interface NativeBillingConfig {
  platform: 'ios' | 'android'
  publicSdkKey: string
  productIds: string[]
  environment: 'sandbox' | 'production'
}

export interface CandidateMerge {
  candidate: CandidateMetadata
  mediaMappings: MediaMapping[]
  additions: number
  matches: number
  copies: number
  mappings: AttachPreview['mappings']
}
