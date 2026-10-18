import { Capacitor } from '@capacitor/core'
import type { BillingAdapter } from '../contracts'
import type {
  AccountSession,
  PurchaseIntent,
  PurchaseOutcome,
  SessionScope,
} from '../../domain/contracts'
import { accountSessionSchema } from '../../auth/schema'
import { canonicalJson } from '../../domain/canonical-json'
import { DomainError } from '../../domain/errors'
import {
  checkoutProductsSchema,
  checkoutPreparationSchema,
  checkoutRequestSchema,
} from '../../domain/remote-schema'
import type { FunctionClient } from '../../sync/http-client'

export interface WebBillingContext {
  session: AccountSession
  scope: SessionScope
}
export interface WebBillingOptions {
  current(): WebBillingContext | null
  client: FunctionClient
  navigate?: (url: string) => void
}
const unavailable = (): PurchaseOutcome => ({
  status: 'unavailable',
  error: new DomainError('PURCHASE_UNAVAILABLE').detail,
})
const mismatch = (): PurchaseOutcome => ({
  status: 'account-mismatch',
  error: new DomainError('PURCHASE_ACCOUNT_MISMATCH').detail,
})
const fingerprint = ({ session, scope }: WebBillingContext) =>
  canonicalJson({
    accountId: session.accountId,
    principal: session.billingPrincipalId,
    collection: session.collection,
    device: session.device,
    deletionGeneration: session.deletionGeneration,
    scope,
  })

/** The caller must persist the intent and draft continuation before purchase(). No provider script runs here. */
export function createWebBilling(options: WebBillingOptions): BillingAdapter {
  let busy = false
  function context() {
    const active = options.current()
    if (Capacitor.isNativePlatform()) throw new DomainError('CAPABILITY_UNAVAILABLE')
    if (
      !active ||
      !accountSessionSchema.safeParse(active.session).success ||
      Date.parse(active.session.expiresAt) <= Date.now()
    )
      throw new DomainError('AUTH_REQUIRED')
    return structuredClone(active)
  }
  function fence(bound: WebBillingContext) {
    const active = options.current()
    if (
      !active ||
      Date.parse(active.session.expiresAt) <= Date.now() ||
      fingerprint(active) !== fingerprint(bound)
    )
      throw new DomainError('ACCOUNT_CHANGED')
  }
  return {
    async products() {
      const bound = context()
      const value = checkoutProductsSchema.safeParse(
        await options.client.post('checkout', { action: 'products' }, AbortSignal.timeout(20_000)),
      )
      fence(bound)
      if (!value.success || value.data.products.some((product) => product.provider !== 'razorpay'))
        throw new DomainError('PURCHASE_UNAVAILABLE')
      return value.data.products
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
        const input = checkoutRequestSchema.safeParse({
          action: 'prepare',
          attemptId: intent.attemptId,
          productId: intent.productId,
          // The maker may be upgrading a local-only collection. Billing binds to the
          // enrolled account collection; the durable UI intent stays with its local draft.
          collection: bound.session.collection,
        })
        if (!input.success) return unavailable()
        const response = checkoutPreparationSchema.safeParse(
          await options.client.post('checkout', input.data, AbortSignal.timeout(20_000)),
        )
        fence(bound)
        if (!response.success || response.data.attemptId !== intent.attemptId) return unavailable()
        const preparation = response.data
        if (preparation.status === 'pending')
          return { status: 'pending', attemptId: intent.attemptId }
        if (
          preparation.product.id !== intent.productId ||
          Date.parse(preparation.expiresAt) <= Date.now()
        )
          return unavailable()
        // The strict response schema permits only the exact provider-hosted path, with no redirect/query.
        // Same-tab navigation avoids popup blockers after the durable asynchronous preparation.
        ;(options.navigate ?? ((url) => window.location.assign(url)))(preparation.checkoutUrl)
        return { status: 'submitted', attemptId: intent.attemptId }
      } catch (error) {
        if (
          error instanceof DomainError &&
          ['ACCOUNT_CHANGED', 'PURCHASE_ACCOUNT_MISMATCH'].includes(error.detail.code)
        )
          return mismatch()
        // A response loss may follow provider creation. The saved attempt is reconciled, never recreated with a new ID.
        if (error instanceof DomainError && error.detail.retryable)
          return { status: 'pending', attemptId: intent.attemptId }
        return unavailable()
      } finally {
        busy = false
      }
    },
    // Web restoration is server reconciliation by the purchase coordinator, not a new checkout.
    async restore() {
      context()
      return { status: 'none' }
    },
  }
}
