import type { SyncTransport } from '../platform/contracts'
import {
  verifyCommand,
  parseReceipt,
  parsePullPage,
  parseSnapshot,
  pullRequestSchema,
  snapshotRequestSchema,
  snapshotReleaseRequestSchema,
  snapshotReleasedSchema,
} from '../domain/schema'
import { DomainError } from '../domain/errors'
import type { FunctionClient } from './http-client'
export function createSyncTransport(client: FunctionClient): SyncTransport {
  return {
    async releaseSnapshot(snapshotId, signal) {
      const request = snapshotReleaseRequestSchema.safeParse({ action: 'release', snapshotId })
      if (!request.success) throw new DomainError('VALIDATION')
      if (
        !snapshotReleasedSchema.safeParse(await client.post('sync-snapshot', request.data, signal))
          .success
      )
        throw new DomainError('SYNC_PAGE_INVALID')
    },
    async push(input, signal) {
      const command = await verifyCommand(input)
      const receipt = parseReceipt(await client.post('sync-push', command, signal))
      if (
        receipt.operationId !== command.operationId ||
        receipt.sha256 !== command.sha256 ||
        receipt.epoch !== command.epoch
      )
        throw new DomainError('SYNC_PAGE_INVALID')
      return receipt
    },
    async pull(input, signal) {
      const request = pullRequestSchema.safeParse(input)
      if (!request.success) throw new DomainError('VALIDATION')
      const page = parsePullPage(await client.post('sync-pull', request.data, signal))
      if (
        page.collectionId !== input.collectionId ||
        page.epoch !== input.epoch ||
        page.afterCursor !== input.afterCursor
      )
        throw new DomainError('SYNC_PAGE_INVALID')
      return page
    },
    async snapshot(input, signal) {
      const request = snapshotRequestSchema.safeParse(input)
      if (!request.success) throw new DomainError('VALIDATION')
      const result = parseSnapshot(
        await client.post('sync-snapshot', request.data, signal, { maxBytes: 512 * 1024 }),
      )
      if (
        (input.action === 'create' &&
          (result.collectionId !== input.collectionId || result.after !== null)) ||
        (input.action === 'page' &&
          (result.snapshotId !== input.snapshotId || result.after !== input.after)) ||
        (input.action === 'renew' && result.snapshotId !== input.snapshotId)
      )
        throw new DomainError('SYNC_PAGE_INVALID')
      return result
    },
  }
}
