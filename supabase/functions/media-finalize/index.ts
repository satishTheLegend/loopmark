import { endpoint, rpc } from '../_shared/command.ts'
import { verifyCommand } from '../_shared/generated/domain/schema.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
Deno.serve(
  endpoint(async (body, { client }) => {
    const command = await verifyCommand(body)
    if (command.kind !== 'media.attach') throw new DomainError('VALIDATION')
    return await rpc(client, 'loopmark_push', { cmd: command })
  }),
)
