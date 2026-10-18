import { transportEndpoint, rpc } from '../_shared/command.ts'
import { boundedJson } from '../_shared/limits.ts'
import { deletionStatusRequestSchema } from '../_shared/generated/domain/remote-schema.ts'
import { deletionReceiptSchema } from '../_shared/generated/domain/schema.ts'
import { sha256Bytes } from '../_shared/generated/domain/canonical-json.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
import { server } from '../_shared/server.ts'
import { RemoteErasureLedger } from '../_shared/erasure-ledger.ts'
Deno.serve(
  transportEndpoint(async (request) => {
    const parsed = deletionStatusRequestSchema.safeParse(await boundedJson(request, 4096))
    if (!parsed.success) throw new DomainError('VALIDATION')
    const admin = server(),
      hash = await sha256Bytes(new TextEncoder().encode(parsed.data.receiptToken))
    // The independent intent preserves the original capability after primary-state loss.
    const intent = await new RemoteErasureLedger(admin.config).lookup(parsed.data.requestId, hash)
    if (!intent) throw new DomainError('NOT_AVAILABLE')
    let receipt
    try {
      receipt = await rpc(admin.client, 'loopmark_deletion_status', {
        p_id: parsed.data.requestId,
        p_hash: hash,
      })
    } catch (error) {
      if (error instanceof DomainError && error.detail.code === 'RATE_LIMITED') throw error
    }
    return deletionReceiptSchema.parse(
      receipt ?? { status: 'pending', requestedAt: intent.requestedAt },
    )
  }, false),
)
