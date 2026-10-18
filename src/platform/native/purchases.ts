import { Capacitor } from '@capacitor/core'
import {
  Purchases,
  LOG_LEVEL,
  PRODUCT_CATEGORY,
  PURCHASES_ERROR_CODE,
  type PurchasesStoreProduct,
} from '@revenuecat/purchases-capacitor'
import type { BillingAdapter } from '../contracts'
import type {
  AccountSession,
  LocalizedProduct,
  PurchaseIntent,
  PurchaseOutcome,
  SessionScope,
} from '../../domain/contracts'
import { nativeBillingConfigSchema } from '../../domain/remote-schema'
import { accountSessionSchema } from '../../auth/schema'
import { canonicalJson } from '../../domain/canonical-json'
import { DomainError } from '../../domain/errors'
import { requireNative } from './boundary'

export interface NativeBillingContext {
  session: AccountSession
  scope: SessionScope
}
export interface NativeBillingOptions {
  current(): NativeBillingContext | null
  /** Authenticated FunctionClient POST billing-config; the SDK key is public, never a grant. */
  loadConfig(platform: 'ios' | 'android', signal: AbortSignal): Promise<unknown>
}
// RevenueCat is a process singleton. Never switch its identity during a purchase/restore.
let busy = false
let configuredKey: string | undefined
const mismatch = (): PurchaseOutcome => ({
  status: 'account-mismatch',
  error: new DomainError('PURCHASE_ACCOUNT_MISMATCH').detail,
})
const unavailable = (): PurchaseOutcome => ({
  status: 'unavailable',
  error: new DomainError('PURCHASE_UNAVAILABLE').detail,
})
function fingerprint(context: NativeBillingContext) {
  return canonicalJson({
    accountId: context.session.accountId,
    principal: context.session.billingPrincipalId,
    collection: context.session.collection,
    device: context.session.device,
    deletionGeneration: context.session.deletionGeneration,
    scope: context.scope,
  })
}
export function createNativeBilling(options: NativeBillingOptions): BillingAdapter {
  function context() {
    requireNative()
    const value = options.current()
    if (
      !value ||
      !accountSessionSchema.safeParse(value.session).success ||
      Date.parse(value.session.expiresAt) <= Date.now()
    )
      throw new DomainError('AUTH_REQUIRED')
    if (
      canonicalJson(value.session.collection) !== canonicalJson(value.scope.key) ||
      canonicalJson(value.session.device) !== canonicalJson(value.scope.device)
    )
      throw new DomainError('ACCOUNT_CHANGED')
    return structuredClone(value)
  }
  function current(expected: NativeBillingContext) {
    const now = options.current()
    return !!now && fingerprint(now) === fingerprint(expected)
  }
  function fence(expected: NativeBillingContext) {
    if (!current(expected)) throw new DomainError('ACCOUNT_CHANGED')
  }
  async function initialize(expected: NativeBillingContext) {
    const platform = Capacitor.getPlatform()
    if (platform !== 'ios' && platform !== 'android')
      throw new DomainError('CAPABILITY_UNAVAILABLE')
    const result = nativeBillingConfigSchema.safeParse(
      await options.loadConfig(platform, AbortSignal.timeout(20_000)),
    )
    fence(expected)
    if (!result.success || result.data.platform !== platform)
      throw new DomainError('PURCHASE_UNAVAILABLE')
    const config = result.data
    if (configuredKey && configuredKey !== config.publicSdkKey)
      throw new DomainError('PURCHASE_UNAVAILABLE')
    if (!configuredKey) {
      await Purchases.setLogLevel({ level: LOG_LEVEL.ERROR })
      await Purchases.setLogHandler(() => {
        /* Never forward SDK account/receipt payloads to logs. */
      })
      fence(expected)
      await Purchases.configure({
        apiKey: config.publicSdkKey,
        appUserID: expected.session.billingPrincipalId,
        diagnosticsEnabled: false,
        automaticDeviceIdentifierCollectionEnabled: false,
        shouldShowInAppMessagesAutomatically: false,
        useExternalPurchaseCustomLinks: false,
        enableExternalPurchasesInSimulator: false,
      })
      configuredKey = config.publicSdkKey
    } else if ((await Purchases.getAppUserID()).appUserID !== expected.session.billingPrincipalId) {
      fence(expected)
      await Purchases.logIn({ appUserID: expected.session.billingPrincipalId })
    }
    fence(expected)
    if (
      (await Purchases.isAnonymous()).isAnonymous ||
      (await Purchases.getAppUserID()).appUserID !== expected.session.billingPrincipalId
    )
      throw new DomainError('PURCHASE_ACCOUNT_MISMATCH')
    fence(expected)
    return config
  }
  async function products(expected: NativeBillingContext) {
    const config = await initialize(expected)
    const { products } = await Purchases.getProducts({
      productIdentifiers: config.productIds,
      type: PRODUCT_CATEGORY.NON_SUBSCRIPTION,
    })
    fence(expected)
    return products.filter(
      (product) =>
        config.productIds.includes(product.identifier) &&
        product.productCategory === PRODUCT_CATEGORY.NON_SUBSCRIPTION,
    )
  }
  function localize(product: PurchasesStoreProduct): LocalizedProduct {
    if (
      !/^[A-Z]{3}$/.test(product.currencyCode) ||
      !Number.isFinite(product.price) ||
      product.price < 0 ||
      !product.priceString ||
      product.priceString.length > 100 ||
      !product.title ||
      product.title.length > 300
    )
      throw new DomainError('PURCHASE_UNAVAILABLE')
    const digits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: product.currencyCode,
    }).resolvedOptions().maximumFractionDigits
    if (digits === undefined) throw new DomainError('PURCHASE_UNAVAILABLE')
    const amountMinor = Math.round(product.price * 10 ** digits)
    if (!Number.isSafeInteger(amountMinor)) throw new DomainError('PURCHASE_UNAVAILABLE')
    return {
      id: product.identifier,
      title: product.title,
      displayPrice: product.priceString,
      currency: product.currencyCode,
      amountMinor,
      provider: 'revenuecat',
    }
  }
  function failure(error: unknown, attemptId: string): PurchaseOutcome {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return { status: 'cancelled' }
    if (
      [
        PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR,
        PURCHASES_ERROR_CODE.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR,
      ].includes(code as PURCHASES_ERROR_CODE)
    )
      return mismatch()
    if (
      code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR ||
      code === PURCHASES_ERROR_CODE.OPERATION_ALREADY_IN_PROGRESS_ERROR ||
      code === PURCHASES_ERROR_CODE.NETWORK_ERROR ||
      code === PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR
    )
      return { status: 'pending', attemptId }
    if (
      error instanceof DomainError &&
      ['ACCOUNT_CHANGED', 'PURCHASE_ACCOUNT_MISMATCH'].includes(error.detail.code)
    )
      return mismatch()
    return unavailable()
  }
  return {
    async products() {
      if (busy) throw new DomainError('PURCHASE_UNAVAILABLE')
      busy = true
      try {
        return (await products(context())).map(localize)
      } catch (error) {
        throw error instanceof DomainError ? error : new DomainError('PURCHASE_UNAVAILABLE')
      } finally {
        busy = false
      }
    },
    async purchase(intent: PurchaseIntent) {
      if (busy) return unavailable()
      busy = true
      try {
        const bound = context()
        if (
          intent.accountId !== bound.session.accountId ||
          intent.billingPrincipalId !== bound.session.billingPrincipalId ||
          intent.generation !== bound.scope.generation ||
          canonicalJson(intent.collection) !== canonicalJson(bound.scope.key)
        )
          return mismatch()
        const product = (await products(bound)).find(
          (product) => product.identifier === intent.productId,
        )
        if (!product) return unavailable()
        localize(product)
        fence(bound)
        await Purchases.purchaseStoreProduct({ product })
        return current(bound) ? { status: 'submitted', attemptId: intent.attemptId } : mismatch()
      } catch (error) {
        return failure(error, intent.attemptId)
      } finally {
        busy = false
      }
    },
    async restore() {
      if (busy) return unavailable()
      busy = true
      const attemptId = crypto.randomUUID()
      try {
        const bound = context()
        const config = await initialize(bound)
        fence(bound)
        const { customerInfo } = await Purchases.restorePurchases()
        if (!current(bound)) return mismatch()
        // SDK customer information is only a reason to ask the server for verified status.
        return customerInfo.allPurchasedProductIdentifiers.some((id) =>
          config.productIds.includes(id),
        )
          ? { status: 'submitted', attemptId }
          : { status: 'none' }
      } catch (error) {
        return failure(error, attemptId)
      } finally {
        busy = false
      }
    },
  }
}
