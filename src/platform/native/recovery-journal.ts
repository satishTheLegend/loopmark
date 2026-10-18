import type { CollectionKey, Generation, SessionScope } from '../../domain/contracts'
import { DomainError } from '../../domain/errors'
import { collectionKeySchema } from '../../domain/schema'
import type { SQLiteDBConnection } from '@capacitor-community/sqlite'

export function scopeKey(scope: CollectionKey): string {
  const parsed = collectionKeySchema.parse(scope)
  return JSON.stringify([parsed.namespace, parsed.collectionId, parsed.epoch])
}
export async function activeScope(db: SQLiteDBConnection): Promise<SessionScope | null> {
  const rows = await db.query("SELECT body FROM metadata WHERE key='active'")
  return rows.values?.[0] ? (JSON.parse(rows.values[0].body as string) as SessionScope) : null
}
export async function assertGeneration(
  db: SQLiteDBConnection,
  key: CollectionKey,
  generation: Generation,
  selected = false,
) {
  const active = await activeScope(db)
  if (
    !active ||
    active.generation !== generation ||
    !Number.isSafeInteger(generation) ||
    generation < 0
  )
    throw new DomainError('ACCOUNT_CHANGED')
  if (selected && scopeKey(active.key) !== scopeKey(key)) throw new DomainError('ACCOUNT_CHANGED')
  const registered = await db.query('SELECT body FROM collections WHERE key=?', [scopeKey(key)])
  if (!registered.values?.length) throw new DomainError('NOT_AVAILABLE')
  const target = JSON.parse(registered.values[0].body as string) as {
    info: { kind: string; key: CollectionKey; accountId: string | null }
  }
  if (target.info.kind === 'connected') {
    const sourceRow = (
      await db.query('SELECT body FROM collections WHERE key=?', [scopeKey(active.key)])
    ).values?.[0]
    const source = sourceRow
      ? (JSON.parse(sourceRow.body as string) as { info: { accountId: string | null } })
      : null
    if (!source || source.info.accountId !== target.info.accountId)
      throw new DomainError('ACCOUNT_CHANGED')
  }
}

// References in saved shadows, pending intents and recovered copies are all protected.
// Explicit pins additionally protect drafts and active exports.
export async function referenced(
  db: SQLiteDBConnection,
  scope: string,
  id: string,
): Promise<boolean> {
  const pins = await db.query('SELECT owner FROM pins WHERE scope=? AND media_id=? LIMIT 1', [
    scope,
    id,
  ])
  if (pins.values?.length) return true
  const rows = await db.query('SELECT body FROM collections WHERE key=?', [scope])
  const walk = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false
    if ('id' in value && 'sha256' in value && (value as { id: unknown }).id === id) return true
    return Object.values(value).some(walk)
  }
  return rows.values?.some((row) => walk(JSON.parse(row.body as string))) ?? false
}
