import { endpoint, rpc } from '../_shared/command.ts'
import {
  checkoutRequestSchema,
  checkoutProductsSchema,
} from '../_shared/generated/domain/remote-schema.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
import { billing, checkout, status, reconcileAttempt, verifyReturn } from '../_shared/billing.ts'
Deno.serve(
  endpoint(async (body, { user }) => {
    const input = checkoutRequestSchema.safeParse(body)
    if (!input.success) throw new DomainError('VALIDATION')
    const admin = billing('razorpay'),
      request = input.data
    if (request.action === 'products')
      return checkoutProductsSchema.parse(
        await rpc(admin.client, 'loopmark_billing_products', {
          p_owner: user.id,
          p_environment: admin.config.paymentEnvironment,
          p_provider: 'razorpay',
        }),
      )
    if (request.action === 'prepare') {
      await rpc(admin.client, 'loopmark_billing_prepare', {
        p_owner: user.id,
        p_environment: admin.config.paymentEnvironment,
        p_provider: 'razorpay',
        p_request: request,
      })
      return await checkout(user.id, request.attemptId)
    }
    if (request.action === 'verify') await verifyReturn(user.id, request)
    else await reconcileAttempt(user.id, request.attemptId)
    return await status(user.id, request.attemptId)
  }),
)
