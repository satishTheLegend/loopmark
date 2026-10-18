import { run, root, evidenceDirectory } from './process.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { productManifest, verifyProductAssets, appDirectoryHash } from './product-evidence.mjs'
const device = process.env.LOOPMARK_IOS_SIMULATOR
if (!device) throw new Error('Select an explicit test-owned simulator with LOOPMARK_IOS_SIMULATOR.')
const manifest = await productManifest(`${root}/docs/evidence/expansion/native/product-bundle.json`)
await verifyProductAssets(`${root}/ios/App/App/public`, manifest)
if (
  (await readFile(`${root}/ios/App/App/public/index.html`, 'utf8')).includes(
    'native persistence fixture',
  )
)
  throw new Error('Production assets are required for native product UI tests.')
// Establish an actual OS-denied state on this explicitly selected fixture simulator.
// Avoid XCTest's default alert handler, which may grant microphone access automatically.
await run('xcrun', ['simctl', 'privacy', device, 'revoke', 'microphone', 'app.loopmark.craft'])
await run('xcodebuild', [
  '-project',
  'ios/App/App.xcodeproj',
  '-scheme',
  'LoopmarkUITests',
  '-sdk',
  'iphonesimulator',
  '-configuration',
  'Debug',
  '-derivedDataPath',
  'ios/build',
  '-destination',
  `platform=iOS Simulator,id=${device}`,
  'CODE_SIGNING_ALLOWED=YES',
  'CODE_SIGN_IDENTITY=-',
  'CODE_SIGN_STYLE=Manual',
  'DEVELOPMENT_TEAM=',
  `CODE_SIGN_ENTITLEMENTS=${root}/tests/native/ios/persistence/simulator-entitlements.plist`,
  '-only-testing:LoopmarkUITests/ProductFlows',
  'test',
])

const { stdout: installed } = await promisify(execFile)('xcrun', [
  'simctl',
  'get_app_container',
  device,
  'app.loopmark.craft',
  'app',
])
await verifyProductAssets(`${installed.trim()}/public`, manifest)
const artifactSha256 = await appDirectoryHash(installed.trim())
await writeFile(
  `${await evidenceDirectory()}/ios-product.json`,
  JSON.stringify(
    {
      simulator: device,
      passed: true,
      completedAt: new Date().toISOString(),
      bundle: manifest.manifestSha256,
      sourceCommit: manifest.sourceCommit,
      manifestFileSha256: manifest.manifestFileSha256,
      artifactSha256,
      artifactFormat: 'app-directory-sha256',
      assertions: [
        'project creation',
        'text-only draft',
        'native camera cancel',
        'OS-denied microphone',
        'checkpoint save',
        'terminate and relaunch with saved next step',
        'account navigation',
        'redacted native diagnostic preview and OS share-sheet cancellation',
      ],
    },
    null,
    2,
  ) + '\n',
)
