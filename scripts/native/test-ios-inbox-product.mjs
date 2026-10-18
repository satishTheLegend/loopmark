import { writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { run, root, evidenceDirectory } from './process.mjs'
import { productManifest, verifyProductAssets, appDirectoryHash } from './product-evidence.mjs'

const device = process.env.LOOPMARK_IOS_SIMULATOR
if (!device || !/^[A-Fa-f0-9-]{36}$/.test(device))
  throw new Error('Select an explicit test-owned iOS simulator.')
const manifest = await productManifest(`${root}/docs/evidence/expansion/native/product-bundle.json`)
await verifyProductAssets(`${root}/ios/App/App/public`, manifest)
await run('xcodebuild', [
  '-project', 'ios/App/App.xcodeproj', '-scheme', 'LoopmarkUITests',
  '-sdk', 'iphonesimulator', '-configuration', 'Debug', '-derivedDataPath', 'ios/build',
  '-destination', `platform=iOS Simulator,id=${device}`,
  'LOOPMARK_APP_BUNDLE_ID=app.loopmark.craft',
  'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'CODE_SIGN_STYLE=Manual', 'DEVELOPMENT_TEAM=',
  `CODE_SIGN_ENTITLEMENTS=${root}/tests/native/ios/persistence/simulator-entitlements.plist`,
  '-only-testing:LoopmarkUITests/InboxProductFlows/testExternalBackupReviewCancelRelaunchRestoreAndRepeat',
  'test',
])
const { stdout } = await promisify(execFile)('xcrun', [
  'simctl', 'get_app_container', device, 'app.loopmark.craft', 'app',
])
await verifyProductAssets(`${stdout.trim()}/public`, manifest)
await writeFile(`${await evidenceDirectory()}/ios-inbox-product.json`, JSON.stringify({
  schemaVersion: 1,
  simulator: device,
  sourceCommit: manifest.sourceCommit,
  manifestFileSha256: manifest.manifestFileSha256,
  artifactSha256: await appDirectoryHash(stdout.trim()),
  artifactFormat: 'app-directory-sha256',
  passed: true,
  completedAt: new Date().toISOString(),
  assertions: [
    'OS file URL opens the production app and presents review without importing',
    'cancel and process relaunch preserve the pending file',
    'explicit confirmation restores a separate collection',
    'repeated same file produces handled notice; relaunch has one restored project',
  ],
  limitation: 'Simulator OS delivery only; physical document providers remain an operator qualification gate.',
}, null, 2) + '\n')
