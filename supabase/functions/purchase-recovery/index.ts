import { endpoint, rpc } from '../_shared/command.ts'
import {
  purchaseRecoveryWireRequestSchema,
  purchaseRecoveryWireResponseSchema,
} from '../_shared/generated/domain/remote-schema.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
import { billing, reconcile } from '../_shared/billing.ts'
import { purchaseFromReceipt } from '../_shared/providers/revenuecat.ts'
Deno.serve(
  endpoint(async (body, { user }) => {
    const input = purchaseRecoveryWireRequestSchema.safeParse(body)
    if (!input.success) throw new DomainError('VALIDATION')
    const request = input.data,
      admin = billing()
    const prepared =
      request.action === 'status'
        ? await rpc(admin.client, 'loopmark_billing_recovery_status', {
            p_owner: user.id,
            p_request: request.requestId,
          })
        : await rpc(admin.client, 'loopmark_billing_recovery_prepare', {
            p_owner: user.id,
            p_environment: admin.config.paymentEnvironment,
            p_request: request,
          })
    if (prepared.status !== 'pending') return purchaseRecoveryWireResponseSchema.parse(prepared)
    // Saved case metadata and hashes remain authoritative; retries do not need the old raw recovery key.
    const saved = await rpc(admin.client, 'loopmark_billing_recovery_case', {
      p_owner: user.id,
      p_request: request.requestId,
    })
    if (saved.environment !== admin.config.paymentEnvironment)
      throw new DomainError('NOT_AVAILABLE')
    const canonicalPurchase =
      saved.provider === 'revenuecat'
        ? await purchaseFromReceipt(admin.config, saved.purchaseId)
        : saved.purchaseId
    const observed = await reconcile(saved.provider, canonicalPurchase, request.requestId)
    if (!observed) return purchaseRecoveryWireResponseSchema.parse(prepared)
    return purchaseRecoveryWireResponseSchema.parse(
      await rpc(admin.client, 'loopmark_billing_recover', {
        p_owner: user.id,
        p_request: request.requestId,
        p_purchase: canonicalPurchase,
      }),
    )
  }),
)
