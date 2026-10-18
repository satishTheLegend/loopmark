import { openNativeRepository } from '../../../src/platform/native/repository'
import { createNativeBackupInbox } from '../../../src/platform/native/backup-inbox'
import { createNativeOperationPlanStore } from '../../../src/platform/native/operation-plans'
import { createLocalDataAdapter } from '../../../src/services/local-data-service'
import { createBackupService } from '../../../src/services/backup-service'
import { parseBackup } from '../../../src/data'
import { validateBackupMedia } from '../../../src/media-validation'
import { canonicalJson } from '../../../src/domain/canonical-json'
import { DomainError, type ErrorCode } from '../../../src/domain/errors'
import { fixture } from './persistence'
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
/** Requires a prior actual OS file-open. Never fabricates/stages a file through a JS test bridge. */
export async function nativeInbox() {
  let repo = await openNativeRepository({ databaseName: 'native_inbox_qa_v1' })
  let scope = await repo.readActive()
  if (!scope) {
    const info = fixture()
    await repo.createCollection(info)
    scope = await repo.transition(null, {
      key: info.key,
      device: { id: 'inbox-device', generation: 'initial' },
    })
  }
  let inbox = createNativeBackupInbox(repo)
  const original = await inbox.pending()
  assert(original, 'Deliver a file through the OS before running this fixture')
  if (!original) throw new Error('No OS file')
  const before = await repo.listCollections(),
    initialView = canonicalJson(await repo.readView(scope.key))
  if (original.state !== 'ready') {
    if (original.state === 'already-handled') {
      assert(original.result, 'Repeated successful file must retain its SQL completion receipt')
      assert(
        before.some((value) => canonicalJson(value.key) === canonicalJson(original.result)),
        'Recovered collection vanished',
      )
    } else assert(original.errorCode, 'Failed OS intake must have a safe error code')
    await rejects(() => inbox.read(original.id), 'NOT_AVAILABLE')
    await inbox.finish(original.id, scope, { state: 'dismissed' })
    assert(
      canonicalJson(await repo.listCollections()) === canonicalJson(before),
      'Dismissing notice changed craft collections',
    )
    await repo.close()
    return {
      outcome: original.state,
      id: original.id,
      checks: [
        'durable handled/error notice',
        'no read or duplicate import',
        'dismiss preserves collections',
      ],
    }
  }
  const bound = await inbox.bind(original.id, scope)
  assert(bound.operationToken === original.operationToken, 'Binding replaced stable token')
  await rejects(
    () => inbox.bind(original.id, { ...scope!, generation: scope!.generation + 1 }),
    'ACCOUNT_CHANGED',
  )
  const bytes = await inbox.read(original.id)
  await repo.close()
  repo = await openNativeRepository({ databaseName: 'native_inbox_qa_v1' })
  inbox = createNativeBackupInbox(repo)
  assert(
    (await inbox.pending())?.operationToken === original.operationToken,
    'Reopen replaced operation token',
  )
  assert(
    (await (await inbox.read(original.id)).text()) === (await bytes.text()),
    'Reopen changed private bytes',
  )
  const source = scope,
    other = fixture()
  await repo.createCollection(other)
  scope = await repo.transition(scope, { key: other.key, device: scope.device })
  await rejects(() => inbox.read(original.id), 'ACCOUNT_CHANGED')
  await rejects(() => inbox.bind(original.id, scope!), 'ACCOUNT_CHANGED')
  scope = await repo.transition(scope, { key: source.key, device: source.device })
  await rejects(() => inbox.read(original.id), 'ACCOUNT_CHANGED')
  await inbox.bind(original.id, scope)
  assert(
    (await inbox.pending())?.source?.generation === scope.generation,
    'Explicit re-review failed to refresh generation',
  )
  assert(
    canonicalJson(await repo.readView(source.key)) === initialView,
    'OS review changed original craft data',
  )
  let backup
  try {
    backup = parseBackup(await bytes.text())
    await validateBackupMedia(backup)
  } catch {
    scope = await repo.transition(scope, { key: other.key, device: scope.device })
    await inbox.finish(original.id, scope, { state: 'dismissed' })
    assert(
      canonicalJson(await repo.readView(source.key)) === initialView,
      'Invalid file dismissal changed source',
    )
    await repo.close()
    return {
      outcome: 'invalid-backup',
      id: original.id,
      checks: [
        'bounded durable read',
        'full validation rejection',
        'other-collection explicit dismiss',
        'source preserved',
      ],
    }
  }
  const data = createLocalDataAdapter({
    repository: repo,
    media: repo.media,
    plans: createNativeOperationPlanStore(repo),
    scope: () => scope!,
  })
  const backups = createBackupService({
    repository: repo,
    media: repo.media,
    data,
    scope: () => scope!,
  })
  const count = (await repo.listCollections()).length
  const recovered = await backups.restoreAsRecovered(
    backup,
    'Native external backup QA',
    original.operationToken,
  )
  const retry = await backups.restoreAsRecovered(
    backup,
    'Native external backup QA',
    original.operationToken,
  )
  assert(
    canonicalJson(recovered) === canonicalJson(retry) &&
      (await repo.listCollections()).length === count + 1,
    'Repeated stable operation created duplicates',
  )
  assert(
    canonicalJson(await repo.readActive()) === canonicalJson(scope),
    'Restore selected a collection automatically',
  )
  assert(
    canonicalJson(await repo.readView(source.key)) === initialView,
    'Restore changed original source',
  )
  assert(
    (await repo.readView(recovered)).projects.length === backup.projects.length,
    'Recovered projects missing',
  )
  await inbox.finish(original.id, scope, { state: 'imported', collection: recovered })
  assert((await inbox.pending()) === null, 'Completed inbox remained pending')
  await inbox.finish(original.id, scope, { state: 'imported', collection: recovered })
  assert(
    (await repo.listCollections()).length === count + 1,
    'Lost completion reply retry changed recovered copies',
  )
  await repo.close()
  return {
    outcome: 'imported',
    id: original.id,
    recovered,
    checks: [
      'OS staged bytes survive database close/reopen',
      'full-scope fences and explicit generation re-review',
      'full backup validation',
      'stable restore token creates one separate copy',
      'source and active selection preserved',
      'completion receipt precedes byte cleanup',
    ],
  }
}
