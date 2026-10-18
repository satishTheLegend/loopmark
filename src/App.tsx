import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconLayoutGrid,
  IconCircleCheck,
  IconDownload,
  IconBook2,
  IconMenu2,
  IconX,
  IconPlus,
  IconWifiOff,
  IconLock,
  IconBookmarkPlus,
} from '@tabler/icons-react'
import type { Project, ProjectInput, CheckpointInput } from './types'
import {
  listProjects,
  createProject,
  updateProject,
  addCheckpoint,
  deleteProject,
  setProjectStatus,
  subscribe,
  seedSamples,
} from './data'
import { Brand, Dialog, Empty, ErrorMessage, errorText } from './components/ui'
import { Shelf } from './components/Shelf'
import { ProjectView } from './components/ProjectView'
import { ProjectForm, CheckpointForm } from './components/Forms'
import { BackupView } from './components/BackupView'
import { BagLabel } from './components/BagLabel'
import { Guide } from './components/Guide'
import { sampleBackup } from './samples'
import { useOfflineSupport } from './offline'
import { captureDraftStore, deleteProjectDrafts } from './drafts'
type Route = 'projects' | 'finished' | 'backup' | 'guide' | `project=${string}`
type Modal = 'new' | 'edit' | 'checkpoint' | 'label' | 'delete' | null
function readRoute(): Route {
  let hash = location.hash.slice(1)
  if (hash.startsWith('project=')) return hash as Route
  return ['finished', 'backup', 'guide'].includes(hash) ? (hash as Route) : 'projects'
}
export default function App() {
  const offlineSupport = useOfflineSupport()
  const [projects, setProjects] = useState<Project[]>([]),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [route, setRoute] = useState<Route>(readRoute),
    [modal, setModal] = useState<Modal>(null),
    [mobileOpen, setMobileOpen] = useState(false),
    [toast, setToast] = useState(''),
    [toastError, setToastError] = useState(false),
    [offline, setOffline] = useState(!navigator.onLine),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(''),
    [editSnapshot, setEditSnapshot] = useState<Project>()
  const exitGuard = useRef<(() => Promise<boolean>) | undefined>(undefined)
  const currentRoute = useRef(route)
  currentRoute.current = route
  const setExitGuard = useCallback((guard?: () => Promise<boolean>) => {
    exitGuard.current = guard
  }, [])
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    main = useRef<HTMLElement>(null),
    request = useRef(0)
  async function refresh() {
    const current = ++request.current
    try {
      const all = await listProjects()
      if (current === request.current) {
        setProjects(all)
        setLoadError('')
      }
    } catch (e) {
      if (current === request.current) setLoadError(errorText(e))
    } finally {
      if (current === request.current) setLoading(false)
    }
  }
  useEffect(() => {
    void refresh()
    const off = subscribe(() => void refresh())
    return off
  }, [])
  useEffect(() => {
    const change = async () => {
      const next = readRoute()
      if (exitGuard.current && !(await exitGuard.current())) {
        history.replaceState(null, '', `#${currentRoute.current}`)
        return
      }
      setRoute(next)
      setModal(null)
      setMobileOpen(false)
      requestAnimationFrame(() => main.current?.focus())
    }
    const connection = () => setOffline(!navigator.onLine)
    window.addEventListener('hashchange', change)
    window.addEventListener('online', connection)
    window.addEventListener('offline', connection)
    return () => {
      window.removeEventListener('hashchange', change)
      window.removeEventListener('online', connection)
      window.removeEventListener('offline', connection)
      clearTimeout(toastTimer.current)
    }
  }, [])
  useEffect(() => {
    const query = window.matchMedia('(min-width: 701px)')
    const resize = () => {
      if (query.matches) setMobileOpen(false)
    }
    query.addEventListener('change', resize)
    return () => query.removeEventListener('change', resize)
  }, [])
  useEffect(() => {
    if (!mobileOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false)
        requestAnimationFrame(() =>
          document.querySelector<HTMLButtonElement>('.mobile-header .icon-button')?.focus(),
        )
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    document.querySelector<HTMLButtonElement>('.sidebar .nav-item')?.focus()
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpen])
  function navigate(next: Route) {
    if (readRoute() === next) {
      setRoute(next)
      setMobileOpen(false)
    } else location.hash = next
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  function notify(message: string, isError = false) {
    clearTimeout(toastTimer.current)
    setToast(message)
    setToastError(isError)
    if (isError) return
    toastTimer.current = setTimeout(() => setToast(''), 6500)
  }
  let projectId: string | undefined
  try {
    projectId = route.startsWith('project=') ? decodeURIComponent(route.slice(8)) : undefined
  } catch {
    projectId = 'invalid'
  }
  const project = projects.find((p) => p.id === projectId)
  useEffect(() => {
    document.title = project
      ? `${project.name} · Loopmark`
      : 'Loopmark · Pick up where you left off'
  }, [project])
  async function saveProject(input: ProjectInput, expectedRevision?: string, draftToken?: string) {
    if (modal === 'edit' && editSnapshot) {
      await updateProject(editSnapshot.id, input, expectedRevision || editSnapshot.updatedAt)
      await refresh()
      return editSnapshot.id
    }
    const created = await createProject(input, draftToken)
    await refresh()
    return created.id
  }
  function projectSaved(id: string, warning?: string) {
    exitGuard.current = undefined
    setModal(null)
    navigate(`project=${id}`)
    notify(warning || 'Your project is saved.', !!warning)
  }
  async function saveCheckpoint(input: CheckpointInput, draftToken?: string) {
    if (!project) throw new Error('This project is no longer available. Your draft is still here.')
    await addCheckpoint(project.id, input, draftToken)
    await refresh()
  }
  function checkpointSaved(warning?: string) {
    setModal(null)
    notify(warning || 'Your place is saved. Take your time.', !!warning)
  }
  async function changeStatus() {
    if (!project || busy) return
    setBusy(true)
    try {
      await setProjectStatus(
        project.id,
        project.status === 'active' ? 'finished' : 'active',
        project.updatedAt,
      )
      await refresh()
      notify(
        project.status === 'active'
          ? 'A lovely finish. Your project is in the finished collection.'
          : 'Your project is back in the workbasket.',
      )
    } catch (e) {
      notify(errorText(e), true)
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!editSnapshot || busy) return
    const draftStore = captureDraftStore()
    setBusy(true)
    setActionError('')
    try {
      await deleteProject(editSnapshot.id, editSnapshot.updatedAt)
      let warning = ''
      try {
        await deleteProjectDrafts(editSnapshot.id, draftStore)
      } catch (e) {
        warning = errorText(e)
      }
      setModal(null)
      navigate('projects')
      await refresh()
      notify(warning || 'Project deleted.', !!warning)
    } catch (e) {
      setActionError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function samples() {
    if (busy) return
    setBusy(true)
    try {
      await seedSamples(sampleBackup())
      await refresh()
      notify('Three sample projects added. Explore them, edit them, or delete them.')
    } catch (e) {
      notify(errorText(e), true)
    } finally {
      setBusy(false)
    }
  }
  const nav = [
    {
      route: 'projects',
      label: 'My projects',
      icon: IconLayoutGrid,
      count: projects.filter((p) => p.status === 'active').length,
    },
    {
      route: 'finished',
      label: 'Finished projects',
      icon: IconCircleCheck,
      count: projects.filter((p) => p.status === 'finished').length,
    },
    { route: 'backup', label: 'Backup & restore', icon: IconDownload },
    { route: 'guide', label: 'A little guide', icon: IconBook2 },
  ] as const
  return (
    <div className="app-shell">
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault()
          main.current?.focus()
        }}
      >
        Skip to content
      </a>
      <div className="mobile-header">
        <button
          className="brand-button"
          onClick={() => navigate('projects')}
          aria-label="Loopmark home"
        >
          <Brand />
        </button>
        <button
          className="icon-button"
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <IconX /> : <IconMenu2 />}
        </button>
      </div>
      {mobileOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <button
          className="brand-button"
          onClick={() => navigate('projects')}
          aria-label="Loopmark home"
        >
          <Brand />
        </button>
        <div className="sidebar-tagline">A place for your next stitch.</div>
        <nav aria-label="Main navigation">
          <div className="nav-label">YOUR WORKBASKET</div>
          {nav.map(({ route: r, label, icon: Icon, ...rest }, i) => (
            <button
              key={r}
              onClick={() => navigate(r)}
              className={`nav-item ${route === r || (project && r === project.status.replace('active', 'projects')) ? 'active' : ''} ${i === 2 ? 'nav-break' : ''}`}
              aria-current={route === r ? 'page' : undefined}
            >
              <Icon size={19} stroke={1.65} />
              <span>{label}</span>
              {'count' in rest && <span className="nav-count">{rest.count}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <IconBookmarkPlus size={24} stroke={1.4} />
            <p>
              A little note now.
              <br />A lovely start later.
            </p>
            <span>No rush. Just one stitch at a time.</span>
          </div>
          <div className="local-status">
            <span className="status-dot" />
            <span>Saved on this device</span>
            <IconLock size={13} />
          </div>
        </div>
      </aside>
      <div className="workspace" inert={mobileOpen}>
        <div className="topbar">
          <span>
            {project
              ? 'The project notebook'
              : route === 'backup'
                ? 'Your projects, kept safe'
                : route === 'guide'
                  ? 'A little help along the way'
                  : 'The project notebook'}
          </span>
          <span className="topbar-right">
            <IconLock size={13} />A space just for you
          </span>
        </div>
        {offline && (
          <div className="offline-banner" role="status">
            <IconWifiOff size={16} />
            {offlineSupport.ready
              ? 'You’re offline. Your projects and checkpoints still work on this device.'
              : 'You’re offline. Keep this page open until you reconnect; offline reopening is not ready yet.'}
          </div>
        )}
        {offlineSupport.update && (
          <div className="offline-banner" role="status">
            An update is ready. Save your work, close all Loopmark tabs, then reopen to apply it.
          </div>
        )}
        <main id="main" ref={main} tabIndex={-1} className="main-content">
          {loading ? (
            <div className="loading-state">
              <img src="/icon.svg" width="42" height="42" alt="" />
              <p>Opening your workbasket…</p>
            </div>
          ) : loadError ? (
            <Empty title="We couldn’t open your workbasket" text={loadError}>
              <p>
                Your browser may be blocking local storage. Allow site storage or try a regular
                browser window.
              </p>
              <button className="button primary" onClick={() => void refresh()}>
                Try again
              </button>
            </Empty>
          ) : projectId && !project ? (
            <Empty
              title="This project isn’t in this browser"
              text="Bag labels open a local record. Use the browser and site where you saved this project, or restore a full backup here first."
            >
              <div className="empty-actions">
                <button className="button primary" onClick={() => navigate('backup')}>
                  Restore a backup
                </button>
                <button className="button secondary" onClick={() => navigate('projects')}>
                  View my projects
                </button>
              </div>
            </Empty>
          ) : project ? (
            <ProjectView
              key={project.id}
              project={project}
              onBack={() => navigate(project.status === 'finished' ? 'finished' : 'projects')}
              onCheckpoint={() => setModal('checkpoint')}
              onEdit={() => {
                setEditSnapshot(project)
                setModal('edit')
              }}
              onLabel={() => setModal('label')}
              onStatus={() => void changeStatus()}
              onDelete={() => {
                setEditSnapshot(project)
                setActionError('')
                setModal('delete')
              }}
            />
          ) : route === 'backup' ? (
            <BackupView onMessage={notify} />
          ) : route === 'guide' ? (
            <Guide
              offlineSupport={offlineSupport}
              onNew={() => setModal('new')}
              onBackup={() => navigate('backup')}
            />
          ) : (
            <Shelf
              key={route}
              projects={projects}
              finished={route === 'finished'}
              onOpen={(id) => navigate(`project=${id}`)}
              onNew={() => setModal('new')}
              onSamples={() => void samples()}
              sampleBusy={busy}
            />
          )}
        </main>
      </div>
      {toast && (
        <div
          className={`toast ${toastError ? 'toast-error' : ''}`}
          role={toastError ? 'alert' : 'status'}
        >
          <span className="toast-mark">{toastError ? '!' : '✓'}</span>
          <span>{toast}</span>
          <button className="icon-button" aria-label="Dismiss message" onClick={() => setToast('')}>
            <IconX size={16} />
          </button>
        </div>
      )}
      {(modal === 'new' || modal === 'edit') && (
        <ProjectForm
          project={modal === 'edit' ? editSnapshot : undefined}
          onClose={() => setModal(null)}
          onSave={saveProject}
          onSaved={projectSaved}
          onExitGuard={setExitGuard}
        />
      )}{' '}
      {modal === 'checkpoint' && project && (
        <CheckpointForm
          project={project}
          onClose={() => setModal(null)}
          onSave={saveCheckpoint}
          onSaved={checkpointSaved}
          onExitGuard={setExitGuard}
        />
      )}{' '}
      {modal === 'label' && project && (
        <BagLabel project={project} onClose={() => setModal(null)} />
      )}
      {modal === 'delete' && editSnapshot && (
        <Dialog
          title="Let this project go?"
          onClose={() => {
            if (!busy) setModal(null)
          }}
        >
          <p>
            Delete <strong>{editSnapshot.name}</strong> and all {editSnapshot.checkpoints.length}{' '}
            checkpoints, photos and voice notes? This cannot be undone. You can download a full
            backup first.
          </p>
          <ErrorMessage message={actionError} />
          <div className="dialog-actions">
            <button className="button subtle" disabled={busy} onClick={() => setModal(null)}>
              Keep project
            </button>
            <button className="button danger" disabled={busy} onClick={remove}>
              {busy ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </Dialog>
      )}
      <button className="mobile-add" aria-label="Add a project" onClick={() => setModal('new')}>
        <IconPlus size={23} />
      </button>
    </div>
  )
}
