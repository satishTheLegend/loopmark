import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { IconX, IconNeedleThread } from '@tabler/icons-react'
import type { Project } from '../types'
import { UserFacingError, safeError, type SafeError } from '../domain/errors'

export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  initialFocus = 'field',
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  initialFocus?: 'field' | 'heading'
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.showModal()
    ref.current
      ?.querySelector<HTMLElement>(
        initialFocus === 'heading'
          ? '#dialog-title'
          : 'input:not([type=file]):not([type=radio]), textarea, select',
      )
      ?.focus()
    return () => {
      ref.current?.close()
      previous?.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog wide' : 'dialog'}
      aria-labelledby="dialog-title"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
          ) || [],
        ).filter((el) => el.getClientRects().length > 0)
        if (!items.length) return
        event.preventDefault()
        const index = items.indexOf(document.activeElement as HTMLElement)
        items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus()
      }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="dialog-head">
        <h2 id="dialog-title" tabIndex={initialFocus === 'heading' ? -1 : undefined}>
          {title}
        </h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <IconX />
        </button>
      </div>
      {children}
    </dialog>
  )
}
export function Brand() {
  return (
    <span className="brand">
      <img src="/icon.svg" width="36" height="36" alt="" />
      <span>
        loopmark<span className="brand-dot">.</span>
      </span>
    </span>
  )
}
export function CraftArt({ project, large = false }: { project?: Project; large?: boolean }) {
  const photo = project?.checkpoints.find((c) => c.photo)?.photo
  const art = /scarf/i.test(project?.name || '')
    ? 'clay-scarf'
    : /cardigan/i.test(project?.name || '') || project?.craft === 'Knitting'
      ? 'sage-knit'
      : 'granny-square'
  return (
    <div className={`craft-art ${project?.color || 'sage'} ${large ? 'large' : ''}`}>
      <img
        src={photo || `/art/${project ? art : 'workbasket'}.svg`}
        alt={photo ? `${project?.name}, saved project photo` : ''}
        className={photo ? 'user-photo' : ''}
      />
      {!photo && project && <span className="art-caption">A little project illustration</span>}
    </div>
  )
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null
}
export function Empty({
  title,
  text,
  children,
}: {
  title: string
  text: string
  children?: ReactNode
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <IconNeedleThread size={32} />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  )
}
export function relativeTime(value: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000))
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`
}
export function fullDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
export function errorText(error: unknown) {
  if (error instanceof UserFacingError) return error.message
  return formatSafeError(safeError(error))
}
export function formatSafeError(detail: SafeError) {
  return `${detail.problem} ${detail.nextAction} Diagnostic code: ${detail.code} (${detail.correlationId}). Help: ${detail.helpRef}.`
}
