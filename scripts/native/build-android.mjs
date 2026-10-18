import { run, root, androidEnvironment } from './process.mjs'
await run('./gradlew', ['--no-daemon', ':app:assembleDebug'], {
  cwd: `${root}/android`,
  env: await androidEnvironment(),
})
