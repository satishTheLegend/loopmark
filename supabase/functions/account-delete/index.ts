import { endpoint, rpc } from '../_shared/command.ts'
import { accountDeleteRequestSchema } from '../_shared/generated/domain/remote-schema.ts'
import { deletionReceiptSchema } from '../_shared/generated/domain/schema.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
import { server } from '../_shared/server.ts'
import { RemoteErasureLedger } from '../_shared/erasure-ledger.ts'
Deno.serve(
  endpoint(async (body, { client }) => {
    const parsed = accountDeleteRequestSchema.safeParse(body)
    if (!parsed.success) throw new DomainError('VALIDATION')
    const admin = server(),
      ledger = new RemoteErasureLedger(admin.config)
    // Check ledger readiness before consuming the user's fresh proof.
    await ledger.currentWatermark()
    const intent = await rpc(client, 'loopmark_delete_prepare', { request: parsed.data })
    const appended = await ledger.append(intent)
    return deletionReceiptSchema.parse(
      await rpc(admin.client, 'loopmark_deletion_barrier', {
        p_intent: intent,
        p_watermark: appended.watermark,
      }),
    )
  }),
)
