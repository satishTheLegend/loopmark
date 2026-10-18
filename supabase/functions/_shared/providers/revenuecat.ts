import { z } from 'npm:zod@4.6.7'
import type { ProviderConfig } from './http.ts'
import { DomainError } from '../generated/domain/errors.ts'
import { providerRequest, providerValue } from './http.ts'
const opaque = z.string().regex(/^[A-Za-z0-9._:=-]{1,255}$/)
const purchaseSchema = z.object({
  id: opaque,
  customer_id: z.string().uuid(),
  original_customer_id: z.string().uuid(),
  product_id: opaque,
  status: z.enum(['owned', 'refunded']),
  environment: z.enum(['sandbox', 'production']),
  store: z.enum(['app_store', 'play_store']),
  ownership: z.literal('purchased'),
  store_purchase_identifier: opaque,
})
export type RevenueCatPurchase = z.infer<typeof purchaseSchema>
export async function purchase(config: ProviderConfig, id: string) {
  const value = providerValue(
    purchaseSchema,
    await providerRequest(
      config,
      'revenuecat',
      `/v2/projects/${config.revenueCatProjectId!}/purchases/${encodeURIComponent(opaque.parse(id))}`,
    ),
  )
  if (
    value.id !== id ||
    value.environment !== config.paymentEnvironment ||
    value.customer_id !== value.original_customer_id
  )
    throw new DomainError('NOT_AVAILABLE')
  return value
}
export async function purchases(
  config: ProviderConfig,
  principal: string,
  after: string | null = null,
) {
  const path = `/v2/projects/${config.revenueCatProjectId!}/customers/${z.string().uuid().parse(principal)}/purchases`
  const response = providerValue(
    z.object({
      items: z.array(z.object({ id: opaque })).max(4),
      next_page: z.string().nullable().optional(),
    }),
    await providerRequest(
      config,
      'revenuecat',
      `${path}?environment=${config.paymentEnvironment}&limit=4${after ? '&starting_after=' + encodeURIComponent(opaque.parse(after)) : ''}`,
    ),
  )
  // Never follow a provider-supplied arbitrary URL. Derive the next bounded cursor from verified items.
  if (response.next_page && (!response.items.length || response.items.at(-1)!.id === after))
    throw new DomainError('SERVICE_UNAVAILABLE')
  return {
    ids: response.items.map((item) => item.id),
    after: response.next_page ? response.items.at(-1)!.id : null,
  }
}

/** A receipt names a store transaction, never an internal provider purchase ID. */
export async function purchaseFromReceipt(
  config: ProviderConfig,
  receipt: string,
): Promise<string> {
  const response = providerValue(
    z.object({
      items: z.array(purchaseSchema).max(2),
      next_page: z.string().nullable().optional(),
    }),
    await providerRequest(
      config,
      'revenuecat',
      `/v2/projects/${config.revenueCatProjectId!}/purchases?store_purchase_identifier=${encodeURIComponent(opaque.parse(receipt))}`,
    ),
  )
  // A truncated or ambiguous search cannot establish unique ownership. No arbitrary next URL is followed.
  if (response.next_page || response.items.length !== 1) throw new DomainError('NOT_AVAILABLE')
  const found = response.items[0]
  if (
    found.environment !== config.paymentEnvironment ||
    found.store_purchase_identifier !== receipt ||
    found.customer_id !== found.original_customer_id
  )
    throw new DomainError('NOT_AVAILABLE')
  return found.id
}
