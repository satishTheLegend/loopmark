import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { parseArguments, errorExit } from '../../scripts/ops.mjs'
import { encodeCursor, decodeCursor } from '../../scripts/ops/cursor.mjs'
test('help is dependency-free and default local grammar preserves exact exit classes', () => {
  const help = spawnSync(process.execPath, ['scripts/ops.mjs', '--help'], {
    encoding: 'utf8',
    env: { ...process.env, DOCKER_HOST: 'tcp://untrusted.invalid:2376' },
  })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /--cursor/)
  assert.match(help.stdout, /5 denied/)
  assert.equal(parseArguments(['status', '--target', 'all']).environment, 'local')
  for (const [args, code] of [
    [['status'], 2],
    [['status', '--target', 'all', '--environment', 'production'], 5],
    [['status', '--target', 'all', '--cursor', 'malformed'], 2],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/ops.mjs', ...args], { encoding: 'utf8' })
    assert.equal(result.status, code)
    assert.equal(JSON.parse(result.stdout).counts.failed, 1)
    assert.equal(result.stderr, '')
  }
  assert.equal(errorExit('SERVICE_UNAVAILABLE'), 3)
  assert.equal(errorExit('CANCELLED'), 4)
  assert.equal(errorExit('RATE_LIMITED'), 4)
  assert.equal(errorExit('MEDIA_INVALID'), 5)
  const remote = spawnSync(process.execPath, ['scripts/ops.mjs', 'status', '--target', 'all'], {
    encoding: 'utf8',
    env: { ...process.env, DOCKER_HOST: 'tcp://untrusted.invalid:2376' },
  })
  assert.equal(remote.status, 5)
  assert.equal(JSON.parse(remote.stdout).errors[0].code, 'NOT_AVAILABLE')
  const missing = spawnSync(process.execPath, ['scripts/ops.mjs', 'status', '--target', 'all'], {
    encoding: 'utf8',
    env: { ...process.env, DOCKER_HOST: '', PATH: '/nonexistent-loopmark-test' },
  })
  assert.equal(missing.status, 3)
  assert.equal(JSON.parse(missing.stdout).errors[0].code, 'SERVICE_UNAVAILABLE')
})
test('opaque cursors bind exact project command target and durable job without granting skip authority', () => {
  const ctx = { key: 'synthetic-cursor-key', config: { projectId: 'synthetic-local' } },
    options = { command: 'maintenance', target: 'all' },
    jobId = randomUUID()
  const cursor = encodeCursor(ctx, options, jobId, 12)
  assert.equal(decodeCursor(ctx, { ...options, cursor }).position, 12)
  assert.equal(decodeCursor(ctx, { ...options, cursor }).jobId, jobId)
  for (const changed of [
    { ...options, command: 'replay-webhooks' },
    { ...options, target: randomUUID() },
  ])
    assert.throws(() => decodeCursor(ctx, { ...changed, cursor }))
  assert.throws(() => decodeCursor({ ...ctx, key: 'different' }, { ...options, cursor }))
  assert.throws(() =>
    decodeCursor({ ...ctx, config: { projectId: 'different' } }, { ...options, cursor }),
  )
  assert.throws(() => decodeCursor(ctx, { ...options, cursor: 'A' + cursor.slice(1) }))
})
