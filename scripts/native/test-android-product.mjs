import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { root, androidEnvironment, evidenceDirectory } from './process.mjs'
import { productManifest, verifyProductAssets, verifyProductApk } from './product-evidence.mjs'

const exec = promisify(execFile)
const serial = process.env.ANDROID_SERIAL
if (!serial?.startsWith('emulator-')) throw new Error('Select a test-owned emulator explicitly.')
const manifest = await productManifest(`${root}/docs/evidence/expansion/native/product-bundle.json`)
await verifyProductAssets(`${root}/android/app/src/main/assets/public`, manifest)
const apk = `${root}/android/app/build/outputs/apk/debug/app-debug.apk`
const artifactSha256 = await verifyProductApk(apk, manifest)
const html = await readFile(`${root}/android/app/src/main/assets/public/index.html`, 'utf8')
if (html.includes('native persistence fixture')) throw new Error('Production assets are required.')
const env = await androidEnvironment()
const adbPath = `${env.ANDROID_HOME}/platform-tools/adb`
const adb = (...args) => exec(adbPath, ['-s', serial, ...args])
const name = 'Android native QA scarf'
const nextStep = 'Start row 24 with the 4 mm hook'
const port = 9233
let browser
async function connect() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const { stdout } = await adb('shell', 'pidof', 'app.loopmark.craft')
      await adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${stdout.trim()}`)
      // Android WebView does not implement Browser.setDownloadBehavior.
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
      const page = browser.contexts()[0].pages()[0]
      if (!page) throw new Error('WebView not ready')
      page.setDefaultTimeout(60_000)
      return page
    } catch {
      await browser?.close().catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  throw new Error('Production WebView did not become available.')
}

try {
  // Install the exact verified artifact; a previous emulator install is not source evidence.
  await adb('install', '-r', apk)
  // Actual OS-denied permission, scoped to this fixture app and emulator.
  await adb('shell', 'pm', 'revoke', 'app.loopmark.craft', 'android.permission.RECORD_AUDIO')
  await adb(
    'shell',
    'pm',
    'set-permission-flags',
    'app.loopmark.craft',
    'android.permission.RECORD_AUDIO',
    'user-set',
    'user-fixed',
  )
  await adb('shell', 'am', 'force-stop', 'app.loopmark.craft')
  await adb('shell', 'am', 'start', '-n', 'app.loopmark.craft/.MainActivity')
  let page = await connect()
  await page.getByRole('button', { name: 'New project', exact: true }).waitFor()
  const existing = page.getByRole('button', { name: `Pick up ${name}`, exact: true })
  if (await existing.count()) await existing.click()
  else {
    await page.getByRole('button', { name: 'New project', exact: true }).click()
    await page.getByRole('dialog').getByLabel('Project name', { exact: true }).fill(name)
    await page.getByRole('dialog').getByLabel('Hook or needle size', { exact: true }).fill('4 mm')
    await page.getByRole('button', { name: 'Create project', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByLabel(/^What will you do next\?/)
    .fill(nextStep)
  await page
    .getByRole('dialog')
    .getByLabel('Current row or repeat', { exact: true })
    .fill('Row 23 complete')
  await page.getByRole('button', { name: /^Add a photo/ }).click()
  await adb('shell', 'uiautomator', 'dump', '/sdcard/loopmark-product.xml')
  const { stdout: sheet } = await adb('shell', 'cat', '/sdcard/loopmark-product.xml')
  if (!sheet.includes('Choose photo') || !sheet.includes('Take photo'))
    throw new Error('Native camera source sheet not shown.')
  await adb('shell', 'input', 'keyevent', '4')
  await page.getByRole('button', { name: 'Record a quick note', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByText(/Permission is needed/)
    .waitFor()
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByText(nextStep, { exact: true }).first().waitFor()
  await browser.close()
  await adb('shell', 'am', 'force-stop', 'app.loopmark.craft')
  await adb('shell', 'am', 'start', '-n', 'app.loopmark.craft/.MainActivity')
  page = await connect()
  await page.getByText(nextStep, { exact: true }).first().waitFor()
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.getByRole('button', { name: 'Account & device', exact: true }).click()
  await page.getByRole('heading', { name: 'Your account', exact: true }).waitFor()
  await page
    .getByText('Account connection is unavailable in this copy of Loopmark.', { exact: false })
    .waitFor()
  await adb('shell', 'input', 'keyevent', '4')
  await page
    .getByRole('heading', { name: 'Your projects, patiently waiting.', exact: true })
    .waitFor()
  await writeFile(
    `${await evidenceDirectory()}/android-product.json`,
    JSON.stringify(
      {
        emulator: serial,
        passed: true,
        completedAt: new Date().toISOString(),
        bundle: manifest.manifestSha256,
        sourceCommit: manifest.sourceCommit,
        manifestFileSha256: manifest.manifestFileSha256,
        artifactSha256,
        artifactFormat: 'apk',
        assertions: [
          'project creation or fixture reopen',
          'text-only draft',
          'native camera cancel',
          'OS-denied microphone',
          'checkpoint save',
          'process relaunch and saved next step',
          'account unavailable without configuration',
          'hardware back to workbasket',
        ],
      },
      null,
      2,
    ) + '\n',
  )
  console.log('PASS: production Android checkpoint, permissions, relaunch and account navigation.')
} finally {
  await browser?.close().catch(() => {})
  await adb('forward', '--remove', `tcp:${port}`).catch(() => {})
}
