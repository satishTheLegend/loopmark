import { z } from 'zod'
import { collectionKeySchema, id, timestamp } from '../domain/schema'
import type { PurchaseIntent, PurchaseOutcome } from '../domain/contracts'
import type { SafeError } from '../domain/errors'
export const purchaseIntentSchema = z
  .object({
    attemptId: z.uuid(),
    accountId: id,
    billingPrincipalId: id,
    productId: id,
    collection: collectionKeySchema,
    generation: z.number().int().nonnegative(),
    returnAction: z.enum(['new-project', 'reopen-project', 'settings']),
    draftKey: z.string().min(1).max(200).optional(),
    projectId: id.optional(),
  })
  .strict()
export interface PurchaseAttempt {
  type: 'purchase-attempt'
  version: 1
  intent: PurchaseIntent
  provider: 'razorpay' | 'revenuecat'
  createdAt: string
  phase: 'saved' | 'launched' | 'pending' | 'verified' | 'cancelled' | 'failed' | 'continued'
  outcome: PurchaseOutcome | null
  error: SafeError | null
}
export const attemptSchema = z
  .object({
    type: z.literal('purchase-attempt'),
    version: z.literal(1),
    intent: purchaseIntentSchema,
    provider: z.enum(['razorpay', 'revenuecat']),
    createdAt: timestamp,
    phase: z.enum(['saved', 'launched', 'pending', 'verified', 'cancelled', 'failed', 'continued']),
    outcome: z.unknown().nullable(),
    error: z.unknown().nullable(),
  })
  .strict()
