// Test-only UI entry. Real coordinators, IndexedDB, drafts and forms; synthetic auth/provider I/O.
// No merchant, store SDK, email provider or cloud endpoint is contacted.
import { useCallback, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles.css'
import { UpgradeView } from '../../src/components/UpgradeView'
import { ProjectForm } from '../../src/components/Forms'
import { createBillingCoordinator } from '../../src/billing/coordinator'
import { createEntitlementCache, type EntitlementCache } from '../../src/billing/entitlement-cache'
import { createPurchaseRecoveryService } from '../../src/billing/recovery-service'
import { createUpgradePrompts } from '../../src/billing/upgrade-prompts'
import { openBrowserRepository } from '../../src/repositories/browser/repository'
import { createBrowserDraftStore } from '../../src/repositories/browser/draft-store'
import { createBrowserOperationPlanStore } from '../../src/repositories/browser/operation-plans'
import { createBrowserWorkflowStore } from '../../src/repositories/browser/workflow-store'
import { installDraftStoreFactory } from '../../src/drafts'
import { createLocalDataAdapter } from '../../src/services/local-data-service'
import { info, create } from '../../src/repositories/browser/fixtures.test-support'
import { DomainError } from '../../src/domain/errors'
import { parsePurchaseReturn } from '../../src/links/purchase-return'
import type { AppRuntime } from '../../src/runtime'
import type { AccountAuth } from '../../src/auth/auth-service'
import type {
  AccountSession,
  EntitlementProjection,
  PurchaseIntent,
} from '../../src/domain/contracts'
import type { PurchaseRecoveryWireResponse } from '../../src/domain/remote-contracts'
import type { FunctionClient } from '../../src/sync/http-client'

const params = new URLSearchParams(location.search)
const platform = params.get('platform') === 'ios' ? 'ios' : 'web'
let signedIn =
  sessionStorage.getItem('fixture-signed-in') === 'true' || params.get('scenario') !== 'draft'
let accessRef: EntitlementCache | undefined
const repo = await openBrowserRepository({
  databaseName: 'loopmark-purchases-ui',
  access: (info) => accessRef?.hasAccess(info) ?? false,
})
const collection = info(false, '-purchase-ui')
if (!(await repo.listCollections()).length) await repo.createCollection(collection)
const scope =
  (await repo.readActive()) ??
  (await repo.transition(null, {
    key: collection.key,
    device: { id: 'guest-device', generation: 'guest-generation' },
  }))
const session: AccountSession = {
  accountId: '11111111-1111-4111-8111-111111111111',
  billingPrincipalId: '22222222-2222-4222-8222-222222222222',
  collection: {
    namespace: 'account_11111111-1111-4111-8111-111111111111',
    collectionId: 'cloud-collection',
    epoch: 'cloud-epoch',
  },
  device: { id: 'account-device', generation: 'account-generation' },
  deletionGeneration: '0',
  expiresAt: '2099-01-01T00:00:00.000Z',
}
const current = () => (signedIn ? session : null)
const workflows = createBrowserWorkflowStore(repo)
const access = createEntitlementCache({ workflows, current })
accessRef = access
const draftStore = createBrowserDraftStore(repo, scope)
installDraftStoreFactory(() => draftStore)
const data = createLocalDataAdapter({
  repository: repo,
  media: repo.media,
  plans: createBrowserOperationPlanStore(repo),
  scope: () => scope,
})
if (!(await repo.readView(scope.key)).projects.length)
  for (const id of ['one', 'two', 'three'])
    await repo.commitLocal(scope.key, create(id), scope.generation)
const events = new EventTarget()
const logs: Array<{ action: string; attemptId?: string; collection?: unknown }> = JSON.parse(
  sessionStorage.getItem('fixture-log') ?? '[]',
)
function log(action: string, extra: Record<string, unknown> = {}) {
  logs.push({ action, ...extra })
  sessionStorage.setItem('fixture-log', JSON.stringify(logs))
  events.dispatchEvent(new Event('change'))
}
const subscribe = (listener: () => void) => {
  events.addEventListener('change', listener)
  return () => events.removeEventListener('change', listener)
}
const logSnapshot = () => JSON.stringify(logs)
let granted = sessionStorage.getItem('fixture-granted') === 'true',
  offline = false,
  nextOutcome = 'submitted',
  revision = 1
const cancelled = new Set<string>()
const recoveryResults = new Map<string, PurchaseRecoveryWireResponse>()
const recoveryHashes = new Map<string, string>()
let currentRecoveryKeyHash: string | null = null
const projection = (): EntitlementProjection => ({
  ...session,
  accountId: session.accountId,
  billingPrincipalId: session.billingPrincipalId,
  upgraded: granted,
  revision: String(revision),
  verifiedAt: new Date().toISOString(),
})
const entitlement = () => {
  const value = projection()
  return {
    accountId: value.accountId,
    billingPrincipalId: value.billingPrincipalId,
    upgraded: value.upgraded,
    revision: value.revision,
    verifiedAt: value.verifiedAt,
  }
}
const client: FunctionClient = {
  async post(name, body) {
    const input = body as {
      action: string
      attemptId?: string
      requestId?: string
      nextRecoveryKeyHash?: string
      collection?: unknown
    }
    log(`server:${name}:${input.action}`, {
      attemptId: input.attemptId,
      collection: input.collection,
    })
    if (offline) throw new DomainError('OFFLINE')
    if (name === 'purchase-recovery') {
      const id = input.requestId!
      if (input.action === 'status') {
        if (!recoveryResults.has(id)) throw new DomainError('NOT_AVAILABLE')
        return recoveryResults.get(id)
      }
      const result: PurchaseRecoveryWireResponse =
        input.action === 'set-key'
          ? { status: 'key-saved', recoveryKeyHash: input.nextRecoveryKeyHash! }
          : { status: 'pending', caseId: id }
      if (result.status === 'key-saved') currentRecoveryKeyHash = result.recoveryKeyHash
      recoveryHashes.set(id, input.nextRecoveryKeyHash!)
      recoveryResults.set(id, result)
      return result
    }
    if (input.action === 'prepare') return { status: 'pending', attemptId: input.attemptId }
    if (input.action === 'cancel') cancelled.add(input.attemptId!)
    return {
      entitlement: entitlement(),
      attempt: input.attemptId
        ? {
            id: input.attemptId,
            provider: platform === 'web' ? 'razorpay' : 'revenuecat',
            state: granted ? 'verified' : cancelled.has(input.attemptId) ? 'failed' : 'pending',
          }
        : null,
      recoveryKeyConfigured: currentRecoveryKeyHash !== null,
      currentRecoveryKeyHash,
    }
  },
}
const product = {
  id: 'loopmark.lifetime',
  title: 'More unfinished projects',
  displayPrice: '₹437.50',
  currency: 'INR',
  amountMinor: 43750,
  provider: platform === 'web' ? ('razorpay' as const) : ('revenuecat' as const),
}
const billing = createBillingCoordinator({
  workflows,
  access,
  client,
  current: () => (signedIn ? { session, scope } : null),
  platform,
  adapter: {
    products: async () => {
      log('catalog')
      return [product]
    },
    purchase: async (intent: PurchaseIntent) => {
      log('provider:purchase', { attemptId: intent.attemptId, collection: intent.collection })
      const outcome = nextOutcome
      nextOutcome = 'submitted'
      return outcome === 'cancelled'
        ? { status: 'cancelled' }
        : { status: 'submitted', attemptId: intent.attemptId }
    },
    restore: async () => {
      log('provider:restore')
      return { status: 'none' }
    },
  },
})
const recovery = createPurchaseRecoveryService({
  repository: repo,
  workflows,
  client,
  current,
  auth: {
    verifiedIdentity: async () =>
      signedIn ? { accountId: session.accountId, email: 'synthetic@example.test' } : null,
    requestCode: async () => {
      log('auth:code')
      return { retryAt: new Date(Date.now() + 60000).toISOString() }
    },
    reauthenticate: async () => ({
      challengeId: crypto.randomUUID(),
      proof: 'a'.repeat(64),
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
  } as unknown as AccountAuth,
})
const prompts = createUpgradePrompts({ workflows, scope: () => scope })
const runtime = {
  billing,
  purchaseRecovery: recovery,
  upgradePrompts: prompts,
  scope: () => scope,
  draftStore: () => draftStore,
  controller: {
    refreshAuthentication: async () => {
      log('auth:refresh')
    },
  },
} as unknown as AppRuntime
await billing.initialize()
const startingCount = (await data.listProjects()).length
function Fixture() {
  const [login, setLogin] = useState(signedIn),
    [form, setForm] = useState(params.get('scenario') === 'draft'),
    [count, setCount] = useState(startingCount),
    [notice, setNotice] = useState(''),
    [viewGeneration, setViewGeneration] = useState(0)
  const report = useSyncExternalStore(subscribe, logSnapshot)
  const guard = useCallback(() => {}, [])
  const control = (work: () => Promise<void> | void) =>
    void Promise.resolve()
      .then(work)
      .catch((e) => setNotice(String(e)))
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
      <h1>Synthetic purchase UI verification</h1>
      <p>No real purchase, email or cloud service is used.</p>
      <fieldset className="fixture-controls account-actions">
        <legend>Synthetic fixture controls</legend>
        <button
          onClick={() =>
            control(async () => {
              signedIn = true
              sessionStorage.setItem('fixture-signed-in', 'true')
              await billing.initialize()
              setLogin(true)
            })
          }
        >
          Fixture: sign in
        </button>
        <button
          onClick={() => {
            granted = true
            revision++
            sessionStorage.setItem('fixture-granted', 'true')
          }}
        >
          Fixture: verify purchase
        </button>
        <button
          onClick={() => {
            nextOutcome = 'cancelled'
          }}
        >
          Fixture: cancel next purchase
        </button>
        <button
          onClick={() => {
            offline = !offline
            setNotice(offline ? 'Fixture offline' : 'Fixture online')
          }}
        >
          Fixture: toggle offline
        </button>
        <button
          onClick={() => {
            for (const [id, result] of recoveryResults)
              if (result.status === 'pending') {
                currentRecoveryKeyHash = recoveryHashes.get(id)!
                recoveryResults.set(id, {
                  status: 'recovered',
                  entitlement: entitlement(),
                  recoveryKeyHash: recoveryHashes.get(id)!,
                })
              }
          }}
        >
          Fixture: approve recovery
        </button>
        <button
          onClick={() =>
            control(async () => {
              const row = billing.getSnapshot().attempts[0]
              if (!row) return
              const query = new URLSearchParams({
                razorpay_payment_id: 'pay_fixture',
                razorpay_payment_link_id: 'plink_fixture',
                razorpay_payment_link_reference_id: row.intent.attemptId,
                razorpay_payment_link_status: 'paid',
                razorpay_signature: 'a'.repeat(64),
              })
              await billing.verifyReturn(
                parsePurchaseReturn(`${location.origin}/purchase/return?${query}`, location.origin),
              )
            })
          }
        >
          Fixture: unverified paid return
        </button>
        <button
          onClick={() => {
            currentRecoveryKeyHash = 'b'.repeat(64)
          }}
        >
          Fixture: rotate key elsewhere
        </button>
      </fieldset>
      <output aria-label="Saved project count">{count}</output>
      <output aria-label="Fixture action log" className="sr-only">
        {report}
      </output>
      <p role="status">{notice}</p>
      <UpgradeView
        key={viewGeneration}
        runtime={runtime}
        signedIn={login}
        onSelect={async () => {
          log('select-original')
        }}
        onContinue={async (action) => {
          log('continue')
          if (action.returnAction === 'new-project') setForm(true)
        }}
      />
      {form && (
        <ProjectForm
          destination="Local guest projects"
          onExitGuard={guard}
          onClose={() => setForm(false)}
          onSave={async (input, _revision, token) => {
            log('project:save')
            return (await data.createProject(input, token)).id
          }}
          onSaved={() => {
            setForm(false)
            void data.listProjects().then((rows) => setCount(rows.length))
          }}
          onUpgrade={async () => {
            await prompts.save({ returnAction: 'new-project', draftKey: 'new' })
            setViewGeneration((value) => value + 1)
            setForm(false)
          }}
        />
      )}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
