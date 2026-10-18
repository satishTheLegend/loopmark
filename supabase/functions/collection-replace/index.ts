import { endpoint } from '../_shared/command.ts'
import { candidateRequestSchema } from '../_shared/generated/domain/remote-schema.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
import { prepareCandidate } from '../_shared/candidates.ts'
Deno.serve(
  endpoint(
    async (body, identity) => {
      const parsed = candidateRequestSchema.safeParse(body)
      if (!parsed.success) throw new DomainError('VALIDATION')
      return await prepareCandidate('replace', parsed.data, identity)
    },
    8 * 1024 * 1024,
  ),
)
