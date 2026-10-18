import { expect, it } from 'vitest'
import {
  checkoutPreparationSchema,
  checkoutRequestSchema,
  purchaseRecoveryWireRequestSchema,
  purchaseRecoveryWireResponseSchema,
} from '../../src/domain/remote-schema'
it('binds checkout identity without accepting client price or entitlement authority', () => {
  const input = {
    action: 'prepare',
    attemptId: crypto.randomUUID(),
    productId: 'loopmark.lifetime',
    collection: { namespace: 'account_test', collectionId: 'collection', epoch: 'epoch' },
  }
  expect(checkoutRequestSchema.safeParse(input).success).toBe(true)
  for (const extra of [
    { amountMinor: 1 },
    { upgraded: true },
    { accountId: crypto.randomUUID() },
    { billingPrincipalId: crypto.randomUUID() },
  ])
    expect(checkoutRequestSchema.safeParse({ ...input, ...extra }).success).toBe(false)
  const ready = {
    status: 'ready',
    attemptId: input.attemptId,
    environment: 'sandbox',
    paymentLinkId: 'plink_synthetic',
    checkoutUrl: 'https://rzp.io/i/synthetic',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    product: {
      id: input.productId,
      title: 'One-time upgrade',
      displayPrice: '₹499.00',
      currency: 'INR',
      amountMinor: 49900,
      provider: 'razorpay',
    },
  }
  expect(checkoutPreparationSchema.safeParse(ready).success).toBe(true)
  for (const checkoutUrl of [
    'https://rzp.io.evil.test/i/x',
    'https://rzp.io@evil.test/i/x',
    'http://rzp.io/i/x',
    'https://rzp.io/i/x?redirect=https://evil.test',
    'https://rzp.io/i/x#x',
  ])
    expect(checkoutPreparationSchema.safeParse({ ...ready, checkoutUrl }).success).toBe(false)
  expect(
    checkoutPreparationSchema.safeParse({
      ...ready,
      product: { ...ready.product, provider: 'revenuecat' },
    }).success,
  ).toBe(false)
})
it('sends only the saved next recovery key hash and permits bounded pending recovery', () => {
  const input = {
    action: 'set-key',
    requestId: crypto.randomUUID(),
    nextRecoveryKeyHash: 'a'.repeat(64),
  }
  expect(purchaseRecoveryWireRequestSchema.safeParse(input).success).toBe(true)
  expect(
    purchaseRecoveryWireRequestSchema.safeParse({ ...input, nextRecoveryKey: 'raw-secret' })
      .success,
  ).toBe(false)
  expect(
    purchaseRecoveryWireResponseSchema.safeParse({ status: 'pending', caseId: crypto.randomUUID() })
      .success,
  ).toBe(true)
  expect(
    purchaseRecoveryWireResponseSchema.safeParse({
      status: 'key-saved',
      recoveryKeyHash: input.nextRecoveryKeyHash,
      recoveryKey: 'raw-secret',
    }).success,
  ).toBe(false)
})
