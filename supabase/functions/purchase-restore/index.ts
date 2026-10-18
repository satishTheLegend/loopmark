import { endpoint, rpc } from '../_shared/command.ts'
import { purchaseRestoreRequestSchema } from '../_shared/generated/domain/remote-schema.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
import { billing, status, discover, discoveryBatch } from '../_shared/billing.ts'
Deno.serve(
  endpoint(async (body, { user }) => {
    const input = purchaseRestoreRequestSchema.safeParse(body)
    if (!input.success) throw new DomainError('VALIDATION')
    const request = input.data
    if (request.action === 'cancel') {
      const admin = billing('revenuecat')
      return await rpc(admin.client, 'loopmark_billing_cancel_native', {
        p_owner: user.id,
        p_environment: admin.config.paymentEnvironment,
        p_attempt: request.attemptId,
      })
    }
    if (request.action === 'prepare') {
      const admin = billing('revenuecat')
      await rpc(admin.client, 'loopmark_billing_prepare', {
        p_owner: user.id,
        p_environment: admin.config.paymentEnvironment,
        p_provider: 'revenuecat',
        p_request: request,
      })
      return { status: 'pending', attemptId: request.attemptId }
    }
    if (request.action === 'reconcile') {
      const principal = await discover(user.id, request.provider)
      await discoveryBatch(1, principal)
    }
    return await status(user.id, request.action === 'status' ? (request.attemptId ?? null) : null)
  }),
)
