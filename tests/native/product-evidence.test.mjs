import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  productManifest,
  verifyProductAssets,
  verifyProductApk,
  appDirectoryHash,
} from '../../scripts/native/product-evidence.mjs'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'loopmark-product-evidence-'))
  const assets = join(root, 'assets/public')
  await mkdir(assets, { recursive: true })
  await writeFile(join(assets, 'index.html'), 'synthetic product')
  const manifest = {
    sourceCommit: 'a'.repeat(40),
    files: { 'index.html': digest('synthetic product') },
  }
  const path = join(root, 'manifest.json')
  await writeFile(path, JSON.stringify(manifest))
  try {
    await run({ root, assets, path, manifest })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
test('manifest rejects traversal and hashes the exact file used as evidence', () =>
  fixture(async ({ path, manifest }) => {
    assert.equal((await productManifest(path)).manifestFileSha256, digest(await readFile(path)))
    manifest.files['../outside'] = digest('anything')
    await writeFile(path, JSON.stringify(manifest))
    await assert.rejects(productManifest(path), /Invalid product bundle/)
  }))
test('changed generated assets cannot be attributed to the original bundle', () =>
  fixture(async ({ assets, manifest }) => {
    await verifyProductAssets(assets, manifest)
    await writeFile(join(assets, 'index.html'), 'stale harness')
    await assert.rejects(verifyProductAssets(assets, manifest), /differs from recorded/)
  }))
test('packaged APK assets must match and returned artifact digest covers APK bytes', () =>
  fixture(async ({ root, manifest }) => {
    const apk = join(root, 'test.apk')
    await promisify(execFile)('zip', ['-q', apk, 'assets/public/index.html'], { cwd: root })
    assert.equal(await verifyProductApk(apk, manifest), digest(await readFile(apk)))
    manifest.files['index.html'] = digest('different bundle')
    await assert.rejects(verifyProductApk(apk, manifest), /APK asset differs/)
  }))
test('installed app digest changes for native bytes and refuses untracked symlink targets', () =>
  fixture(async ({ root }) => {
    await writeFile(join(root, 'executable'), 'native one')
    const before = await appDirectoryHash(root)
    await writeFile(join(root, 'executable'), 'native two')
    assert.notEqual(await appDirectoryHash(root), before)
    await symlink('/etc/hosts', join(root, 'unexpected'))
    await assert.rejects(appDirectoryHash(root), /non-regular app/)
  }))
