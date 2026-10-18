import { z } from 'zod'
import type { AccountSession, PurchaseProvider, SessionScope } from '../domain/contracts'
import type {
  PurchaseRecoveryWireRequest,
  PurchaseRecoveryWireResponse,
} from '../domain/remote-contracts'
import type { Repository } from '../repositories/contracts'
import type { AccountAuth } from '../auth/auth-service'
import type { FunctionClient } from '../sync/http-client'
import type { WorkflowRecord, WorkflowStore } from '../services/workflow-store'
import {
  billingStatusSchema,
  purchaseRecoveryWireResponseSchema,
  purchaseRecoveryWireRequestSchema,
} from '../domain/remote-schema'
import { hashSchema, timestamp } from '../domain/schema'
import { canonicalHash, canonicalJson, sha256Bytes } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
const schema = z
  .object({
    type: z.literal('purchase-recovery'),
    version: z.literal(1),
    mode: z.enum(['set-key', 'claim']),
    requestId: z.uuid(),
    fingerprint: hashSchema,
    nextKey: hashSchema,
    createdAt: timestamp,
    result: purchaseRecoveryWireResponseSchema.nullable(),
  })
  .strict()
type Recovery = z.infer<typeof schema>
const keyStatusSchema = z
  .object({
    type: z.literal('recovery-key-current'),
    accountId: z.string(),
    principalId: z.string(),
    deletionGeneration: z.string(),
    hash: hashSchema.nullable(),
    checkedAt: timestamp,
  })
  .strict()
type KeyStatus = z.infer<typeof keyStatusSchema>
const identity = (session: AccountSession | null) =>
  session
    ? {
        accountId: session.accountId,
        principalId: session.billingPrincipalId,
        deletionGeneration: session.deletionGeneration,
      }
    : null

export interface SavedPurchaseRecovery {
  id: string
  mode: 'set-key' | 'claim'
  createdAt: string
  result: PurchaseRecoveryWireResponse | null
  keyState?: 'last-confirmed' | 'current' | 'superseded'
  keyCheckedAt?: string | null
}
/** Recovery keys are user-owned secrets: never a URL, log, ordinary snapshot, or server plaintext field. */
export function createPurchaseRecoveryService(options: {
  repository: Repository
  auth: AccountAuth
  client: FunctionClient
  workflows: WorkflowStore
  current: () => AccountSession | null
}) {
  const publicValue = (row: WorkflowRecord<Recovery>): SavedPurchaseRecovery => ({
    id: row.id,
    mode: row.value.mode,
    createdAt: row.value.createdAt,
    result: row.value.result,
  })
  const statusId = async (session: AccountSession) =>
    `recovery_key_${(await canonicalHash(identity(session))).slice(0, 48)}`
  async function knownKeyStatus(session: AccountSession) {
    const row = await options.workflows.read(await statusId(session))
    if (canonicalJson(identity(options.current())) !== canonicalJson(identity(session)))
      throw new DomainError('ACCOUNT_CHANGED')
    if (!row) return null
    const parsed = keyStatusSchema.safeParse(row.value)
    if (
      row.accountId !== session.accountId ||
      !parsed.success ||
      canonicalJson({
        accountId: parsed.data.accountId,
        principalId: parsed.data.principalId,
        deletionGeneration: parsed.data.deletionGeneration,
      }) !== canonicalJson(identity(session))
    )
      throw new DomainError('VALIDATION')
    return parsed.data
  }
  const withStatus = (
    row: WorkflowRecord<Recovery>,
    status: KeyStatus | null,
  ): SavedPurchaseRecovery => {
    const result = row.value.result
    return {
      ...publicValue(row),
      keyState:
        !status || !result || result.status === 'pending'
          ? 'last-confirmed'
          : result.recoveryKeyHash === status.hash
            ? 'current'
            : 'superseded',
      keyCheckedAt: status?.checkedAt ?? null,
    }
  }
  async function check(scope: SessionScope, signal: AbortSignal) {
    signal.throwIfAborted()
    const session = options.current(),
      identity = await options.auth.verifiedIdentity()
    if (
      !session ||
      identity?.accountId !== session.accountId ||
      canonicalJson(await options.repository.readActive()) !== canonicalJson(scope)
    )
      throw new DomainError('ACCOUNT_CHANGED')
    signal.throwIfAborted()
    return session
  }
  async function read(id: string) {
    const session = options.current(),
      row = await options.workflows.read<Recovery>(id)
    if (
      !session ||
      options.current()?.accountId !== session.accountId ||
      !row ||
      row.kind !== 'purchase' ||
      row.accountId !== session.accountId ||
      !schema.safeParse(row.value).success
    )
      throw new DomainError('NOT_AVAILABLE')
    return row
  }
  async function storeResult(
    row: WorkflowRecord<Recovery>,
    input: unknown,
    scope: SessionScope,
    signal: AbortSignal,
  ) {
    const session = await check(scope, signal),
      result = purchaseRecoveryWireResponseSchema.safeParse(input)
    if (!result.success || row.accountId !== session.accountId)
      throw new DomainError('SYNC_PAGE_INVALID')
    if ((row.value.mode === 'set-key') !== (result.data.status === 'key-saved'))
      throw new DomainError('SYNC_PAGE_INVALID')
    if (
      'recoveryKeyHash' in result.data &&
      result.data.recoveryKeyHash !==
        (await sha256Bytes(new TextEncoder().encode(row.value.nextKey)))
    )
      throw new DomainError('SYNC_PAGE_INVALID')
    if (
      result.data.status === 'recovered' &&
      result.data.entitlement.accountId !== session.accountId
    )
      throw new DomainError('ACCOUNT_CHANGED')
    return options.workflows.write(
      row.id,
      row.revision,
      { ...row, value: { ...row.value, result: result.data } },
      scope,
    )
  }
  async function refresh(row: WorkflowRecord<Recovery>, scope: SessionScope, signal: AbortSignal) {
    await check(scope, signal)
    return storeResult(
      row,
      await options.client.post(
        'purchase-recovery',
        { action: 'status', requestId: row.value.requestId },
        signal,
      ),
      scope,
      signal,
    )
  }
  async function prepare(
    mode: Recovery['mode'],
    operationToken: string,
    input: unknown,
    scope: SessionScope,
    signal: AbortSignal,
  ) {
    const session = await check(scope, signal)
    if (!operationToken || operationToken.length > 128) throw new DomainError('VALIDATION')
    const id = `recovery_${(await canonicalHash({ accountId: session.accountId, operationToken })).slice(0, 48)}`,
      fingerprint = await canonicalHash({ mode, input })
    const previous = await options.workflows.read<Recovery>(id)
    if (previous) {
      const row = await read(id)
      if (row.value.mode !== mode || row.value.fingerprint !== fingerprint)
        throw new DomainError('OPERATION_REUSED')
      return row
    }
    const nextKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    return options.workflows.write<Recovery>(
      id,
      null,
      {
        kind: 'purchase',
        accountId: session.accountId,
        collection: null,
        value: {
          type: 'purchase-recovery',
          version: 1,
          mode,
          requestId: crypto.randomUUID(),
          fingerprint,
          nextKey,
          createdAt: new Date().toISOString(),
          result: null,
        },
      },
      scope,
    )
  }
  async function perform(
    row: WorkflowRecord<Recovery>,
    scope: SessionScope,
    signal: AbortSignal,
    request: () => Promise<PurchaseRecoveryWireRequest>,
  ) {
    // A lost response may already have consumed the one-use proof or rotated the key.
    try {
      return publicValue(await refresh(row, scope, signal))
    } catch (error) {
      if (!(error instanceof DomainError) || error.detail.code !== 'NOT_AVAILABLE') throw error
    }
    const body = purchaseRecoveryWireRequestSchema.parse(await request())
    await check(scope, signal)
    try {
      return publicValue(
        await storeResult(
          row,
          await options.client.post('purchase-recovery', body, signal),
          scope,
          signal,
        ),
      )
    } catch (error) {
      if (signal.aborted) throw error
      try {
        return publicValue(await refresh(await read(row.id), scope, signal))
      } catch {
        throw error
      }
    }
  }
  return {
    async requestCode(scope: SessionScope, signal: AbortSignal) {
      await check(scope, signal)
      const identity = await options.auth.verifiedIdentity()
      if (!identity) throw new DomainError('AUTH_REQUIRED')
      const result = await options.auth.requestCode(identity.email, signal)
      await check(scope, signal)
      return result
    },
    async setKey(
      input: { operationToken: string; code?: string },
      scope: SessionScope,
      signal: AbortSignal,
    ) {
      const row = await prepare('set-key', input.operationToken, {}, scope, signal)
      return perform(row, scope, signal, async () => ({
        action: 'set-key',
        requestId: row.value.requestId,
        nextRecoveryKeyHash: await sha256Bytes(new TextEncoder().encode(row.value.nextKey)),
        ...(input.code
          ? { reauthentication: await options.auth.reauthenticate(input.code, signal) }
          : {}),
      }))
    },
    async claim(
      input: {
        operationToken: string
        provider: PurchaseProvider
        evidenceId: string
        recoveryKey?: string
        code: string
      },
      scope: SessionScope,
      signal: AbortSignal,
    ) {
      if (input.recoveryKey && !hashSchema.safeParse(input.recoveryKey).success)
        throw new DomainError('VALIDATION')
      const row = await prepare(
        'claim',
        input.operationToken,
        {
          provider: input.provider,
          evidenceId: input.evidenceId,
          recoveryKeyHash: input.recoveryKey
            ? await sha256Bytes(new TextEncoder().encode(input.recoveryKey))
            : null,
        },
        scope,
        signal,
      )
      return perform(row, scope, signal, async () => ({
        action: 'claim',
        requestId: row.value.requestId,
        provider: input.provider,
        evidenceId: input.evidenceId,
        ...(input.recoveryKey ? { recoveryKey: input.recoveryKey } : {}),
        nextRecoveryKeyHash: await sha256Bytes(new TextEncoder().encode(row.value.nextKey)),
        reauthentication: await options.auth.reauthenticate(input.code, signal),
      }))
    },
    async refresh(id: string, scope: SessionScope, signal: AbortSignal) {
      return publicValue(await refresh(await read(id), scope, signal))
    },
    async refreshKeyStatus(scope: SessionScope, signal: AbortSignal) {
      const session = await check(scope, signal),
        id = await statusId(session)
      // Capture CAS before the request: a late response cannot overwrite a newer observation.
      const previous = await options.workflows.read(id)
      const parsed = billingStatusSchema.safeParse(
        await options.client.post('purchase-restore', { action: 'status' }, signal),
      )
      await check(scope, signal)
      if (
        !parsed.success ||
        parsed.data.entitlement.accountId !== session.accountId ||
        parsed.data.entitlement.billingPrincipalId !== session.billingPrincipalId ||
        canonicalJson(identity(options.current())) !== canonicalJson(identity(session))
      )
        throw new DomainError('ACCOUNT_CHANGED')
      const value: KeyStatus = {
        type: 'recovery-key-current',
        ...identity(session)!,
        hash: parsed.data.currentRecoveryKeyHash,
        checkedAt: new Date().toISOString(),
      }
      await options.workflows.write(
        id,
        previous?.revision ?? null,
        {
          kind: 'purchase',
          accountId: session.accountId,
          collection: null,
          value,
        },
        scope,
      )
    },
    async listKeys(): Promise<SavedPurchaseRecovery[]> {
      const session = options.current()
      if (!session) return []
      const rows = (await options.workflows.list<Recovery>('purchase')).filter(
        (row) => row.accountId === session.accountId && row.value?.type === 'purchase-recovery',
      )
      if (options.current()?.accountId !== session.accountId)
        throw new DomainError('ACCOUNT_CHANGED')
      const status = await knownKeyStatus(session)
      return rows
        .filter((row) => schema.safeParse(row.value).success)
        .map((row) => withStatus(row, status))
    },
    async exportKey(id: string): Promise<Blob> {
      const row = await read(id)
      if (
        !row.value.result ||
        row.value.result.status === 'pending' ||
        withStatus(row, await knownKeyStatus(options.current()!)).keyState === 'superseded'
      )
        throw new DomainError('NOT_AVAILABLE')
      return new Blob(
        [
          JSON.stringify({
            format: 'loopmark-purchase-recovery',
            version: 1,
            recoveryKey: row.value.nextKey,
            createdAt: row.value.createdAt,
          }),
        ],
        { type: 'application/json' },
      )
    },
  }
}
