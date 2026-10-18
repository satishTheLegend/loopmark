import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { openNativeRepository } from '../../../src/platform/native/repository'
import { createNativeOperationPlanStore } from '../../../src/platform/native/operation-plans'
import { createLocalDataAdapter } from '../../../src/services/local-data-service'
import { createBackupService } from '../../../src/services/backup-service'
import { canonicalHash } from '../../../src/domain/canonical-json'
import { MAX_LIBRARY_BYTES, utf8Bytes } from '../../../src/domain/policy'
import type { CollectionInfo, SessionScope } from '../../../src/domain/contracts'
import { benchmarkFixture } from './fixture'
import { nativeExamples } from './examples'
import { nativeMediaRepair } from '../harness/media-repair'
import { nativeRebase } from '../harness/rebase'
import { nativeDownloads } from '../harness/downloads'
import { nativeInbox } from '../harness/inbox'
import { stageNativeExport } from '../../../src/platform/native/share'
import { decodeBase64Bytes } from '../../../src/media-validation'
import { backupInboxBridge } from '../../../src/platform/native/backup-inbox'

// Read-only OS intake observer for XCTest. It does not fabricate or stage a file.
const incomingLabel = document.createElement('p')
document.body.append(incomingLabel)
const showIncoming = async () => {
  const { item } = await backupInboxBridge.pending()
  incomingLabel.textContent =
    item?.state === 'ready'
      ? 'Incoming OS file ready'
      : item
        ? `Incoming OS file ${item.state}`
        : 'No incoming OS file'
}
if (Capacitor.isNativePlatform()) {
  void backupInboxBridge.addListener('changed', () => {
    void showIncoming()
  })
  void showIncoming()
}

const openedAt = performance.now()
const directory = Directory.Data
const commandName = 'loopmark-benchmark-command.json'
const reportName = 'loopmark-benchmark-results.json'
const progressName = 'loopmark-benchmark-progress.json'
let runId = 'unread-command'
async function progress(stage: string, detail: Record<string, unknown> = {}) {
  const value = {
    runId,
    stage,
    wallTime: Date.now(),
    elapsedMs: performance.now() - openedAt,
    ...detail,
  }
  document.getElementById('results')!.textContent = JSON.stringify(value, null, 2)
  await Filesystem.writeFile({
    path: progressName,
    directory,
    encoding: Encoding.UTF8,
    data: JSON.stringify(value),
  })
}
const report: Record<string, unknown> = {
  schemaVersion: 1,
  platform: Capacitor.getPlatform(),
  origin: location.origin,
  scope:
    'actual native SQLite/files and production backup service; synthetic fixture; no physical-device claim',
}
try {
  if (!Capacitor.isNativePlatform()) throw new Error('Actual native runtime required.')
  const command = JSON.parse(
    String(
      (await Filesystem.readFile({ path: commandName, directory, encoding: Encoding.UTF8 })).data,
    ),
  )
  if (
    command.schemaVersion !== 1 ||
    !/^[a-f0-9-]{36}$/.test(command.runId) ||
    ![
      'import',
      'export',
      'startup',
      'examples',
      'repair',
      'profile',
      'rebase',
      'downloads',
      'inbox',
    ].includes(command.action) ||
    !['small', 'limit'].includes(command.dataset)
  )
    throw new Error('Explicit benchmark command is invalid.')
  runId = command.runId
  Object.assign(report, { runId, action: command.action, dataset: command.dataset })
  await progress('opening')
  const repo = await openNativeRepository({ databaseName: 'native_benchmark_v1' })
  let selected = await repo.readActive()
  if (!selected) {
    const info: CollectionInfo = {
      key: {
        namespace: 'guest_native_benchmark',
        collectionId: 'benchmark_empty',
        epoch: 'initial',
      },
      kind: 'guest',
      accountId: null,
      legacyAccess: false,
      name: 'Synthetic benchmark',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    await repo.createCollection(info)
    selected = await repo.transition(null, {
      key: info.key,
      device: { id: 'benchmark_device', generation: 'initial' },
    })
  }
  let scope: SessionScope = selected
  const startingView = await repo.readView(scope.key)
  report.repositoryReadyMs = performance.now() - openedAt
  report.repositoryReadyWallTime = Date.now()
  report.startingProjects = startingView.projects.length
  report.startingCheckpoints = startingView.checkpoints.length
  const data = createLocalDataAdapter({
    repository: repo,
    media: repo.media,
    plans: createNativeOperationPlanStore(repo),
    scope: () => scope,
  })
  const backups = createBackupService({
    repository: repo,
    media: repo.media,
    data,
    scope: () => scope,
  })
  const phases: { operation: string; bytes?: number; ms: number }[] = []
  const storeVerified = repo.media.storeVerified.bind(repo.media),
    release = repo.media.release.bind(repo.media),
    importLocal = repo.importLocal.bind(repo)
  repo.media.storeVerified = async (...args) => {
    const started = performance.now()
    try {
      await storeVerified(...args)
    } finally {
      phases.push({
        operation: 'storeVerified',
        bytes: args[1].size,
        ms: performance.now() - started,
      })
    }
  }
  repo.media.release = async (...args) => {
    const started = performance.now()
    try {
      await release(...args)
    } finally {
      phases.push({ operation: 'release', ms: performance.now() - started })
    }
  }
  repo.importLocal = async (...args) => {
    const started = performance.now()
    try {
      return await importLocal(...args)
    } finally {
      phases.push({ operation: 'importLocal', ms: performance.now() - started })
    }
  }
  await progress('ready')
  if (command.action === 'import') {
    await progress('generating')
    let fixture = benchmarkFixture(command.dataset)
    report.fixtureBytes = utf8Bytes(fixture)
    report.expectedProjects = fixture.projects.length
    report.expectedCheckpoints = fixture.projects.reduce((sum, p) => sum + p.checkpoints.length, 0)
    const expected = await canonicalHash(fixture.projects)
    await progress('importing', { fixtureBytes: report.fixtureBytes })
    const started = performance.now()
    const key = await backups.restoreAsRecovered(fixture, `Benchmark ${command.dataset}`, runId)
    report.importMs = performance.now() - started
    report.importPhases = phases
    const restored = await repo.readView(key)
    if (
      restored.projects.length !== report.expectedProjects ||
      restored.checkpoints.length !== report.expectedCheckpoints
    )
      throw new Error('Imported record counts differ.')
    // The durable selected target is used by a separate, clean process export run.
    scope = await repo.transition(scope, { key, device: scope.device })
    await repo.database.transaction(async (db) => {
      await db.run(
        'INSERT OR REPLACE INTO metadata(key,body) VALUES(?,?)',
        [
          'benchmark_expected',
          JSON.stringify({ dataset: command.dataset, hash: expected, bytes: report.fixtureBytes }),
        ],
        false,
      )
    })
    fixture = {
      format: 'loopmark',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      projects: [],
    }
    await progress('cleanup')
    const completedKey = scope.key
    for (const info of await repo.listCollections()) {
      if (JSON.stringify(info.key) === JSON.stringify(completedKey)) continue
      const previous = await repo.readView(info.key)
      scope = await repo.transition(scope, { key: info.key, device: scope.device })
      await repo.removeLocal(info.key, previous.revision, scope.generation)
      scope = await repo.transition(scope, { key: completedKey, device: scope.device })
    }
    await repo.media.reconcile()
  } else if (command.action === 'export') {
    const expected = await repo.database.serial(async (db) => {
      const row = (await db.query('SELECT body FROM metadata WHERE key=?', ['benchmark_expected']))
        .values?.[0]
      return row ? JSON.parse(String(row.body)) : null
    })
    if (!expected || expected.dataset !== command.dataset)
      throw new Error('Import the matching fixture before export.')
    await progress('exporting')
    const started = performance.now()
    const backup = await backups.exportComplete()
    // Include the final compact JSON allocation and Blob that the product exports.
    const serialized = JSON.stringify(backup),
      blob = new Blob([serialized], { type: 'application/json' })
    report.exportMs = performance.now() - started
    report.exportBytes = blob.size
    if (
      blob.size !== expected.bytes ||
      (command.dataset === 'limit' && blob.size !== MAX_LIBRARY_BYTES)
    )
      throw new Error('Complete export length differs from the imported portable fixture.')
    const staged = await stageNativeExport({ name: 'synthetic-benchmark.json', bytes: blob })
    report.exportThroughNativeFileMs = performance.now() - started
    report.nativeExportFileBytes = (await Filesystem.stat({ path: staged.uri })).size
    await Filesystem.rmdir({ path: staged.directory, directory: Directory.Cache, recursive: true })
    await progress('verifying', { exportBytes: blob.size })
    if ((await canonicalHash(backup.projects)) !== expected.hash)
      throw new Error('Complete export content differs after native process restart.')
    report.roundtripHash = expected.hash
  }
  await repo.close()
  if (command.action === 'examples') report.examples = await nativeExamples()
  if (command.action === 'repair') report.repair = await nativeMediaRepair()
  if (command.action === 'rebase') report.rebase = await nativeRebase()
  if (command.action === 'downloads') report.downloads = await nativeDownloads()
  if (command.action === 'inbox') report.inbox = await nativeInbox()
  if (command.action === 'profile') {
    const decoding = []
    for (const size of [60 * 1024, 6 * 1024 * 1024]) {
      const payload = 'A'.repeat((size * 4) / 3)
      for (let iteration = 0; iteration < 3; iteration++) {
        for (const algorithm of ['legacy-string-iterator', 'preallocated-byte-loop']) {
          const started = performance.now()
          const bytes =
            algorithm === 'legacy-string-iterator'
              ? Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
              : decodeBase64Bytes(payload)
          const elapsedMs = performance.now() - started
          if (bytes.length !== size || bytes.some((value) => value !== 0))
            throw new Error('Decode profile changed bytes')
          decoding.push({ size, iteration, algorithm, elapsedMs })
        }
      }
    }
    report.decoding = decoding
  }
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = error instanceof Error ? error.message : String(error)
}
report.completedAt = new Date().toISOString()
await progress('complete', { passed: report.passed })
await Filesystem.writeFile({
  path: reportName,
  directory,
  encoding: Encoding.UTF8,
  data: JSON.stringify(report, null, 2),
})
