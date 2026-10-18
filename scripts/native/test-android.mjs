import { run, root, androidEnvironment, evidenceDirectory } from './process.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { productManifest, verifyProductAssets, verifyProductApk } from './product-evidence.mjs'
const exec = promisify(execFile)
const serial = process.env.ANDROID_SERIAL
if (!serial || !serial.startsWith('emulator-'))
  throw new Error(
    'Set ANDROID_SERIAL to an authorized emulator. Physical-device tests are separate.',
  )
const env = { ...(await androidEnvironment()), ANDROID_SERIAL: serial }
const adb = `${env.ANDROID_HOME}/platform-tools/adb`
const manifest = await productManifest(`${root}/docs/evidence/expansion/native/harness-bundle.json`)
await verifyProductAssets(`${root}/android/app/src/main/assets/public`, manifest)
if (
  !(await readFile(`${root}/android/app/src/main/assets/public/index.html`, 'utf8')).includes(
    'native persistence fixture',
  )
)
  throw new Error(
    'Build the synthetic harness and Android debug app first; native:sync restores production assets.',
  )
await run('./gradlew', ['--no-daemon', ':app:connectedDebugAndroidTest'], {
  cwd: `${root}/android`,
  env,
})
const artifactSha256 = await verifyProductApk(
  `${root}/android/app/build/outputs/apk/debug/app-debug.apk`,
  manifest,
)
await run(adb, ['-s', serial, 'install', '-r', 'android/app/build/outputs/apk/debug/app-debug.apk'])
const reports = []
for (let pass = 0; pass < 2; pass++) {
  await run(adb, ['-s', serial, 'shell', 'am', 'force-stop', 'app.loopmark.craft'])
  await run(adb, [
    '-s',
    serial,
    'shell',
    'run-as',
    'app.loopmark.craft',
    'rm',
    '-f',
    'files/loopmark-native-results.json',
  ])
  await run(adb, ['-s', serial, 'shell', 'am', 'start', '-n', 'app.loopmark.craft/.MainActivity'])
  let report
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const { stdout } = await exec(adb, [
        '-s',
        serial,
        'shell',
        'run-as',
        'app.loopmark.craft',
        'cat',
        'files/loopmark-native-results.json',
      ])
      report = JSON.parse(stdout)
      break
    } catch {
      /* File appears when actual bridge assertions finish. */
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  if (!report) throw new Error('Native harness did not finish in 30 seconds.')
  reports.push(report)
  if (report.platform !== 'android' || report.results.some((result) => !result.passed))
    throw new Error(`Native assertions failed: ${JSON.stringify(report)}`)
}
if (reports[1].restartPhase !== 2)
  throw new Error('Process restart did not observe the durable seed.')
await writeFile(
  `${await evidenceDirectory()}/android-runtime.json`,
  JSON.stringify(
    {
      emulator: serial,
      sourceCommit: manifest.sourceCommit,
      manifestFileSha256: manifest.manifestFileSha256,
      artifactSha256,
      artifactFormat: 'apk',
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
