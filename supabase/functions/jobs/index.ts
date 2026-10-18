import { z } from 'npm:zod@4.6.7'
import { transportEndpoint } from '../_shared/command.ts'
import { boundedJson } from '../_shared/limits.ts'
import { server } from '../_shared/server.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
import { sweepMedia } from './sweep-media.ts'
import { resumeDeletions } from './delete-account.ts'
const schema = z
  .object({
    action: z.enum(['resume-deletions', 'sweep-media']),
    limit: z.number().int().min(1).max(100).default(20),
    ownerId: z.string().uuid().nullable().default(null),
  })
  .strict()
Deno.serve(
  transportEndpoint(async (request) => {
    const actual = new TextEncoder().encode(request.headers.get('authorization') ?? ''),
      expected = new TextEncoder().encode(`Bearer ${server().config.secrets.serviceRole.reveal()}`)
    let mismatch = actual.length ^ expected.length
    for (let i = 0; i < expected.length; i++) mismatch |= expected[i] ^ (actual[i] ?? 0)
    if (mismatch) throw new DomainError('AUTH_REQUIRED')
    const parsed = schema.safeParse(await boundedJson(request))
    if (!parsed.success) throw new DomainError('VALIDATION')
    return await (parsed.data.action === 'resume-deletions' ? resumeDeletions : sweepMedia)(
      parsed.data.limit,
      parsed.data.ownerId,
    )
  }, false),
)
