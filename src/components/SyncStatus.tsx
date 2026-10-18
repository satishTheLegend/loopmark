import { useEffect, useRef, useState } from 'react'
import {
  IconCloudCheck,
  IconCloudUpload,
  IconWifiOff,
  IconAlertTriangle,
  IconLock,
} from '@tabler/icons-react'
import type { SyncSummary } from './sync-summary'

export function SyncStatus({
  summary,
  onDetails,
}: {
  summary: SyncSummary
  onDetails: () => void
}) {
  const previous = useRef(summary)
  // Acknowledgements can drain the queue before the final account pull completes.
  const pendingCycle = useRef(false)
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    const old = previous.current
    if (summary.items.length > 0) pendingCycle.current = true
    const completed = summary.kind === 'current' && !!summary.lastSyncedAt && pendingCycle.current
    if (completed) pendingCycle.current = false
    if ((summary.actionable && old.kind !== summary.kind) || completed)
      setAnnouncement(summary.label)
    else if (old.kind !== summary.kind) setAnnouncement('')
    previous.current = summary
  }, [summary])
  const Icon =
    summary.kind === 'local'
      ? IconLock
      : summary.kind === 'offline'
        ? IconWifiOff
        : summary.actionable
          ? IconAlertTriangle
          : summary.kind === 'current'
            ? IconCloudCheck
            : IconCloudUpload
  return (
    <div className={`sync-status sync-${summary.kind} readable-controls`}>
      <span>
        <Icon aria-hidden size={19} /> {summary.label}
      </span>
      {summary.kind !== 'local' && (
        <button type="button" className="text-button" onClick={onDetails}>
          Sync details
        </button>
      )}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </div>
  )
}
