import { z } from 'zod'
import { canonicalHash, canonicalJson } from './canonical-json'
import { DomainError } from './errors'
import {
  LIMITS,
  MAX_CHECKPOINTS,
  MAX_LIBRARY_BYTES,
  MAX_PROJECTS,
  portableMediaBytes,
  utf8Bytes,
} from './policy'
import {
  checkpointCreateSchema,
  collectionKeySchema,
  hashSchema,
  id,
  mediaRefSchema,
  nonBlank,
  projectCreateSchema,
  receiptSchema,
  replacementPreviewSchema,
  revisionSchema,
  timestamp,
  uploadRequestSchema,
} from './schema'
import type { CandidateMetadata, CandidatePreparation } from './remote-contracts'

export function candidatePortableBytes(candidate: CandidateMetadata): number {
  let attachmentBytes = 0
  const projects = candidate.projects.map((project) => ({
    ...project,
    checkpoints: candidate.checkpoints
      .filter((checkpoint) => checkpoint.projectId === project.id)
      .map((checkpoint) => {
        const { projectId: _parent, photo, voice, ...fields } = checkpoint
        for (const ref of [photo, voice])
          if (ref) attachmentBytes += portableMediaBytes(ref.bytes, ref.mimeType) - 2
        return { ...fields, ...(photo ? { photo: '' } : {}), ...(voice ? { voice: '' } : {}) }
      }),
  }))
  // Logical capacity counts serialized project objects; the complete backup has its own 50 MiB guard.
  return projects.reduce((sum, project) => sum + utf8Bytes(project), 0) + attachmentBytes
}
export const candidateMetadataSchema = z
  .object({
    projects: z.array(projectCreateSchema).max(MAX_PROJECTS),
    checkpoints: z.array(checkpointCreateSchema).max(MAX_CHECKPOINTS),
  })
  .strict()
  .superRefine((candidate, context) => {
    const ids = new Set<string>(),
      codes = new Set<string>(),
      projectIds = new Set<string>()
    const media = new Map<string, string>()
    let invalid = false
    for (const project of candidate.projects) {
      if (ids.has(project.id) || codes.has(project.code)) invalid = true
      ids.add(project.id)
      projectIds.add(project.id)
      codes.add(project.code)
    }
    for (const checkpoint of candidate.checkpoints) {
      if (ids.has(checkpoint.id) || !projectIds.has(checkpoint.projectId)) invalid = true
      ids.add(checkpoint.id)
      for (const ref of [checkpoint.photo, checkpoint.voice])
        if (ref) {
          const serialized = canonicalJson(ref)
          if (media.has(ref.id) && media.get(ref.id) !== serialized) invalid = true
          media.set(ref.id, serialized)
        }
    }
    try {
      canonicalJson(candidate)
      if (
        utf8Bytes(candidate) > LIMITS.replacementMetadataBytes ||
        candidatePortableBytes(candidate) > MAX_LIBRARY_BYTES
      )
        invalid = true
    } catch {
      invalid = true
    }
    if (invalid)
      context.addIssue({
        code: 'custom',
        message: 'Invalid candidate relationships, identities, media, or capacity',
      })
  })
export const candidateDestinationSchema = z
  .object({ collectionId: id, epoch: id, revision: revisionSchema })
  .strict()
const sourceSchema = z
  .object({ key: collectionKeySchema, name: nonBlank(100), revision: revisionSchema })
  .strict()
const statusRequest = z.object({ action: z.literal('status'), reservationId: id }).strict()
const cancelRequest = z.object({ action: z.literal('cancel'), reservationId: id }).strict()
export const candidateRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('prepare'),
      requestId: id,
      destination: candidateDestinationSchema,
      candidate: candidateMetadataSchema,
    })
    .strict(),
  statusRequest,
  cancelRequest,
])
export const attachRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('prepare'),
      requestId: id,
      source: sourceSchema,
      destination: candidateDestinationSchema,
      candidate: candidateMetadataSchema,
    })
    .strict(),
  statusRequest,
  cancelRequest,
])
const count = (maximum: number) => z.number().int().min(0).max(maximum)
export const attachPreviewSchema = z
  .object({
    id,
    source: sourceSchema,
    destination: z
      .object({
        key: collectionKeySchema,
        name: nonBlank(100),
        revision: revisionSchema,
        email: z.string().email().max(320),
      })
      .strict(),
    additions: count(MAX_PROJECTS),
    matches: count(MAX_PROJECTS),
    copies: count(MAX_PROJECTS),
    mappings: z
      .array(
        z
          .object({
            sourceId: id,
            sourceCode: z.string().max(24),
            destinationId: id,
            destinationCode: z.string().max(24),
          })
          .strict(),
      )
      .max(MAX_PROJECTS),
    resulting: z
      .object({
        projects: count(MAX_PROJECTS),
        activeProjects: count(MAX_PROJECTS),
        checkpoints: count(MAX_CHECKPOINTS),
        portableBytes: count(MAX_LIBRARY_BYTES),
      })
      .strict(),
    expiresAt: timestamp,
  })
  .strict()
export const candidatePreparationSchema = z
  .object({
    mode: z.enum(['attach', 'replace']),
    preview: attachPreviewSchema.nullable(),
    replacement: replacementPreviewSchema,
    nextEpoch: id,
    candidate: candidateMetadataSchema,
    mediaMappings: z
      .array(z.object({ sourceId: id, destination: mediaRefSchema }).strict())
      .max(2 * MAX_CHECKPOINTS),
    requiredMedia: z.array(mediaRefSchema).max(2 * MAX_CHECKPOINTS),
    receipt: receiptSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const refs = new Map(
      value.candidate.checkpoints
        .flatMap((checkpoint) => [checkpoint.photo, checkpoint.voice].filter((v) => !!v))
        .map((ref) => [ref.id, canonicalJson(ref)]),
    )
    const required = new Set<string>(),
      sources = new Set<string>()
    let invalid =
      value.nextEpoch === value.replacement.epoch ||
      (value.mode === 'attach') !== (value.preview !== null)
    for (const ref of value.requiredMedia) {
      if (required.has(ref.id) || refs.get(ref.id) !== canonicalJson(ref)) invalid = true
      required.add(ref.id)
    }
    for (const mapping of value.mediaMappings) {
      if (
        sources.has(mapping.sourceId) ||
        refs.get(mapping.destination.id) !== canonicalJson(mapping.destination)
      )
        invalid = true
      sources.add(mapping.sourceId)
    }
    if (
      value.replacement.projects !== value.candidate.projects.length ||
      value.replacement.checkpoints !== value.candidate.checkpoints.length ||
      value.replacement.portableBytes !== candidatePortableBytes(value.candidate)
    )
      invalid = true
    if (
      value.preview &&
      (value.preview.id !== value.replacement.reservationId ||
        value.preview.expiresAt !== value.replacement.expiresAt ||
        value.preview.destination.key.collectionId !== value.replacement.collectionId ||
        value.preview.destination.key.epoch !== value.replacement.epoch ||
        value.preview.destination.revision !== value.replacement.revision)
    )
      invalid = true
    if (
      value.receipt &&
      (value.receipt.epoch !== value.replacement.epoch ||
        !value.receipt.changes.some(
          (change) => change.kind === 'collection.replaced' && change.nextEpoch === value.nextEpoch,
        ))
    )
      invalid = true
    if (invalid)
      context.addIssue({
        code: 'custom',
        message: 'Candidate preparation does not match its immutable preview',
      })
  })
export const mediaUploadRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('reserve'),
      requestId: id,
      upload: uploadRequestSchema,
      candidateId: id.optional(),
    })
    .strict(),
  cancelRequest,
])
export const mediaUploadVerifiedSchema = z
  .object({ reservationId: id, verified: z.literal(true) })
  .strict()
export const cancelledReservationSchema = z.object({ cancelled: z.literal(true) }).strict()
export const mediaDownloadRequestSchema = z
  .object({ collectionId: id, epoch: id, mediaId: id, snapshotId: id.optional() })
  .strict()
export const reauthenticationProofSchema = z
  .object({ challengeId: id, proof: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: timestamp })
  .strict()
export const accountDeleteRequestSchema = z
  .object({
    requestId: id,
    receiptTokenHash: hashSchema,
    reauthentication: reauthenticationProofSchema,
  })
  .strict()
export const deletionStatusRequestSchema = z
  .object({ requestId: id, receiptToken: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict()
export const nativeBillingConfigRequestSchema = z
  .object({ platform: z.enum(['ios', 'android']) })
  .strict()
export const nativeBillingConfigSchema = z
  .object({
    platform: z.enum(['ios', 'android']),
    publicSdkKey: z.string(),
    productIds: z
      .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/))
      .min(1)
      .max(10),
    environment: z.enum(['sandbox', 'production']),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !(value.platform === 'ios' ? /^appl_[A-Za-z0-9]{16,}$/ : /^goog_[A-Za-z0-9]{16,}$/).test(
        value.publicSdkKey,
      ) ||
      new Set(value.productIds).size !== value.productIds.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Native product configuration does not match the platform',
      })
  })
export function parseCandidatePreparation(input: unknown): CandidatePreparation {
  const parsed = candidatePreparationSchema.safeParse(input)
  if (!parsed.success) throw new DomainError('VALIDATION')
  return parsed.data
}

export async function verifyCandidatePreparation(input: unknown): Promise<CandidatePreparation> {
  const parsed = parseCandidatePreparation(input)
  if ((await canonicalHash(parsed.candidate)) !== parsed.replacement.candidateSha256)
    throw new DomainError('VALIDATION')
  return parsed
}
