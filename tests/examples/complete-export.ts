import type { SessionScope } from '../../src/domain/contracts'
import type { PlatformMedia } from '../../src/platform/contracts'
import type { Repository } from '../../src/repositories/contracts'
import { encodeSnapshotBackup } from '../../src/services/local-data-service'

/** Local complete export. Connected callers use BackupService.exportComplete to fetch missing bytes. */
export async function completeLocalExport(
  repository: Repository,
  media: PlatformMedia,
  scope: SessionScope,
) {
  const snapshot = await repository.snapshot(scope.key)
  try {
    return await encodeSnapshotBackup(snapshot, media, scope, 2)
  } finally {
    await repository.releaseSnapshot(snapshot.id)
  }
}
