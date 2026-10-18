import { rpc } from '../_shared/command.ts'
import { billing, reconcile, discoveryBatch } from '../_shared/billing.ts'
import { dispute, disputes } from '../_shared/providers/razorpay.ts'
import { DomainError, safeError } from '../_shared/generated/domain/errors.ts'
import type { OperationReport, PurchaseProvider } from '../_shared/generated/domain/contracts.ts'
export async function reconcilePurchases(limit: number): Promise<OperationReport> {
  const admin = billing(),
    environment = admin.config.paymentEnvironment,
    report: OperationReport = {
      schemaVersion: 1,
      status: 'ok',
      dryRun: false,
      counts: { examined: 0, changed: 0, failed: 0 },
      nextCursor: null,
      jobId: null,
      errors: [],
    }
  const inbox = (await rpc(admin.client, 'loopmark_billing_inbox_claim', {
    p_limit: Math.min(limit, 4),
  })) as {
    provider: PurchaseProvider
    environment: string
    eventId: string
    fence: string
    payload: { purchaseId?: string; disputeId?: string; principalId?: string }
  }[]
  for (let offset = 0; offset < inbox.length; offset += 4)
    await Promise.all(
      inbox.slice(offset, offset + 4).map(async (item) => {
        report.counts.examined++
        let success = false
        try {
          if (item.environment !== environment) throw new DomainError('NOT_AVAILABLE')
          billing(item.provider)
          if (item.provider === 'razorpay') {
            if (item.payload.disputeId) {
              const value = await dispute(admin.config, item.payload.disputeId)
              if (value.payment_id !== item.payload.purchaseId)
                throw new DomainError('NOT_AVAILABLE')
              await rpc(admin.client, 'loopmark_billing_dispute_record', {
                p_environment: environment,
                p_id: value.id,
                p_purchase: value.payment_id,
              })
            }
            if (item.payload.purchaseId && !(await reconcile('razorpay', item.payload.purchaseId)))
              throw new DomainError('SERVICE_UNAVAILABLE')
          } else if (item.payload.principalId)
            await rpc(admin.client, 'loopmark_billing_queue_principal', {
              p_principal: item.payload.principalId,
              p_environment: environment,
            })
          success = true
          report.counts.changed++
        } catch (error) {
          report.counts.failed++
          report.errors.push(safeError(error))
        }
        await rpc(admin.client, 'loopmark_billing_inbox_finish', {
          p_provider: item.provider,
          p_environment: item.environment,
          p_event: item.eventId,
          p_fence: item.fence,
          p_success: success,
        })
      }),
    )
  if (admin.config.razorpayEnrolled) {
    const scan = await rpc(admin.client, 'loopmark_billing_dispute_scan_claim', {
      p_environment: environment,
    })
    if (scan)
      try {
        const page = await disputes(admin.config, scan.offset, scan.through)
        for (const value of page)
          await rpc(admin.client, 'loopmark_billing_dispute_record', {
            p_environment: environment,
            p_id: value.id,
            p_purchase: value.payment_id,
          })
        await rpc(admin.client, 'loopmark_billing_dispute_scan_finish', {
          p_environment: environment,
          p_fence: scan.fence,
          p_count: page.length,
        })
      } catch (error) {
        report.counts.failed++
        report.errors.push(safeError(error))
      }
  }
  const due = (await rpc(admin.client, 'loopmark_billing_due', {
    p_limit: Math.min(limit, 4),
  })) as {
    provider: PurchaseProvider
    environment: string
    purchaseId: string
  }[]
  for (let offset = 0; offset < due.length; offset += 4)
    await Promise.all(
      due.slice(offset, offset + 4).map(async (item) => {
        report.counts.examined++
        try {
          if (item.environment !== environment) throw new DomainError('NOT_AVAILABLE')
          if (await reconcile(item.provider, item.purchaseId)) report.counts.changed++
        } catch (error) {
          report.counts.failed++
          report.errors.push(safeError(error))
        }
      }),
    )
  const discovered = await discoveryBatch(limit)
  for (const key of ['examined', 'changed', 'failed'] as const)
    report.counts[key] += discovered[key]
  if (report.counts.failed) report.status = 'partial'
  return report
}
