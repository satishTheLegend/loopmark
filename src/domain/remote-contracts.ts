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

export interface AccountUsageRequest {
  collectionId: string
  epoch: string
}
export interface AccountUsage {
  collectionId: string
  epoch: string
  revision: Revision
  observedAt: string
  projects: number
  activeProjects: number
  checkpoints: number
  portableBytes: number
  /** Storage service metadata, including this owner's staged and orphan objects. */
  storedBytes: number
  storedObjects: number
  /** Conservative physical admission meter, including allocated but not uploaded objects. */
  allocatedBytes: number
  unfinishedUploads: number
  ordinaryStagedBytes: number
  candidateMediaBytes: number
  limits: {
    projects: 200
    checkpoints: 1000
    portableBytes: 50331648
    uploads: 4
    ordinaryStagedBytes: 33554432
    candidateMediaBytes: 41943040
    allocatedBytes: 83886080
  }
}
