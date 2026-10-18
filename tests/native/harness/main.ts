import { persistenceTests } from './persistence'
import { adapterTests } from './adapters'
import { capabilityTests, installManualFlows } from './flows'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { verifyRepositoryContract } from '../../../src/repositories/contract-suite'
import { openNativeRepository } from '../../../src/platform/native/repository'
import { NativeCredentialStore } from '../../../src/platform/native/session-storage'
import { durableFiles } from '../../../src/platform/native/files-bridge'
import { nativeMediaRepair } from './media-repair'
import { nativeRebase } from './rebase'
import { nativeDownloads } from './downloads'
import { nativePullNoop } from './pull-noop'
import { nativeControllerSwitch } from './controller-switch'
import { nativeRuntimeScheduler } from './runtime-scheduler'

const results: { name: string; passed: boolean; error?: string }[] = []
const assert = (value: unknown) => {
  if (!value) throw new Error('Assertion failed')
}
async function test(name: string, action: () => Promise<void>) {
  try {
    await action()
    results.push({ name, passed: true })
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
await test('real native platform', async () => {
  assert(Capacitor.isNativePlatform())
})
await test('SQLite save, close, reopen, idempotence, stale generation, snapshot', async () => {
  const name = `test_${Date.now()}`
  await verifyRepositoryContract(() => openNativeRepository({ databaseName: name }))
})
await test('durable byte roundtrip, reopen, immutable rejection, hash rejection, removal', async () => {
  const bytes = new TextEncoder().encode('synthetic durable native bytes')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  const key = hash
  const encoded = btoa(String.fromCharCode(...bytes))
  await durableFiles.put({ key, base64: encoded, sha256: hash })
  assert((await durableFiles.read({ key })).base64 === encoded)
  await durableFiles.put({ key, base64: encoded, sha256: hash })
  let rejected = false
  try {
    await durableFiles.put({ key, base64: btoa('corrupt'), sha256: hash })
  } catch {
    rejected = true
  }
  assert(rejected)
  await durableFiles.remove({ key })
  assert(!(await durableFiles.list()).files.some((file) => file.key === key))
})
await test('actual device credential save, read, clear', async () => {
  const store = new NativeCredentialStore()
  await store.write('synthetic-native-fixture-only')
  assert((await store.read()) === 'synthetic-native-fixture-only')
  await store.clear()
  assert((await store.read()) === null)
})
const runId = String(
  (
    await Filesystem.readFile({
      path: 'loopmark-native-run-id',
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    })
  ).data,
).trim()
const restartPhase = await persistenceTests(test, runId)
await test('native corrupt/missing cache repair preserves draft/export pins and transaction fences', async () => {
  await nativeMediaRepair()
})
await test('native source-preserving rebase validates review and archives drafts, media and old commands atomically', async () => {
  await nativeRebase()
})
await adapterTests(test)
await test('native downloaded cache eviction preserves protected/source bytes and retries physical cleanup', async () => {
  await nativeDownloads()
})
await test('empty unchanged-cursor pull preserves real SQLite state, subscriptions and review CAS', async () => {
  await nativePullNoop()
})
await test('late sync cleanup preserves a deliberate guest switch in the actual controller and SQLite', async () => {
  await nativeControllerSwitch()
})
await test('native runtime scheduler waits for startup and queued selection settlement', async () => {
  await nativeRuntimeScheduler()
})
await capabilityTests(test)
const report = {
  schemaVersion: 1,
  runId,
  restartPhase,
  platform: Capacitor.getPlatform(),
  origin: location.origin,
  scope: 'synthetic simulator fixture; not physical/store/power-loss qualification',
  results,
}
document.getElementById('results')!.textContent = JSON.stringify(report, null, 2)
await Filesystem.writeFile({
  path: 'loopmark-native-results.json',
  data: JSON.stringify(report, null, 2),
  directory: Directory.Data,
  encoding: Encoding.UTF8,
})
installManualFlows()
