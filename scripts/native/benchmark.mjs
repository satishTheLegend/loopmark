import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import os from 'node:os'
import { root, androidEnvironment } from './process.mjs'
import {
  productManifest,
  verifyProductAssets,
  verifyProductApk,
  appDirectoryHash,
} from './product-evidence.mjs'
import { iosMemory, androidMemory, peakMemory } from './benchmark-memory.mjs'
const exec = promisify(execFile)
const call = async (command, args) =>
  (await exec(command, args, { maxBuffer: 16 * 1024 * 1024, timeout: 30_000 })).stdout
if (process.env.LOOPMARK_NATIVE_BENCHMARK !== '1')
  throw new Error('Explicit LOOPMARK_NATIVE_BENCHMARK=1 is required.')
const [platform, action, dataset, countText = '1'] = process.argv.slice(2),
  count = Number(countText)
if (
  !['ios', 'android'].includes(platform) ||
  !['startup', 'import', 'export', 'examples', 'repair', 'profile', 'rebase'].includes(action) ||
  !['small', 'limit'].includes(dataset) ||
  !Number.isInteger(count) ||
  count < 1 ||
  count > 30
)
  throw new Error(
    'Usage: benchmark.mjs <ios|android> <startup|import|export|examples|repair|profile|rebase> <small|limit> [1..30 samples]',
  )
const appId = 'app.loopmark.craft.benchmark',
  evidence = resolve(root, 'docs/evidence/expansion/native/benchmarks')
const manifest = await productManifest(resolve(evidence, 'bundle.json'))
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
let stop, launch, read, write, memory, artifactSha256, target, runtimeVersion, bootstrapParent
if (platform === 'ios') {
  target = process.env.LOOPMARK_IOS_SIMULATOR
  if (!target || !/^[A-Fa-f0-9-]{36}$/.test(target))
    throw new Error('Select a test-owned booted iOS simulator explicitly.')
  const app = resolve(root, 'ios/build/Build/Products/Debug-iphonesimulator/App.app')
  if (
    (
      await call('plutil', ['-extract', 'CFBundleIdentifier', 'raw', `${app}/Info.plist`])
    ).trim() !== appId
  )
    throw new Error('Refusing to install a non-benchmark iOS app.')
  await verifyProductAssets(`${app}/public`, manifest)
  await call('xcrun', ['simctl', 'install', target, app])
  const container = (
    await call('xcrun', ['simctl', 'get_app_container', target, appId, 'data'])
  ).trim()
  const installed = (
    await call('xcrun', ['simctl', 'get_app_container', target, appId, 'app'])
  ).trim()
  await verifyProductAssets(`${installed}/public`, manifest)
  artifactSha256 = await appDirectoryHash(installed)
  runtimeVersion =
    Object.entries(
      JSON.parse(await call('xcrun', ['simctl', 'list', 'devices', '--json'])).devices,
    ).find(([, rows]) => rows.some((device) => device.udid === target))?.[0] ?? 'unknown'
  stop = () => call('xcrun', ['simctl', 'terminate', target, appId]).catch(() => {})
  let appPid = -1
  launch = async () => {
    const output = await call('xcrun', ['simctl', 'launch', target, appId])
    appPid = Number(output.trim().split(':').at(-1))
    if (!Number.isInteger(appPid) || appPid <= 0) throw new Error('No benchmark app PID.')
    bootstrapParent = Number((await call('ps', ['-o', 'ppid=', '-p', String(appPid)])).trim())
  }
  read = async (name) => JSON.parse(await readFile(resolve(container, 'Documents', name), 'utf8'))
  write = async (value) => {
    await mkdir(resolve(container, 'Documents'), { recursive: true })
    await writeFile(
      resolve(container, 'Documents/loopmark-benchmark-command.json'),
      JSON.stringify(value),
    )
    for (const name of ['results', 'progress'])
      await unlink(resolve(container, `Documents/loopmark-benchmark-${name}.json`)).catch((e) => {
        if (e.code !== 'ENOENT') throw e
      })
  }
  memory = async () =>
    iosMemory(await call('ps', ['-axo', 'pid,ppid,rss,comm']), appPid, bootstrapParent)
  // Learn only this simulator's launchd parent before checking exclusive WebView ownership.
  await write({ schemaVersion: 1, runId: randomUUID(), action: 'startup', dataset })
  await launch()
  await sleep(1000)
  await stop()
} else {
  target = process.env.ANDROID_SERIAL
  if (!/^emulator-\d+$/.test(target ?? ''))
    throw new Error('Select an authorized Android emulator explicitly.')
  const env = await androidEnvironment(),
    adb = resolve(env.ANDROID_HOME, 'platform-tools/adb'),
    apk = resolve(root, 'android/app/build/outputs/apk/debug/app-debug.apk'),
    aapt = resolve(env.ANDROID_HOME, 'build-tools/36.0.0/aapt2')
  const badging = await call(aapt, ['dump', 'badging', apk])
  if (!badging.startsWith(`package: name='${appId}'`))
    throw new Error('Refusing to install a non-benchmark Android APK.')
  artifactSha256 = await verifyProductApk(apk, manifest)
  const shell = (args) => call(adb, ['-s', target, 'shell', ...args])
  await call(adb, ['-s', target, 'install', '-r', apk])
  const installed = (await shell(['pm', 'path', appId])).trim().replace(/^package:/, '')
  if (!installed.startsWith('/data/app/')) throw new Error('Installed benchmark APK not found.')
  const installedHash = (await shell(['sha256sum', installed])).trim().split(/\s/)[0]
  if (installedHash !== artifactSha256) throw new Error('Installed benchmark APK differs.')
  runtimeVersion = (await shell(['getprop', 'ro.build.version.release'])).trim()
  stop = () => shell(['am', 'force-stop', appId])
  launch = () => shell(['am', 'start', '-W', '-n', `${appId}/app.loopmark.craft.MainActivity`])
  read = async (name) => JSON.parse(await shell(['run-as', appId, 'cat', `files/${name}`]))
  write = async (value) => {
    const local = resolve(root, 'ios/benchmark-command.json')
    await writeFile(local, JSON.stringify(value))
    await call(adb, [
      '-s',
      target,
      'push',
      local,
      '/data/local/tmp/loopmark-benchmark-command.json',
    ])
    await shell(['run-as', appId, 'mkdir', '-p', 'files'])
    await shell([
      'run-as',
      appId,
      'cp',
      '/data/local/tmp/loopmark-benchmark-command.json',
      'files/loopmark-benchmark-command.json',
    ])
    await shell([
      'run-as',
      appId,
      'rm',
      '-f',
      'files/loopmark-benchmark-results.json',
      'files/loopmark-benchmark-progress.json',
    ])
  }
  memory = async () =>
    androidMemory(await shell(['ps', '-A', '-o', 'PID,PPID,RSS,NAME,ARGS']), appId)
}
const runs = []
for (let sample = 0; sample < count; sample++) {
  await stop()
  let empty = false
  for (let retry = 0; retry < 30; retry++) {
    if ((await memory()).webContentKiB === 0) {
      empty = true
      break
    }
    await sleep(200)
  }
  if (!empty)
    throw new Error(
      'Another WebView is active on this simulator/emulator; close test-owned apps before benchmarking.',
    )
  const runId = randomUUID(),
    command = { schemaVersion: 1, runId, action, dataset }
  await write(command)
  const launchedAt = Date.now(),
    samples = []
  let result,
    latestStage = 'launching',
    readyAt = null
  await launch()
  while (Date.now() - launchedAt < 20 * 60_000) {
    const at = Date.now()
    try {
      const stage = await read('loopmark-benchmark-progress.json')
      if (stage.runId === runId) {
        latestStage = stage.stage
        if (stage.stage === 'ready') readyAt ??= stage.wallTime
      }
    } catch {
      /* Native file is absent or being atomically rewritten during startup. */
    }
    samples.push({ at, stage: latestStage, ...(await memory()) })
    try {
      const candidate = await read('loopmark-benchmark-results.json')
      if (candidate.runId === runId) {
        result = candidate
        break
      }
    } catch {
      /* Report appears only after actual native work. */
    }
    await sleep(100)
  }
  const entry = {
    sample: sample + 1,
    launchedAt,
    completedAt: Date.now(),
    processToRepositoryReadyMs:
      (result?.repositoryReadyWallTime ?? readyAt)
        ? (result?.repositoryReadyWallTime ?? readyAt) - launchedAt
        : null,
    result: result ?? { passed: false, error: 'Native measurement timed out after 20 minutes.' },
    peak: peakMemory(samples),
    operationPeak: peakMemory(samples.filter((s) => s.stage === `${action}ing`)),
    samples,
  }
  runs.push(entry)
  await mkdir(evidence, { recursive: true })
  await writeFile(
    resolve(evidence, `${platform}-${action}-${dataset}.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        measurementWindow:
          process.env.LOOPMARK_NATIVE_BENCHMARK_WINDOW === 'exclusive'
            ? 'loopmark-team-coordinated'
            : 'shared-correctness-only',
        target,
        platform,
        runtimeVersion,
        sourceCommit: manifest.sourceCommit,
        manifestFileSha256: manifest.manifestFileSha256,
        artifactSha256,
        host: {
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          model: os.cpus()[0]?.model,
          memoryBytes: os.totalmem(),
        },
        memoryMetric:
          'sampled sum of RSS KiB for isolated app host and its WebView processes; shared pages may be counted twice; peaks between samples may be missed',
        sampleIntervalRequestedMs: 100,
        runs,
      },
      null,
      2,
    ) + '\n',
  )
  await stop()
  if (!entry.result.passed) throw new Error(entry.result.error ?? 'Native benchmark failed.')
  process.stdout.write(
    JSON.stringify({
      platform,
      action,
      dataset,
      sample: sample + 1,
      native: result,
      peakRssKiB: entry.peak.totalRssKiB,
    }) + '\n',
  )
}
