import type {
  ErasureIntent,
  ErasureInventory,
  ErasureLedger,
} from './generated/domain/contracts.ts'
import { DomainError } from './generated/domain/errors.ts'
import type { ServerConfig } from './config.ts'
import { boundedJson } from './limits.ts'
import { z } from 'npm:zod@4.6.7'
import { id, timestamp, hashSchema, revisionSchema } from './generated/domain/schema.ts'
const watermarkSchema = z
  .string()
  .max(100)
  .regex(/^(0|[1-9][0-9]*):[a-f0-9]{64}$/)
const intentSchema = z
  .object({
    accountId: z.string().uuid(),
    deletionGeneration: revisionSchema.refine((value) => value !== '0'),
    requestId: id,
    receiptTokenHash: hashSchema,
    requestedAt: timestamp,
    retainUntil: timestamp,
  })
  .strict()
  .refine((value) => Date.parse(value.retainUntil) >= Date.parse(value.requestedAt) + 90 * 86400000)
const inventorySchema = z
  .object({
    watermark: watermarkSchema,
    asOf: timestamp,
    entries: z.array(intentSchema).max(50),
    nextCursor: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,12})$/)
      .nullable(),
  })
  .strict()
export class RemoteErasureLedger implements ErasureLedger {
  constructor(private config: ServerConfig) {}
  private async call(path: string, body: unknown) {
    if (!this.config.erasureLedgerUrl || !this.config.secrets.erasureLedger)
      throw new DomainError('CAPABILITY_UNAVAILABLE')
    try {
      const response = await fetch(this.config.erasureLedgerUrl + path, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.secrets.erasureLedger.reveal()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      })
      if (!response.ok) throw new Error('Ledger unavailable')
      return await boundedJson(response, 128 * 1024)
    } catch {
      throw new DomainError('SERVICE_UNAVAILABLE')
    }
  }
  async append(intent: ErasureIntent): Promise<{ watermark: string }> {
    return z
      .object({ watermark: watermarkSchema })
      .strict()
      .parse(await this.call('/append', intentSchema.parse(intent)))
  }
  async inventory(cursor: string | null): Promise<ErasureInventory> {
    return inventorySchema.parse(await this.call('/inventory', { cursor }))
  }
  async currentWatermark(): Promise<string> {
    return z
      .object({ watermark: watermarkSchema, asOf: timestamp })
      .strict()
      .parse(await this.call('/watermark', {})).watermark
  }
  async lookup(requestId: string, receiptTokenHash: string): Promise<ErasureIntent | null> {
    return z
      .object({ intent: intentSchema.nullable(), watermark: watermarkSchema })
      .strict()
      .parse(await this.call('/lookup', { requestId, receiptTokenHash })).intent
  }
}
