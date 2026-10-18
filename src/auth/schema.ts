import { z } from 'zod'
import { collectionKeySchema, id, revisionSchema, timestamp } from '../domain/schema'
export const accountSessionSchema = z
  .object({
    accountId: id,
    billingPrincipalId: id,
    deletionGeneration: revisionSchema,
    collection: collectionKeySchema,
    device: z.object({ id, generation: id }).strict(),
    expiresAt: timestamp,
  })
  .strict()
  .refine((s) => s.collection.namespace === `account_${s.accountId}`)
export const reauthenticationSchema = z
  .object({ challengeId: id, proof: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: timestamp })
  .strict()
