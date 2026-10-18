import { z } from 'zod'
import { id, timestamp, projectInputSchema, nonBlank } from './portable-schema'
import { DomainError } from './errors'
import { LIMITS, MAX_CHECKPOINTS, MAX_PROJECTS, utf8Bytes } from './policy'
import { canonicalHash, canonicalJson } from './canonical-json'
import { supportedMediaType } from './media-contract'
import type { Command, PullPage, Receipt, SnapshotManifest, UnsignedCommand } from './contracts'
export * from './portable-schema'

export const revisionSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .pipe(
    z
      .string()
      .refine((value) => BigInt(value) <= 9223372036854775807n, 'Revision exceeds database range'),
  )
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const collectionKeySchema = z.object({ namespace: id, collectionId: id, epoch: id }).strict()
export const baseSchema = z.union([
  z.object({ revision: revisionSchema }).strict(),
  z.object({ afterOperationId: id }).strict(),
])
export const mediaRefSchema = z
  .object({
    id,
    kind: z.enum(['photo', 'voice']),
    mimeType: z.string().max(100),
    bytes: z.number().int().positive().max(LIMITS.voiceBytes),
    sha256: hashSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const valid =
      supportedMediaType(value.mimeType, value.kind) &&
      (value.kind !== 'photo' || value.bytes <= LIMITS.photoBytes)
    if (!valid)
      context.addIssue({ code: 'custom', message: 'Unsupported attachment format or size' })
  })
export const projectCreateSchema = projectInputSchema.extend({
  id,
  code: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,23}$/),
  status: z.enum(['active', 'finished']),
  createdAt: timestamp,
  updatedAt: timestamp,
})
export const projectRecordSchema = projectCreateSchema.extend({
  revision: revisionSchema,
  sample: z.boolean().optional(),
})
export const checkpointCreateSchema = z
  .object({
    id,
    projectId: id,
    createdAt: timestamp,
    position: z.string().max(100),
    toolSize: z.string().max(80),
    nextStep: nonBlank(1000),
    notes: z.string().max(2000),
    photo: mediaRefSchema.optional(),
    voice: mediaRefSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.photo && value.photo.kind !== 'photo')
      context.addIssue({ code: 'custom', path: ['photo'], message: 'Expected a photo' })
    if (value.voice && value.voice.kind !== 'voice')
      context.addIssue({ code: 'custom', path: ['voice'], message: 'Expected a voice note' })
  })
export const checkpointRecordSchema = checkpointCreateSchema.safeExtend({
  revision: revisionSchema,
})
const projectCreatePayload = z.object({ project: projectCreateSchema }).strict()
const projectUpdatePayload = z
  .object({ projectId: id, fields: projectInputSchema, updatedAt: timestamp })
  .strict()
const projectStatusPayload = z
  .object({ projectId: id, status: z.enum(['active', 'finished']), updatedAt: timestamp })
  .strict()
const projectDeletePayload = z.object({ projectId: id }).strict()
const checkpointCreatePayload = z
  .object({ checkpoint: checkpointCreateSchema, updatedAt: timestamp })
  .strict()
const mediaAttachPayload = z
  .object({ projectId: id, checkpointId: id, reservationId: id, media: mediaRefSchema })
  .strict()
const replacementPayload = z
  .object({ reservationId: id, candidateSha256: hashSchema, nextEpoch: id })
  .strict()
const envelope = {
  protocolVersion: z.literal(2),
  payloadVersion: z.literal(1),
  collectionId: id,
  epoch: id,
  deviceId: id,
  deviceGeneration: id,
  sequence: revisionSchema.refine((v) => v !== '0'),
  operationId: id,
  base: baseSchema.nullable(),
  sha256: hashSchema,
}
export const commandSchema = z
  .discriminatedUnion('kind', [
    z
      .object({ ...envelope, kind: z.literal('project.create'), payload: projectCreatePayload })
      .strict(),
    z
      .object({ ...envelope, kind: z.literal('project.update'), payload: projectUpdatePayload })
      .strict(),
    z
      .object({ ...envelope, kind: z.literal('project.status'), payload: projectStatusPayload })
      .strict(),
    z
      .object({ ...envelope, kind: z.literal('project.delete'), payload: projectDeletePayload })
      .strict(),
    z
      .object({
        ...envelope,
        kind: z.literal('checkpoint.create'),
        payload: checkpointCreatePayload,
      })
      .strict(),
    z
      .object({ ...envelope, kind: z.literal('media.attach'), payload: mediaAttachPayload })
      .strict(),
    z
      .object({ ...envelope, kind: z.literal('collection.replace'), payload: replacementPayload })
      .strict(),
  ])
  .superRefine((value, context) => {
    if ((value.kind === 'project.create') !== (value.base === null))
      context.addIssue({
        code: 'custom',
        path: ['base'],
        message: 'Create needs no base; other mutations need a base',
      })
    if (
      value.base &&
      'afterOperationId' in value.base &&
      value.base.afterOperationId === value.operationId
    )
      context.addIssue({
        code: 'custom',
        path: ['base'],
        message: 'An operation cannot depend on itself',
      })
    if (
      value.kind === 'collection.replace' &&
      (value.payload.nextEpoch === value.epoch || !value.base || !('revision' in value.base))
    )
      context.addIssue({
        code: 'custom',
        message: 'Replacement needs a new epoch and explicit preview revision',
      })
  })
export const changeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project.put'), value: projectRecordSchema }).strict(),
  z.object({ kind: z.literal('project.delete'), id, revision: revisionSchema }).strict(),
  z.object({ kind: z.literal('checkpoint.put'), value: checkpointRecordSchema }).strict(),
  z
    .object({ kind: z.literal('checkpoint.delete'), id, projectId: id, revision: revisionSchema })
    .strict(),
  z.object({ kind: z.literal('collection.replaced'), nextEpoch: id }).strict(),
])
export const receiptSchema = z
  .object({
    operationId: id,
    sha256: hashSchema,
    epoch: id,
    revision: revisionSchema,
    cursor: revisionSchema,
    resultId: id,
    changes: z
      .array(changeSchema)
      .min(1)
      .max(MAX_CHECKPOINTS + 1),
  })
  .strict()
export const pullRequestSchema = z
  .object({
    collectionId: id,
    epoch: id,
    afterCursor: revisionSchema,
    deviceId: id,
    deviceGeneration: id,
  })
  .strict()
export const pullPageSchema = z
  .object({
    protocolVersion: z.literal(2),
    collectionId: id,
    epoch: id,
    afterCursor: revisionSchema,
    nextCursor: revisionSchema,
    hasMore: z.boolean(),
    entries: z.array(receiptSchema).max(LIMITS.pullEntries),
  })
  .strict()
  .superRefine((value, context) => {
    let cursor = BigInt(value.afterCursor)
    const ids = new Set<string>()
    for (const receipt of value.entries) {
      if (
        BigInt(receipt.cursor) !== cursor + 1n ||
        receipt.epoch !== value.epoch ||
        ids.has(receipt.operationId)
      )
        context.addIssue({ code: 'custom', message: 'Invalid page ordering or scope' })
      cursor = BigInt(receipt.cursor)
      ids.add(receipt.operationId)
    }
    if (BigInt(value.nextCursor) !== cursor || (value.hasMore && value.entries.length === 0))
      context.addIssue({ code: 'custom', message: 'Page cursor must end at its last entry' })
  })
const snapshotCursorSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !value.includes('\0'))
export const snapshotRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      collectionId: id,
      purpose: z.enum(['hydrate', 'export']),
    })
    .strict(),
  z
    .object({ action: z.literal('page'), snapshotId: id, after: snapshotCursorSchema.nullable() })
    .strict(),
  z.object({ action: z.literal('renew'), snapshotId: id }).strict(),
])
export const snapshotManifestSchema = z
  .object({
    protocolVersion: z.literal(2),
    snapshotId: id,
    collectionId: id,
    epoch: id,
    cursor: revisionSchema,
    revision: revisionSchema,
    expiresAt: timestamp,
    after: snapshotCursorSchema.nullable(),
    projects: z.array(projectRecordSchema).max(MAX_PROJECTS),
    checkpoints: z.array(checkpointRecordSchema).max(MAX_CHECKPOINTS),
    media: z.array(mediaRefSchema).max(2 * MAX_CHECKPOINTS),
    nextPage: snapshotCursorSchema.nullable(),
  })
  .strict()
export const uploadRequestSchema = z
  .object({ collectionId: id, epoch: id, media: mediaRefSchema })
  .strict()
export const uploadReservationSchema = uploadRequestSchema.extend({
  id,
  expiresAt: timestamp,
  deletionGeneration: revisionSchema,
})
export const replacementPreviewSchema = z
  .object({
    reservationId: id,
    collectionId: id,
    epoch: id,
    revision: revisionSchema,
    candidateSha256: hashSchema,
    projects: z.number().int().min(0).max(MAX_PROJECTS),
    checkpoints: z.number().int().min(0).max(MAX_CHECKPOINTS),
    mediaBytes: z.number().int().min(0).max(LIMITS.replacementMediaBytes),
    portableBytes: z
      .number()
      .int()
      .min(0)
      .max(48 * 1024 * 1024),
    expiresAt: timestamp,
  })
  .strict()
export const deletionReceiptSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), requestedAt: timestamp }).strict(),
  z
    .object({
      status: z.literal('live-data-removed'),
      removedAt: timestamp,
      backupExpiresAt: timestamp,
    })
    .strict(),
  z.object({ status: z.literal('complete'), completedAt: timestamp }).strict(),
  z
    .object({
      status: z.literal('needs-help'),
      helpRef: z.literal('account#deletion'),
      correlationId: id,
    })
    .strict(),
])

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new DomainError('VALIDATION', { field: result.error.issues[0]?.path.join('.') })
  return result.data
}
export function parseCommand(input: unknown): Command {
  if (utf8Bytes(input) > LIMITS.commandBytes) throw new DomainError('VALIDATION')
  const command = parse(commandSchema, input)
  canonicalJson(command)
  return command
}
export async function signCommand(input: UnsignedCommand): Promise<Command> {
  const validated = parseCommand({ ...input, sha256: '0'.repeat(64) })
  const { sha256: _hash, ...unsigned } = validated
  return { ...validated, sha256: await canonicalHash(unsigned) }
}
export async function verifyCommand(input: unknown): Promise<Command> {
  const command = parseCommand(input)
  const { sha256, ...unsigned } = command
  if ((await canonicalHash(unsigned)) !== sha256) throw new DomainError('OPERATION_REUSED')
  return command
}
export const parseReceipt = (input: unknown): Receipt => parse(receiptSchema, input)
export function parsePullPage(input: unknown): PullPage {
  if (utf8Bytes(input) > LIMITS.pullBytes) throw new DomainError('SYNC_PAGE_INVALID')
  try {
    return parse(pullPageSchema, input)
  } catch {
    throw new DomainError('SYNC_PAGE_INVALID')
  }
}
export const parseSnapshot = (input: unknown): SnapshotManifest =>
  parse(snapshotManifestSchema, input)
