import { describe, expect, it } from 'vitest'
import { parsePurchaseReturn } from './purchase-return'
const origin = 'https://loopmark.example'
const attempt = '11111111-1111-4111-8111-111111111111'
const query = new URLSearchParams({
  razorpay_payment_id: 'pay_synthetic',
  razorpay_payment_link_id: 'plink_synthetic',
  razorpay_payment_link_reference_id: attempt,
  razorpay_payment_link_status: 'paid',
  razorpay_signature: 'a'.repeat(64),
})
const url = `${origin}/purchase/return?${query}`
describe('purchase return parsing', () => {
  it('produces verification input only, with the stable reference as attempt ID', () => {
    expect(parsePurchaseReturn(url, origin)).toEqual({
      action: 'verify',
      attemptId: attempt,
      paymentId: 'pay_synthetic',
      paymentLinkId: 'plink_synthetic',
      paymentLinkStatus: 'paid',
      signature: 'a'.repeat(64),
    })
  })
  it.each([
    url.replace(origin, 'https://other.example'),
    url.replace('/purchase/return', '/p/project'),
    `${url}#continue`,
    `${url}&next=https://other.example`,
    `${url}&razorpay_payment_id=pay_second`,
    url.replace('status=paid', 'status=created'),
    url.replace(attempt, 'unknown'),
    url.replace('pay_synthetic', 'pay_%0Asecret'),
    `${origin}/purchase/return`,
  ])('rejects malformed or ambiguous input %#', (value) => {
    expect(() => parsePurchaseReturn(value, origin)).toThrow()
  })
})
