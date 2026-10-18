import { run, root, evidenceDirectory } from './process.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { productManifest, verifyProductAssets, appDirectoryHash } from './product-evidence.mjs'
const exec = promisify(execFile)
const device = process.env.LOOPMARK_IOS_SIMULATOR
if (!device)
  throw new Error(
    'Set LOOPMARK_IOS_SIMULATOR to a test-owned booted simulator UUID. No personal device is selected or erased.',
  )
const html = await readFile(`${root}/ios/App/App/public/index.html`, 'utf8')
const manifest = await productManifest(`${root}/docs/evidence/expansion/native/harness-bundle.json`)
await verifyProductAssets(`${root}/ios/App/App/public`, manifest)
await verifyProductAssets(
  `${root}/ios/build/Build/Products/Debug-iphonesimulator/App.app/public`,
  manifest,
)
if (!html.includes('native persistence fixture'))
  throw new Error(
    'Build the synthetic harness first: LOOPMARK_NATIVE_TEST_BUILD=1 node scripts/native/harness.mjs, then LOOPMARK_NATIVE_TEST_BUILD=1 node scripts/native/build-ios.mjs. Run native:sync afterwards to restore production assets.',
  )
await run('xcrun', [
  'simctl',
  'install',
  device,
  'ios/build/Build/Products/Debug-iphonesimulator/App.app',
])
const { stdout } = await exec('xcrun', [
  'simctl',
  'get_app_container',
  device,
  'app.loopmark.craft',
  'data',
])
const reportPath = `${stdout.trim()}/Documents/loopmark-native-results.json`
const runId = randomUUID()
await mkdir(`${stdout.trim()}/Documents`, { recursive: true })
await writeFile(`${stdout.trim()}/Documents/loopmark-native-run-id`, runId)
const reports = []
for (let pass = 0; pass < 2; pass++) {
  await unlink(reportPath).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  await run('xcrun', [
    'simctl',
    'launch',
    '--terminate-running-process',
    device,
    'app.loopmark.craft',
  ])
  let report
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      report = JSON.parse(await readFile(reportPath, 'utf8'))
      break
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  if (!report) throw new Error('Native harness did not finish in 30 seconds.')
  reports.push(report)
  if (report.platform !== 'ios' || report.results.some((result) => !result.passed))
    throw new Error(`Native assertions failed: ${JSON.stringify(report)}`)
}
if (
  reports.some((report) => report.runId !== runId) ||
  reports[0].restartPhase !== 1 ||
  reports[1].restartPhase !== 2
)
  throw new Error('Process restart did not prove a fresh run-specific phase1 to phase2 transition.')
const { stdout: installed } = await exec('xcrun', [
  'simctl',
  'get_app_container',
  device,
  'app.loopmark.craft',
  'app',
])
await verifyProductAssets(`${installed.trim()}/public`, manifest)
await writeFile(
  `${await evidenceDirectory()}/ios-runtime.json`,
  JSON.stringify(
    {
      simulator: device,
      runId,
      sourceCommit: manifest.sourceCommit,
      manifestFileSha256: manifest.manifestFileSha256,
      artifactSha256: await appDirectoryHash(installed.trim()),
      artifactFormat: 'app-directory-sha256',
      completedAt: new Date().toISOString(),
      runs: reports,
    },
    null,
    2,
  ) + '\n',
)
console.log(
  `PASS: ${reports[0].results.length} native groups, twice, including actual process relaunch.`,
)
