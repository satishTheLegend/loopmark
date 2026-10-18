import { run, root, androidEnvironment } from './process.mjs'
if (process.env.LOOPMARK_NATIVE_BENCHMARK !== '1')
  throw new Error('Explicit LOOPMARK_NATIVE_BENCHMARK=1 is required.')
const platform = process.argv[2]
if (platform === 'ios') {
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
    'LOOPMARK_APP_BUNDLE_ID=app.loopmark.craft.benchmark',
    'CODE_SIGNING_ALLOWED=YES',
    'CODE_SIGN_IDENTITY=-',
    'CODE_SIGN_STYLE=Manual',
    'DEVELOPMENT_TEAM=',
    'build',
  ])
} else if (platform === 'android') {
  await run('./gradlew', ['--no-daemon', '-PloopmarkBenchmark', ':app:assembleDebug'], {
    cwd: `${root}/android`,
    env: await androidEnvironment(),
  })
} else throw new Error('Choose ios or android explicitly.')
