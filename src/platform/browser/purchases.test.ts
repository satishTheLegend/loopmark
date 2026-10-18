import { describe, expect, it, vi } from 'vitest'
import { createWebBilling, type WebBillingContext } from './purchases'
import type { PurchaseIntent } from '../../domain/contracts'
import { DomainError } from '../../domain/errors'

const key = { namespace: 'account_maker', collectionId: 'collection', epoch: 'epoch' }
const context = (): WebBillingContext => ({
  session: {
    accountId: 'maker',
    billingPrincipalId: 'principal',
    collection: key,
    device: { id: 'device', generation: 'device-generation' },
    deletionGeneration: '0',
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
  scope: { key, device: { id: 'device', generation: 'device-generation' }, generation: 1 },
})
const intent: PurchaseIntent = {
  attemptId: '11111111-1111-4111-8111-111111111111',
  accountId: 'maker',
  billingPrincipalId: 'principal',
  collection: key,
  generation: 1,
  productId: 'loopmark.lifetime',
  returnAction: 'settings',
}
const product = {
  id: intent.productId,
  title: 'More active projects',
  displayPrice: '₹499',
  currency: 'INR',
  amountMinor: 49900,
  provider: 'razorpay',
}
const preparation = {
  status: 'ready',
  attemptId: intent.attemptId,
  environment: 'sandbox',
  paymentLinkId: 'plink_test',
  checkoutUrl: 'https://rzp.io/i/synthetic',
  expiresAt: '2099-01-01T00:00:00.000Z',
  product,
}
function fixture(response: unknown = preparation) {
  let active: WebBillingContext | null = context()
  const post = vi.fn(async () => response),
    navigate = vi.fn()
  const adapter = createWebBilling({ current: () => active, client: { post }, navigate })
  return {
    adapter,
    post,
    navigate,
    setActive(value: WebBillingContext | null) {
      active = value
    },
  }
}
describe('hosted checkout boundary (synthetic provider responses)', () => {
  it('keeps a local draft bound to its device collection while preparing for the paying account', async () => {
    const f = fixture(),
      local = { namespace: 'guest', collectionId: 'local', epoch: 'local-epoch' }
    f.setActive({
      ...context(),
      scope: {
        ...context().scope,
        key: local,
        device: { id: 'local-device', generation: 'local-generation' },
      },
    })
    expect(
      await f.adapter.purchase({
        ...intent,
        collection: local,
        returnAction: 'new-project',
        draftKey: 'new',
      }),
    ).toMatchObject({ status: 'submitted' })
    expect(f.post).toHaveBeenCalledWith(
      'checkout',
      expect.objectContaining({ collection: key }),
      expect.any(AbortSignal),
    )
    expect(f.navigate).toHaveBeenCalledOnce()
  })
  it('opens only a server-prepared exact link and returns no access grant', async () => {
    const f = fixture()
    expect(await f.adapter.purchase(intent)).toEqual({
      status: 'submitted',
      attemptId: intent.attemptId,
    })
    expect(f.post).toHaveBeenCalledWith(
      'checkout',
      {
        action: 'prepare',
        attemptId: intent.attemptId,
        productId: intent.productId,
        collection: key,
      },
      expect.any(AbortSignal),
    )
    expect(f.navigate).toHaveBeenCalledWith(preparation.checkoutUrl)
  })
  it.each([
    { checkoutUrl: 'https://rzp.io.evil.test/i/synthetic' },
    { checkoutUrl: 'https://rzp.io/i/synthetic?next=https://evil.test' },
    { checkoutUrl: 'javascript:alert(1)' },
    { checkoutUrl: 'https://user:secret@rzp.io/i/synthetic' },
    { expiresAt: '2000-01-01T00:00:00.000Z' },
    { attemptId: '22222222-2222-4222-8222-222222222222' },
    { product: { ...product, id: 'other' } },
  ])('rejects a hostile, stale or misbound preparation %#', async (change) => {
    const f = fixture({ ...preparation, ...change })
    expect(await f.adapter.purchase(intent)).toMatchObject({ status: 'unavailable' })
    expect(f.navigate).not.toHaveBeenCalled()
  })
  it('fences identity changes during preparation before external navigation', async () => {
    const f = fixture()
    f.post.mockImplementation(async () => {
      f.setActive({ ...context(), scope: { ...context().scope, generation: 2 } })
      return preparation
    })
    expect(await f.adapter.purchase(intent)).toMatchObject({ status: 'account-mismatch' })
    expect(f.navigate).not.toHaveBeenCalled()
  })
  it('rejects another account intent before making a request', async () => {
    const f = fixture()
    expect(await f.adapter.purchase({ ...intent, accountId: 'another' })).toMatchObject({
      status: 'account-mismatch',
    })
    expect(f.post).not.toHaveBeenCalled()
  })
  it('keeps an unresolved attempt pending without opening a second checkout', async () => {
    const f = fixture({ status: 'pending', attemptId: intent.attemptId })
    expect(await f.adapter.purchase(intent)).toEqual({
      status: 'pending',
      attemptId: intent.attemptId,
    })
    expect(f.navigate).not.toHaveBeenCalled()
    f.post.mockRejectedValueOnce(new DomainError('OFFLINE'))
    expect(await f.adapter.purchase(intent)).toMatchObject({
      status: 'pending',
      attemptId: intent.attemptId,
    })
  })
  it('shows actual catalog prices, rejects a mixed native catalog and requires authentication', async () => {
    const f = fixture({ products: [product] })
    expect(await f.adapter.products()).toEqual([product])
    f.post.mockResolvedValueOnce({ products: [{ ...product, provider: 'revenuecat' }] })
    await expect(f.adapter.products()).rejects.toMatchObject({
      detail: { code: 'PURCHASE_UNAVAILABLE' },
    })
    f.setActive(null)
    await expect(f.adapter.restore()).rejects.toMatchObject({ detail: { code: 'AUTH_REQUIRED' } })
  })
})
