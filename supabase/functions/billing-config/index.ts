import { endpoint, rpc } from '../_shared/command.ts'
import {
  nativeBillingConfigRequestSchema,
  nativeBillingConfigSchema,
  checkoutProductsSchema,
} from '../_shared/generated/domain/remote-schema.ts'
import { DomainError } from '../_shared/generated/domain/errors.ts'
import { billing, context } from '../_shared/billing.ts'
Deno.serve(
  endpoint(async (body, { user }) => {
    const request = nativeBillingConfigRequestSchema.safeParse(body)
    if (!request.success) throw new DomainError('VALIDATION')
    const admin = billing('revenuecat')
    await context(user.id)
    const config = admin.config.nativeBilling[request.data.platform]
    if (!config) throw new DomainError('CAPABILITY_UNAVAILABLE')
    const catalog = checkoutProductsSchema.parse(
      await rpc(admin.client, 'loopmark_billing_products', {
        p_owner: user.id,
        p_environment: admin.config.paymentEnvironment,
        p_provider: 'revenuecat',
      }),
    )
    const productIds = config.productIds.filter((id) =>
      catalog.products.some((product) => product.id === id),
    )
    if (!productIds.length) throw new DomainError('CAPABILITY_UNAVAILABLE')
    return nativeBillingConfigSchema.parse({
      platform: request.data.platform,
      publicSdkKey: config.publicSdkKey,
      productIds,
      environment: admin.config.paymentEnvironment,
    })
  }),
)
