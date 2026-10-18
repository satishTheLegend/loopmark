import { endpoint, rpc } from '../_shared/command.ts'
import { snapshotRequestSchema, parseSnapshot } from '../_shared/generated/domain/schema.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
Deno.serve(
  endpoint(async (body, { client }) => {
    const request = snapshotRequestSchema.safeParse(body)
    if (!request.success) throw new DomainError('VALIDATION')
    return parseSnapshot(await rpc(client, 'loopmark_snapshot', { request: request.data }))
  }),
)
