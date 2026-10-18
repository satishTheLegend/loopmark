import { run, root } from './process.mjs'
const harness = process.env.LOOPMARK_NATIVE_TEST_BUILD === '1'
await run('xcodebuild', [
  '-project',
  'ios/App/App.xcodeproj',
  '-scheme',
  'App',
  '-sdk',
  'iphonesimulator',
  '-configuration',
  'Debug',
  '-derivedDataPath',
  'ios/build',
  ...(harness
    ? [
        'CODE_SIGNING_ALLOWED=YES',
        'CODE_SIGN_IDENTITY=-',
        'CODE_SIGN_STYLE=Manual',
        'DEVELOPMENT_TEAM=',
        `CODE_SIGN_ENTITLEMENTS=${root}/tests/native/ios/persistence/simulator-entitlements.plist`,
      ]
    : ['CODE_SIGNING_ALLOWED=NO']),
  'build',
])
