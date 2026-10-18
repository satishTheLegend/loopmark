import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile, rename, open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { localContext, status, assertLocalDocker } from '../local.mjs'
export const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export const hash = (value) => createHash('sha256').update(value).digest('hex')
export const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'"
export class OpsError extends Error {
  constructor(code = 'SERVICE_UNAVAILABLE') {
    super(code)
    this.code = code
  }
}
export async function run(
  command,
  args,
  { input, timeout = 120_000, maxBytes = 16 * 1024 * 1024, signal } = {},
) {
  if (signal?.aborted) throw new OpsError('CANCELLED')
  return await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
    })
    let chunks = [],
      size = 0,
      failed = false
    const stop = () => {
      failed = true
      child.kill('SIGTERM')
    }
    const timer = setTimeout(stop, timeout)
    signal?.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) stop()
      else chunks.push(chunk)
    })
    // Never include command arguments, SQL values, credentials or provider payloads in errors.
    child.stderr.resume()
    child.on('error', () => {
      failed = true
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      if (code || failed)
        reject(new OpsError(signal?.aborted ? 'CANCELLED' : 'SERVICE_UNAVAILABLE'))
      else resolveResult(Buffer.concat(chunks))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}
export async function context() {
  await assertLocalDocker()
  const local = await localContext(),
    credentials = await status(local)
  if (
    credentials.API_URL !== local.config.backendUrl ||
    new URL(credentials.API_URL).hostname !== '127.0.0.1'
  )
    throw new OpsError('NOT_AVAILABLE')
  return {
    ...local,
    url: credentials.API_URL,
    key: credentials.SERVICE_ROLE_KEY ?? credentials.SECRET_KEY,
    database: `supabase_db_${local.config.projectId}`,
    recovery: resolve('.gstack/recovery', local.config.profile),
    keyPath: resolve('.gstack/recovery-keys', local.config.profile + '.key'),
  }
}
export async function sql(ctx, statement, database = 'postgres') {
  if (database !== 'postgres' && !/^lm_restore_[a-f0-9]{32}$/.test(database))
    throw new OpsError('VALIDATION')
  return (
    await run(
      'docker',
      [
        'exec',
        '-i',
        ctx.database,
        'psql',
        '-U',
        'postgres',
        '-d',
        database,
        '-X',
        '-q',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { input: statement },
    )
  )
    .toString()
    .trim()
}
export async function rpc(ctx, name, args = {}) {
  const response = await fetch(ctx.url + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: ctx.key,
      authorization: 'Bearer ' + ctx.key,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(60_000),
    redirect: 'error',
  })
  if (!response.ok) {
    const failed = await response.json().catch(() => null)
    const allowed = new Set([
      'MEDIA_INVALID',
      'OPERATION_REUSED',
      'RATE_LIMITED',
      'NOT_AVAILABLE',
      'VALIDATION',
      'CAPABILITY_UNAVAILABLE',
    ])
    throw new OpsError(allowed.has(failed?.message) ? failed.message : 'SERVICE_UNAVAILABLE')
  }
  const body = await response.text()
  return body ? JSON.parse(body) : null
}
export async function job(ctx, action, limit, target = 'all') {
  const response = await fetch(ctx.url + '/functions/v1/jobs', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + ctx.key, 'content-type': 'application/json' },
    body: JSON.stringify({ action, limit, ownerId: target === 'all' ? null : target }),
    signal: AbortSignal.timeout(180_000),
    redirect: 'error',
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new OpsError('SERVICE_UNAVAILABLE')
  }
  return await response.json()
}
export async function durableJson(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 })
  const temporary = path + '.next',
    file = await open(temporary, 'w', 0o600)
  try {
    await file.writeFile(JSON.stringify(value))
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(temporary, path)
  const dir = await open(resolve(path, '..'), 'r')
  try {
    await dir.sync()
  } finally {
    await dir.close()
  }
}
export async function ledger(ctx, path, body) {
  const value = await run(
    'docker',
    [
      'exec',
      `loopmark_erasure_ledger_${ctx.config.projectId}`,
      'node',
      '--input-type=module',
      '-e',
      "const r=await fetch('http://127.0.0.1:8787'+process.argv[1],{method:'POST',headers:{authorization:'Bearer '+process.env.LOOPMARK_ERASURE_LEDGER_KEY,'content-type':'application/json'},body:process.argv[2],signal:AbortSignal.timeout(10000)});if(!r.ok)process.exit(2);process.stdout.write(await r.text())",
      path,
      JSON.stringify(body),
    ],
    { timeout: 15_000, maxBytes: 128 * 1024 },
  )
  return JSON.parse(value.toString())
}
export async function currentLedger(ctx) {
  const first = await ledger(ctx, '/watermark', {}),
    entries = []
  if (
    !/^\d+:[a-f0-9]{64}$/.test(first.watermark) ||
    Math.abs(Date.now() - Date.parse(first.asOf)) > 30_000
  )
    throw new OpsError('SERVICE_UNAVAILABLE')
  let cursor = null
  do {
    const page = await ledger(ctx, '/inventory', { cursor })
    if (
      page.watermark !== first.watermark ||
      Math.abs(Date.now() - Date.parse(page.asOf)) > 30_000 ||
      !Array.isArray(page.entries) ||
      page.entries.length > 50
    )
      throw new OpsError('SERVICE_UNAVAILABLE')
    entries.push(...page.entries)
    if (
      page.nextCursor !== null &&
      (!/^\d+$/.test(page.nextCursor) || Number(page.nextCursor) !== entries.length)
    )
      throw new OpsError('SERVICE_UNAVAILABLE')
    cursor = page.nextCursor
    if (entries.length > 100_000) throw new OpsError('TECHNICAL_CAPACITY_REACHED')
  } while (cursor !== null)
  let chain = '0'.repeat(64)
  const canonical = (value) =>
    value && typeof value === 'object'
      ? Array.isArray(value)
        ? '[' + value.map(canonical).join(',') + ']'
        : '{' +
          Object.keys(value)
            .sort()
            .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
            .join(',') +
          '}'
      : JSON.stringify(value)
  const seen = new Set()
  for (const entry of entries) {
    if (
      !entry ||
      Object.keys(entry).sort().join(',') !==
        'accountId,deletionGeneration,receiptTokenHash,requestId,requestedAt,retainUntil' ||
      !uuid.test(entry.accountId) ||
      !/^[1-9][0-9]{0,18}$/.test(entry.deletionGeneration) ||
      !/^[a-f0-9]{64}$/.test(entry.receiptTokenHash) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(entry.requestId) ||
      seen.has(entry.accountId) ||
      !Number.isFinite(Date.parse(entry.requestedAt)) ||
      Date.parse(entry.retainUntil) < Date.parse(entry.requestedAt) + 90 * 86400000
    )
      throw new OpsError('SERVICE_UNAVAILABLE')
    seen.add(entry.accountId)
    chain = hash(chain + canonical(entry))
  }
  if (first.watermark !== entries.length + ':' + chain) throw new OpsError('SERVICE_UNAVAILABLE')
  const final = await ledger(ctx, '/watermark', {})
  if (
    final.watermark !== first.watermark ||
    Math.abs(Date.now() - Date.parse(final.asOf)) > 30_000 ||
    Number(first.watermark.split(':')[0]) !== entries.length
  )
    throw new OpsError('SERVICE_UNAVAILABLE')
  return { watermark: first.watermark, entries }
}
export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}
