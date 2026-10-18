import type { CheckoutRequest } from '../domain/remote-contracts'
import { checkoutRequestSchema } from '../domain/remote-schema'
import { DomainError } from '../domain/errors'
import { originSchema } from '../config'

export type PurchaseReturn = Extract<CheckoutRequest, { action: 'verify' }>
const keys = [
  'razorpay_payment_id',
  'razorpay_payment_link_id',
  'razorpay_payment_link_reference_id',
  'razorpay_payment_link_status',
  'razorpay_signature',
] as const

/** Untrusted verification input only. The coordinator must match a durable account-bound attempt. */
export function parsePurchaseReturn(value: string, appOrigin: string): PurchaseReturn {
  try {
    if (value.length > 2400) throw new Error()
    const url = new URL(value),
      origin = new URL(originSchema.parse(appOrigin))
    if (
      url.origin !== origin.origin ||
      url.username ||
      url.password ||
      url.pathname !== '/purchase/return' ||
      url.hash ||
      !['https:', 'http:'].includes(url.protocol)
    )
      throw new Error()
    if (
      [...url.searchParams.keys()].length !== keys.length ||
      keys.some((key) => url.searchParams.getAll(key).length !== 1)
    )
      throw new Error()
    const result = checkoutRequestSchema.safeParse({
      action: 'verify',
      attemptId: url.searchParams.get(keys[2]),
      paymentId: url.searchParams.get(keys[0]),
      paymentLinkId: url.searchParams.get(keys[1]),
      paymentLinkStatus: url.searchParams.get(keys[3]),
      signature: url.searchParams.get(keys[4]),
    })
    if (!result.success || result.data.action !== 'verify') throw new Error()
    return result.data
  } catch {
    throw new DomainError('PURCHASE_UNAVAILABLE')
  }
}
