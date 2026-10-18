import type { SnapshotManifest } from '../domain/contracts'
import type { SyncTransport } from '../platform/contracts'
import { canonicalJson } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'

/** Collect one fixed server snapshot. Callers own its release until every pinned byte is consumed. */
export async function collectSnapshot(
  transport: SyncTransport,
  input: { collectionId: string; purpose: 'hydrate' | 'export'; epoch?: string },
  signal: AbortSignal,
  check: () => Promise<void>,
  owned?: () => boolean | Promise<boolean>,
): Promise<SnapshotManifest[]> {
  await check()
  let page = await transport.snapshot(
    { action: 'create', collectionId: input.collectionId, purpose: input.purpose },
    signal,
  )
  const pages: SnapshotManifest[] = [],
    seen = new Set<string>(),
    first = page
  try {
    for (let n = 0; ; n++) {
      await check()
      if (
        n >= 200 ||
        page.collectionId !== input.collectionId ||
        (input.epoch && page.epoch !== input.epoch) ||
        page.after !== (pages.length ? pages[pages.length - 1].nextPage : null) ||
        canonicalJson([page.snapshotId, page.epoch, page.cursor, page.revision, page.expiresAt]) !==
          canonicalJson([
            first.snapshotId,
            first.epoch,
            first.cursor,
            first.revision,
            first.expiresAt,
          ])
      )
        throw new DomainError('SYNC_PAGE_INVALID')
      pages.push(page)
      if (page.nextPage === null) return pages
      if (seen.has(page.nextPage)) throw new DomainError('SYNC_PAGE_INVALID')
      seen.add(page.nextPage)
      page = await transport.snapshot(
        { action: 'page', snapshotId: first.snapshotId, after: page.nextPage },
        signal,
      )
    }
  } catch (error) {
    // Even malformed pagination can have allocated a valid, owned lease.
    await releaseSnapshotQuietly(
      transport,
      first.snapshotId,
      owned ??
        (async () => {
          try {
            await check()
            return true
          } catch {
            return false
          }
        }),
    )
    throw error
  }
}
export async function releaseSnapshotQuietly(
  transport: SyncTransport,
  snapshotId: string,
  owned: () => boolean | Promise<boolean>,
): Promise<void> {
  try {
    if (!(await owned())) return
    await transport.releaseSnapshot(snapshotId, AbortSignal.timeout(4000))
  } catch {
    /* Expiry is the offline fallback. */
  }
}
