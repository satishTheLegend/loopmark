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
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    const old = previous.current
    if (
      (summary.actionable && old.kind !== summary.kind) ||
      (summary.kind === 'current' && old.items.length > 0 && !!summary.lastSyncedAt)
    )
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
