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
import type {
  AttachPreview,
  CandidateMerge,
  CandidateMetadata,
  CandidatePreparation,
  MediaMapping,
} from './remote-contracts'
import type { MediaRef } from './contracts'

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

/** Pure preview, shared by device and server. No network, mutation, clock or randomness. */
export async function mergeCandidate(
  mode: 'attach' | 'replace',
  requestId: string,
  sourceInput: CandidateMetadata,
  destinationInput: CandidateMetadata,
): Promise<CandidateMerge> {
  id.parse(requestId)
  const source = candidateMetadataSchema.parse(sourceInput)
  const destination = candidateMetadataSchema.parse(destinationInput)
  const result: CandidateMetadata =
    mode === 'attach' ? structuredClone(destination) : { projects: [], checkpoints: [] }
  const refs = (candidate: CandidateMetadata) =>
    new Map(
      candidate.checkpoints
        .flatMap((checkpoint) => [checkpoint.photo, checkpoint.voice].filter((ref) => !!ref))
        .map((ref) => [ref.id, ref]),
    )
  const existingRefs = mode === 'attach' ? refs(destination) : new Map<string, MediaRef>()
  const stableId = async (kind: string, sourceId: string, occupied: Set<string>) => {
    for (let attempt = 0; attempt <= MAX_PROJECTS + MAX_CHECKPOINTS * 2; attempt++) {
      const hash = await canonicalHash({ requestId, kind, sourceId, attempt })
      const value = `lm_${hash.slice(0, 40)}`
      if (!occupied.has(value)) return value
    }
    throw new DomainError('TECHNICAL_CAPACITY_REACHED')
  }
  const mediaMappings: MediaMapping[] = []
  for (const ref of refs(source).values()) {
    const existing = existingRefs.get(ref.id)
    const mapped =
      existing && canonicalJson(existing) !== canonicalJson(ref)
        ? { ...ref, id: await stableId('media', ref.id, new Set(existingRefs.keys())) }
        : ref
    existingRefs.set(mapped.id, mapped)
    mediaMappings.push({ sourceId: ref.id, destination: mapped })
  }
  const media = new Map(mediaMappings.map((entry) => [entry.sourceId, entry.destination]))
  const ids = new Set([...result.projects, ...result.checkpoints].map((record) => record.id))
  const codes = new Set(result.projects.map((project) => project.code))
  const mappings: AttachPreview['mappings'] = []
  let additions = 0,
    matches = 0,
    copies = 0
  const compare = (candidate: CandidateMetadata, projectId: string) => ({
    project: candidate.projects.find((project) => project.id === projectId),
    checkpoints: candidate.checkpoints
      .filter((checkpoint) => checkpoint.projectId === projectId)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  })
  for (const project of source.projects) {
    const prior = mode === 'attach' && destination.projects.find((value) => value.id === project.id)
    if (
      prior &&
      canonicalJson(compare(source, project.id)) === canonicalJson(compare(destination, project.id))
    ) {
      matches++
      mappings.push({
        sourceId: project.id,
        sourceCode: project.code,
        destinationId: project.id,
        destinationCode: project.code,
      })
      continue
    }
    const copied = !!prior || ids.has(project.id)
    const destinationId = copied ? await stableId('project', project.id, ids) : project.id
    let code = project.code
    for (let attempt = 0; codes.has(code); attempt++) {
      if (attempt > MAX_PROJECTS) throw new DomainError('TECHNICAL_CAPACITY_REACHED')
      code = `LM-${(await canonicalHash({ requestId, kind: 'code', sourceId: project.id, attempt })).slice(0, 16).toUpperCase()}`
    }
    const suffix = ' (copy from this device)'
    // Avoid splitting a surrogate pair when the readable suffix needs room.
    let name = project.name
    while (name.length > 100 - suffix.length) name = [...name].slice(0, -1).join('')
    result.projects.push({
      ...project,
      id: destinationId,
      code,
      ...(copied ? { name: name + suffix } : {}),
    })
    ids.add(destinationId)
    codes.add(code)
    if (copied) copies++
    else additions++
    mappings.push({
      sourceId: project.id,
      sourceCode: project.code,
      destinationId,
      destinationCode: code,
    })
    for (const checkpoint of source.checkpoints.filter((value) => value.projectId === project.id)) {
      const checkpointId =
        copied || ids.has(checkpoint.id)
          ? await stableId('checkpoint', checkpoint.id, ids)
          : checkpoint.id
      ids.add(checkpointId)
      result.checkpoints.push({
        ...checkpoint,
        id: checkpointId,
        projectId: destinationId,
        ...(checkpoint.photo ? { photo: media.get(checkpoint.photo.id)! } : {}),
        ...(checkpoint.voice ? { voice: media.get(checkpoint.voice.id)! } : {}),
      })
    }
  }
  candidateMetadataSchema.parse(result)
  return { candidate: result, mediaMappings, additions, matches, copies, mappings }
}
export const accountUsageRequestSchema = z.object({ collectionId: id, epoch: id }).strict()
export const accountUsageSchema = z
  .object({
    collectionId: id,
    epoch: id,
    revision: revisionSchema,
    observedAt: timestamp,
    projects: count(MAX_PROJECTS),
    activeProjects: count(MAX_PROJECTS),
    checkpoints: count(MAX_CHECKPOINTS),
    portableBytes: count(MAX_LIBRARY_BYTES),
    storedBytes: z.number().int().nonnegative(),
    storedObjects: z.number().int().nonnegative(),
    allocatedBytes: z.number().int().nonnegative(),
    unfinishedUploads: z.number().int().nonnegative(),
    ordinaryStagedBytes: z.number().int().nonnegative(),
    candidateMediaBytes: z.number().int().nonnegative(),
    limits: z
      .object({
        projects: z.literal(200),
        checkpoints: z.literal(1000),
        portableBytes: z.literal(50331648),
        uploads: z.literal(4),
        ordinaryStagedBytes: z.literal(33554432),
        candidateMediaBytes: z.literal(41943040),
        allocatedBytes: z.literal(83886080),
      })
      .strict(),
  })
  .strict()
