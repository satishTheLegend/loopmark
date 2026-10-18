import { endpoint, rpc } from '../_shared/command.ts'
import { parseReceipt, verifyCommand } from '../_shared/generated/domain/schema.ts'
Deno.serve(
  endpoint(async (body, { client }) =>
    parseReceipt(await rpc(client, 'loopmark_push', { cmd: await verifyCommand(body) })),
  ),
)
