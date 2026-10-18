import { z } from 'npm:zod@4.6.7'
import type { ProviderConfig } from './http.ts'
import { DomainError } from '../generated/domain/errors.ts'
import { localizedProductSchema } from '../generated/domain/remote-schema.ts'
import { providerRequest, ProviderHttpError, providerValue } from './http.ts'
const providerId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,100}$`))
export const razorpayLinkSchema = z.object({
  id: providerId('plink'),
  reference_id: z.string().uuid(),
  amount: z.number().int().positive(),
  currency: z.string(),
  accept_partial: z.literal(false),
  status: z.enum(['created', 'partially_paid', 'paid', 'expired', 'cancelled']),
  short_url: z.string().regex(/^https:\/\/rzp\.io\/(?:i|l)\/[A-Za-z0-9_-]{1,100}$/),
  expire_by: z.number().int().positive(),
  order_id: providerId('order').nullable().optional(),
  payments: z
    .array(
      z.object({
        payment_id: providerId('pay'),
        status: z.literal('captured'),
        amount: z.number().int().positive(),
      }),
    )
    .max(1)
    .nullable(),
})
export type RazorpayLink = z.infer<typeof razorpayLinkSchema>
const linkList = z.object({ payment_links: z.array(razorpayLinkSchema).max(2) })
export async function links(
  config: ProviderConfig,
  field: 'reference_id' | 'payment_id',
  value: string,
) {
  return providerValue(
    linkList,
    await providerRequest(
      config,
      'razorpay',
      `/v1/payment_links?${field}=${encodeURIComponent(value)}`,
    ),
  ).payment_links
}
export async function link(config: ProviderConfig, id: string) {
  return providerValue(
    razorpayLinkSchema,
    await providerRequest(config, 'razorpay', `/v1/payment_links/${providerId('plink').parse(id)}`),
  )
}
export function checkLink(
  value: RazorpayLink,
  attempt: { attemptId: string; product: z.infer<typeof localizedProductSchema> },
) {
  if (
    value.reference_id !== attempt.attemptId ||
    value.amount !== attempt.product.amountMinor ||
    value.currency !== attempt.product.currency
  )
    throw new DomainError('NOT_AVAILABLE')
  return value
}
export async function prepareLink(
  config: ProviderConfig,
  attempt: { attemptId: string; product: z.infer<typeof localizedProductSchema> },
) {
  const found = await links(config, 'reference_id', attempt.attemptId)
  if (found.length > 1) throw new DomainError('NOT_AVAILABLE')
  if (found.length === 1) return checkLink(found[0], attempt)
  try {
    return checkLink(
      providerValue(
        razorpayLinkSchema,
        await providerRequest(config, 'razorpay', '/v1/payment_links/', {
          reference_id: attempt.attemptId,
          amount: attempt.product.amountMinor,
          currency: attempt.product.currency,
          description: attempt.product.title,
          accept_partial: false,
          expire_by: Math.floor(Date.now() / 1000) + 3600,
          notify: { email: false, sms: false },
          reminder_enable: false,
          callback_url: `${config.appOrigin}/purchase/return`,
          callback_method: 'get',
        }),
      ),
      attempt,
    )
  } catch (error) {
    if (!(error instanceof ProviderHttpError) || error.status !== 400) throw error
    const retried = await links(config, 'reference_id', attempt.attemptId)
    if (retried.length !== 1) throw new DomainError('SERVICE_UNAVAILABLE')
    return checkLink(retried[0], attempt)
  }
}
const paymentSchema = z.object({
  id: providerId('pay'),
  amount: z.number().int().positive(),
  currency: z.string(),
  status: z.enum(['created', 'authorized', 'captured', 'refunded', 'failed']),
  captured: z.boolean(),
  amount_refunded: z.number().int().nonnegative(),
  refund_status: z.enum(['partial', 'full']).nullable(),
  order_id: providerId('order'),
})
export async function payment(config: ProviderConfig, id: string) {
  const value = providerValue(
    paymentSchema,
    await providerRequest(config, 'razorpay', `/v1/payments/${providerId('pay').parse(id)}`),
  )
  if (value.id !== id) throw new DomainError('NOT_AVAILABLE')
  return value
}
export function paymentState(
  value: z.infer<typeof paymentSchema>,
  bound: RazorpayLink,
): 'valid' | 'pending' | 'failed' | 'refunded' {
  if (
    value.order_id !== bound.order_id ||
    value.amount !== bound.amount ||
    value.currency !== bound.currency ||
    value.amount_refunded > value.amount ||
    !bound.payments?.some((p) => p.payment_id === value.id && p.amount === value.amount)
  )
    throw new DomainError('NOT_AVAILABLE')
  if (value.amount_refunded > 0 || value.refund_status || value.status === 'refunded')
    return 'refunded'
  if (value.status === 'captured' && value.captured) return 'valid'
  return value.status === 'failed' ? 'failed' : 'pending'
}
const disputeSchema = z.object({
  id: providerId('disp'),
  payment_id: providerId('pay'),
  status: z.enum(['open', 'under_review', 'won', 'lost', 'closed']),
})
export async function dispute(config: ProviderConfig, id: string) {
  const value = providerValue(
    disputeSchema,
    await providerRequest(config, 'razorpay', `/v1/disputes/${providerId('disp').parse(id)}`),
  )
  if (value.id !== id) throw new DomainError('NOT_AVAILABLE')
  return value
}
export async function disputes(config: ProviderConfig, skip: number, through: number) {
  return providerValue(
    z.object({ items: z.array(disputeSchema).max(20) }),
    await providerRequest(config, 'razorpay', `/v1/disputes?count=20&skip=${skip}&to=${through}`),
  ).items
}
