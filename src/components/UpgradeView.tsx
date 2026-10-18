import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AppRuntime } from '../runtime'
import type { LocalizedProduct, CollectionKey } from '../domain/contracts'
import type { PurchaseAction } from '../billing/coordinator'
import { purchaseAction, type UpgradePrompt } from '../billing/upgrade-prompts'
import { canonicalJson } from '../domain/canonical-json'
import { ErrorMessage, errorText, fullDate } from './ui'
import { PurchaseRecovery } from './PurchaseRecovery'

const noSubscribe = () => () => {}
const noSnapshot = () => null
export function UpgradeView({
  runtime,
  signedIn,
  onContinue,
  onSelect,
}: {
  runtime: AppRuntime
  signedIn: boolean
  onContinue(action: PurchaseAction): Promise<void>
  onSelect(key: CollectionKey): Promise<void>
}) {
  const billing = runtime.billing
  const state = useSyncExternalStore(
    billing?.subscribe ?? noSubscribe,
    billing?.getSnapshot ?? noSnapshot,
  )
  const [products, setProducts] = useState<LocalizedProduct[] | null>(null)
  const [prompt, setPrompt] = useState<UpgradePrompt | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    void runtime.upgradePrompts
      .read()
      .then((value) => {
        if (mounted.current) setPrompt(value)
      })
      .catch((failure) => {
        if (mounted.current) setError(errorText(failure))
      })
    return () => {
      mounted.current = false
    }
  }, [runtime])
  async function run(work: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await work()
    } catch (failure) {
      if (mounted.current) setError(errorText(failure))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const active = !!state?.access.projection?.upgraded
  const pending = state?.attempts.some(
    (attempt) =>
      ['saved', 'launched', 'pending'].includes(attempt.phase) ||
      (attempt.phase === 'failed' &&
        !['failed', 'refunded', 'revoked', 'disputed'].includes(attempt.serverState ?? '')),
  )
  const sameCollection = (key: CollectionKey) =>
    canonicalJson(key) === canonicalJson(runtime.scope().key)
  async function buy(product: LocalizedProduct) {
    if (!billing) return
    let saved = prompt ?? (await runtime.upgradePrompts.save({ returnAction: 'settings' }))
    // A fresh token is only allowed after an explicit cancel or an authoritative terminal result.
    if (
      state?.attempts.some(
        (item) =>
          sameCollection(item.intent.collection) &&
          (item.phase === 'cancelled' ||
            (item.phase === 'failed' &&
              ['failed', 'refunded', 'revoked', 'disputed'].includes(item.serverState ?? ''))),
      )
    ) {
      saved = await runtime.upgradePrompts.save(purchaseAction(saved))
    }
    setPrompt(saved)
    const id = await billing.purchase(product.id, purchaseAction(saved), saved.operationToken)
    await billing.resume(id)
    setMessage('Purchase status checked. Your project action still needs your review.')
  }
  return (
    <section className="account-section readable-controls" aria-labelledby="upgrade-title">
      <h2 id="upgrade-title">More room for unfinished projects</h2>
      <p>
        Keep three active projects free, or make a one-time purchase for more. Saved checkpoints,
        history and complete exports stay available at the free limit.
      </p>
      <p>
        The upgrade keeps the collection limits of 200 projects, 1,000 checkpoints and 48 MiB of
        portable content.
      </p>
      {prompt?.returnAction === 'new-project' && (
        <p role="status">
          Your new-project draft is kept in this collection. You can return to it after the upgrade.
        </p>
      )}
      {prompt?.returnAction === 'reopen-project' && (
        <p role="status">
          Your finished project is still saved. Review it again after the upgrade to reopen it.
        </p>
      )}
      {!billing ? (
        <p>Purchases are unavailable in this copy of Loopmark.</p>
      ) : !signedIn ? (
        <p>
          Sign in above to see the price or restore a purchase. Your local projects stay on this
          device.
        </p>
      ) : (
        <>
          {active ? (
            <p role="status">
              <strong>Your upgrade is active.</strong>
            </p>
          ) : (
            <p>
              Free access
              {state?.access.projection
                ? ' confirmed'
                : ' · purchase status has not been checked yet'}
              .
            </p>
          )}
          {state?.access.projection && (
            <p className="hint">
              Last verified {fullDate(state.access.projection.verifiedAt)}.{' '}
              {state.access.source === 'cache'
                ? 'Showing the last saved result; reconnect to check for changes.'
                : 'Confirmed by your account.'}
            </p>
          )}
          <div className="account-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await billing.refresh()
                  setMessage('Access checked.')
                })
              }
            >
              Check purchase status
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await billing.restore()
                  setMessage('Restore checked. Pending verification does not unlock access yet.')
                })
              }
            >
              Restore purchases
            </button>
            {!active && (
              <button
                className="button secondary"
                disabled={busy || !!pending}
                onClick={() =>
                  void run(async () => {
                    const result = await billing.products()
                    setProducts(result)
                    if (!result.length)
                      setMessage('No upgrade is currently available for this store or region.')
                  })
                }
              >
                {products ? 'Refresh upgrade price' : 'See upgrade price'}
              </button>
            )}
          </div>
          {!active &&
            products?.map((product) => (
              <div key={product.id} className="purchase-option">
                <h3>{product.title}</h3>
                <p>
                  <strong>{product.displayPrice}</strong> · one-time purchase
                </p>
                <button
                  className="button primary"
                  disabled={busy || !!pending}
                  onClick={() => void run(() => buy(product))}
                >
                  Upgrade for {product.displayPrice}
                </button>
              </div>
            ))}
          {pending && (
            <p role="status">
              A purchase is unfinished. Check its status before starting another payment.
            </p>
          )}
          {state?.attempts
            .filter((attempt) => attempt.phase !== 'continued')
            .map((attempt) => (
              <div className="purchase-attempt" key={attempt.intent.attemptId}>
                <h3>
                  {attempt.intent.returnAction === 'new-project'
                    ? 'Saved project draft'
                    : attempt.intent.returnAction === 'reopen-project'
                      ? 'Saved reopen request'
                      : 'Upgrade request'}
                </h3>
                <p>
                  Status:{' '}
                  {attempt.phase === 'verified'
                    ? 'Verified'
                    : attempt.phase === 'cancelled'
                      ? 'Cancelled'
                      : attempt.phase === 'failed'
                        ? 'Needs attention'
                        : 'Waiting for confirmation'}
                  .
                </p>
                {attempt.error && (
                  <p>
                    {attempt.error.problem} {attempt.error.nextAction}
                  </p>
                )}
                <div className="account-actions">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await billing.resume(attempt.intent.attemptId)
                      })
                    }
                  >
                    Check this purchase
                  </button>
                  {attempt.provider === 'razorpay' &&
                    sameCollection(attempt.intent.collection) &&
                    ['saved', 'launched', 'pending'].includes(attempt.phase) &&
                    !active && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await billing.resumeCheckout(attempt.intent.attemptId)
                          })
                        }
                      >
                        Reopen this checkout
                      </button>
                    )}
                  {!sameCollection(attempt.intent.collection) ? (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void run(() => onSelect(attempt.intent.collection))}
                    >
                      Select the original collection
                    </button>
                  ) : (
                    active && (
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const intent = await billing.continuePurchase(attempt.intent.attemptId)
                            await onContinue(intent)
                            await billing.completeContinuation(attempt.intent.attemptId)
                            await runtime.upgradePrompts.clear()
                            setPrompt(null)
                          })
                        }
                      >
                        Continue saved action
                      </button>
                    )
                  )}
                </div>
              </div>
            ))}
          {active &&
            prompt &&
            prompt.returnAction !== 'settings' &&
            !state?.attempts.some(
              (item) => sameCollection(item.intent.collection) && item.phase !== 'continued',
            ) && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await onContinue(prompt)
                    await runtime.upgradePrompts.clear()
                    setPrompt(null)
                  })
                }
              >
                Continue saved action
              </button>
            )}
          <PurchaseRecovery runtime={runtime} configured={state?.recoveryKeyConfigured ?? false} />
        </>
      )}
      {busy && <p role="status">Checking your purchase…</p>}
      {message && <p role="status">{message}</p>}
      <ErrorMessage
        message={error || (state?.error ? `${state.error.problem} ${state.error.nextAction}` : '')}
      />
    </section>
  )
}
