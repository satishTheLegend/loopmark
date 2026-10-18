import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { androidEnvironment, evidenceDirectory, root } from './process.mjs'
import { productManifest, verifyProductApk } from './product-evidence.mjs'

const exec = promisify(execFile)
const serial = process.env.ANDROID_SERIAL
if (!serial?.startsWith('emulator-') || process.env.LOOPMARK_ANDROID_SYNTHETIC_AUDIO !== '1')
  throw new Error(
    'Select a test-owned emulator started with -no-audio and explicitly set LOOPMARK_ANDROID_SYNTHETIC_AUDIO=1.',
  )
const env = await androidEnvironment(),
  adbPath = `${env.ANDROID_HOME}/platform-tools/adb`
const adb = (...args) => exec(adbPath, ['-s', serial, ...args])
const manifest = await productManifest(`${root}/docs/evidence/expansion/native/harness-bundle.json`)
const apk = `${root}/android/app/build/outputs/apk/debug/app-debug.apk`
const artifactSha256 = await verifyProductApk(apk, manifest)
const { stdout: processes } = await exec('ps', ['-axo', 'command='])
const port = serial.slice('emulator-'.length)
if (
  !processes
    .split('\n')
    .some(
      (line) =>
        line.includes('qemu') && line.includes(`-port ${port}`) && line.includes('-no-audio'),
    )
)
  throw new Error('The selected local emulator process is not visibly configured with -no-audio.')
const packageId = 'app.loopmark.craft',
  cdpPort = 9236
let browser
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function flows() {
  try {
    const { stdout } = await adb(
      'shell',
      'run-as',
      packageId,
      'cat',
      'files/loopmark-native-flow-results.json',
    )
    return JSON.parse(stdout)
  } catch {
    return []
  }
}
async function waitForFlow(action, status, length) {
  for (let i = 0; i < 100; i++) {
    const value = await flows()
    if (value.length >= length) {
      const last = value[length - 1]
      if (last.action !== action || last.status !== status)
        throw new Error(`Unexpected native audio boundary result: ${JSON.stringify(last)}`)
      return value
    }
    await delay(100)
  }
  throw new Error(`Native ${action} did not finish.`)
}
try {
  await adb('install', '-r', apk)
  await adb('shell', 'am', 'force-stop', packageId)
  await adb(
    'shell',
    'pm',
    'clear-permission-flags',
    packageId,
    'android.permission.RECORD_AUDIO',
    'user-set',
    'user-fixed',
  )
  await adb('shell', 'pm', 'grant', packageId, 'android.permission.RECORD_AUDIO')
  await adb('shell', 'run-as', packageId, 'rm', '-f', 'files/loopmark-native-flow-results.json')
  await adb('shell', 'am', 'start', '-n', `${packageId}/.MainActivity`)
  let page
  for (let i = 0; i < 60; i++) {
    try {
      const { stdout } = await adb('shell', 'pidof', packageId)
      await adb(
        'forward',
        `tcp:${cdpPort}`,
        `localabstract:webview_devtools_remote_${stdout.trim()}`,
      )
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { noDefaults: true })
      page = browser.contexts()[0].pages()[0]
      if (!page) throw new Error('WebView not ready')
      break
    } catch {
      await browser?.close().catch(() => {})
      await delay(200)
    }
  }
  if (!page) throw new Error('Native harness WebView did not open.')
  await page.getByText('Native UI fixtures ready', { exact: true }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Record fixture', exact: true }).click()
  await waitForFlow('audio-start', 'ok', 1)
  await delay(750)
  await page.getByRole('button', { name: 'Stop fixture', exact: true }).click()
  const stopped = (await waitForFlow('audio-stop', 'ok', 2))[1]
  if (!(stopped.bytes > 0) || stopped.type !== 'audio/mp4')
    throw new Error('Foreground recording did not return nonempty MP4 audio.')
  await page.getByRole('button', { name: 'Record fixture', exact: true }).click()
  await waitForFlow('audio-start', 'ok', 3)
  await delay(750)
  await adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
  const result = await waitForFlow('audio-interrupted', 'ok', 4)
  if (!(result[3].bytes > 0) || result[3].type !== 'audio/mp4')
    throw new Error('Actual background interruption did not return nonempty MP4 audio.')
  await writeFile(
    `${await evidenceDirectory()}/android-audio-flows.json`,
    JSON.stringify(
      {
        schemaVersion: 1,
        emulator: serial,
        sourceCommit: manifest.sourceCommit,
        manifestFileSha256: manifest.manifestFileSha256,
        artifactSha256,
        artifactFormat: 'apk',
        completedAt: new Date().toISOString(),
        passed: true,
        scope:
          'Actual Android recorder and HOME/background lifecycle; test-owned emulator with host audio disabled (-no-audio). Synthetic recording only; no microphone fidelity, iOS recording, lock/call interruption or physical-device qualification.',
        flows: result,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(
    'PASS: native Android foreground recording and actual background interruption return nonempty MP4 bytes.',
  )
} finally {
  await browser?.close().catch(() => {})
  await adb('forward', '--remove', `tcp:${cdpPort}`).catch(() => {})
  await adb('shell', 'pm', 'revoke', packageId, 'android.permission.RECORD_AUDIO').catch(() => {})
}
