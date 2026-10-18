import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { IconCloud, IconLock, IconLogout } from '@tabler/icons-react'
import { safeError } from '../domain/errors'
import { ErrorMessage } from './ui'

export function AccountView({
  cloudAvailable,
  accountEmail,
  signedIn,
  children,
  onRequestCode,
  onVerifyCode,
  onSignOut,
  onDiagnostics,
}: {
  cloudAvailable: boolean
  accountEmail?: string
  signedIn: boolean
  children?: ReactNode
  onRequestCode: (email: string) => Promise<{ retryAt: string }>
  onVerifyCode: (email: string, code: string) => Promise<void>
  onSignOut: () => void
  onDiagnostics?: () => void
}) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState<'sending' | 'verifying' | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!retryAt || retryAt <= Date.now()) return
    const timer = setInterval(() => {
      const time = Date.now()
      setNow(time)
      if (time >= retryAt) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [retryAt])
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000))
  async function send(event?: FormEvent) {
    event?.preventDefault()
    if (busy || wait) return
    setBusy('sending')
    setError('')
    try {
      const result = await onRequestCode(email.trim())
      setRetryAt(Date.parse(result.retryAt))
      setNow(Date.now())
      setSent(true)
    } catch (failure) {
      const detail = safeError(failure)
      setError(`${detail.problem} ${detail.nextAction}`)
      if (detail.retryAfterMs) setRetryAt(Date.now() + detail.retryAfterMs)
    } finally {
      setBusy(null)
    }
  }
  async function verify(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy('verifying')
    setError('')
    try {
      await onVerifyCode(email.trim(), code.trim())
    } catch (failure) {
      const detail = safeError(failure)
      setError(`${detail.problem} ${detail.nextAction}`)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="account-page readable-controls">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR WORKBASKET</p>
          <h1>Account &amp; device</h1>
          <p>Keep your place here. Connect a collection when you want it on another device.</p>
        </div>
      </div>
      <section className="account-section" aria-labelledby="account-access-title">
        <h2 id="account-access-title">
          <IconCloud aria-hidden size={23} /> Your account
        </h2>
        {signedIn ? (
          <>
            <p className="account-identity">
              Signed in
              {accountEmail ? (
                <>
                  {' '}
                  as <strong>{accountEmail}</strong>
                </>
              ) : (
                ' to your account'
              )}
              .
            </p>
            <p>
              Signing in does not move local projects. Choose a collection or review a connection
              preview below.
            </p>
            <button className="button secondary" onClick={onSignOut}>
              <IconLogout aria-hidden size={19} /> Sign out
            </button>
          </>
        ) : !cloudAvailable ? (
          <p>
            Account connection is unavailable in this copy of Loopmark. Your local projects,
            checkpoints and complete exports still work.
          </p>
        ) : sent ? (
          <form onSubmit={verify} className="account-form">
            <p id="code-help" role="status">
              Enter the code sent to <strong>{email.trim()}</strong>. Your current collection stays
              on this device until you choose to connect it.
            </p>
            <label htmlFor="account-code">Sign-in code</label>
            <input
              id="account-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-describedby="code-help"
              disabled={!!busy}
            />
            <ErrorMessage message={error} />
            <div className="account-actions">
              <button className="button primary" disabled={!!busy}>
                {busy === 'verifying' ? 'Checking code…' : 'Sign in'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={!!busy || !!wait}
                onClick={() => void send()}
              >
                {busy === 'sending' ? 'Sending code…' : wait ? `Resend in ${wait}s` : 'Resend code'}
              </button>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={!!busy}
              onClick={() => {
                setSent(false)
                setCode('')
                setError('')
              }}
            >
              Use a different email
            </button>
          </form>
        ) : (
          <form onSubmit={send} className="account-form">
            <p>
              Keep using Loopmark without an account, or sign in with an email code. No password to
              remember.
            </p>
            <label htmlFor="account-email">Email address</label>
            <input
              id="account-email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={!!busy}
            />
            <ErrorMessage message={error} />
            <div>
              <button className="button primary" disabled={!!busy || !!wait}>
                {busy ? 'Sending code…' : wait ? `Try again in ${wait}s` : 'Send sign-in code'}
              </button>
            </div>
          </form>
        )}
      </section>
      {children}
      <section className="account-section" aria-labelledby="privacy-help-title">
        <h2 id="privacy-help-title">
          <IconLock aria-hidden size={23} /> Privacy and help
        </h2>
        <p>
          A complete export includes your private notes and attachments. Keep the file somewhere
          safe. A label or a synced copy is not a backup.
        </p>
        {onDiagnostics && (
          <button className="button secondary" onClick={(event) => { event.currentTarget.focus(); onDiagnostics() }}>
            Preview diagnostic report
          </button>
        )}
        <nav className="account-actions" aria-label="Privacy and help">
          <a href="/privacy">Privacy</a>
          <a href="/support">Support</a>
          <a href="/delete-account">Account deletion</a>
        </nav>
      </section>
    </div>
  )
}
