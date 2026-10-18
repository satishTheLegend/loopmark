#!/usr/bin/env node
// Prepared delivery procedure. Nothing runs without both explicit arguments below.
// node .gstack/deliver-canonical.mjs --execute --target-revision <full integration HEAD>
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const canonical = '/Users/lalaji/Repos/CGProjects/loopmark'
const integration = '/Users/lalaji/Repos/CGProjects/loopmark-expansion-integration'
const expectedOldPreviewPid = 88700
const previewOrigin = 'http://127.0.0.1:4173'
const frozenProduct = '2b6e628'
const qualificationPath = 'docs/evidence/expansion/I13/web/qualification.json'
const productInputs = [
  'src', 'public', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts',
  'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
  'scripts/build-sw.mjs', 'scripts/build-public-pages.mjs',
]
const titles = [
  'create, edit, capture photo, resume latest, browse immutable history, finish, reopen and delete',
  '@chromium-media simulated microphone recording and photo survive a full export and isolated-browser restore',
]
const args = process.argv.slice(2)
if (args.length !== 3 || args[0] !== '--execute' || args[1] !== '--target-revision' || !/^[a-f0-9]{40}$/.test(args[2])) {
  console.error('Prepared only. To execute after qualification: node .gstack/deliver-canonical.mjs --execute --target-revision <full integration HEAD>')
  process.exitCode = 2
} else {
  await deliver(args[2])
}

async function deliver(target) {
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const now = () => new Date().toISOString()
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  // Fresh guest build/test environment. Do not inherit cloud credentials, CI or a test port.
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SystemRoot', 'PLAYWRIGHT_BROWSERS_PATH']
      .filter((key) => process.env[key]).map((key) => [key, process.env[key]]),
  )
  Object.assign(env, { LOOPMARK_DEV_PROFILE: 'loopmark-canonical-delivery', LOOPMARK_DEV_APP_PORT: '4173' })
  delete env.CI
  delete env.LOOPMARK_TEST_PORT
  const record = {
    schemaVersion: 1, status: 'running', startedAt: now(), canonical, integration,
    targetSourceCommit: target, productSourceCommit: null, nodeVersion: process.version, commands: [], actions: [],
    limits: ['Fresh isolated Chromium contexts; existing browser data is not cleared.',
      'Microphone evidence uses the existing simulated-device test, not physical hardware.',
      'Delivery verification does not activate cloud services or payment providers.'],
  }
  let evidence
  const bufferedLogs = []
  let previewPid
  const persist = async () => {
    if (evidence) await writeFile(join(evidence, 'delivery.json'), `${JSON.stringify(record, null, 2)}\n`)
  }
  async function command(label, executable, commandArgs, { cwd = canonical, accepted = [0], timeout = 600_000 } = {}) {
    const index = record.commands.length + 1
    const logName = `${String(index).padStart(2, '0')}-${label}.log`
    const row = { label, executable, args: commandArgs, cwd, startedAt: now(), log: logName }
    record.commands.push(row)
    const began = performance.now()
    const result = await new Promise((resolveCommand) => {
      const child = spawn(executable, commandArgs, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
      const chunks = []
      let bytes = 0
      let stdout = ''
      let timedOut = false
      let errorCode
      const append = (chunk) => {
        bytes += chunk.length
        if (bytes <= 16 * 1024 * 1024) chunks.push(chunk)
        else { errorCode = 'OUTPUT_LIMIT'; child.kill('SIGTERM') }
      }
      child.stdout.on('data', (chunk) => { if (bytes + chunk.length <= 16 * 1024 * 1024) stdout += chunk.toString(); append(chunk) })
      child.stderr.on('data', append)
      child.on('error', (error) => { errorCode = error.code ?? 'SPAWN_FAILED' })
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeout)
      child.on('close', (exitCode, signal) => {
        clearTimeout(timer)
        resolveCommand({ exitCode, signal, timedOut, errorCode, stdout, log: Buffer.concat(chunks) })
      })
    })
    Object.assign(row, { finishedAt: now(), elapsedMs: Math.round(performance.now() - began),
      exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut,
      errorCode: result.errorCode ?? null, logSha256: sha(result.log) })
    if (evidence) await writeFile(join(evidence, logName), result.log)
    else bufferedLogs.push([logName, result.log])
    await persist()
    check(!result.timedOut && !result.errorCode && accepted.includes(result.exitCode), `${label} failed; see its recorded command result`)
    return result.stdout
  }
  const git = (label, commandArgs, cwd = canonical, accepted = [0]) => command(label, 'git', commandArgs, { cwd, accepted })
  async function guardCanonical() {
    check(await realpath(canonical) === canonical, 'Canonical path is not the expected real directory')
    check((await git('canonical-branch', ['branch', '--show-current'])).trim() === 'main', 'Canonical checkout is not on main')
    const status = await git('canonical-status', ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    const entries = status.split('\0').filter(Boolean)
    const ownedEvidencePrefix = evidence ? `?? ${relative(canonical, evidence)}/` : null
    check(entries.every((entry) => entry.startsWith('?? artifacts/') || (ownedEvidencePrefix && entry.startsWith(ownedEvidencePrefix))), 'Canonical has tracked changes or unapproved untracked files')
    record.initialUntrackedArtifacts ??= entries.map((entry) => entry.slice(3))
    const modules = await lstat(join(canonical, 'node_modules'))
    check(modules.isDirectory() && !modules.isSymbolicLink(), 'Canonical node_modules must be a real owned directory')
    check(await realpath(join(canonical, 'node_modules')) === join(canonical, 'node_modules'), 'Canonical node_modules resolves outside its own checkout')
    const envFiles = (await readdir(canonical)).filter((name) => name.startsWith('.env') && name !== '.env.example')
    check(envFiles.length === 0, 'Unexpected canonical .env files; review before a guest delivery build')
  }
  async function listeners(label) {
    const text = await command(label, 'lsof', ['-nP', '-iTCP:4173', '-sTCP:LISTEN', '-Fp'], { accepted: [0, 1], timeout: 10_000 })
    return [...new Set([...text.matchAll(/^p(\d+)$/gm)].map((match) => Number(match[1])))]
  }
  async function processIdentity(pid, label) {
    const text = await command(`${label}-command`, 'ps', ['-p', String(pid), '-o', 'command='], { accepted: [0, 1], timeout: 10_000 })
    if (!text.trim()) return null
    const cwd = await command(`${label}-cwd`, 'lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 10_000 })
    const started = await command(`${label}-started`, 'ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 10_000 })
    const expected = [
      `node ${canonical}/node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort`,
      `${process.execPath} ${canonical}/node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort`,
    ]
    check(expected.includes(text.trim()) && cwd.split('\n').includes(`n${canonical}`), `PID ${pid} is not the exact owned canonical preview`)
    return { pid, command: text.trim(), cwd: canonical, started: started.trim() }
  }
  async function verifyFiles(manifest, directory) {
    for (const file of manifest.productFiles) {
      check(!file.path.startsWith('/') && !file.path.split('/').includes('..'), 'Unsafe product manifest path')
      check(sha(await readFile(join(directory, file.path))) === file.sha256, `Product input differs: ${file.path}`)
    }
  }
  async function servedIndex(expectedHash) {
    const response = await fetch(`${previewOrigin}/`, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(3_000) })
    check(response.status === 200 && response.headers.get('content-type')?.includes('text/html'), 'Preview did not serve the expected HTML response')
    const hash = sha(Buffer.from(await response.arrayBuffer()))
    check(hash === expectedHash, 'Preview HTML differs from canonical dist/index.html')
    return hash
  }
  try {
    check(await realpath(integration) === integration, 'Integration path is not the expected real directory')
    await guardCanonical()
    record.initialSourceCommit = (await git('canonical-head', ['rev-parse', 'HEAD'])).trim()
    check((await git('integration-branch', ['branch', '--show-current'], integration)).trim() === 'expansion/integration', 'Unexpected integration branch')
    check((await git('integration-head', ['rev-parse', 'HEAD'], integration)).trim() === target, 'Integration moved from the explicitly selected target')
    check(!(await git('integration-tracked-status', ['status', '--porcelain=v1', '--untracked-files=no'], integration)).trim(), 'Integration tracked files are dirty')
    await git('fast-forward-check', ['merge-base', '--is-ancestor', 'HEAD', target])
    const product = (await git('frozen-product', ['rev-parse', frozenProduct], integration)).trim()
    const manifestBytes = await readFile(join(integration, qualificationPath))
    const committedManifest = await git('qualified-manifest', ['show', `${target}:${qualificationPath}`], integration)
    check(sha(manifestBytes) === sha(Buffer.from(committedManifest)), 'Qualification manifest is not the exact committed target artifact')
    const manifest = JSON.parse(manifestBytes)
    check(manifest.productSourceCommit === product && Array.isArray(manifest.productFiles) && manifest.productFiles.length > 0, 'Final frozen product qualification manifest is not ready')
    const paths = (await git('product-paths', ['ls-tree', '-r', '--name-only', target, '--', ...productInputs], integration))
      .split('\n').filter(Boolean).filter((path) => !/\.test\.tsx?$/.test(path)).sort()
    const declared = manifest.productFiles.map((file) => file.path)
    check(JSON.stringify(paths) === JSON.stringify(declared), 'Qualification manifest does not cover the exact delivery production inputs')
    const normalized = manifest.productFiles.map(({ path, sha256 }) => ({ path, sha256 }))
    check(sha(JSON.stringify(normalized)) === manifest.productFileManifestSha256, 'Product file manifest hash mismatch')
    check(!(await git('frozen-product-diff', ['diff', '--name-only', product, target, '--', ...paths], integration)).trim(), 'Selected target changes the qualified production inputs')
    await verifyFiles(manifest, integration)
    Object.assign(record, { productSourceCommit: product, qualification: { path: qualificationPath, sha256: sha(manifestBytes), status: manifest.status },
      productFileManifestSha256: manifest.productFileManifestSha256, productFiles: normalized })
    const old = await processIdentity(expectedOldPreviewPid, 'old-preview')
    const currentListeners = await listeners('initial-port-listeners')
    check(old ? currentListeners.length === 1 && currentListeners[0] === old.pid : currentListeners.length === 0, 'Port 4173 is occupied by an unexpected process')
    record.previousPreview = old
    const stamp = now().replace(/[:.]/g, '-')
    evidence = join(canonical, 'docs/evidence/expansion/delivery', `${stamp}-${target.slice(0, 7)}`)
    await mkdir(evidence, { recursive: true })
    for (const [name, bytes] of bufferedLogs) await writeFile(join(evidence, name), bytes)
    await persist()
    if (old) {
      const verified = await processIdentity(old.pid, 'old-preview-before-stop')
      check(JSON.stringify(verified) === JSON.stringify(old), 'Owned preview identity changed before stop')
      const began = performance.now()
      const startedAt = now()
      process.kill(old.pid, 'SIGTERM')
      let stopped = false
      for (let attempt = 0; attempt < 25; attempt++) {
        await pause(200)
        try { process.kill(old.pid, 0) } catch (error) { if (error.code === 'ESRCH') { stopped = true; break } else throw error }
      }
      check(stopped && (await listeners('port-after-stop')).length === 0, 'Owned preview did not stop; dependencies were not touched')
      record.actions.push({ kind: 'stop-owned-preview', pid: old.pid, signal: 'SIGTERM', startedAt, finishedAt: now(), elapsedMs: Math.round(performance.now() - began) })
      await persist()
    }
    check((await git('target-before-merge', ['rev-parse', 'refs/heads/expansion/integration'])).trim() === target, 'Integration moved before fast-forward')
    check((await git('canonical-before-merge', ['rev-parse', 'HEAD'])).trim() === record.initialSourceCommit, 'Canonical HEAD changed before fast-forward')
    await guardCanonical()
    await git('merge-fast-forward', ['merge', '--ff-only', 'expansion/integration'])
    check((await git('delivered-head', ['rev-parse', 'HEAD'])).trim() === target, 'Fast-forward selected an unexpected target')
    check(sha(await readFile(join(canonical, qualificationPath))) === sha(manifestBytes), 'Delivered qualification manifest differs from the reviewed target')
    await verifyFiles(manifest, canonical)
    const lockHash = sha(await readFile(join(canonical, 'package-lock.json')))
    check(lockHash === normalized.find((file) => file.path === 'package-lock.json')?.sha256, 'Lockfile is not the qualified lockfile')
    // Recheck immediately before npm ci: never operate through another lane's dependency link.
    const modules = await lstat(join(canonical, 'node_modules'))
    check(modules.isDirectory() && !modules.isSymbolicLink() && await realpath(join(canonical, 'node_modules')) === join(canonical, 'node_modules'), 'Canonical dependency ownership changed')
    await command('npm-ci', 'npm', ['ci', '--no-audit', '--no-fund'])
    check(sha(await readFile(join(canonical, 'package-lock.json'))) === lockHash, 'npm ci changed the lockfile')
    await command('build', 'npm', ['run', 'build'])
    await command('guest-doctor', 'npm', ['run', 'doctor', '--', '--capability', 'guest', '--json'])
    await verifyFiles(manifest, canonical)
    check((await listeners('port-before-preview')).length === 0, 'Port 4173 became occupied before preview start')
    const distHash = sha(await readFile(join(canonical, 'dist/index.html')))
    const previewLog = join(evidence, 'preview.log')
    const fd = openSync(previewLog, 'wx')
    const previewArgs = [join(canonical, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort']
    const preview = spawn(process.execPath, previewArgs, { cwd: canonical, env, detached: true, stdio: ['ignore', fd, fd] })
    let previewError
    preview.on('error', (error) => { previewError = error.code ?? 'SPAWN_FAILED' })
    previewPid = preview.pid
    preview.unref()
    closeSync(fd)
    const previewStarted = performance.now()
    record.preview = { pid: previewPid, executable: process.execPath, args: previewArgs, cwd: canonical, origin: previewOrigin,
      log: 'preview.log', startedAt: now(), distIndexSha256: distHash, intentionallyLeftRunning: true }
    await persist()
    let ready = false
    while (performance.now() - previewStarted < 30_000) {
      check(!previewError && previewPid, 'Could not start owned preview')
      try { process.kill(previewPid, 0) } catch { throw new Error('Owned preview exited before readiness') }
      try { record.preview.servedIndexSha256 = await servedIndex(distHash); ready = true; break } catch { await pause(200) }
    }
    check(ready, 'Preview did not serve the exact built index within the readiness deadline')
    Object.assign(record.preview, { readyAt: now(), readinessMs: Math.round(performance.now() - previewStarted), exitCode: null })
    record.preview.identity = await processIdentity(previewPid, 'new-preview')
    check(JSON.stringify(await listeners('new-preview-listener')) === JSON.stringify([previewPid]), 'Port 4173 listener is not the newly owned preview')
    const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const grep = `(?:${titles.map(escapeRegex).join('|')})$` // No start anchor: Playwright matches the full title path.
    const testArgs = ['run', 'test:e2e', '--', 'tests/journeys.spec.ts', '--project=chromium', '--workers=1', '--retries=0', '--reporter=list', '--grep', grep]
    const selected = await command('smoke-selection', 'npm', [...testArgs, '--list'])
    check(/Total: 2 tests? in 1 file/.test(selected) && titles.every((title) => selected.split('\n').filter((line) => line.includes('[chromium]') && line.endsWith(title)).length === 1), 'Smoke selection does not contain exactly the two intended Chromium journeys')
    record.smoke = { testSourceCommit: target, file: 'tests/journeys.spec.ts', fileSha256: sha(await readFile(join(canonical, 'tests/journeys.spec.ts'))),
      titles, project: 'chromium', workers: 1, retries: 0, existingPreviewReused: true,
      environment: { CI: 'unset', LOOPMARK_TEST_PORT: 'unset', LOOPMARK_DEV_APP_PORT: '4173' } }
    const smoke = (await command('smoke', 'npm', testArgs)).replace(/\x1b\[[0-9;]*m/g, '')
    check(/^\s*2 passed(?:\s|$)/m.test(smoke) && !/^\s*\d+ (?:failed|skipped)(?:\s|$)/m.test(smoke), 'Smoke did not report exactly two passing journeys')
    check((await git('final-head', ['rev-parse', 'HEAD'])).trim() === target, 'Canonical HEAD changed during delivery verification')
    check(!(await git('final-tracked-status', ['status', '--porcelain=v1', '--untracked-files=no'])).trim(), 'Delivery commands changed tracked files')
    await verifyFiles(manifest, canonical)
    record.preview.servedIndexSha256 = await servedIndex(distHash)
    check(JSON.stringify(await listeners('final-preview-listener')) === JSON.stringify([previewPid]), 'Final preview ownership changed')
    record.preview.identity = await processIdentity(previewPid, 'final-preview')
    record.preview.logSha256AtCompletion = sha(await readFile(previewLog))
    record.smoke.passed = 2
    record.status = 'passed'
  } catch (error) {
    record.status = 'failed'
    record.failure = error.message
    process.exitCode = 1
  } finally {
    record.finishedAt = now()
    if (record.preview) record.preview.intentionallyLeftRunning = true
    await persist()
    console.log(JSON.stringify({ status: record.status, targetSourceCommit: target,
      productSourceCommit: record.productSourceCommit, evidence: evidence ? relative(canonical, evidence) : null,
      previewPid: previewPid ?? null, previewOrigin: previewPid ? previewOrigin : null,
      failure: record.failure ?? null }, null, 2))
  }
}
