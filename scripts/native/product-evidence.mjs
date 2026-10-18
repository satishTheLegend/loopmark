import { createHash } from 'node:crypto'
import { readFile, readdir, lstat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
const exec = promisify(execFile)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

export async function productManifest(path) {
  const raw = await readFile(path)
  const value = JSON.parse(raw.toString('utf8'))
  if (
    !/^[a-f0-9]{7,40}$/.test(value.sourceCommit ?? '') ||
    !value.files ||
    typeof value.files !== 'object' ||
    Array.isArray(value.files) ||
    !Object.hasOwn(value.files, 'index.html') ||
    Object.keys(value.files).length > 500 ||
    Object.entries(value.files).some(
      ([path, hash]) =>
        !/^[A-Za-z0-9_.\/-]+$/.test(path) ||
        path.startsWith('/') ||
        path.split('/').some((part) => !part || part === '.' || part === '..') ||
        !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new Error('Invalid product bundle manifest.')
  return { ...value, manifestFileSha256: digest(raw) }
}
export async function verifyProductAssets(directory, manifest) {
  for (const [path, expected] of Object.entries(manifest.files)) {
    if (digest(await readFile(join(directory, path))) !== expected)
      throw new Error(`Product asset differs from recorded bundle: ${path}`)
  }
}
export async function verifyProductApk(apk, manifest) {
  for (const [path, expected] of Object.entries(manifest.files)) {
    const { stdout } = await exec('unzip', ['-p', apk, `assets/public/${path}`], {
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
    })
    if (digest(stdout) !== expected)
      throw new Error(`APK asset differs from recorded bundle: ${path}`)
  }
  return digest(await readFile(apk))
}
/** Stable digest of every regular file in the installed app, including native executables and web assets. */
export async function appDirectoryHash(directory) {
  const files = {}
  async function visit(relative = '') {
    for (const name of (await readdir(join(directory, relative))).sort()) {
      const path = relative ? `${relative}/${name}` : name
      const info = await lstat(join(directory, path))
      if (info.isDirectory()) await visit(path)
      else if (info.isFile()) files[path] = digest(await readFile(join(directory, path)))
      else throw new Error('Unexpected non-regular app artifact.')
    }
  }
  await visit()
  return digest(JSON.stringify(files))
}
