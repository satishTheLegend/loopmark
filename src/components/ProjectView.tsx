import { useState } from 'react'
import {
  IconArrowLeft,
  IconBookmarkPlus,
  IconNeedleThread,
  IconTag,
  IconPencil,
  IconCircleCheck,
  IconTrash,
  IconArrowBackUp,
  IconPhoto,
  IconHistory,
  IconArrowRight,
} from '@tabler/icons-react'
import type { Project, Checkpoint } from '../types'
import { Badge, CraftArt, fullDate, relativeTime } from './ui'
export function ProjectView({
  project: p,
  onBack,
  onCheckpoint,
  onEdit,
  onLabel,
  onStatus,
  onDelete,
}: {
  project: Project
  onBack: () => void
  onCheckpoint: () => void
  onEdit: () => void
  onLabel: () => void
  onStatus: () => void
  onDelete: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const cp = p.checkpoints.find((c) => c.id === selected) || p.checkpoints[0],
    latest = cp === p.checkpoints[0]
  return (
    <>
      <button className="text-button back-link" onClick={onBack}>
        <IconArrowLeft size={17} />
        Back to your projects
      </button>
      <header className="page-heading detail-heading">
        <div>
          <div className="detail-eyebrow">
            <Badge tone={p.color}>{p.craft}</Badge>
            <span className="project-code">{p.code}</span>
            {p.sample && <Badge>Sample project</Badge>}
            {p.status === 'finished' && <Badge tone="sage">Finished</Badge>}
          </div>
          <h1>{p.name}</h1>
          <p>{p.yarn || 'Every stitch has its own story.'}</p>
        </div>
        <button
          className="button primary"
          onClick={onCheckpoint}
          disabled={p.status === 'finished'}
        >
          <IconBookmarkPlus size={19} />
          Save a checkpoint
        </button>
      </header>
      <div className="project-detail-grid">
        <div className="detail-main">
          <section
            className={`resume-note ${!latest ? 'past-note' : ''}`}
            aria-label={latest ? 'Latest checkpoint' : 'Earlier checkpoint'}
          >
            <div className="note-top">
              <span className="mini-label">
                <IconNeedleThread size={17} />
                {!cp ? 'A FRESH START' : latest ? 'PICK UP RIGHT HERE' : 'AN EARLIER CHAPTER'}
              </span>
              <span>{cp && relativeTime(cp.createdAt)}</span>
            </div>
            <h2>{cp ? 'Your next little step' : 'A little note goes a long way.'}</h2>
            <p className="next-instruction">
              {cp?.nextStep ||
                'When you put this project down, save where you are and what you’ll do next. We’ll keep your place.'}
            </p>
            {cp ? (
              <>
                <div className="checkpoint-facts">
                  <div>
                    <span>WHERE YOU LEFT OFF</span>
                    <strong>{cp.position || 'Position not recorded'}</strong>
                  </div>
                  <div>
                    <span>YOUR TOOL</span>
                    <strong>{cp.toolSize || 'Tool not recorded'}</strong>
                  </div>
                </div>
                {cp.notes && (
                  <div className="extra-note">
                    <h3>A few more details</h3>
                    <p>{cp.notes}</p>
                  </div>
                )}
                {cp.voice && (
                  <div className="checkpoint-voice">
                    <span>Your voice note</span>
                    <audio controls src={cp.voice} />
                  </div>
                )}
                <p className="saved-date">Saved {fullDate(cp.createdAt)}</p>
              </>
            ) : (
              <button
                className="button primary"
                onClick={onCheckpoint}
                disabled={p.status === 'finished'}
              >
                Save your first checkpoint
                <IconArrowRight size={17} />
              </button>
            )}
            {!latest && (
              <button className="text-button" onClick={() => setSelected(null)}>
                Back to latest checkpoint
                <IconArrowRight size={17} />
              </button>
            )}
          </section>
          <section className="history-section">
            <div className="section-title">
              <IconHistory size={20} />
              <h2>Little pauses along the way</h2>
              <span className="count">{p.checkpoints.length}</span>
            </div>
            {p.checkpoints.length ? (
              <div className="history-list">
                {p.checkpoints.map((entry, i) => (
                  <HistoryRow
                    key={entry.id}
                    checkpoint={entry}
                    latest={i === 0}
                    selected={entry.id === cp?.id}
                    onSelect={() => setSelected(entry.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="muted">Your checkpoint history will grow here, one pause at a time.</p>
            )}
          </section>
        </div>
        <aside className="project-sidebar">
          <div className="detail-photo">
            {cp?.photo ? (
              <img src={cp.photo} alt={`${p.name}, checkpoint saved ${fullDate(cp.createdAt)}`} />
            ) : (
              <CraftArt project={{ ...p, checkpoints: [] }} large />
            )}
            <span>
              <IconPhoto size={15} />
              {cp?.photo ? 'Your checkpoint photo' : 'A little inspiration for your project'}
            </span>
          </div>
          <section className="project-details-card">
            <div className="section-top">
              <h2>The details</h2>
              <button className="icon-button" aria-label="Edit project details" onClick={onEdit}>
                <IconPencil size={18} />
              </button>
            </div>
            <dl>
              <dt>Craft</dt>
              <dd>{p.craft}</dd>
              <dt>Hook / needles</dt>
              <dd>{p.toolSize || 'Not added yet'}</dd>
              <dt>Yarn / material</dt>
              <dd>{p.yarn || 'Not added yet'}</dd>
              <dt>Project code</dt>
              <dd>{p.code}</dd>
            </dl>
            {p.notes && (
              <div className="project-notes">
                <h3>Project notes</h3>
                <p>{p.notes}</p>
              </div>
            )}
            <button className="button secondary full-width" onClick={onLabel}>
              <IconTag size={18} />
              Make a bag label
            </button>
          </section>
          <div className="project-actions">
            <button className="text-button" onClick={onStatus}>
              {p.status === 'active' ? (
                <IconCircleCheck size={18} />
              ) : (
                <IconArrowBackUp size={18} />
              )}{' '}
              {p.status === 'active' ? 'Mark as finished' : 'Bring back to my projects'}
            </button>
            <button className="text-button danger-text" onClick={onDelete}>
              <IconTrash size={16} />
              Delete project
            </button>
          </div>
        </aside>
      </div>
    </>
  )
}
function HistoryRow({
  checkpoint: c,
  latest,
  selected,
  onSelect,
}: {
  checkpoint: Checkpoint
  latest: boolean
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      className={`history-row ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="timeline-dot" />
      <span className="history-content">
        <span className="history-date">
          {fullDate(c.createdAt)}
          {latest && <Badge tone="sage">Latest</Badge>}
        </span>
        <strong>{c.position || 'A saved place'}</strong>
        <span className="history-preview">{c.nextStep}</span>
      </span>
      <IconArrowRight size={17} />
    </button>
  )
}
