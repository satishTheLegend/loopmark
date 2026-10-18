import { cp, mkdir, readFile, rm, readdir, open } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { OpsError, run, durableJson, uuid } from './common.mjs'
// The preceding qualified, additive protocol-2 server artifact. Never downgrade SQL.
export const compatibleRevision = '967cc65'
async function treeHash(directory) {
  const digest = createHash('sha256')
  async function walk(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = resolve(path, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile() && entry.name !== '.env') {
        digest.update(relative(directory, absolute))
        digest.update(await readFile(absolute))
      }
    }
  }
  await walk(directory)
  return digest.digest('hex')
}
async function restart(ctx) {
  const name = `supabase_edge_runtime_${ctx.config.projectId}`
  const label = (
    await run('docker', [
      'inspect',
      '--format',
      '{{index .Config.Labels "com.supabase.cli.project"}}',
      name,
    ])
  )
    .toString()
    .trim()
  if (label !== ctx.config.projectId) throw new OpsError('NOT_AVAILABLE')
  await run('docker', ['restart', name], { timeout: 30000 })
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(ctx.url + '/functions/v1/account-session', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(1000),
      })
      await response.body?.cancel()
      if (response.status === 401) return
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new OpsError('SERVICE_UNAVAILABLE')
}
export async function rollbackCheck(ctx, { verify = async () => {}, signal } = {}) {
  if (signal?.aborted) throw new OpsError('CANCELLED')
  const started = Date.now(),
    id = randomUUID(),
    directory = resolve('.gstack/rollback', ctx.config.profile, id),
    runtime = resolve(ctx.runtime, 'supabase/functions'),
    current = resolve(directory, 'current'),
    prior = resolve(directory, 'prior')
  const lock = resolve('.gstack/rollback', ctx.config.profile, 'lock')
  await mkdir(resolve(lock, '..'), { recursive: true, mode: 0o700 })
  await mkdir(lock, { mode: 0o700 }).catch((error) => {
    if (error.code === 'EEXIST') throw new OpsError('RATE_LIMITED')
    throw error
  })
  let mutated = false,
    restored = false
  try {
    await durableJson(resolve(lock, 'journal.json'), {
      id,
      pid: process.pid,
      projectId: ctx.config.projectId,
      currentHash: null,
    })
    await mkdir(prior, { recursive: true, mode: 0o700 })
    await cp(runtime, current, { recursive: true })
    const currentHash = await treeHash(current),
      archive = await run('git', ['archive', compatibleRevision, 'supabase/functions'], {
        maxBytes: 16 * 1024 * 1024,
        signal,
      })
    await run('tar', ['-x', '-C', prior], { input: archive, signal })
    const candidate = resolve(prior, 'supabase/functions')
    // Frozen protocol-2 generated source and private configuration are identical inputs to both runtimes.
    await cp(resolve(current, '_shared/generated'), resolve(candidate, '_shared/generated'), {
      recursive: true,
    })
    await cp(resolve(current, '.env'), resolve(candidate, '.env'))
    const config = resolve(candidate, '_shared/config.ts')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      config,
      (await readFile(config, 'utf8')).replaceAll("from 'zod'", "from 'npm:zod@4.6.7'"),
    )
    const previousHash = await treeHash(candidate),
      result = {
        schemaVersion: 1,
        id,
        compatibleRevision,
        edgeImage: (
          await run('docker', [
            'inspect',
            '--format',
            '{{.Image}}',
            `supabase_edge_runtime_${ctx.config.projectId}`,
          ])
        )
          .toString()
          .trim(),
        currentHash,
        previousHash,
        ready: false,
        restoredCurrent: false,
        elapsedMs: 0,
      }
    await durableJson(resolve(directory, 'result.json'), result)
    await durableJson(resolve(lock, 'journal.json'), {
      id,
      pid: process.pid,
      projectId: ctx.config.projectId,
      currentHash,
    })
    if (signal?.aborted) throw new OpsError('CANCELLED')
    try {
      mutated = true
      await rm(runtime, { recursive: true })
      await cp(candidate, runtime, { recursive: true })
      await restart(ctx)
      await verify('previous')
      result.ready = true
    } finally {
      await rm(runtime, { recursive: true })
      await cp(current, runtime, { recursive: true })
      await restart(ctx)
      if ((await treeHash(runtime)) !== currentHash) throw new OpsError('MEDIA_INVALID')
      await verify('current')
      restored = true
      result.restoredCurrent = true
      result.elapsedMs = Date.now() - started
      await durableJson(resolve(directory, 'result.json'), result)
    }
    return { ...result, oneHourTargetMet: result.elapsedMs <= 3600000 }
  } finally {
    if (!mutated || restored) await removeLock(lock)
  }
}

async function removeLock(lock) {
  await rm(lock, { recursive: true })
  const parent = await open(resolve(lock, '..'), 'r')
  try {
    await parent.sync()
  } finally {
    await parent.close()
  }
}
export async function rollbackResume(ctx) {
  const lock = resolve('.gstack/rollback', ctx.config.profile, 'lock'),
    journal = JSON.parse(await readFile(resolve(lock, 'journal.json'), 'utf8'))
  if (
    !uuid.test(journal.id) ||
    journal.projectId !== ctx.config.projectId ||
    !Number.isSafeInteger(journal.pid)
  )
    throw new OpsError('NOT_AVAILABLE')
  try {
    process.kill(journal.pid, 0)
    throw new OpsError('RATE_LIMITED')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
  await mkdir(resolve(lock, 'resuming')).catch((error) => {
    if (error.code === 'EEXIST') throw new OpsError('RATE_LIMITED')
    throw error
  })
  try {
    if (journal.currentHash !== null) {
      const current = resolve('.gstack/rollback', ctx.config.profile, journal.id, 'current'),
        runtime = resolve(ctx.runtime, 'supabase/functions')
      if ((await treeHash(current)) !== journal.currentHash) throw new OpsError('MEDIA_INVALID')
      await rm(runtime, { recursive: true, force: true })
      await cp(current, runtime, { recursive: true })
      await restart(ctx)
      if ((await treeHash(runtime)) !== journal.currentHash) throw new OpsError('MEDIA_INVALID')
    }
    await removeLock(lock)
    return { restoredCurrent: true, id: journal.id }
  } catch (error) {
    await rm(resolve(lock, 'resuming'), { recursive: true, force: true })
    throw error
  }
}
