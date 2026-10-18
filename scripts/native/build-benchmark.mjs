import { build } from 'vite'
import { cp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { root } from './process.mjs'
if (process.env.LOOPMARK_NATIVE_BENCHMARK !== '1')
  throw new Error(
    'Set LOOPMARK_NATIVE_BENCHMARK=1 for this synthetic native benchmark bundle. Restore production assets with native:sync afterward.',
  )
const outDir = resolve(root, 'ios/benchmark-build')
await build({
  configFile: false,
  root: resolve(root, 'tests/native/benchmark'),
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
const { stdout } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })
const manifest = {
  sourceCommit: stdout.trim(),
  purpose: 'synthetic native performance fixture',
  files,
}
await mkdir(resolve(root, 'docs/evidence/expansion/native/benchmarks'), { recursive: true })
await writeFile(
  resolve(root, 'docs/evidence/expansion/native/benchmarks/bundle.json'),
  JSON.stringify(manifest, null, 2) + '\n',
)
for (const directory of ['ios/App/App/public', 'android/app/src/main/assets/public']) {
  // These directories contain generated web assets only; prevent a stale test/product bundle.
  await rm(resolve(root, directory), { recursive: true, force: true })
  await cp(outDir, resolve(root, directory), { recursive: true })
}
