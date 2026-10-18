import { z } from 'npm:zod@4.6.7'
import { server } from './server.ts'
import { rpc } from './command.ts'
import { DomainError } from './generated/domain/errors.ts'
import {
  localizedProductSchema,
  checkoutPreparationSchema,
  billingStatusSchema,
} from './generated/domain/remote-schema.ts'
import * as razorpay from './providers/razorpay.ts'
import * as revenuecat from './providers/revenuecat.ts'
import { constantEqual, hmac } from './providers/http.ts'
import type { PurchaseProvider } from './generated/domain/contracts.ts'
const attemptSchema = z.object({
  attemptId: z.string().uuid(),
  principalId: z.string().uuid(),
  provider: z.enum(['razorpay', 'revenuecat']),
  environment: z.enum(['sandbox', 'production']),
  product: localizedProductSchema,
  providerProductId: z.string(),
  state: z.string(),
  paymentLinkId: z.string().nullable(),
  checkoutUrl: z.string().nullable(),
  expiresAt: z.string().nullable(),
})
export function billing(provider?: PurchaseProvider) {
  const admin = server()
  if (
    !admin.config.cloudEnrolled ||
    (provider === 'razorpay' && !admin.config.razorpayEnrolled) ||
    (provider === 'revenuecat' && !admin.config.revenueCatEnrolled)
  )
    throw new DomainError('CAPABILITY_UNAVAILABLE')
  return admin
}
export async function context(owner: string) {
  const admin = billing()
  return (await rpc(admin.client, 'loopmark_billing_context', {
    p_owner: owner,
    p_environment: admin.config.paymentEnvironment,
  })) as { principalId: string }
}
export async function status(owner: string, attemptId: string | null = null) {
  const admin = billing()
  return billingStatusSchema.parse(
    await rpc(admin.client, 'loopmark_billing_status', {
      p_owner: owner,
      p_environment: admin.config.paymentEnvironment,
      p_attempt: attemptId,
    }),
  )
}
export async function attempt(id: string, owner: string | null = null) {
  return attemptSchema.parse(
    await rpc(billing().client, 'loopmark_billing_attempt', { p_id: id, p_owner: owner }),
  )
}
export async function checkout(owner: string, id: string) {
  const admin = billing('razorpay'),
    lease = await rpc(admin.client, 'loopmark_billing_create_claim', { p_id: id, p_owner: owner })
  if (lease) {
    const saved = attemptSchema.parse(lease.attempt),
      value = await razorpay.prepareLink(admin.config, saved)
    await rpc(admin.client, 'loopmark_billing_created', {
      p_id: id,
      p_fence: lease.fence,
      p_link_id: value.id,
      p_url: value.short_url,
      p_expires: new Date(value.expire_by * 1000).toISOString(),
    })
  }
  const saved = await attempt(id, owner)
  if (!saved.paymentLinkId || !saved.checkoutUrl || !saved.expiresAt)
    return { status: 'pending' as const, attemptId: id }
  return checkoutPreparationSchema.parse({
    status: 'ready',
    attemptId: id,
    environment: saved.environment,
    paymentLinkId: saved.paymentLinkId,
    checkoutUrl: saved.checkoutUrl,
    expiresAt: saved.expiresAt,
    product: saved.product,
  })
}
export async function reconcile(
  provider: PurchaseProvider,
  purchaseId: string,
  observation = crypto.randomUUID(),
): Promise<boolean> {
  const admin = billing(provider),
    environment = admin.config.paymentEnvironment,
    fence = await rpc(admin.client, 'loopmark_billing_purchase_claim', {
      p_provider: provider,
      p_environment: environment,
      p_purchase: purchaseId,
    })
  if (!fence) return false
  const providerConfig = { ...admin.config, requestDeadline: Date.now() + 40_000 }
  try {
    let principalId: string,
      productId: string,
      attemptId: string | null = null,
      state: string
    if (provider === 'razorpay') {
      const payment = await razorpay.payment(providerConfig, purchaseId),
        links = await razorpay.links(providerConfig, 'payment_id', purchaseId)
      if (links.length !== 1) throw new DomainError('NOT_AVAILABLE')
      const bound = links[0],
        saved = await attempt(bound.reference_id)
      if (
        saved.provider !== 'razorpay' ||
        saved.environment !== environment ||
        (saved.paymentLinkId !== null && saved.paymentLinkId !== bound.id)
      )
        throw new DomainError('NOT_AVAILABLE')
      razorpay.checkLink(bound, saved)
      if (!saved.paymentLinkId)
        await rpc(admin.client, 'loopmark_billing_link_observed', {
          p_id: saved.attemptId,
          p_link: bound.id,
          p_url: bound.short_url,
          p_expires: new Date(bound.expire_by * 1000).toISOString(),
        })
      principalId = saved.principalId
      productId = saved.product.id
      attemptId = saved.attemptId
      state = razorpay.paymentState(payment, bound)
      const ids = (await rpc(admin.client, 'loopmark_billing_dispute_ids', {
        p_environment: environment,
        p_purchase: purchaseId,
      })) as string[]
      for (const id of ids) {
        const value = await razorpay.dispute(providerConfig, id)
        if (value.payment_id !== purchaseId) throw new DomainError('NOT_AVAILABLE')
        if (['open', 'under_review'].includes(value.status)) state = 'disputed'
        else if (value.status === 'lost') state = 'revoked'
      }
    } else {
      const value = await revenuecat.purchase(providerConfig, purchaseId)
      const bound = await rpc(admin.client, 'loopmark_billing_lookup', {
        p_provider: provider,
        p_environment: environment,
        p_purchase: purchaseId,
        p_principal: value.original_customer_id,
        p_provider_product: value.product_id,
      })
      if (!bound || bound.principalId !== value.original_customer_id)
        throw new DomainError('NOT_AVAILABLE')
      principalId = bound.principalId
      productId = bound.productId
      attemptId = bound.attemptId
      state = value.status === 'owned' ? 'valid' : 'refunded'
    }
    await rpc(admin.client, 'loopmark_billing_observe', {
      p_provider: provider,
      p_environment: environment,
      p_purchase: purchaseId,
      p_fence: fence,
      p_principal: principalId,
      p_product: productId,
      p_state: state,
      p_observation: observation,
      p_attempt: attemptId,
    })
    return true
  } catch (error) {
    await rpc(admin.client, 'loopmark_billing_purchase_failed', {
      p_provider: provider,
      p_environment: environment,
      p_purchase: purchaseId,
      p_fence: fence,
    }).catch(() => {})
    throw error
  }
}
export async function reconcileAttempt(owner: string, id: string) {
  const admin = billing('razorpay'),
    saved = await attempt(id, owner)
  if (!saved.paymentLinkId) return
  const bound = razorpay.checkLink(await razorpay.link(admin.config, saved.paymentLinkId), saved)
  for (const payment of bound.payments ?? []) await reconcile('razorpay', payment.payment_id)
}
export async function verifyReturn(
  owner: string,
  input: {
    attemptId: string
    paymentId: string
    paymentLinkId: string
    paymentLinkStatus: 'paid'
    signature: string
  },
) {
  const admin = billing('razorpay'),
    saved = await attempt(input.attemptId, owner)
  if (
    saved.provider !== 'razorpay' ||
    saved.environment !== admin.config.paymentEnvironment ||
    saved.paymentLinkId !== input.paymentLinkId
  )
    throw new DomainError('NOT_AVAILABLE')
  const signature = await hmac(
    admin.config.secrets.razorpayKey!.reveal(),
    `${saved.paymentLinkId}|${saved.attemptId}|${input.paymentLinkStatus}|${input.paymentId}`,
  )
  if (!constantEqual(input.signature, signature)) throw new DomainError('NOT_AVAILABLE')
  await reconcile('razorpay', input.paymentId)
}
export async function discover(owner: string, provider: PurchaseProvider) {
  const admin = billing(provider),
    identity = await context(owner)
  await rpc(admin.client, 'loopmark_billing_discover', {
    p_owner: owner,
    p_environment: admin.config.paymentEnvironment,
    p_provider: provider,
  })
  return identity.principalId
}
export async function discoveryBatch(limit = 20, principalId: string | null = null) {
  const admin = billing()
  let examined = 0,
    changed = 0,
    failed = 0
  for (let index = 0; index < Math.min(limit, 4); index++) {
    const jobs = (await rpc(admin.client, 'loopmark_billing_discovery_claim', {
      p_limit: 1,
      p_principal: principalId,
    })) as {
      provider: PurchaseProvider
      environment: string
      principalId: string
      after: string | null
      fence: string
    }[]
    if (!jobs.length) break
    const job = jobs[0]
    examined++
    let after: string | null = null,
      success = false
    try {
      if (job.environment !== admin.config.paymentEnvironment)
        throw new DomainError('NOT_AVAILABLE')
      billing(job.provider)
      if (job.provider === 'revenuecat') {
        const page = await revenuecat.purchases(admin.config, job.principalId, job.after)
        await Promise.all(page.ids.map((id) => reconcile('revenuecat', id)))
        after = page.after
      } else {
        const ids = (await rpc(admin.client, 'loopmark_billing_attempts', {
          p_principal: job.principalId,
          p_environment: job.environment,
          p_after: job.after,
        })) as string[]
        await Promise.all(
          ids.map(async (id) => {
            const saved = await attempt(id)
            if (saved.paymentLinkId) {
              const bound = razorpay.checkLink(
                await razorpay.link(admin.config, saved.paymentLinkId),
                saved,
              )
              for (const item of bound.payments ?? []) await reconcile('razorpay', item.payment_id)
            }
          }),
        )
        after = ids.length === 4 ? ids.at(-1)! : null
      }
      success = true
      changed++
    } catch {
      failed++
    }
    await rpc(admin.client, 'loopmark_billing_discovery_finish', {
      p_provider: job.provider,
      p_environment: job.environment,
      p_principal: job.principalId,
      p_fence: job.fence,
      p_after: after,
      p_success: success,
    })
  }
  return { examined, changed, failed }
}
