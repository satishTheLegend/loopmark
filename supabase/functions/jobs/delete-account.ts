import { rpc } from '../_shared/command.ts'
import { server } from '../_shared/server.ts'
import { DomainError, safeError } from '../_shared/generated/domain/errors.ts'
import type { OperationReport } from '../_shared/generated/domain/contracts.ts'
export async function resumeDeletions(
  limit: number,
  ownerId: string | null = null,
): Promise<OperationReport> {
  const admin = server().client
  const jobs = await rpc(admin, 'loopmark_deletion_claim', { p_limit: limit, p_owner: ownerId })
  const report: OperationReport = {
    schemaVersion: 1,
    status: 'ok',
    dryRun: false,
    counts: { examined: jobs.length, changed: 0, failed: 0 },
    nextCursor: null,
    jobId: null,
    errors: [],
  }
  for (let offset = 0; offset < jobs.length; offset += 4)
    await Promise.all(
      jobs
        .slice(offset, offset + 4)
        .map(async (job: { id: string; ownerId: string; fence: string }) => {
          const step = (action: string) =>
            rpc(admin, 'loopmark_deletion_step', {
              p_id: job.id,
              p_fence: job.fence,
              p_action: action,
            })
          try {
            const first = await step('inventory')
            if (first.keys.length) {
              const removed = await admin.storage.from('loopmark-private').remove(first.keys)
              if (removed.error) throw new DomainError('SERVICE_UNAVAILABLE')
            }
            // Second fresh inventory follows the admitted-request expiry barrier and first sweep.
            const second = await step('inventory')
            if (second.keys.length) {
              await step('reschedule')
              report.status = 'partial'
              return
            }
            await step('purge-metadata')
            const removed = await admin.auth.admin.deleteUser(job.ownerId, false)
            if (removed.error && removed.error.status !== 404)
              throw new DomainError('SERVICE_UNAVAILABLE')
            await step('finish')
            report.counts.changed++
          } catch (error) {
            report.counts.failed++
            report.status = 'partial'
            report.errors.push(safeError(error))
            await step('reschedule').catch(() => {})
          }
        }),
    )
  return report
}
