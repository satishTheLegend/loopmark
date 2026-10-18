import { persistenceTests } from './persistence'
import { adapterTests } from './adapters'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { verifyRepositoryContract } from '../../../src/repositories/contract-suite'
import { openNativeRepository } from '../../../src/platform/native/repository'
import { NativeCredentialStore } from '../../../src/platform/native/session-storage'
import { durableFiles } from '../../../src/platform/native/files-bridge'

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
const restartPhase = await persistenceTests(test)
await adapterTests(test)
const report = {
  schemaVersion: 1,
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
