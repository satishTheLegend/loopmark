import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PurchaseIntent } from '../../domain/contracts'
const sdk = vi.hoisted(() => ({
  configure: vi.fn(),
  setLogLevel: vi.fn(),
  setLogHandler: vi.fn(),
  getAppUserID: vi.fn(),
  isAnonymous: vi.fn(),
  logIn: vi.fn(),
  getProducts: vi.fn(),
  purchaseStoreProduct: vi.fn(),
  restorePurchases: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}))
vi.mock('@revenuecat/purchases-capacitor', () => ({
  Purchases: sdk,
  LOG_LEVEL: { ERROR: 'ERROR' },
  PRODUCT_CATEGORY: { NON_SUBSCRIPTION: 'NON_SUBSCRIPTION' },
  PURCHASES_ERROR_CODE: {
    PURCHASE_CANCELLED_ERROR: '1',
    RECEIPT_ALREADY_IN_USE_ERROR: '7',
    RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR: '13',
    PAYMENT_PENDING_ERROR: '20',
    OPERATION_ALREADY_IN_PROGRESS_ERROR: '15',
    NETWORK_ERROR: '10',
    OFFLINE_CONNECTION_ERROR: '35',
  },
}))
const key = { namespace: 'account_test', collectionId: 'collection', epoch: 'epoch' }
const context = () => ({
  session: {
    accountId: 'test',
    billingPrincipalId: 'principal',
    collection: key,
    device: { id: 'device', generation: 'device-generation' },
    deletionGeneration: '0',
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
  scope: { key, device: { id: 'device', generation: 'device-generation' }, generation: 1 },
})
const config = {
  platform: 'ios',
  publicSdkKey: 'appl_1234567890123456',
  productIds: ['loopmark.lifetime'],
  environment: 'sandbox',
}
const product = {
  identifier: 'loopmark.lifetime',
  title: 'Loopmark lifetime',
  price: 499,
  priceString: '¥499',
  currencyCode: 'JPY',
  productCategory: 'NON_SUBSCRIPTION',
}
const intent: PurchaseIntent = {
  attemptId: 'attempt',
  accountId: 'test',
  billingPrincipalId: 'principal',
  collection: key,
  generation: 1,
  productId: product.identifier,
  returnAction: 'settings',
}
describe('supplemental native billing guards (no store transaction evidence)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    sdk.getAppUserID.mockResolvedValue({ appUserID: 'principal' })
    sdk.isAnonymous.mockResolvedValue({ isAnonymous: false })
    sdk.getProducts.mockResolvedValue({ products: [product] })
  })
  async function adapter(current = () => context(), loadConfig = async () => config) {
    const { createNativeBilling } = await import('./purchases')
    return createNativeBilling({ current, loadConfig })
  }
  it('does not initialize the SDK when enrolled public configuration is unavailable', async () => {
    const billing = await adapter(
      () => context(),
      async () => {
        throw new Error('Unconfigured')
      },
    )
    expect(await billing.purchase(intent)).toMatchObject({ status: 'unavailable' })
    expect(sdk.configure).not.toHaveBeenCalled()
    expect(sdk.purchaseStoreProduct).not.toHaveBeenCalled()
  })
  it('identifies the verified billing principal and uses localized zero-decimal currency price', async () => {
    expect(await (await adapter()).products()).toMatchObject([
      { displayPrice: '¥499', amountMinor: 499, provider: 'revenuecat' },
    ])
    expect(sdk.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        appUserID: 'principal',
        diagnosticsEnabled: false,
        automaticDeviceIdentifierCollectionEnabled: false,
        useExternalPurchaseCustomLinks: false,
      }),
    )
  })
  it('fences a scope change during configuration before any native SDK initialization', async () => {
    let active = context()
    const billing = await adapter(
      () => active,
      async () => {
        active = { ...active, scope: { ...active.scope, generation: 2 } }
        return config
      },
    )
    expect(await billing.purchase(intent)).toMatchObject({ status: 'account-mismatch' })
    expect(sdk.configure).not.toHaveBeenCalled()
  })
  it('never purchases an unapproved product or grants access from a successful SDK result', async () => {
    const billing = await adapter()
    expect(await billing.purchase({ ...intent, productId: 'unapproved' })).toMatchObject({
      status: 'unavailable',
    })
    expect(sdk.purchaseStoreProduct).not.toHaveBeenCalled()
    sdk.purchaseStoreProduct.mockResolvedValue({
      customerInfo: { entitlements: { active: { paid: true } } },
    })
    expect(await billing.purchase(intent)).toEqual({ status: 'submitted', attemptId: 'attempt' })
  })
  it('maps pending and receipt-owner mismatch without exposing raw SDK errors', async () => {
    const billing = await adapter()
    sdk.purchaseStoreProduct.mockRejectedValue({ code: '20', message: 'private receipt' })
    expect(await billing.purchase(intent)).toEqual({ status: 'pending', attemptId: 'attempt' })
    sdk.purchaseStoreProduct.mockRejectedValue({ code: '7', message: 'private receipt' })
    const outcome = await billing.purchase(intent)
    expect(outcome).toMatchObject({
      status: 'account-mismatch',
      error: { code: 'PURCHASE_ACCOUNT_MISMATCH' },
    })
    expect(JSON.stringify(outcome)).not.toContain('private receipt')
  })
})
