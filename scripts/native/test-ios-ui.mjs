import { run, root } from './process.mjs'
import { readFile } from 'node:fs/promises'
const device = process.env.LOOPMARK_IOS_SIMULATOR
if (!device) throw new Error('Select an explicit test-owned simulator with LOOPMARK_IOS_SIMULATOR.')
if (
  !(await readFile(`${root}/ios/App/App/public/index.html`, 'utf8')).includes(
    'native persistence fixture',
  )
)
  throw new Error('Build the synthetic native harness before running OS sheet UI tests.')
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
  'test',
])
