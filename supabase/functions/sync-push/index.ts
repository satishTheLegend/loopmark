import { endpoint, rpc } from '../_shared/command.ts'
import { parseReceipt, verifyCommand } from '../_shared/generated/domain/schema.ts'
import { safeError } from '../_shared/generated/domain/errors.ts'
import { observe } from '../_shared/observability.ts'
Deno.serve(
  endpoint(async (body, { client, user }) => {
    const cmd = await verifyCommand(body),
      started = performance.now()
    await observe(user.id, 'sync', 'start', cmd.operationId)
    try {
      const result = parseReceipt(await rpc(client, 'loopmark_push', { cmd }))
      await observe(user.id, 'sync', 'success', cmd.operationId, performance.now() - started)
      return result
    } catch (error) {
      const detail = safeError(error)
      await observe(
        user.id,
        'sync',
        detail.code === 'REVISION_CONFLICT' ? 'conflict' : detail.retryable ? 'retry' : 'error',
        cmd.operationId,
        performance.now() - started,
      )
      throw error
    }
  }),
)
