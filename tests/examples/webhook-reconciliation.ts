import type { createBillingCoordinator } from '../../src/billing/coordinator'

/** A webhook/callback hint is not a grant. The server verifies provider evidence before this read. */
export async function reconcilePurchase(
  billing: Pick<ReturnType<typeof createBillingCoordinator>, 'refresh' | 'getSnapshot'>,
) {
  await billing.refresh()
  return billing.getSnapshot().access
}
