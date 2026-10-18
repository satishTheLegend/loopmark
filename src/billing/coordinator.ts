import type {
  AccountSession,
  LocalizedProduct,
  PurchaseIntent,
  SessionScope,
} from '../domain/contracts'
import type { BillingStatus, CheckoutRequest } from '../domain/remote-contracts'
import type { BillingAdapter } from '../platform/contracts'
import type { FunctionClient } from '../sync/http-client'
import type { WorkflowRecord, WorkflowStore } from '../services/workflow-store'
import { billingStatusSchema, purchaseSubmittedSchema } from '../domain/remote-schema'
import { canonicalHash, canonicalJson } from '../domain/canonical-json'
import { DomainError, safeError, type SafeError } from '../domain/errors'
import {
  createEntitlementCache,
  type EntitlementCache,
  type AccessState,
} from './entitlement-cache'
import { attemptSchema, purchaseIntentSchema, type PurchaseAttempt } from './continuation'
export type PurchaseAction = Pick<PurchaseIntent, 'returnAction' | 'draftKey' | 'projectId'>
export interface BillingState {
  access: AccessState
  attempts: PurchaseAttempt[]
  recoveryKeyConfigured: boolean
  currentRecoveryKeyHash?: string | null
  error: SafeError | null
}
export function createBillingCoordinator(options: {
  adapter: BillingAdapter
  client: FunctionClient
  workflows: WorkflowStore
  current: () => { session: AccountSession; scope: SessionScope } | null
  platform: 'web' | 'ios' | 'android'
  access?: EntitlementCache
}) {
  const access =
    options.access ??
    createEntitlementCache({
      workflows: options.workflows,
      current: () => options.current()?.session ?? null,
    })
  const listeners = new Set<() => void>()
  const identity = (value: ReturnType<typeof options.current>) =>
    value
      ? {
          account: value.session.accountId,
          principal: value.session.billingPrincipalId,
          deletion: value.session.deletionGeneration,
        }
      : null
  let owner: ReturnType<typeof identity> = null,
    disposed = false
  const empty: BillingState = {
    access: { projection: null, receivedAt: null, source: null },
    attempts: [],
    recoveryKeyConfigured: false,
    error: null,
  }
  let state: BillingState = {
      access: access.getSnapshot(),
      attempts: [],
      recoveryKeyConfigured: false,
      error: null,
    },
    serial: Promise<unknown> = Promise.resolve()
  const publish = (patch: Partial<BillingState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const unsubscribe = access.subscribe(() => publish({ access: access.getSnapshot() }))
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const captured = structuredClone(options.current())
    const pending = serial
      .catch(() => {})
      .then(() => {
        const current = options.current()
        if (
          disposed ||
          canonicalJson({ owner: identity(current), scope: current?.scope ?? null }) !==
            canonicalJson({ owner: identity(captured), scope: captured?.scope ?? null })
        )
          throw new DomainError('ACCOUNT_CHANGED')
        return work()
      })
    serial = pending
    return pending.catch((error) => {
      publish({ error: safeError(error) })
      throw error
    })
  }
  const bound = () => {
    const value = options.current()
    if (disposed) throw new DomainError('ACCOUNT_CHANGED')
    if (!value) throw new DomainError('AUTH_REQUIRED')
    return structuredClone(value)
  }
  const check = (captured: ReturnType<typeof bound>) => {
    const current = bound()
    if (
      canonicalJson({
        scope: current.scope,
        account: current.session.accountId,
        principal: current.session.billingPrincipalId,
        deletion: current.session.deletionGeneration,
      }) !==
      canonicalJson({
        scope: captured.scope,
        account: captured.session.accountId,
        principal: captured.session.billingPrincipalId,
        deletion: captured.session.deletionGeneration,
      })
    )
      throw new DomainError('ACCOUNT_CHANGED')
  }
  async function list() {
    const captured = bound()
    const rows = (await options.workflows.list<PurchaseAttempt>('purchase')).filter(
      (row) =>
        row.value?.type === 'purchase-attempt' && row.accountId === captured.session.accountId,
    )
    for (const row of rows)
      if (!attemptSchema.safeParse(row.value).success) throw new DomainError('VALIDATION')
    check(captured)
    owner = identity(captured)
    publish({ attempts: rows.map((row) => structuredClone(row.value)) })
    return rows
  }
  async function find(attemptId: string) {
    const row = (await list()).find((row) => row.value.intent.attemptId === attemptId)
    if (!row) throw new DomainError('NOT_AVAILABLE')
    if (row.value.intent.billingPrincipalId !== bound().session.billingPrincipalId)
      throw new DomainError('ACCOUNT_CHANGED')
    return row
  }
  async function save(row: WorkflowRecord<PurchaseAttempt>, patch: Partial<PurchaseAttempt>) {
    const current = bound()
    if (row.accountId !== current.session.accountId) throw new DomainError('ACCOUNT_CHANGED')
    const result = await options.workflows.write(
      row.id,
      row.revision,
      { ...row, value: { ...row.value, ...patch } },
      current.scope,
    )
    await list()
    return result
  }
  async function observe(
    input: unknown,
    captured: ReturnType<typeof bound>,
    row?: WorkflowRecord<PurchaseAttempt>,
  ) {
    const parsed = billingStatusSchema.safeParse(input)
    if (
      !parsed.success ||
      (row && parsed.data.attempt && parsed.data.attempt.id !== row.value.intent.attemptId)
    )
      throw new DomainError('SYNC_PAGE_INVALID')
    check(captured)
    await access.observe(parsed.data.entitlement, captured.session)
    check(captured)
    owner = identity(captured)
    publish({
      recoveryKeyConfigured: parsed.data.recoveryKeyConfigured,
      currentRecoveryKeyHash: parsed.data.currentRecoveryKeyHash,
      error: null,
    })
    if (row && row.value.phase !== 'continued') {
      const status = parsed.data.attempt?.state
      const phase = access.getSnapshot().projection?.upgraded
        ? 'verified'
        : status && ['failed', 'disputed', 'refunded', 'revoked'].includes(status)
          ? 'failed'
          : row.value.phase === 'cancelled'
            ? 'cancelled'
            : 'pending'
      await save(row, { phase, error: null, serverState: parsed.data.attempt?.state ?? null })
    }
    return parsed.data
  }
  async function status(attemptId?: string): Promise<BillingStatus> {
    const captured = bound(),
      row = attemptId ? await find(attemptId) : undefined
    const response =
      row?.value.provider === 'razorpay'
        ? await options.client.post(
            'checkout',
            { action: 'status', attemptId },
            AbortSignal.timeout(15000),
          )
        : await options.client.post(
            'purchase-restore',
            { action: 'status', ...(attemptId ? { attemptId } : {}) },
            AbortSignal.timeout(15000),
          )
    return observe(response, captured, row)
  }
  return {
    access,
    getSnapshot: () =>
      canonicalJson(owner) === canonicalJson(identity(options.current())) ? state : empty,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    initialize: () =>
      run(async () => {
        await access.load()
        if (options.current()) await list()
      }),
    refresh: () => run(() => status()),
    async products(): Promise<LocalizedProduct[]> {
      const captured = bound(),
        products = await options.adapter.products()
      check(captured)
      return products
    },
    purchase: (productId: string, action: PurchaseAction, operationToken: string) =>
      run(async () => {
        const captured = bound()
        if (!operationToken || operationToken.length > 128) throw new DomainError('VALIDATION')
        const id = `purchase_${(await canonicalHash({ account: captured.session.accountId, collection: captured.scope.key, operationToken })).slice(0, 48)}`
        let row = await options.workflows.read<PurchaseAttempt>(id)
        const identity = {
          accountId: captured.session.accountId,
          billingPrincipalId: captured.session.billingPrincipalId,
          productId,
          collection: captured.scope.key,
          ...action,
        }
        if (row) {
          if (!attemptSchema.safeParse(row.value).success) throw new DomainError('VALIDATION')
          const { attemptId: _attempt, generation: _generation, ...prior } = row.value.intent
          if (canonicalJson(prior) !== canonicalJson(identity))
            throw new DomainError('OPERATION_REUSED')
          if (row.value.phase !== 'saved') {
            await status(row.value.intent.attemptId)
            return row.value.intent.attemptId
          }
        } else {
          const parsedIntent = purchaseIntentSchema.safeParse({
            ...identity,
            attemptId: crypto.randomUUID(),
            generation: captured.scope.generation,
          })
          if (!parsedIntent.success) throw new DomainError('VALIDATION')
          const intent = parsedIntent.data
          check(captured)
          try {
            row = await options.workflows.write<PurchaseAttempt>(
              id,
              null,
              {
                kind: 'purchase',
                accountId: captured.session.accountId,
                collection: null,
                value: {
                  type: 'purchase-attempt',
                  version: 1,
                  intent,
                  provider: options.platform === 'web' ? 'razorpay' : 'revenuecat',
                  createdAt: new Date().toISOString(),
                  phase: 'saved',
                  outcome: null,
                  error: null,
                },
              },
              captured.scope,
            )
          } catch (error) {
            if (error instanceof DomainError && error.detail.code === 'REVISION_CONFLICT') {
              const winner = await options.workflows.read<PurchaseAttempt>(id)
              if (winner) return winner.value.intent.attemptId
            }
            throw error
          }
        }
        check(captured)
        if (options.platform !== 'web') {
          const prepared = purchaseSubmittedSchema.safeParse(
            await options.client.post(
              'purchase-restore',
              {
                action: 'prepare',
                attemptId: row.value.intent.attemptId,
                productId,
                collection: captured.session.collection,
              },
              AbortSignal.timeout(15000),
            ),
          )
          if (!prepared.success || prepared.data.attemptId !== row.value.intent.attemptId)
            throw new DomainError('SYNC_PAGE_INVALID')
        }
        check(captured)
        row = await save(row, { phase: 'launched' })
        try {
          const outcome = await options.adapter.purchase(row.value.intent)
          check(captured)
          if (
            (outcome.status === 'submitted' || outcome.status === 'pending') &&
            outcome.attemptId !== row.value.intent.attemptId
          )
            throw new DomainError('SYNC_PAGE_INVALID')
          await save(row, {
            outcome,
            phase:
              outcome.status === 'cancelled'
                ? 'cancelled'
                : ['failed', 'unavailable', 'account-mismatch'].includes(outcome.status)
                  ? 'failed'
                  : 'pending',
            error: 'error' in outcome ? outcome.error : null,
          })
          if (outcome.status === 'cancelled' && options.platform !== 'web') {
            try {
              await observe(
                await options.client.post(
                  'purchase-restore',
                  { action: 'cancel', attemptId: row.value.intent.attemptId },
                  AbortSignal.timeout(15000),
                ),
                captured,
                await find(row.value.intent.attemptId),
              )
            } catch (error) {
              check(captured)
              publish({ error: safeError(error) })
            }
          }
          return row.value.intent.attemptId
        } catch (error) {
          check(captured)
          await save(row, { phase: 'pending', error: safeError(error) })
          throw error
        }
      }),
    resume: (attemptId: string) => run(() => status(attemptId)),
    resumeCheckout: (attemptId: string) =>
      run(async () => {
        if (options.platform !== 'web') throw new DomainError('CAPABILITY_UNAVAILABLE')
        const captured = bound()
        let row = await find(attemptId)
        if (
          row.value.provider !== 'razorpay' ||
          canonicalJson(row.value.intent.collection) !== canonicalJson(captured.scope.key)
        )
          throw new DomainError('ACCOUNT_CHANGED')
        await status(attemptId)
        check(captured)
        if (access.getSnapshot().projection?.upgraded) return attemptId
        row = await find(attemptId)
        row = await save(row, { phase: 'launched' })
        try {
          // This explicit user action reauthorizes execution in the current generation. The original
          // durable intent remains unchanged; the adapter reopens the same server-owned payment link.
          const outcome = await options.adapter.purchase({
            ...row.value.intent,
            generation: captured.scope.generation,
          })
          check(captured)
          if (
            (outcome.status === 'submitted' || outcome.status === 'pending') &&
            outcome.attemptId !== attemptId
          )
            throw new DomainError('SYNC_PAGE_INVALID')
          await save(row, {
            phase: outcome.status === 'cancelled' ? 'cancelled' : 'pending',
            outcome,
            error: 'error' in outcome ? outcome.error : null,
          })
          return attemptId
        } catch (error) {
          check(captured)
          await save(row, { phase: 'pending', error: safeError(error) })
          throw error
        }
      }),
    verifyReturn: (input: Extract<CheckoutRequest, { action: 'verify' }>) =>
      run(async () => {
        const captured = bound(),
          row = await find(input.attemptId)
        if (row.value.provider !== 'razorpay') throw new DomainError('VALIDATION')
        return observe(
          await options.client.post('checkout', input, AbortSignal.timeout(15000)),
          captured,
          row,
        )
      }),
    restore: () =>
      run(async () => {
        const captured = bound(),
          outcome = await options.adapter.restore()
        check(captured)
        if (['account-mismatch', 'failed', 'unavailable'].includes(outcome.status)) {
          if ('error' in outcome) publish({ error: outcome.error })
          return outcome
        }
        await options.client.post(
          'purchase-restore',
          {
            action: 'reconcile',
            requestId: crypto.randomUUID(),
            provider: options.platform === 'web' ? 'razorpay' : 'revenuecat',
          },
          AbortSignal.timeout(15000),
        )
        check(captured)
        await status()
        return outcome
      }),
    continuePurchase: (attemptId: string) =>
      run(async () => {
        const current = bound(),
          row = await find(attemptId),
          projection = access.getSnapshot().projection
        if (
          !projection?.upgraded ||
          projection.accountId !== current.session.accountId ||
          projection.billingPrincipalId !== current.session.billingPrincipalId ||
          canonicalJson(row.value.intent.collection) !== canonicalJson(current.scope.key)
        )
          throw new DomainError('ACCOUNT_CHANGED')
        // Explicit user action authorizes opening the original draft in the current matching collection.
        return structuredClone(row.value.intent)
      }),
    completeContinuation: (attemptId: string) =>
      run(async () => {
        await save(await find(attemptId), { phase: 'continued' })
      }),
    dispose() {
      disposed = true
      unsubscribe()
      listeners.clear()
    },
  }
}
export type BillingCoordinator = ReturnType<typeof createBillingCoordinator>
