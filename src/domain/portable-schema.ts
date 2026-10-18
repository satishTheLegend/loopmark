import { z } from 'zod'
import { validMedia } from '../media-validation'
import { MAX_PROJECTS, MAX_CHECKPOINTS } from './policy'

export const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/, 'Invalid record ID')
export function supportedTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  // Do not allow an imported date to move the persistent revision clock near Date's limit.
  // A century of clock skew still permits ordinary backups from devices with incorrect clocks.
  return (
    /^\d{4}-/.test(value) &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString() === value &&
    parsed.getTime() <= Date.now() + 100 * 366 * 24 * 60 * 60 * 1000
  )
}
export const timestamp = z.string().refine(supportedTimestamp, 'Invalid date')
export const nonBlank = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, 'Must not be blank')

export const projectFields = {
  name: nonBlank(100),
  craft: z.enum(['Crochet', 'Knitting', 'Other']),
  color: z.enum(['clay', 'sage', 'lavender', 'ochre']),
  yarn: z.string().max(200),
  toolSize: z.string().max(80),
  notes: z.string().max(2000),
}
export const projectInputSchema = z.object(projectFields).strict()
export const checkpointInputSchema = z
  .object({
    position: z.string().max(100),
    toolSize: z.string().max(80),
    nextStep: nonBlank(1000),
    notes: z.string().max(2000),
    photo: z
      .string()
      .max(6 * 1024 * 1024)
      .refine(
        (value) => validMedia(value, 'photo'),
        'Photo must be a valid JPEG, PNG or WebP data URL up to 4 MiB',
      )
      .optional(),
    voice: z
      .string()
      .max(12 * 1024 * 1024)
      .refine(
        (value) => validMedia(value, 'voice'),
        'Voice note must be a supported audio data URL up to 8 MiB',
      )
      .optional(),
  })
  .strict()
export const checkpointSchema = checkpointInputSchema.extend({ id, createdAt: timestamp })
export const projectSchema = projectInputSchema.extend({
  id,
  code: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,23}$/, 'Invalid project code'),
  status: z.enum(['active', 'finished']),
  createdAt: timestamp,
  updatedAt: timestamp,
  checkpoints: z.array(checkpointSchema).max(MAX_CHECKPOINTS),
  sample: z.boolean().optional(),
})
export const backupSchema = z
  .object({
    format: z.literal('loopmark'),
    version: z.literal(1),
    exportedAt: timestamp,
    projects: z.array(projectSchema).max(MAX_PROJECTS),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>()
    const codes = new Set<string>()
    let count = 0
    for (const project of value.projects) {
      if (ids.has(project.id) || codes.has(project.code))
        context.addIssue({ code: 'custom', message: 'Project IDs and codes must be unique' })
      ids.add(project.id)
      codes.add(project.code)
      for (const checkpoint of project.checkpoints) {
        if (ids.has(checkpoint.id))
          context.addIssue({ code: 'custom', message: 'Checkpoint IDs must be unique' })
        ids.add(checkpoint.id)
        count++
      }
    }
    // Catch an earlier checkpoint ID that collides with a later project ID too.
    if (ids.size !== value.projects.length + count)
      context.addIssue({ code: 'custom', message: 'All record IDs must be unique' })
    if (count > MAX_CHECKPOINTS)
      context.addIssue({
        code: 'custom',
        message: `A library can contain up to ${MAX_CHECKPOINTS} checkpoints`,
      })
  })

export function validated<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new Error(`${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
  }
  return result.data
}
