import type { CollectionInfo, SessionScope } from '../domain/contracts'
import { DomainError } from '../domain/errors'
import type { Repository } from '../repositories/contracts'
import type { BrowserRepository } from '../repositories/browser/repository'
import { migrateLegacy } from '../repositories/browser/migration'
import { closeLegacyDatabase } from '../data'

/** Stable destination lets an interrupted migration resume without making another collection. */
export const personalCollection = (): CollectionInfo => ({
  key: { namespace: 'local', collectionId: 'personal', epoch: 'initial' },
  name: 'Personal projects',
  kind: 'guest',
  accountId: null,
  createdAt: new Date().toISOString(),
  legacyAccess: false,
})
async function active(repository: Repository): Promise<SessionScope | null> {
  const scope = await repository.readActive()
  if (scope) await repository.readView(scope.key)
  return scope
}
function isStartupRace(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    ['ACCOUNT_CHANGED', 'REVISION_CONFLICT'].includes(error.detail.code)
  )
}
export async function prepareBrowserStorage(
  repository: BrowserRepository,
  factory?: IDBFactory,
): Promise<SessionScope> {
  const existing = await active(repository)
  if (existing) return existing
  await closeLegacyDatabase()
  try {
    await migrateLegacy({
      repository,
      factory,
      destination: personalCollection(),
      generation: 0,
      device: { id: crypto.randomUUID(), generation: crypto.randomUUID() },
    })
  } catch (error) {
    // Another tab may have completed the same migration. Validate its durable selection.
    if (!isStartupRace(error) || !(await active(repository))) throw error
  }
  const selected = await active(repository)
  if (!selected) throw new DomainError('INVARIANT_VIOLATION')
  return selected
}
export async function prepareNativeStorage(repository: Repository): Promise<SessionScope> {
  const existing = await active(repository)
  if (existing) return existing
  const personal = personalCollection()
  const collections = await repository.listCollections()
  const known = collections.find(
    (info) => JSON.stringify(info.key) === JSON.stringify(personal.key),
  )
  if (known && (known.kind !== 'guest' || known.accountId !== null))
    throw new DomainError('INVARIANT_VIOLATION')
  try {
    if (!known) await repository.createCollection(personal)
    return await repository.transition(null, {
      key: personal.key,
      device: { id: crypto.randomUUID(), generation: crypto.randomUUID() },
    })
  } catch (error) {
    if (!isStartupRace(error)) throw error
    const selected = await active(repository)
    if (!selected) throw error
    return selected
  }
}
