import { expect, it } from 'vitest'
import type { PurchaseGrant } from './contracts'
import {
  assertActiveCapacity,
  assertCapacity,
  deriveUpgrade,
  MAX_LIBRARY_BYTES,
  portableMediaBytes,
  LIMITS,
} from './policy'

it('keeps technical capacity independent from paid access', () => {
  expect(() =>
    assertCapacity({ projects: 200, checkpoints: 1000, portableBytes: MAX_LIBRARY_BYTES }),
  ).not.toThrow()
  for (const input of [
    { projects: 201, checkpoints: 0, portableBytes: 0 },
    { projects: 1, checkpoints: 1001, portableBytes: 0 },
    { projects: 1, checkpoints: 1, portableBytes: MAX_LIBRARY_BYTES + 1 },
  ])
    expect(() => assertCapacity(input)).toThrow()
  expect(Object.isFrozen(LIMITS)).toBe(true)
})
it('retains history, export, editing and finishing even when capacity is revoked', () => {
  const input = { activeProjects: 30, upgraded: false, connected: true, legacyLocalAccess: true }
  for (const action of ['finish', 'delete', 'read', 'export', 'checkpoint', 'edit'] as const)
    expect(() => assertActiveCapacity({ ...input, action })).not.toThrow()
  expect(() => assertActiveCapacity({ ...input, action: 'create' })).toThrow()
  expect(() => assertActiveCapacity({ ...input, action: 'reopen', connected: false })).not.toThrow()
  expect(() =>
    assertActiveCapacity({
      ...input,
      action: 'create',
      activeProjects: 2,
      legacyLocalAccess: false,
    }),
  ).not.toThrow()
})
it('derives ANY-valid verified grant without crossing provider environment or principal', () => {
  const grant: PurchaseGrant = {
    provider: 'razorpay',
    environment: 'production',
    canonicalPurchaseId: 'p1',
    billingPrincipalId: 'owner',
    productId: 'upgrade',
    state: 'valid',
    observedAt: '2026-01-01T00:00:00.000Z',
    observationId: 'event1',
  }
  const second: PurchaseGrant = { ...grant, provider: 'revenuecat', canonicalPurchaseId: 'p2' }
  expect(deriveUpgrade([{ ...grant, state: 'refunded' }, second], 'owner', 'production')).toBe(true)
  expect(
    deriveUpgrade(
      [
        { ...grant, state: 'refunded' },
        { ...second, state: 'refunded' },
      ],
      'owner',
      'production',
    ),
  ).toBe(false)
  expect(
    deriveUpgrade(
      [
        { ...grant, environment: 'sandbox' },
        { ...grant, billingPrincipalId: 'someone-else' },
      ],
      'owner',
      'production',
    ),
  ).toBe(false)
})
it('accounts for exact base64 padding and data URL bytes', () => {
  for (const n of [0, 1, 2, 3, 4, 100]) {
    const value = `data:image/png;base64,${Buffer.alloc(n).toString('base64')}`
    expect(portableMediaBytes(n, 'image/png')).toBe(Buffer.byteLength(JSON.stringify(value)))
  }
  for (const mime of [
    'audio/webm;codecs=opus',
    'audio/mp4; codecs=mp4a.40.2',
    'audio/mp4; codecs="mp4a.40.2"',
  ]) {
    expect(portableMediaBytes(3, mime)).toBe(
      Buffer.byteLength(JSON.stringify(`data:${mime};base64,AAAA`)),
    )
  }
})
