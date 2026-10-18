import { rpc } from '../_shared/command.ts'
import { server } from '../_shared/server.ts'
import { DomainError, safeError } from '../_shared/generated/domain/errors.ts'
import type { OperationReport } from '../_shared/generated/domain/contracts.ts'
export async function sweepMedia(
  limit: number,
  ownerId: string | null = null,
): Promise<OperationReport> {
  const admin = server().client,
    objects = await rpc(admin, 'loopmark_media_sweep_claim', { p_limit: limit, p_owner: ownerId })
  const report: OperationReport = {
    schemaVersion: 1,
    status: 'ok',
    dryRun: false,
    counts: { examined: objects.length, changed: 0, failed: 0 },
    nextCursor: null,
    jobId: null,
    errors: [],
  }
  for (let offset = 0; offset < objects.length; offset += 4)
    await Promise.all(
      objects
        .slice(offset, offset + 4)
        .map(async (object: { objectKey: string; ownerId: string; fence: string }) => {
          try {
            const removed = await admin.storage.from('loopmark-private').remove([object.objectKey])
            if (removed.error) throw new DomainError('SERVICE_UNAVAILABLE')
            await rpc(admin, 'loopmark_media_sweep_finish', {
              p_owner: object.ownerId,
              p_key: object.objectKey,
              p_fence: object.fence,
            })
            report.counts.changed++
          } catch (error) {
            report.counts.failed++
            report.status = 'partial'
            report.errors.push(safeError(error))
          }
        }),
    )
  return report
}
