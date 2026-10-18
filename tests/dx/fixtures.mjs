import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
export const root = resolve(import.meta.dirname, '../..')
export async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'loopmark-dx-'))
  const write = async (name, text, mode) => {
    const path = resolve(directory, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text, mode ? { mode } : undefined)
  }
  for (const file of [
    'package.json',
    'package-lock.json',
    'index.html',
    'src/main.tsx',
    'node_modules/vite/bin/vite.js',
  ])
    await write(file, '{}')
  await write('bin/npm', '#!/bin/sh\necho 10.0.0\n', 0o700)
  const environment = {
    PATH: resolve(directory, 'bin'),
    LOOPMARK_DEV_PROFILE: 'dx-fixture',
    LOOPMARK_DEV_APP_PORT: '49380',
    LOOPMARK_DEV_API_PORT: '49381',
    LOOPMARK_DEV_DB_PORT: '49382',
    LOOPMARK_DEV_STUDIO_PORT: '49383',
    LOOPMARK_DEV_MAIL_PORT: '49384',
  }
  return {
    directory,
    write,
    environment,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}
export async function copyLocalLauncher(fixture) {
  const visited = new Set()
  async function copy(name) {
    if (visited.has(name)) return
    visited.add(name)
    const source = await readFile(resolve(root, name), 'utf8')
    await fixture.write(name, source)
    for (const [, target] of source.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
      const path = resolve(dirname(name), target)
      const relative = path.slice(root.length + 1)
      if (!path.startsWith(root + '/')) throw new Error('Fixture import escaped repository')
      await copy(relative)
    }
  }
  await copy('scripts/local.mjs')
  await symlink(resolve(root, 'node_modules/zod'), resolve(fixture.directory, 'node_modules/zod'))
}
