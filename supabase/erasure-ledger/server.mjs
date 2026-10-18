import { createServer } from 'node:http'
import { open, readFile, mkdir } from 'node:fs/promises'
import { createHash, timingSafeEqual } from 'node:crypto'
const key = process.env.LOOPMARK_ERASURE_LEDGER_KEY
if (!/^[a-f0-9]{64}$/.test(key ?? '')) throw new Error('Ledger credential is missing')
const directory = process.env.LEDGER_DIRECTORY ?? '/data',
  path = directory + '/intents.jsonl'
await mkdir(directory, { recursive: true, mode: 0o700 })
const canonical = (value) =>
  value && typeof value === 'object'
    ? Array.isArray(value)
      ? '[' + value.map(canonical).join(',') + ']'
      : '{' +
        Object.keys(value)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
          .join(',') +
        '}'
    : JSON.stringify(value)
const hash = (value) => createHash('sha256').update(value).digest('hex')
const entries = [],
  byRequest = new Map(),
  byOwner = new Map()
let chain = '0'.repeat(64),
  sequence = Promise.resolve(),
  failed = false
const validIntent = (value) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).sort().join(',') !==
      [
        'accountId',
        'deletionGeneration',
        'receiptTokenHash',
        'requestId',
        'requestedAt',
        'retainUntil',
      ]
        .sort()
        .join(',')
  )
    return false
  return (
    /^[a-f0-9-]{36}$/.test(value.accountId) &&
    /^[1-9][0-9]{0,18}$/.test(value.deletionGeneration) &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value.requestId) &&
    /^[a-f0-9]{64}$/.test(value.receiptTokenHash) &&
    [value.requestedAt, value.retainUntil].every(
      (v) =>
        typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v,
    ) &&
    Date.parse(value.retainUntil) >= Date.parse(value.requestedAt) + 90 * 86400000
  )
}
const existing = await readFile(path, 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return ''
  throw error
})
if (existing && !existing.endsWith('\n')) throw new Error('Ledger integrity failure')
for (const line of existing.split('\n').filter(Boolean)) {
  const row = JSON.parse(line)
  if (
    !validIntent(row.intent) ||
    row.index !== entries.length + 1 ||
    row.previous !== chain ||
    row.hash !== hash(chain + canonical(row.intent)) ||
    byRequest.has(row.intent.requestId) ||
    byOwner.has(row.intent.accountId)
  )
    throw new Error('Ledger integrity failure')
  entries.push(row.intent)
  byRequest.set(row.intent.requestId, row.intent)
  byOwner.set(row.intent.accountId, row.intent)
  chain = row.hash
}
const file = await open(path, 'a', 0o600),
  directoryHandle = await open(directory, 'r')
await directoryHandle.sync()
await directoryHandle.close()
const watermark = () => `${entries.length}:${chain}`
function serialized(action) {
  const result = sequence.then(() => {
    if (failed) throw new Error('Ledger unavailable')
    return action()
  })
  sequence = result.catch(() => {})
  return result
}
async function append(intent) {
  if (!validIntent(intent)) return { status: 400, body: { error: 'VALIDATION' } }
  const prior = byRequest.get(intent.requestId) ?? byOwner.get(intent.accountId)
  if (prior)
    return canonical(prior) === canonical(intent)
      ? { status: 200, body: { watermark: watermark() } }
      : { status: 409, body: { error: 'OPERATION_REUSED' } }
  const next = hash(chain + canonical(intent)),
    row = { index: entries.length + 1, previous: chain, hash: next, intent }
  try {
    await file.writeFile(JSON.stringify(row) + '\n')
    await file.sync()
  } catch {
    failed = true
    throw new Error('Ledger unavailable')
  }
  entries.push(intent)
  byRequest.set(intent.requestId, intent)
  byOwner.set(intent.accountId, intent)
  chain = next
  return { status: 200, body: { watermark: watermark() } }
}
let tokens = 60,
  last = Date.now(),
  inflight = 0
const server = createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    })
    res.end(JSON.stringify(body))
  }
  const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
  if (supplied.length !== key.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(key)))
    return reply(401, { error: 'AUTH_REQUIRED' })
  if (
    req.method !== 'POST' ||
    !['/append', '/inventory', '/watermark', '/lookup'].includes(req.url)
  )
    return reply(404, { error: 'NOT_AVAILABLE' })
  const now = Date.now()
  tokens = Math.min(60, tokens + (now - last) / 1000)
  last = now
  if (tokens < 1 || inflight >= 4) return reply(429, { error: 'RATE_LIMITED' })
  tokens--
  inflight++
  const timer = setTimeout(() => req.destroy(), 5000)
  try {
    let size = 0,
      chunks = []
    for await (const chunk of req) {
      size += chunk.length
      if (size > 4096) return reply(413, { error: 'VALIDATION' })
      chunks.push(chunk)
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const result = await serialized(async () => {
      if (req.url === '/append') return await append(input)
      if (req.url === '/watermark')
        return { status: 200, body: { watermark: watermark(), asOf: new Date().toISOString() } }
      if (req.url === '/lookup') {
        if (
          typeof input.requestId !== 'string' ||
          !/^[a-f0-9]{64}$/.test(input.receiptTokenHash ?? '')
        )
          return { status: 400, body: { error: 'VALIDATION' } }
        const intent = byRequest.get(input.requestId)
        return {
          status: 200,
          body: {
            intent:
              intent &&
              intent.receiptTokenHash === input.receiptTokenHash &&
              Date.parse(intent.retainUntil) > Date.now()
                ? intent
                : null,
            watermark: watermark(),
          },
        }
      }
      if (
        input.cursor !== null &&
        !(typeof input.cursor === 'string' && /^(0|[1-9][0-9]{0,12})$/.test(input.cursor))
      )
        return { status: 400, body: { error: 'VALIDATION' } }
      const offset = input.cursor === null ? 0 : Number(input.cursor)
      if (offset > entries.length) return { status: 400, body: { error: 'VALIDATION' } }
      return {
        status: 200,
        body: {
          watermark: watermark(),
          asOf: new Date().toISOString(),
          entries: entries.slice(offset, offset + 50),
          nextCursor: offset + 50 < entries.length ? String(offset + 50) : null,
        },
      }
    })
    reply(result.status, result.body)
  } catch {
    if (!res.headersSent) reply(503, { error: 'SERVICE_UNAVAILABLE' })
  } finally {
    clearTimeout(timer)
    inflight--
  }
})
server.requestTimeout = 5000
server.headersTimeout = 5000
server.maxConnections = 16
server.listen(8787, '0.0.0.0', () =>
  process.stdout.write('Erasure ledger ready; no host port published.\n'),
)
process.on('SIGTERM', () =>
  server.close(async () => {
    await sequence
    await file.sync()
    await file.close()
    process.exit(0)
  }),
)
