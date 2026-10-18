import { build } from 'vite'
import { cp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { root, evidenceDirectory } from './process.mjs'
if (process.env.LOOPMARK_NATIVE_TEST_BUILD !== '1')
  throw new Error(
    'Set LOOPMARK_NATIVE_TEST_BUILD=1 to replace generated native web assets with synthetic tests; run native:sync to restore production assets.',
  )
const outDir = resolve(root, 'ios/harness-build')
const exec = promisify(execFile)
const { stdout: changes } = await exec(
  'git',
  [
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    'src',
    'tests/native',
    'scripts/native',
    'ios/App',
    'android/app/src/main',
  ],
  { cwd: root },
)
if (changes.trim())
  throw new Error(
    'Commit the native fixture and relevant product sources before recording a source-bound harness.',
  )
await build({
  configFile: false,
  root: resolve(root, 'tests/native/harness'),
  build: { target: 'es2022', outDir, emptyOutDir: true },
})
const files = {}
async function scan(relative = '') {
  for (const entry of await readdir(resolve(outDir, relative), { withFileTypes: true })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) await scan(path)
    else
      files[path] = createHash('sha256')
        .update(await readFile(resolve(outDir, path)))
        .digest('hex')
  }
}
await scan()
const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root })
await writeFile(
  resolve(await evidenceDirectory(), 'harness-bundle.json'),
  JSON.stringify(
    {
      sourceCommit: stdout.trim(),
      purpose: 'synthetic native persistence and boundary qualification',
      files,
    },
    null,
    2,
  ) + '\n',
)
for (const directory of ['ios/App/App/public', 'android/app/src/main/assets/public']) {
  // These paths contain generated web assets only; remove obsolete product/harness bundles.
  await rm(resolve(root, directory), { recursive: true, force: true })
  await cp(outDir, resolve(root, directory), { recursive: true })
}
