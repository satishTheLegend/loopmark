import { z } from 'zod'
import type { AccountSession, DeletionReceipt, SessionScope } from '../domain/contracts'
import type { AccountAuth } from '../auth/auth-service'
import type { Repository } from '../repositories/contracts'
import type { FunctionClient } from '../sync/http-client'
import type { WorkflowRecord, WorkflowStore } from './workflow-store'
import { canonicalHash, canonicalJson, sha256Bytes } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import { deletionReceiptSchema, id, timestamp } from '../domain/schema'

const deletionStateSchema = z
  .object({
    requestId: id,
    receiptToken: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: timestamp,
    receipt: deletionReceiptSchema.nullable(),
    localOutcome: z.enum(['kept', 'removed', 'not-completed']),
  })
  .strict()
type DeletionState = z.infer<typeof deletionStateSchema>
export interface SavedDeletionReceipt {
  id: string
  createdAt: string
  receipt: DeletionReceipt | null
  localOutcome: 'kept' | 'removed' | 'not-completed'
}
export function createDeletionService(options: {
  repository: Repository
  auth: AccountAuth
  client: FunctionClient
  workflows: WorkflowStore
  current: () => AccountSession | null
}) {
  const publicReceipt = (row: WorkflowRecord<DeletionState>): SavedDeletionReceipt => ({
    id: row.id,
    createdAt: row.value.createdAt,
    receipt: row.value.receipt,
    localOutcome: row.value.localOutcome,
  })
  async function checked(scope: SessionScope, signal: AbortSignal) {
    signal.throwIfAborted()
    const session = options.current(),
      identity = await options.auth.verifiedIdentity()
    if (
      !session ||
      !identity ||
      identity.accountId !== session.accountId ||
      canonicalJson(await options.repository.readActive()) !== canonicalJson(scope)
    )
      throw new DomainError('ACCOUNT_CHANGED')
    return { session, identity }
  }
  async function readReceipt(idValue: string) {
    const row = await options.workflows.read<DeletionState>(idValue)
    if (!row || row.kind !== 'deletion' || !deletionStateSchema.safeParse(row.value).success)
      throw new DomainError('NOT_AVAILABLE')
    return row
  }
  async function query(row: WorkflowRecord<DeletionState>, signal: AbortSignal) {
    const result = deletionReceiptSchema.safeParse(
      await options.client.post(
        'deletion-status',
        { requestId: row.value.requestId, receiptToken: row.value.receiptToken },
        signal,
        { anonymous: true, maxBytes: 8192 },
      ),
    )
    if (!result.success) throw new DomainError('SYNC_PAGE_INVALID')
    return options.workflows.write(row.id, row.revision, {
      kind: 'deletion',
      accountId: row.accountId,
      collection: null,
      value: { ...row.value, receipt: result.data },
    })
  }
  return {
    async requestCode(scope: SessionScope, signal: AbortSignal) {
      const { identity } = await checked(scope, signal)
      const result = await options.auth.requestCode(identity.email, signal)
      await checked(scope, signal)
      return result
    },
    async delete(
      input: { operationToken: string; code: string },
      scope: SessionScope,
      signal: AbortSignal,
    ): Promise<SavedDeletionReceipt> {
      const { session } = await checked(scope, signal)
      if (!input.operationToken || input.operationToken.length > 128)
        throw new DomainError('VALIDATION')
      const recordId = `deletion_${await canonicalHash({ accountId: session.accountId, operationToken: input.operationToken })}`
      let row = await options.workflows.read<DeletionState>(recordId)
      if (row) {
        if (
          row.kind !== 'deletion' ||
          row.accountId !== session.accountId ||
          !deletionStateSchema.safeParse(row.value).success
        )
          throw new DomainError('OPERATION_REUSED')
        // A consumed one-time proof must never be replayed just because the response was lost.
        try {
          return publicReceipt(await query(row, signal))
        } catch (error) {
          if (!(error instanceof DomainError) || error.detail.code !== 'NOT_AVAILABLE') throw error
        }
      } else {
        const receiptToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('')
        row = await options.workflows.write(
          recordId,
          null,
          {
            kind: 'deletion',
            accountId: session.accountId,
            collection: null,
            value: {
              requestId: crypto.randomUUID(),
              receiptToken,
              createdAt: new Date().toISOString(),
              receipt: null,
              localOutcome: 'not-completed',
            },
          },
          scope,
        )
      }
      await checked(scope, signal)
      const proof = await options.auth.reauthenticate(input.code, signal)
      await checked(scope, signal)
      let response: unknown
      try {
        response = await options.client.post(
          'account-delete',
          {
            requestId: row.value.requestId,
            receiptTokenHash: await sha256Bytes(new TextEncoder().encode(row.value.receiptToken)),
            reauthentication: proof,
          },
          signal,
          { maxBytes: 8192 },
        )
      } catch (error) {
        // The deletion barrier immediately invalidates even the old JWT's getUser request.
        // Its independent read-only capability is the only safe continuation after a lost reply.
        try {
          return publicReceipt(await query(row, signal))
        } catch {
          throw error
        }
      }
      const result = deletionReceiptSchema.safeParse(response)
      if (!result.success) throw new DomainError('SYNC_PAGE_INVALID')
      // Store only the narrow receipt after a deletion-induced auth event changes the active scope.
      row = await options.workflows.write(recordId, row.revision, {
        kind: 'deletion',
        accountId: session.accountId,
        collection: null,
        value: { ...row.value, receipt: result.data },
      })
      return publicReceipt(row)
    },
    async listReceipts(): Promise<SavedDeletionReceipt[]> {
      return (await options.workflows.list<DeletionState>('deletion'))
        .filter((row) => deletionStateSchema.safeParse(row.value).success)
        .map(publicReceipt)
    },
    async recordLocalOutcome(
      idValue: string,
      localOutcome: SavedDeletionReceipt['localOutcome'],
    ): Promise<void> {
      if (!['kept', 'removed', 'not-completed'].includes(localOutcome))
        throw new DomainError('VALIDATION')
      const row = await readReceipt(idValue)
      await options.workflows.write(row.id, row.revision, {
        kind: 'deletion',
        accountId: row.accountId,
        collection: null,
        value: { ...row.value, localOutcome },
      })
    },
    async exportReceipt(idValue: string): Promise<Blob> {
      const row = await readReceipt(idValue)
      return new Blob(
        [
          JSON.stringify({
            version: 1,
            requestId: row.value.requestId,
            receiptToken: row.value.receiptToken,
            createdAt: row.value.createdAt,
            localOutcome: row.value.localOutcome,
          }),
        ],
        { type: 'application/json' },
      )
    },
    async refreshReceipt(idValue: string, signal: AbortSignal): Promise<DeletionReceipt> {
      return (await query(await readReceipt(idValue), signal)).value.receipt!
    },
  }
}
