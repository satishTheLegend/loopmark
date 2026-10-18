import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { root, androidEnvironment, evidenceDirectory } from './process.mjs'
import { productManifest, verifyProductApk } from './product-evidence.mjs'

const serial = process.env.ANDROID_SERIAL
if (!serial?.startsWith('emulator-')) throw new Error('Select a test-owned emulator explicitly.')
const exec = promisify(execFile),
  env = await androidEnvironment()
const adb = (...args) => exec(`${env.ANDROID_HOME}/platform-tools/adb`, ['-s', serial, ...args])
const manifest = await productManifest(`${root}/docs/evidence/expansion/native/product-bundle.json`)
const artifactSha256 = await verifyProductApk(
  `${root}/android/app/build/outputs/apk/debug/app-debug.apk`,
  manifest,
)
const appId = 'app.loopmark.craft',
  senderId = 'app.loopmark.craft.benchmark.test',
  port = 9234,
  tag = randomUUID()
let browser
const check = (value, message) => {
  if (!value) throw new Error(message)
}
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const { stdout } = await adb('shell', 'pidof', appId)
      await adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${stdout.trim()}`)
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
      const page = browser.contexts()[0].pages()[0]
      if (!page) throw new Error('No WebView')
      page.setDefaultTimeout(30_000)
      return page
    } catch {
      await browser?.close().catch(() => {})
      await new Promise((done) => setTimeout(done, 250))
    }
  }
  throw new Error('Product WebView unavailable')
}
async function send(kind, extras = []) {
  await adb(
    'shell',
    'am',
    'start',
    '-W',
    '-n',
    `${senderId}/app.loopmark.craft.BackupSenderActivity`,
    '--es',
    'target',
    appId,
    '--es',
    'kind',
    kind,
    '--es',
    'tag',
    tag,
    ...extras,
  )
}
async function restart() {
  await browser?.close()
  await adb('shell', 'am', 'force-stop', appId)
  await adb('shell', 'am', 'start', '-n', `${appId}/.MainActivity`)
  return connect()
}
async function countCollections(page) {
  await page.getByRole('button', { name: 'Change collection', exact: true }).click()
  const count = await page.locator('.collection-option').count()
  await page.getByRole('button', { name: 'Keep current collection', exact: true }).click()
  return count
}
try {
  // The previously built test APK is a separate UID and grants access through the OS.
  check(
    (await adb('shell', 'pm', 'path', senderId)).stdout.startsWith('package:'),
    'Install the synthetic sender test APK first',
  )
  let page = await restart()
  await page.getByRole('button', { name: 'Change collection', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Change collection', exact: true }).click()
  const personal = page.locator('.collection-option').filter({
    has: page.getByText('Personal projects', { exact: true }),
  })
  if (await personal.count()) await personal.click()
  else await page.getByRole('button', { name: 'Keep current collection', exact: true }).click()
  const sourceName = await page.locator('.collection-heading strong').textContent()
  const before = await countCollections(page)
  await send('valid')
  const notice = () => page.getByRole('region', { name: 'Incoming backup file' })
  await notice().getByRole('button', { name: 'Review backup file', exact: true }).click()
  await page.getByRole('dialog', { name: 'Restore this little collection?' }).waitFor()
  check(
    (await countSafeProjects(page)) === '1 projects · 1 checkpoints',
    'External preview content differs',
  )
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  page = await restart()
  await notice().getByRole('button', { name: 'Review backup file', exact: true }).click()
  await page.getByRole('dialog', { name: 'Restore this little collection?' }).waitFor()
  await send('other') // A second file creates a notice while the original explicit preview stays open.
  await page.getByRole('button', { name: 'Restore as separate collection', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  // Restore keeps the maker on Backup & restore. Navigate through the product UI.
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.getByRole('button', { name: /^My projects/ }).click()
  await page.getByRole('button', { name: `Pick up External valid ${tag}`, exact: true }).waitFor()
  await notice().getByText('This incoming file could not be prepared.', { exact: false }).waitFor()
  await notice().getByRole('button', { name: 'Dismiss backup file', exact: true }).click()
  check(
    (await countCollections(page)) === before + 1,
    'Restore did not create exactly one separate collection',
  )
  await send('valid', ['--ez', 'send', 'true'])
  await notice()
    .getByRole('heading', { name: 'Backup file already handled', exact: true })
    .waitFor()
  await notice().getByRole('button', { name: 'Dismiss backup file', exact: true }).click()
  page = await restart()
  await page.getByRole('button', { name: `Pick up External valid ${tag}`, exact: true }).waitFor()
  check(
    (await countCollections(page)) === before + 1,
    'Repeated intent duplicated recovered collection',
  )
  await page.getByRole('button', { name: 'Change collection', exact: true }).click()
  await page
    .locator('.collection-option')
    .filter({ has: page.locator('strong', { hasText: sourceName }) })
    .first()
    .click()
  check(
    (await page.locator('.collection-heading strong').textContent()) === sourceName,
    'Original collection not preserved',
  )
  await send('invalid')
  await notice().getByRole('button', { name: 'Review backup file', exact: true }).click()
  await notice().getByRole('button', { name: 'Review backup file', exact: true }).waitFor()
  check(
    (await page.getByRole('dialog').count()) === 0,
    'Malformed backup opened a restore confirmation',
  )
  await notice().getByRole('button', { name: 'Dismiss backup file', exact: true }).click()
  await send('oversized')
  await notice().getByText('This incoming file could not be prepared.', { exact: false }).waitFor()
  await notice().getByRole('button', { name: 'Dismiss backup file', exact: true }).click()
  check((await countCollections(page)) === before + 1, 'Rejected external file changed collections')
  await writeFile(
    `${await evidenceDirectory()}/android-inbox-product.json`,
    JSON.stringify(
      {
        sourceCommit: manifest.sourceCommit,
        manifestFileSha256: manifest.manifestFileSha256,
        artifactSha256,
        platform: 'android',
        emulator: serial,
        completedAt: new Date().toISOString(),
        passed: true,
        assertions: [
          'separate-UID OS content read grant and VIEW delivery',
          'explicit full preview, cancel and process relaunch',
          'unrelated second-file notice does not block reviewed completion',
          'separate collection and original preserved',
          'SEND of same file and relaunch do not duplicate import',
          'malformed and oversized files fail safely',
        ],
      },
      null,
      2,
    ) + '\n',
  )
  console.log('PASS: actual Android external backup product journey')
} finally {
  await browser?.close().catch(() => {})
  await adb('forward', '--remove', `tcp:${port}`).catch(() => {})
}
async function countSafeProjects(page) {
  return (await page.locator('.restore-preview strong').textContent()).trim()
}
