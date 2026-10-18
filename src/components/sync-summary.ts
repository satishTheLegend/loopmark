import type { CollectionView, PendingIntent } from '../domain/contracts'
import type { SafeError } from '../domain/errors'
import type { AttachmentItem } from '../services/attachment-queue'

export type SyncCategory = 'account' | 'conflict' | 'quota' | 'failed' | 'waiting'
export interface SyncItem {
  id: string
  title: string
  kind: 'project' | 'checkpoint' | 'attachment'
  createdAt: string
  category: SyncCategory
  error?: SafeError
  retryable: boolean
}
export interface SyncSummary {
  kind:
    | 'local'
    | 'disabled'
    | 'account'
    | 'conflict'
    | 'quota'
    | 'failed'
    | 'offline'
    | 'working'
    | 'waiting'
    | 'current'
  label: string
  actionable: boolean
  items: SyncItem[]
  lastSyncedAt: string | null
  error?: SafeError
}
const permanent = new Set([
  'AUTH_REQUIRED',
  'ACCOUNT_CHANGED',
  'REVISION_CONFLICT',
  'UPGRADE_REQUIRED',
  'TECHNICAL_CAPACITY_REACHED',
  'MEDIA_CAPACITY_REACHED',
  'VALIDATION',
  'MEDIA_INVALID',
  'SYNC_REBASE_REQUIRED',
])
export function canRetryTransient(item: Pick<SyncItem, 'category' | 'error'>): boolean {
  return !!item.error?.retryable && !permanent.has(item.error.code) && item.category !== 'conflict'
}
function category(pending: PendingIntent): SyncCategory {
  const code = pending.error?.code
  if (code === 'AUTH_REQUIRED' || code === 'ACCOUNT_CHANGED') return 'account'
  if (pending.state === 'conflict' || code === 'REVISION_CONFLICT') return 'conflict'
  if (
    code === 'UPGRADE_REQUIRED' ||
    code === 'TECHNICAL_CAPACITY_REACHED' ||
    code === 'MEDIA_CAPACITY_REACHED'
  )
    return 'quota'
  return pending.error && code !== 'OFFLINE' ? 'failed' : 'waiting'
}
export function attachmentSyncItems(items: AttachmentItem[], view: CollectionView): SyncItem[] {
  return items
    .filter((item) => !['complete', 'cancelled'].includes(item.state))
    .map((item) => {
      const checkpoint = view.checkpoints.find((cp) => cp.id === item.checkpointId)
      const error = item.error ?? undefined
      const code = error?.code
      return {
        id: item.id,
        kind: 'attachment',
        title: `${view.projects.find((project) => project.id === checkpoint?.projectId)?.name ?? 'Saved checkpoint'} · ${item.kind === 'photo' ? 'Photo' : 'Voice note'}`,
        createdAt: checkpoint?.createdAt ?? view.info.createdAt,
        category:
          code === 'AUTH_REQUIRED' || code === 'ACCOUNT_CHANGED'
            ? 'account'
            : ['UPGRADE_REQUIRED', 'TECHNICAL_CAPACITY_REACHED', 'MEDIA_CAPACITY_REACHED'].includes(
                  code ?? '',
                )
              ? 'quota'
              : error && code !== 'OFFLINE'
                ? 'failed'
                : 'waiting',
        error,
        retryable: false,
      }
    })
}
export function summarizeSync({
  view,
  online,
  working,
  authRequired = false,
  disabled = false,
  lastSyncedAt = null,
  attachments = [],
  syncState,
  syncError,
}: {
  view: CollectionView | null
  online: boolean
  working: boolean
  authRequired?: boolean
  disabled?: boolean
  lastSyncedAt?: string | null
  attachments?: SyncItem[]
  syncState?: 'offline' | 'idle' | 'syncing' | 'pending' | 'conflict' | 'error'
  syncError?: SafeError
}): SyncSummary {
  const items: SyncItem[] = (view?.pending ?? [])
    .filter((pending) => !attachments.some((item) => item.id === pending.command.operationId))
    .map((pending) => {
      const intent = pending.intent
      const projectId =
        intent.kind === 'project.create'
          ? intent.payload.project.id
          : intent.kind === 'checkpoint.create'
            ? intent.payload.checkpoint.projectId
            : intent.kind === 'collection.replace'
              ? undefined
              : intent.payload.projectId
      const name =
        view?.projects.find((project) => project.id === projectId)?.name || 'Saved project'
      const item: SyncItem = {
        id: pending.command.operationId,
        title: name,
        kind:
          intent.kind === 'media.attach'
            ? 'attachment'
            : intent.kind === 'checkpoint.create'
              ? 'checkpoint'
              : 'project',
        createdAt: intent.createdAt,
        category: category(pending),
        error: pending.error,
        retryable: false,
      }
      item.retryable = canRetryTransient(item)
      return item
    })
    .concat(attachments.map((item) => ({ ...item, retryable: canRetryTransient(item) })))
  const result = (kind: SyncSummary['kind'], label: string, actionable = false): SyncSummary => ({
    kind,
    label,
    actionable,
    items,
    lastSyncedAt,
    error: syncError,
  })
  if (view?.info.kind !== 'connected') return result('local', 'On this device')
  if (disabled) return result('disabled', 'Account access is disabled', true)
  if (
    authRequired ||
    ['AUTH_REQUIRED', 'ACCOUNT_CHANGED'].includes(syncError?.code ?? '') ||
    items.some((item) => item.category === 'account')
  )
    return result('account', 'Sign in to continue syncing', true)
  if (items.some((item) => item.category === 'conflict'))
    return result('conflict', 'Changes need your review', true)
  if (items.some((item) => item.category === 'quota'))
    return result('quota', 'Capacity needs your attention', true)
  if (items.some((item) => item.category === 'failed'))
    return result('failed', 'Some items could not sync', true)
  if (syncState === 'error') return result('failed', 'Sync needs your attention', true)
  if (!online)
    return result(
      'offline',
      items.length
        ? `${items.length} ${items.length === 1 ? 'item waiting' : 'items waiting'} for a connection`
        : 'Offline · saved work remains here',
    )
  if (working || view.hydration === 'loading' || view.hydration === 'empty')
    return result(
      'working',
      view.hydration !== 'ready' ? 'Loading your projects' : 'Syncing with your account',
    )
  if (items.length)
    return result(
      'waiting',
      `${items.length} ${items.length === 1 ? 'item waiting' : 'items waiting'} to sync`,
    )
  if (syncState === 'pending') return result('waiting', 'More account changes are waiting to sync')
  return result('current', lastSyncedAt ? 'Synced to your account' : 'Ready to sync')
}
