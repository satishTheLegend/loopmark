import { openNativeRepository } from '../../../src/platform/native/repository'
import { scopeKey } from '../../../src/platform/native/recovery-journal'
import { DomainError, type ErrorCode } from '../../../src/domain/errors'
import type { PullPage } from '../../../src/domain/contracts'
import { create, fixture } from './persistence'

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message)
}
async function rejects(action: () => Promise<unknown>, code: ErrorCode) {
  try {
    await action()
  } catch (error) {
    assert(error instanceof DomainError && error.detail.code === code, `Expected ${code}`)
    return
  }
  throw new Error(`Expected ${code}`)
}

/** Real SQLite and repository subscriptions; no storage or bridge mocks. */
export async function nativePullNoop() {
  const results: string[] = [],
    databaseName = `pull_noop_${Date.now()}`,
    info = fixture(true)
  let repo = await openNativeRepository({ databaseName })
  await repo.createCollection(info)
  const scope = await repo.transition(null, {
    key: info.key,
    device: { id: 'pull-device', generation: 'initial' },
  })
  let notifications = 0
  const unsubscribe = repo.subscribe(() => notifications++)
  const body = () =>
    repo.database.serial(async (db) =>
      String(
        (await db.query('SELECT body FROM collections WHERE key=?', [scopeKey(scope.key)]))
          .values?.[0]?.body,
      ),
    )
  const changes = () =>
    repo.database.serial(async (db) =>
      Number((await db.query('SELECT total_changes() AS count')).values?.[0]?.count),
    )
  const page: PullPage = {
    protocolVersion: 2,
    collectionId: scope.key.collectionId,
    epoch: scope.key.epoch,
    afterCursor: '0',
    nextCursor: '0',
    hasMore: false,
    entries: [],
  }
  try {
    const original = await body(),
      review = await repo.reviewLocal(scope.key),
      writesBefore = await changes()
    // Any unexpected collection write fails inside the actual native SQL transaction.
    await repo.database.serial((db) =>
      db.execute(`
        CREATE TEMP TRIGGER reject_pull_insert BEFORE INSERT ON collections BEGIN SELECT RAISE(ABORT, 'unexpected no-op insert'); END;
        CREATE TEMP TRIGGER reject_pull_update BEFORE UPDATE ON collections BEGIN SELECT RAISE(ABORT, 'unexpected no-op update'); END;
        CREATE TEMP TRIGGER reject_pull_delete BEFORE DELETE ON collections BEGIN SELECT RAISE(ABORT, 'unexpected no-op delete'); END;
      `),
    )
    await repo.applyPage(scope.key, page, scope.generation)
    assert((await body()) === original, 'Empty pull rewrote stored state')
    assert((await changes()) === writesBefore, 'Empty pull performed SQL row writes')
    assert(notifications === 0, 'Empty pull published a false repository change')
    assert(
      JSON.stringify(await repo.reviewLocal(scope.key)) === JSON.stringify(review),
      'Empty pull invalidated an unchanged review',
    )
    results.push('empty unchanged-cursor pull: no SQLite row writes, revision change, or publish')

    await rejects(
      () =>
        repo.applyPage(scope.key, { ...page, collectionId: 'wrong-collection' }, scope.generation),
      'SYNC_REBASE_REQUIRED',
    )
    await rejects(
      () => repo.applyPage(scope.key, { ...page, epoch: 'wrong-epoch' }, scope.generation),
      'SYNC_REBASE_REQUIRED',
    )
    await rejects(
      () =>
        repo.applyPage(scope.key, { ...page, afterCursor: '1', nextCursor: '1' }, scope.generation),
      'SYNC_PAGE_INVALID',
    )
    await rejects(
      () => repo.applyPage(scope.key, { ...page, nextCursor: '-1' }, scope.generation),
      'SYNC_PAGE_INVALID',
    )
    await rejects(() => repo.applyPage(scope.key, page, scope.generation + 1), 'ACCOUNT_CHANGED')
    await rejects(
      () => repo.applyPage({ ...scope.key, namespace: 'another-owner' }, page, scope.generation),
      'ACCOUNT_CHANGED',
    )
    assert((await body()) === original && notifications === 0, 'Rejected pull changed state')
    results.push(
      'empty pull still rejects invalid collection, epoch, cursor, active scope, and generation',
    )
    await repo.database.serial((db) =>
      db.execute(
        'DROP TRIGGER reject_pull_insert; DROP TRIGGER reject_pull_update; DROP TRIGGER reject_pull_delete;',
      ),
    )

    await repo.applyPage(scope.key, { ...page, nextCursor: '1' }, scope.generation)
    const advanced = await repo.readView(scope.key)
    assert(
      advanced.cursor === '1' && advanced.revision !== review.revision && notifications === 1,
      'Cursor advancement did not change and publish the revision',
    )
    const intent = create(info)
    if (intent.kind !== 'project.create') throw new Error('Wrong fixture')
    await repo.applyPage(
      scope.key,
      {
        ...page,
        afterCursor: '1',
        nextCursor: '2',
        entries: [
          {
            operationId: 'remote-create',
            sha256: 'a'.repeat(64),
            epoch: scope.key.epoch,
            revision: '2',
            cursor: '2',
            resultId: intent.payload.project.id,
            changes: [{ kind: 'project.put', value: { ...intent.payload.project, revision: '2' } }],
          },
        ],
      },
      scope.generation,
    )
    const updated = await repo.readView(scope.key)
    assert(
      updated.cursor === '2' &&
        updated.revision !== advanced.revision &&
        updated.projects[0]?.id === intent.payload.project.id &&
        notifications === 2,
      'Real receipt did not change saved content/revision or publish',
    )
    results.push('cursor advancement and real receipt each durably change revision and publish')
    const finalReview = await repo.reviewLocal(scope.key)
    await repo.applyPage(
      scope.key,
      { ...page, afterCursor: '2', nextCursor: '2' },
      scope.generation,
    )
    assert(notifications === 2, 'Second empty pull published')
    unsubscribe()
    await repo.close()
    repo = await openNativeRepository({ databaseName })
    assert(
      JSON.stringify(await repo.readView(scope.key)) === JSON.stringify(updated),
      'State differs after actual SQLite close/reopen',
    )
    // The reviewed state remains usable by the same atomic transition that fences deletion.
    const fenced = await repo.transition(
      scope,
      { key: scope.key, device: scope.device },
      finalReview,
    )
    results.push('no-op pull preserves review CAS across SQLite close/reopen')
    const guest = fixture()
    await repo.createCollection(guest)
    const guestScope = await repo.transition(fenced, { key: guest.key, device: scope.device })
    const guestBefore = await repo.readView(guest.key)
    await rejects(
      () =>
        repo.applyPage(
          guest.key,
          {
            ...page,
            collectionId: guest.key.collectionId,
            epoch: guest.key.epoch,
          },
          guestScope.generation,
        ),
      'VALIDATION',
    )
    assert(
      JSON.stringify(await repo.readView(guest.key)) === JSON.stringify(guestBefore),
      'Connected pull altered a guest collection',
    )
    results.push('guest collection refuses connected pull without changing its records')
    return results
  } finally {
    unsubscribe()
    await repo.close()
  }
}
