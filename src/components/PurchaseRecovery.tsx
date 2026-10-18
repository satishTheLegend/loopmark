import { DomainError } from '../domain/errors'
import { useEffect, useRef, useState } from 'react'
import type { AppRuntime } from '../runtime'
import type { SavedPurchaseRecovery } from '../billing/recovery-service'
import { ErrorMessage, errorText, fullDate } from './ui'
import './PurchaseRecovery.css'

export function PurchaseRecovery({
  runtime,
  configured,
}: {
  runtime: AppRuntime
  configured: boolean
}) {
  const service = runtime.purchaseRecovery
  const [rows, setRows] = useState<SavedPurchaseRecovery[]>([])
  const [code, setCode] = useState(''),
    [provider, setProvider] = useState<'razorpay' | 'revenuecat'>('razorpay')
  const [evidenceId, setEvidenceId] = useState(''),
    [recoveryKey, setRecoveryKey] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const [retryAt, setRetryAt] = useState(0)
  const [keyCheckUnavailable, setKeyCheckUnavailable] = useState(false)
  const keyToken = useRef(crypto.randomUUID()),
    claimToken = useRef(crypto.randomUUID())
  const mounted = useRef(true)
  async function load(refresh = false) {
    if (service) {
      if (refresh) {
        try {
          await service.refreshKeyStatus(runtime.scope(), AbortSignal.timeout(15000))
          if (mounted.current) setKeyCheckUnavailable(false)
        } catch {
          if (mounted.current) setKeyCheckUnavailable(true)
        }
      }
      const next = await service.listKeys()
      if (mounted.current) setRows(next)
    }
  }
  useEffect(() => {
    mounted.current = true
    void load(true).catch((e) => {
      if (mounted.current) setError(errorText(e))
    })
    return () => {
      mounted.current = false
    }
    // The parent remounts for each account and collection generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service])
  async function run(work: () => Promise<void>, refreshKey = true) {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await work()
    } catch (e) {
      if (mounted.current) setError(errorText(e))
    } finally {
      if (mounted.current) {
        await load(refreshKey).catch(() => {})
        setBusy(false)
      }
    }
  }
  async function observe(row: SavedPurchaseRecovery) {
    setCode('')
    setRecoveryKey('')
    if (row.result?.status === 'recovered') {
      await runtime.controller.refreshAuthentication()
      await runtime.billing?.refresh()
      setMessage('Purchase recovered. Export the new recovery key and keep it safe.')
    } else
      setMessage(
        row.result?.status === 'key-saved'
          ? 'Recovery key saved. Export it and keep it separate from your project backup.'
          : 'Recovery is pending review. Check this request again for the result.',
      )
  }
  async function exportKey(id: string) {
    const bytes = await service!.exportKey(id),
      name = 'loopmark-purchase-recovery.json'
    if (runtime.share) {
      const result = await runtime.share.shareFile({ name, mimeType: 'application/json', bytes })
      if ('error' in result)
        throw new DomainError(result.error.code, { correlationId: result.error.correlationId })
    } else {
      const url = URL.createObjectURL(bytes),
        link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
  if (!service) return null
  const latest = [...rows]
    .filter((row) => row.result && row.result.status !== 'pending' && row.keyState !== 'superseded')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const keyConfigured =
    configured || rows.some((row) => row.result && row.result.status !== 'pending')
  return (
    <details className="purchase-recovery">
      <summary>Purchase recovery and recovery key</summary>
      <p>
        A recovery key helps prove your purchase if you delete your account. It does not restore
        deleted projects. Keep it private and separate from your project backup.
      </p>
      <p>
        {keyConfigured
          ? 'A recovery key is configured. Creating a new key replaces the previous one.'
          : 'You can create a recovery key for this account.'}
      </p>
      <fieldset disabled={busy} className="form-fields account-form">
        <button
          type="button"
          className="button secondary"
          onClick={() =>
            void run(async () => {
              if (Date.now() < retryAt) {
                setMessage('Wait before requesting another code.')
                return
              }
              const result = await service.requestCode(runtime.scope(), AbortSignal.timeout(30000))
              setRetryAt(Date.parse(result.retryAt))
              setCode('')
              setMessage('A fresh code was sent to your signed-in email address.')
            })
          }
        >
          Send recovery verification code
        </button>
        <label>
          Fresh email code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
          />
        </label>
        <button
          type="button"
          className="button secondary"
          disabled={!/^\d{6}$/.test(code)}
          onClick={() =>
            void run(async () => {
              await observe(
                await service.setKey(
                  { operationToken: keyToken.current, code },
                  runtime.scope(),
                  AbortSignal.timeout(30000),
                ),
              )
              keyToken.current = crypto.randomUUID()
            })
          }
        >
          {keyConfigured ? 'Replace recovery key' : 'Create recovery key'}
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => void run(() => load(true), false)}
        >
          Check current recovery key
        </button>
        {keyCheckUnavailable && (
          <p role="status">
            The current recovery key could not be checked. Showing the last saved result.
          </p>
        )}
        {latest && (
          <p>
            {latest.keyState === 'current' && latest.keyCheckedAt
              ? `This device's recovery key was confirmed current on ${fullDate(latest.keyCheckedAt)}. Reconnect and check for changes before relying on it.`
              : 'This device has a previously confirmed recovery key. Check its current status when online.'}
          </p>
        )}
        {rows.some((row) => row.keyState === 'superseded') && (
          <p>
            A recovery key saved on this device has been replaced. Use the current key from the
            device where you created it, or create a new key here.
          </p>
        )}
        {latest && (
          <button
            type="button"
            className="button secondary"
            onClick={() => void run(() => exportKey(latest.id))}
          >
            Export latest recovery key from this device
          </button>
        )}
        <h3>Recover a previous purchase</h3>
        <p>
          Use your payment or original store transaction ID and recovery key. Without a key, the
          request may require support review. Your new account needs a fresh email code.
        </p>
        <label>
          Purchase provider
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as typeof provider)
              claimToken.current = crypto.randomUUID()
            }}
          >
            <option value="razorpay">Web payment</option>
            <option value="revenuecat">Apple App Store or Google Play</option>
          </select>
        </label>
        <label>
          Payment or original transaction ID
          <input
            value={evidenceId}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => {
              setEvidenceId(e.target.value)
              claimToken.current = crypto.randomUUID()
            }}
          />
        </label>
        <label>
          <span>
            Recovery key <span className="optional">optional</span>
          </span>
          <input
            type="password"
            value={recoveryKey}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setRecoveryKey(e.target.value)
              claimToken.current = crypto.randomUUID()
            }}
          />
        </label>
        <button
          type="button"
          className="button primary"
          disabled={
            !evidenceId.trim() ||
            !/^\d{6}$/.test(code) ||
            (!!recoveryKey && !/^[a-f0-9]{64}$/.test(recoveryKey))
          }
          onClick={() =>
            void run(async () => {
              await observe(
                await service.claim(
                  {
                    operationToken: claimToken.current,
                    provider,
                    evidenceId: evidenceId.trim(),
                    recoveryKey: recoveryKey || undefined,
                    code,
                  },
                  runtime.scope(),
                  AbortSignal.timeout(30000),
                ),
              )
            })
          }
        >
          Request purchase recovery
        </button>
        {rows
          .filter((row) => !row.result || row.result.status === 'pending')
          .map((row) => (
            <div key={row.id}>
              <p>
                Unfinished {row.mode === 'claim' ? 'purchase recovery' : 'key setup'} from{' '}
                {fullDate(row.createdAt)}.
              </p>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  void run(async () =>
                    observe(
                      await service.refresh(row.id, runtime.scope(), AbortSignal.timeout(30000)),
                    ),
                  )
                }
              >
                Check recovery request
              </button>
            </div>
          ))}
      </fieldset>
      {message && <p role="status">{message}</p>}
      <ErrorMessage message={error} />
    </details>
  )
}
