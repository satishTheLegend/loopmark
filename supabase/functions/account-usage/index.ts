import { endpoint, rpc } from '../_shared/command.ts'
import {
  accountUsageRequestSchema,
  accountUsageSchema,
} from '../_shared/generated/domain/remote-schema.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
Deno.serve(
  endpoint(async (body, { client }) => {
    const parsed = accountUsageRequestSchema.safeParse(body)
    if (!parsed.success) throw new DomainError('VALIDATION')
    return accountUsageSchema.parse(
      await rpc(client, 'loopmark_account_usage', {
        p_collection: parsed.data.collectionId,
        p_epoch: parsed.data.epoch,
      }),
    )
  }),
)
