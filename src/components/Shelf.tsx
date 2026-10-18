import { useState } from 'react'
import {
  IconArrowRight,
  IconBookmark,
  IconPlus,
  IconSearch,
  IconNeedleThread,
  IconArrowUpRight,
  IconCircleCheck,
} from '@tabler/icons-react'
import type { Project, Craft } from '../types'
import { Badge, CraftArt, Empty, relativeTime } from './ui'
export function Shelf({
  projects,
  finished,
  onOpen,
  onNew,
  onSamples,
  sampleBusy,
}: {
  projects: Project[]
  finished: boolean
  onOpen: (id: string) => void
  onNew: () => void
  onSamples: () => void
  sampleBusy: boolean
}) {
  const [query, setQuery] = useState(''),
    [craft, setCraft] = useState('All crafts'),
    [sort, setSort] = useState('recent')
  const collection = projects.filter((p) => p.status === (finished ? 'finished' : 'active'))
  const filtered = collection
    .filter(
      (p) =>
        (craft === 'All crafts' || p.craft === craft) &&
        [p.name, p.code, p.craft, p.yarn].join(' ').toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt),
    )
  const last = collection
    .filter((p) => p.checkpoints.length)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  return (
    <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">
            {finished ? 'MADE WITH TIME & CARE' : 'YOUR LITTLE CORNER OF MAKING'}
          </div>
          <h1>{finished ? 'The finished collection' : 'Your projects, patiently waiting.'}</h1>
          <p>
            {finished
              ? 'Every finished piece has a story. Keep yours here.'
              : 'A few stitches now. A little note for later. Pick up right where you left off.'}
          </p>
        </div>
        <button className="button primary" onClick={onNew}>
          <IconPlus size={18} />
          New project
        </button>
      </header>
      {!finished && (
        <section
          className={`welcome-banner ${last ? 'with-checkpoint' : ''}`}
          aria-label={last ? 'Last saved checkpoint' : 'Welcome to Loopmark'}
        >
          <div className="banner-copy">
            <span className="mini-label">
              <IconBookmark size={16} />
              {last ? 'A NOTE FROM YOUR PAST SELF' : 'MAKE SOMETHING. TAKE YOUR TIME.'}
            </span>
            <h2>{last ? `Ready when you are.` : 'Your next stitch starts here.'}</h2>
            <p>
              {last
                ? last.checkpoints[0].nextStep
                : 'Half-finished doesn’t mean forgotten. Give your next creative moment a place to begin.'}
            </p>
            {last ? (
              <button className="text-button" onClick={() => onOpen(last.id)}>
                Pick up {last.name}
                <IconArrowRight size={18} />
              </button>
            ) : (
              <button className="text-button" onClick={onNew}>
                Save your first project
                <IconArrowRight size={18} />
              </button>
            )}
          </div>
          <div className="banner-art">
            <img src="/art/workbasket.svg" alt="" />
            <span className="handwritten">a little pause, not a goodbye</span>
          </div>
        </section>
      )}
      <section className="project-section" aria-labelledby="shelf-title">
        <div className="section-top">
          <div className="section-title">
            <h2 id="shelf-title">{finished ? 'Finished projects' : 'On your needles & hooks'}</h2>
            <span className="count">{collection.length}</span>
          </div>
          <label className="sort-label">
            Sort by
            <select
              aria-label="Sort projects"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="recent">Recently touched</option>
              <option value="name">Project name</option>
            </select>
          </label>
        </div>
        <div className="filter-row">
          <div className="filter-tabs" aria-label="Filter by craft">
            {['All crafts', 'Crochet', 'Knitting', 'Other'].map((c) => (
              <button
                key={c}
                className={craft === c ? 'selected' : ''}
                aria-pressed={craft === c}
                onClick={() => setCraft(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="search">
            <IconSearch size={17} />
            <input
              aria-label="Search projects"
              placeholder="Find a project…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        {filtered.length ? (
          <div className="project-grid">
            {filtered.map((p) => (
              <ProjectCard key={p.id} project={p} onOpen={() => onOpen(p.id)} />
            ))}
            {!finished && (
              <button className="new-project-card" onClick={onNew}>
                <span>
                  <IconPlus size={25} />
                </span>
                <strong>A new beginning</strong>
                <p>There’s always room for one more.</p>
              </button>
            )}
          </div>
        ) : query || craft !== 'All crafts' ? (
          <Empty
            title="No projects in this basket"
            text="Try a different craft or a shorter search."
          >
            <button
              className="button secondary"
              onClick={() => {
                setQuery('')
                setCraft('All crafts')
              }}
            >
              Clear filters
            </button>
          </Empty>
        ) : (
          <div className="first-project">
            <div className="empty-stitch">
              <IconNeedleThread size={38} stroke={1.3} />
            </div>
            <h2>{finished ? 'Good things take a few stitches.' : 'Let’s keep your place.'}</h2>
            <p>
              {finished
                ? 'Finished projects will appear here when you mark them complete.'
                : 'Add that cardigan, blanket, or one-day-I’ll-finish-it project. Future you will thank you.'}
            </p>
            {!finished && (
              <div className="empty-actions">
                <button className="button primary" onClick={onNew}>
                  <IconPlus size={17} />
                  Add your first project
                </button>
                {projects.length === 0 && (
                  <button className="text-button" disabled={sampleBusy} onClick={onSamples}>
                    {sampleBusy ? 'Adding examples…' : 'Take a look with sample projects'}
                    <IconArrowUpRight size={16} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>
      <footer className="page-footer">
        <span>
          <IconNeedleThread size={16} />
          Made for the joy of making.
        </span>
        <span>A pause is part of the process.</span>
      </footer>
    </>
  )
}
function ProjectCard({ project: p, onOpen }: { project: Project; onOpen: () => void }) {
  const latest = p.checkpoints[0]
  return (
    <article className="project-card">
      <button className="project-card-main" onClick={onOpen}>
        <span className="sr-only">Open {p.name}. </span>
        <div className="card-image">
          <CraftArt project={p} />
          <Badge tone={p.color}>{p.craft}</Badge>
          {p.sample && <span className="sample-tag">Sample</span>}
        </div>
        <div className="card-body">
          <div className="card-title-row">
            <h3>{p.name}</h3>
            <IconArrowUpRight size={18} />
          </div>
          <p className="card-material">{p.yarn || 'A project with possibility'}</p>
          <div className="card-facts">
            <span>
              <IconNeedleThread size={15} />
              {latest?.toolSize || p.toolSize || 'Tool not set'}
            </span>
            <span>{latest?.position || 'Ready to begin'}</span>
          </div>
          <div className="card-next">
            <span>
              {p.status === 'finished' ? <IconCircleCheck size={15} /> : <IconBookmark size={15} />}
            </span>
            <p>
              {p.status === 'finished'
                ? 'Made, with a little patience.'
                : latest?.nextStep || 'Save a checkpoint for your future self.'}
            </p>
          </div>
          <div className="card-bottom">
            <span>
              {latest
                ? `Paused ${relativeTime(latest.createdAt).toLowerCase()}`
                : 'No checkpoint yet'}
            </span>
            <span>
              {latest ? 'Pick up here' : 'Open project'} <IconArrowRight size={14} />
            </span>
          </div>
        </div>
      </button>
    </article>
  )
}
export const craftList: Craft[] = ['Crochet', 'Knitting', 'Other']
