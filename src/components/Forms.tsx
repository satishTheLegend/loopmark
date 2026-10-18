import { useRef, useState, type FormEvent } from 'react'
import { IconCamera, IconCheck, IconTrash } from '@tabler/icons-react'
import type { Project, ProjectInput, CheckpointInput, ProjectColor, Craft } from '../types'
import { Dialog, ErrorMessage, errorText } from './ui'
import { preparePhoto } from '../media'
import { VoiceNote } from './VoiceNote'
export function ProjectForm({
  project,
  onSave,
  onClose,
}: {
  project?: Project
  onSave: (v: ProjectInput) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(project?.name || ''),
    [craft, setCraft] = useState<Craft>(project?.craft || 'Crochet'),
    [color, setColor] = useState<ProjectColor>(project?.color || 'clay'),
    [toolSize, setTool] = useState(project?.toolSize || ''),
    [yarn, setYarn] = useState(project?.yarn || ''),
    [notes, setNotes] = useState(project?.notes || ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onSave({
        name: name.trim(),
        craft,
        color,
        toolSize: toolSize.trim(),
        yarn: yarn.trim(),
        notes: notes.trim(),
      })
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={project ? 'The project details' : 'Make room for a project'}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <p className="dialog-intro">
        A few little details. You can add a checkpoint whenever you pause.
      </p>
      <form onSubmit={submit}>
        <label>
          Project name
          <input
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sunday morning cardigan"
          />
        </label>
        <div className="form-grid">
          <label>
            Craft
            <select value={craft} onChange={(e) => setCraft(e.target.value as Craft)}>
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
              onChange={(e) => setTool(e.target.value)}
              placeholder="e.g. 5 mm hook"
            />
          </label>
        </div>
        <label>
          Yarn or material <span className="optional">optional</span>
          <input
            maxLength={200}
            value={yarn}
            onChange={(e) => setYarn(e.target.value)}
            placeholder="Brand, weight, shade…"
          />
        </label>
        <label>
          Project notes <span className="optional">optional</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
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
                onChange={() => setColor(c)}
              />
              <span className="sr-only">{c}</span>
              {color === c && <IconCheck size={16} />}
            </label>
          ))}
        </fieldset>
        <ErrorMessage message={error} />
        <div className="dialog-actions">
          <button type="button" className="button subtle" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : project ? 'Save details' : 'Create project'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
export function CheckpointForm({
  project,
  onSave,
  onClose,
}: {
  project: Project
  onSave: (v: CheckpointInput) => Promise<void>
  onClose: () => void
}) {
  const latest = project.checkpoints[0]
  const [position, setPosition] = useState(latest?.position || ''),
    [toolSize, setTool] = useState(latest?.toolSize || project.toolSize),
    [nextStep, setNext] = useState(''),
    [notes, setNotes] = useState(''),
    [photo, setPhoto] = useState<string>(),
    [voice, setVoice] = useState<string>(),
    [mediaBusy, setMediaBusy] = useState(false),
    [voiceBusy, setVoiceBusy] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const alive = useRef(true)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || mediaBusy || voiceBusy) return
    setBusy(true)
    setError('')
    try {
      await onSave({
        position: position.trim(),
        toolSize: toolSize.trim(),
        nextStep: nextStep.trim(),
        notes: notes.trim(),
        photo,
        voice,
      })
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Leave yourself a little note"
      onClose={() => {
        if (!busy) {
          alive.current = false
          onClose()
        }
      }}
      wide
    >
      <p className="dialog-intro">
        For the next time you pick up <strong>{project.name}</strong>.
      </p>
      <form onSubmit={submit}>
        <label className="next-step-label">
          What will you do next?
          <textarea
            autoFocus
            required
            rows={3}
            maxLength={1000}
            value={nextStep}
            onChange={(e) => setNext(e.target.value)}
            placeholder="e.g. Start row 24. Chain 2, turn, then work the first shell into the corner space."
          />
        </label>
        <div className="form-grid">
          <label>
            Current row or repeat
            <input
              maxLength={100}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="e.g. Row 23 complete"
            />
          </label>
          <label>
            Hook or needle size
            <input
              maxLength={80}
              value={toolSize}
              onChange={(e) => setTool(e.target.value)}
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
                  onClick={() => setPhoto(undefined)}
                >
                  <IconTrash size={18} />
                </button>
              </div>
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
                      if (alive.current) setPhoto(value)
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
          <VoiceNote value={voice} onChange={setVoice} onBusy={setVoiceBusy} />
        </div>
        <label>
          Anything else to remember? <span className="optional">optional</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
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
      </form>
    </Dialog>
  )
}
