import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { IconCamera, IconCheck, IconTrash } from '@tabler/icons-react'
import type { Project, ProjectInput, CheckpointInput, Craft } from '../types'
import { Dialog, ErrorMessage, errorText } from './ui'
import { preparePhoto, readFile } from '../media'
import { VoiceNote } from './VoiceNote'
import { useDraft } from '../drafts'
import { NativeVoiceNote } from './NativeVoiceNote'
import type { AppRuntime } from '../runtime'
export function ProjectForm({
  project,
  onSave,
  onClose,
  onSaved,
  onExitGuard,
  destination,
}: {
  project?: Project
  onSave: (v: ProjectInput, expectedRevision?: string, draftToken?: string) => Promise<string>
  onSaved: (id: string, warning?: string) => void
  onClose: () => void
  onExitGuard: (guard?: () => Promise<boolean>) => void
  destination?: string
}) {
  const draft = useDraft<ProjectInput>(
    project ? `edit:${project.id}` : 'new',
    {
      name: project?.name || '',
      craft: project?.craft || 'Crochet',
      color: project?.color || 'clay',
      toolSize: project?.toolSize || '',
      yarn: project?.yarn || '',
      notes: project?.notes || '',
    },
    project?.updatedAt,
  )
  const { name, craft, color, toolSize, yarn, notes } = draft.value
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (draft.ready) formRef.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [draft.ready])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    onExitGuard(async () => !busy && !draft.discarding && (await draft.canClose()))
    return () => onExitGuard(undefined)
  }, [onExitGuard, busy, draft])
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || draft.discarding) return
    setBusy(true)
    setError('')
    try {
      const id = await onSave(
        {
          name: name.trim(),
          craft,
          color,
          toolSize: toolSize.trim(),
          yarn: yarn.trim(),
          notes: notes.trim(),
        },
        draft.baseRevision,
        await draft.prepareCommit(),
      )
      let warning: string | undefined
      try {
        await draft.clear()
      } catch {
        warning =
          'Saved, but the draft could not be cleared. Reopening unchanged input will not create a duplicate.'
      }
      onSaved(id, warning)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={project ? 'The project details' : 'Make room for a project'}
      onClose={() => {
        if (!busy && !draft.discarding) void draft.closeSafely(onClose)
      }}
    >
      <p className="dialog-intro">
        A few little details. You can add a checkpoint whenever you pause.
      </p>
      {destination && (
        <p className="hint">
          Saving to <strong>{destination}</strong>
        </p>
      )}
      <DraftStatus draft={draft} disabled={busy || draft.discarding} />
      <form ref={formRef} onSubmit={submit}>
        <fieldset disabled={!draft.ready || busy || draft.discarding} className="form-fields">
          <label>
            Project name
            <input
              autoFocus
              required
              maxLength={100}
              value={name}
              onChange={(e) => draft.change('name', e.target.value)}
              aria-describedby="project-name-help"
              placeholder="e.g. Sunday morning cardigan"
            />
          </label>
          <p id="project-name-help" className="field-help">
            A project name is required to save.
          </p>
          <div className="form-grid">
            <label>
              Craft
              <select
                value={craft}
                onChange={(e) => draft.change('craft', e.target.value as Craft)}
              >
                <option>Crochet</option>
                <option>Knitting</option>
                <option>Other</option>
              </select>
            </label>
            <label>
              Hook or needle size
              <input
                maxLength={80}
                value={toolSize}
                onChange={(e) => draft.change('toolSize', e.target.value)}
                placeholder="e.g. 5 mm hook"
              />
            </label>
          </div>
          <label>
            Yarn or material <span className="optional">optional</span>
            <input
              maxLength={200}
              value={yarn}
              onChange={(e) => draft.change('yarn', e.target.value)}
              placeholder="Brand, weight, shade…"
            />
          </label>
          <label>
            Project notes <span className="optional">optional</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => draft.change('notes', e.target.value)}
              placeholder="Pattern name, modifications, who it’s for…"
            />
          </label>
          <fieldset className="color-picker">
            <legend>A color for your project</legend>
            {(['clay', 'sage', 'lavender', 'ochre'] as const).map((c) => (
              <label key={c} className={`color-option ${c} ${color === c ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="color"
                  value={c}
                  checked={color === c}
                  onChange={() => draft.change('color', c)}
                />
                <span className="sr-only">{c}</span>
                {color === c && <IconCheck size={16} />}
              </label>
            ))}
          </fieldset>
          <ErrorMessage message={error} />
          <div className="dialog-actions">
            <button
              type="button"
              className="button subtle"
              disabled={busy}
              onClick={() => void draft.closeSafely(onClose)}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : project ? 'Save details' : 'Create project'}
            </button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  )
}
export function CheckpointForm({
  project,
  onSave,
  onClose,
  onSaved,
  onExitGuard,
  destination,
  runtime,
}: {
  project: Project
  onSave: (v: CheckpointInput, draftToken?: string) => Promise<void>
  onSaved: (warning?: string) => void
  onClose: () => void
  onExitGuard: (guard?: () => Promise<boolean>) => void
  destination?: string
  runtime?: AppRuntime
}) {
  const latest = project.checkpoints[0]
  const draft = useDraft<CheckpointInput>(
    `checkpoint:${project.id}`,
    {
      position: latest?.position || '',
      toolSize: latest?.toolSize || project.toolSize,
      nextStep: '',
      notes: '',
      photo: undefined,
      voice: undefined,
    },
    project.updatedAt,
  )
  const { position, toolSize, nextStep, notes, photo, voice } = draft.value
  const currentDraft = useRef(draft)
  currentDraft.current = draft
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (draft.ready) formRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [draft.ready])
  const [mediaBusy, setMediaBusy] = useState(false),
    [voiceBusy, setVoiceBusy] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (mediaBusy || voiceBusy) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [mediaBusy, voiceBusy])
  const finishVoice = useRef<(() => Promise<boolean>) | undefined>(undefined)
  const setFinishVoice = useCallback((finish?: () => Promise<boolean>) => {
    finishVoice.current = finish
  }, [])
  async function canLeave() {
    if (busy || draft.discarding || mediaBusy) {
      setError('Wait for saving or photo preparation to finish before leaving this note.')
      return false
    }
    if (voiceBusy && finishVoice.current && !(await finishVoice.current())) return false
    return draft.canClose()
  }
  useEffect(() => {
    onExitGuard(canLeave)
    return () => onExitGuard(undefined)
  }, [onExitGuard, busy, mediaBusy, voiceBusy, draft])
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || draft.discarding || mediaBusy || voiceBusy) return
    setBusy(true)
    setError('')
    try {
      await onSave(
        {
          position: position.trim(),
          toolSize: toolSize.trim(),
          nextStep: nextStep.trim(),
          notes: notes.trim(),
          photo,
          voice,
        },
        await draft.prepareCommit(),
      )
      let warning: string | undefined
      try {
        await draft.clear()
      } catch {
        warning =
          'Checkpoint saved, but the draft could not be cleared. Reopening unchanged input will not add a duplicate.'
      }
      onSaved(warning)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Leave yourself a little note"
      onClose={() => {
        void canLeave().then((allowed) => {
          if (allowed) onClose()
        })
      }}
      wide
    >
      <p className="dialog-intro">
        For the next time you pick up <strong>{project.name}</strong>.
      </p>
      {destination && (
        <p className="hint">
          Saving to <strong>{destination}</strong>
        </p>
      )}
      <DraftStatus draft={draft} disabled={busy || draft.discarding || mediaBusy || voiceBusy} />
      <form ref={formRef} onSubmit={submit}>
        <fieldset disabled={!draft.ready || busy || draft.discarding} className="form-fields">
          <label className="next-step-label">
            What will you do next?
            <textarea
              autoFocus
              required
              rows={3}
              maxLength={1000}
              value={nextStep}
              onChange={(e) => draft.change('nextStep', e.target.value)}
              aria-describedby="next-step-help"
              placeholder="e.g. Start row 24. Chain 2, turn, then work the first shell into the corner space."
            />
          </label>
          <p id="next-step-help" className="field-help">
            A next step is required to save your checkpoint.
          </p>
          <div className="form-grid">
            <label>
              Current row or repeat
              <input
                maxLength={100}
                value={position}
                onChange={(e) => draft.change('position', e.target.value)}
                placeholder="e.g. Row 23 complete"
              />
            </label>
            <label>
              Hook or needle size
              <input
                maxLength={80}
                value={toolSize}
                onChange={(e) => draft.change('toolSize', e.target.value)}
                placeholder="e.g. 5 mm hook"
              />
            </label>
          </div>
          <div className="media-grid">
            <div>
              <div className="field-caption">
                A photo <span>optional</span>
              </div>
              {photo ? (
                <div className="photo-preview">
                  <img src={photo} alt="Checkpoint photo preview" />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remove photo"
                    onClick={() => draft.change('photo', undefined)}
                  >
                    <IconTrash size={18} />
                  </button>
                </div>
              ) : runtime?.native ? (
                <button
                  type="button"
                  className="photo-upload"
                  disabled={mediaBusy || voiceBusy}
                  onClick={async () => {
                    const capturedScope = runtime.scope()
                    setMediaBusy(true)
                    setError('')
                    try {
                      const saved = await currentDraft.current.pin()
                      if (!alive.current) return
                      const { result, id } = await runtime.capturePhoto(
                        {
                          scope: capturedScope,
                          draftKey: saved.key,
                          draftRevision: saved.revision,
                        },
                        () => alive.current,
                      )
                      if (result.status === 'ok' && alive.current) {
                        const value = await readFile(result.value.bytes)
                        if (!alive.current) return
                        currentDraft.current.change('photo', value)
                        await currentDraft.current.pin()
                        if (id) await runtime.acknowledgePhoto(id, capturedScope)
                      } else if ('error' in result) {
                        setError(`${result.error.problem} ${result.error.nextAction}`)
                      }
                    } catch (failure) {
                      if (alive.current) setError(errorText(failure))
                    } finally {
                      if (alive.current) setMediaBusy(false)
                    }
                  }}
                >
                  <IconCamera size={25} aria-hidden />
                  <span>{mediaBusy ? 'Preparing your photo…' : 'Add a photo'}</span>
                  <small>Take a photo or choose one from this device</small>
                </button>
              ) : (
                <label className="photo-upload">
                  <IconCamera size={25} />
                  <span>{mediaBusy ? 'Preparing your photo…' : 'Add a photo'}</span>
                  <small>JPEG, PNG, WebP · up to 15 MB</small>
                  <input
                    aria-label="Add checkpoint photo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    disabled={mediaBusy}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      setMediaBusy(true)
                      setError('')
                      try {
                        const value = await preparePhoto(file)
                        if (alive.current) draft.change('photo', value)
                      } catch (err) {
                        setError(errorText(err))
                      } finally {
                        setMediaBusy(false)
                      }
                    }}
                  />
                </label>
              )}
            </div>
            {runtime?.native ? (
              <NativeVoiceNote
                runtime={runtime}
                value={voice}
                onChange={async (value) => {
                  currentDraft.current.change('voice', value)
                  await currentDraft.current.pin()
                }}
                onBusy={setVoiceBusy}
                onFinishReady={setFinishVoice}
              />
            ) : (
              <VoiceNote
                value={voice}
                onChange={(value) => draft.change('voice', value)}
                onBusy={setVoiceBusy}
                onFinishReady={setFinishVoice}
              />
            )}
          </div>
          <label>
            Anything else to remember? <span className="optional">optional</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => draft.change('notes', e.target.value)}
              placeholder="A stitch change, a tricky bit, or where the pattern is…"
            />
          </label>
          <ErrorMessage message={error} />
          <div className="dialog-actions">
            <span className="save-note">Just for you. Saved on this device.</span>
            <button
              className="button primary"
              disabled={busy || mediaBusy || voiceBusy || !nextStep.trim()}
            >
              <IconCheck size={18} />
              {busy ? 'Saving…' : 'Save checkpoint'}
            </button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  )
}

function DraftStatus({
  draft,
  disabled,
}: {
  draft: { ready: boolean; status: string; error: string; discard: () => Promise<void> }
  disabled: boolean
}) {
  return (
    <div className="draft-status">
      <p role="status">
        {!draft.ready
          ? 'Checking for a saved draft…'
          : draft.status || 'You can close this form and return to your draft later.'}
      </p>
      {draft.status && (
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={() => void draft.discard()}
        >
          Discard draft
        </button>
      )}
      <ErrorMessage message={draft.error} />
    </div>
  )
}
