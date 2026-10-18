import { useState } from 'react'
import type { CollectionView, ProjectFields, ProjectRecord } from '../domain/contracts'
import type { ConflictChoice } from '../services/controller-contract'
import { safeError } from '../domain/errors'
import { Dialog, ErrorMessage, fullDate } from './ui'

const fields = [
  ['name', 'Project name'],
  ['craft', 'Craft'],
  ['toolSize', 'Tool size'],
  ['yarn', 'Yarn'],
  ['notes', 'Notes'],
  ['color', 'Colour'],
  ['status', 'Status'],
] as const
const editable = (project: ProjectRecord): ProjectFields => ({
  name: project.name,
  craft: project.craft,
  toolSize: project.toolSize,
  yarn: project.yarn,
  notes: project.notes,
  color: project.color,
})

export function ConflictReview({
  operationId,
  view,
  acknowledged,
  stale,
  onRefresh,
  onResolve,
  onClose,
}: {
  operationId: string
  view: CollectionView
  acknowledged: CollectionView
  stale: boolean
  onRefresh: () => Promise<void>
  onResolve: (
    operationId: string,
    expectedRevision: string,
    choice: ConflictChoice,
  ) => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unchanged, setUnchanged] = useState(false)
  const [merging, setMerging] = useState(false)
  const [merged, setMerged] = useState<ProjectFields | null>(null)
  const pending = view.pending.find((item) => item.command.operationId === operationId)
  const intent = pending?.intent
  const projectId =
    intent?.kind === 'project.create'
      ? intent.payload.project.id
      : intent?.kind === 'checkpoint.create'
        ? intent.payload.checkpoint.projectId
        : intent && intent.kind !== 'collection.replace'
          ? intent.payload.projectId
          : undefined
  const device = view.projects.find((project) => project.id === projectId)
  const cloud = acknowledged.projects.find((project) => project.id === projectId)
  const cloudDeleted = !cloud && intent?.kind !== 'project.create'
  const canMerge = intent?.kind === 'project.update' && device && cloud
  const deviceCheckpoint =
    intent?.kind === 'checkpoint.create' ? intent.payload.checkpoint : undefined
  const cloudCheckpoint = acknowledged.checkpoints
    .filter((checkpoint) => checkpoint.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  async function act(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      const detail = safeError(failure)
      setError(`${detail.problem} ${detail.nextAction}`)
    } finally {
      setBusy(false)
    }
  }
  async function resolve(choice: ConflictChoice) {
    if (stale && choice.action !== 'later') return
    await onResolve(operationId, view.revision, choice)
    onClose()
  }
  return (
    <Dialog
      title="Review these versions"
      wide
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="readable-controls conflict-review">
        <p>
          <strong>{device?.name || cloud?.name || 'Project change'}</strong> changed in more than
          one place. Choose what to keep. No choice is selected for you.
        </p>
        <p>
          Dates help you recognise a version; they do not decide which one wins. Your pending work
          is retained in a recovered local collection before resolution.
        </p>
        {!pending && (
          <p role="status">
            This change is no longer pending. Close this review and check the current project.
          </p>
        )}
        <div className="version-comparison">
          {(
            [
              { label: 'This device', project: device, checkpoint: deviceCheckpoint },
              { label: 'Cloud', project: cloud, checkpoint: cloudCheckpoint },
            ] as const
          ).map(({ label, project, checkpoint }) => (
            <section key={label} aria-label={`${label} version`}>
              <h3>{label}</h3>
              {project ? (
                <>
                  <p className="hint">
                    Observed update:{' '}
                    <time dateTime={project.updatedAt}>{fullDate(project.updatedAt)}</time>
                  </p>
                  <dl className="version-fields">
                    {fields
                      .filter(([field]) => unchanged || device?.[field] !== cloud?.[field])
                      .map(([field, title]) => (
                        <div key={field}>
                          <dt>
                            {title}
                            {device?.[field] !== cloud?.[field] && (
                              <span className="changed-label">Changed</span>
                            )}
                          </dt>
                          <dd>{project[field] || 'Not recorded'}</dd>
                        </div>
                      ))}
                  </dl>
                </>
              ) : (
                <p>
                  {label === 'Cloud'
                    ? 'This project is no longer in the cloud collection.'
                    : 'This device has a pending project deletion.'}
                </p>
              )}
              {deviceCheckpoint && (
                <div className="checkpoint-comparison">
                  <h4>{label === 'Cloud' ? 'Latest cloud checkpoint' : 'Unsent checkpoint'}</h4>
                  {checkpoint ? (
                    <dl className="version-fields">
                      <div>
                        <dt>Position</dt>
                        <dd>{checkpoint.position || 'Not recorded'}</dd>
                      </div>
                      <div>
                        <dt>Tool size</dt>
                        <dd>{checkpoint.toolSize || 'Not recorded'}</dd>
                      </div>
                      <div>
                        <dt>Do this next</dt>
                        <dd>{checkpoint.nextStep}</dd>
                      </div>
                      <div>
                        <dt>Notes</dt>
                        <dd>{checkpoint.notes || 'Not recorded'}</dd>
                      </div>
                      <div>
                        <dt>Attachments</dt>
                        <dd>
                          {[checkpoint.photo && 'Photo', checkpoint.voice && 'Voice note']
                            .filter(Boolean)
                            .join(' and ') || 'None'}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p>No saved checkpoint.</p>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
        <button
          className="text-button"
          onClick={() => setUnchanged(!unchanged)}
          aria-expanded={unchanged}
        >
          {unchanged ? 'Hide unchanged fields' : 'Show unchanged fields'}
        </button>
        {deviceCheckpoint && (
          <p>
            Checkpoints remain separate history entries. Keeping this device’s checkpoint adds a new
            entry; it does not overwrite the cloud checkpoint.
          </p>
        )}
        {cloudDeleted && (
          <p>
            The project was deleted from the account. Accepting deletion keeps your pending work as
            a local recovered copy. It does not recreate the cloud project.
          </p>
        )}
        {stale && (
          <p className="error" role="alert">
            New changes arrived while this review was open. Refresh both versions before choosing.
          </p>
        )}
        <ErrorMessage message={error} />
        {merging && canMerge && (
          <section className="merge-editor">
            <h3>Edit a merged version</h3>
            {!merged ? (
              <>
                <p>Choose the version to start from. You can then change any project field.</p>
                <div className="account-actions">
                  <button className="button secondary" onClick={() => setMerged(editable(device))}>
                    Start from this device
                  </button>
                  <button className="button secondary" onClick={() => setMerged(editable(cloud))}>
                    Start from cloud
                  </button>
                </div>
              </>
            ) : (
              <form
                className="account-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void act(() => resolve({ action: 'merged', fields: merged }))
                }}
              >
                <label htmlFor="merge-name">Project name</label>
                <input
                  id="merge-name"
                  required
                  maxLength={100}
                  value={merged.name}
                  onChange={(event) => setMerged({ ...merged, name: event.target.value })}
                />
                <label htmlFor="merge-craft">Craft</label>
                <select
                  id="merge-craft"
                  value={merged.craft}
                  onChange={(event) =>
                    setMerged({ ...merged, craft: event.target.value as ProjectFields['craft'] })
                  }
                >
                  {['Crochet', 'Knitting', 'Other'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <label htmlFor="merge-tool">Tool size</label>
                <input
                  id="merge-tool"
                  maxLength={80}
                  value={merged.toolSize}
                  onChange={(event) => setMerged({ ...merged, toolSize: event.target.value })}
                />
                <label htmlFor="merge-yarn">Yarn</label>
                <input
                  id="merge-yarn"
                  maxLength={200}
                  value={merged.yarn}
                  onChange={(event) => setMerged({ ...merged, yarn: event.target.value })}
                />
                <label htmlFor="merge-notes">Notes</label>
                <textarea
                  id="merge-notes"
                  maxLength={2000}
                  value={merged.notes}
                  onChange={(event) => setMerged({ ...merged, notes: event.target.value })}
                />
                <label htmlFor="merge-color">Colour</label>
                <select
                  id="merge-color"
                  value={merged.color}
                  onChange={(event) =>
                    setMerged({ ...merged, color: event.target.value as ProjectFields['color'] })
                  }
                >
                  {['clay', 'sage', 'lavender', 'ochre'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <button className="button primary" disabled={busy || stale}>
                  {busy ? 'Saving merged version…' : 'Save merged version'}
                </button>
              </form>
            )}
          </section>
        )}
        <div className="dialog-actions conflict-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void act(() => resolve({ action: 'later' }))}
          >
            Decide later
          </button>
          {stale ? (
            <button className="button primary" disabled={busy} onClick={() => void act(onRefresh)}>
              Refresh versions
            </button>
          ) : (
            pending && (
              <>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void act(() => resolve({ action: 'cloud' }))}
                >
                  {cloudDeleted ? 'Accept deletion and keep local recovery' : 'Use cloud version'}
                </button>
                {!cloudDeleted &&
                  intent?.kind !== 'project.create' &&
                  intent?.kind !== 'collection.replace' && (
                    <button
                      className={`button ${intent?.kind === 'project.delete' ? 'danger' : 'primary'}`}
                      disabled={busy}
                      onClick={() => void act(() => resolve({ action: 'device' }))}
                    >
                      {intent?.kind === 'project.delete'
                        ? 'Delete cloud project'
                        : 'Keep this device’s changes'}
                    </button>
                  )}
                {canMerge && !merging && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setMerging(true)}
                  >
                    Edit a merged version
                  </button>
                )}
              </>
            )
          )}
        </div>
      </div>
    </Dialog>
  )
}
