import { useState } from 'react'
import type { CollectionView } from '../domain/contracts'
import type { AccountUsage } from '../domain/remote-contracts'
import { ErrorMessage, errorText, fullDate } from './ui'
const bytes = (value: number) =>
  `${(value / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 2 })} MiB`
export function AccountCapacity({
  view,
  signedIn,
  onLoadUsage,
}: {
  view: CollectionView
  signedIn: boolean
  onLoadUsage: () => Promise<AccountUsage>
}) {
  const [usage, setUsage] = useState<AccountUsage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function load() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setUsage(await onLoadUsage())
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="account-section readable-controls"
      aria-label="Project capacity and account storage"
    >
      <h2>Your collection</h2>
      <p>
        <strong>{view.info.name}</strong> has{' '}
        {view.projects.filter((project) => project.status === 'active').length} active projects,{' '}
        {view.projects.length} saved projects and {view.checkpoints.length} checkpoints on this
        device.
      </p>
      <p>
        The free allowance is three active projects. Finish a project to make room for another. Your
        saved notes, history and complete exports remain available when you reach a limit.
      </p>
      {view.info.legacyAccess && (
        <p>This collection keeps the access granted to its existing projects during the update.</p>
      )}
      <p>
        A collection can hold up to 200 projects, 1,000 checkpoints and 48 MiB of portable project
        content. These storage limits also apply to an upgrade.
      </p>
      {signedIn && (
        <>
          <h3>Cloud storage</h3>
          <p>
            Check your account’s current storage separately from this device. Files waiting to
            finish or be cleaned up also use cloud space.
          </p>
          {usage && (
            <>
              <p>
                Checked <time dateTime={usage.observedAt}>{fullDate(usage.observedAt)}</time>. Newer
                changes may not be included.
              </p>
              <dl className="review-counts">
                <div>
                  <dt>Account projects</dt>
                  <dd>
                    {usage.projects} / {usage.limits.projects}
                  </dd>
                </div>
                <div>
                  <dt>Account checkpoints</dt>
                  <dd>
                    {usage.checkpoints} / {usage.limits.checkpoints}
                  </dd>
                </div>
                <div>
                  <dt>Portable project content</dt>
                  <dd>
                    {bytes(usage.portableBytes)} / {bytes(usage.limits.portableBytes)}
                  </dd>
                </div>
                <div>
                  <dt>Cloud files present</dt>
                  <dd>
                    {bytes(usage.storedBytes)} · {usage.storedObjects} files
                  </dd>
                </div>
                <div>
                  <dt>Space in use or reserved</dt>
                  <dd>
                    {bytes(usage.allocatedBytes)} / {bytes(usage.limits.allocatedBytes)}
                  </dd>
                </div>
                <div>
                  <dt>Unfinished uploads</dt>
                  <dd>{usage.unfinishedUploads}</dd>
                </div>
              </dl>
              <p>
                Portable content includes the encoded photos and voice notes in a backup. Reserved
                cloud space includes uploads and replacement copies still being prepared; it can be
                larger than files already present.
              </p>
            </>
          )}
          <ErrorMessage message={error} />
          <button className="button secondary" disabled={busy} onClick={() => void load()}>
            {busy ? 'Checking storage…' : usage ? 'Refresh account usage' : 'Check account usage'}
          </button>
        </>
      )}
    </section>
  )
}
