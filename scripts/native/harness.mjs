import { build } from 'vite'
import { cp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { root } from './process.mjs'
if (process.env.LOOPMARK_NATIVE_TEST_BUILD !== '1')
  throw new Error(
    'Set LOOPMARK_NATIVE_TEST_BUILD=1 to replace generated native web assets with synthetic tests; run native:sync to restore production assets.',
  )
await build({
  configFile: false,
  root: resolve(root, 'tests/native/harness'),
  build: { target: 'es2022', outDir: resolve(root, 'ios/harness-build'), emptyOutDir: true },
})
await cp(resolve(root, 'ios/harness-build'), resolve(root, 'ios/App/App/public'), {
  recursive: true,
})
await cp(resolve(root, 'ios/harness-build'), resolve(root, 'android/app/src/main/assets/public'), {
  recursive: true,
})
