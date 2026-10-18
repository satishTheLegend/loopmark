import { endpoint, rpc } from '../_shared/command.ts'
import { pullRequestSchema, parsePullPage } from '../_shared/generated/domain/schema.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
Deno.serve(
  endpoint(async (body, { client }) => {
    const request = pullRequestSchema.safeParse(body)
    if (!request.success) throw new DomainError('VALIDATION')
    return parsePullPage(await rpc(client, 'loopmark_pull', { request: request.data }))
  }),
)
