import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture, copyLocalLauncher } from './fixtures.mjs'
const execute = promisify(execFile)
async function refusal(environment, confirmation, contextHost = 'unix:///synthetic/docker.sock') {
  const f = await fixture()
  try {
    await copyLocalLauncher(f)
    await f.write(
      'bin/docker',
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "' +
        resolve(f.directory, 'calls') +
        '"\nif [ "$1" = "context" ]; then echo \'[{"Endpoints":{"docker":{"Host":"' +
        contextHost +
        '"}}}]\'; else echo 1.0; fi\n',
      0o700,
    )
    let failure
    try {
      await execute(
        process.execPath,
        ['scripts/local.mjs', 'reset', '--confirm-project', confirmation],
        { cwd: f.directory, env: { ...f.environment, ...environment }, timeout: 10000 },
      )
    } catch (error) {
      failure = error
    }
    assert.ok(failure, 'unsafe reset unexpectedly succeeded')
    assert.equal(failure.code, 2)
    const calls = await readFile(resolve(f.directory, 'calls'), 'utf8').catch(() => '')
    assert.doesNotMatch(calls, /\b(create|run|stop|restart|rm|exec)\b/)
    assert.doesNotMatch(failure.stdout + failure.stderr, /secret-value/)
    return { calls, message: failure.stderr }
  } finally {
    await f.cleanup()
  }
}
test('wrong reset project is refused before preparation or mutation', async () => {
  const result = await refusal({}, 'loopmark-another-project')
  assert.match(result.message, /confirm-project/)
})
test('remote operator endpoint is refused before invoking Docker', async () => {
  const result = await refusal(
    { LOOPMARK_LOCAL_URL: 'https://secret-value@example.invalid' },
    'loopmark-dx-fixture',
  )
  assert.equal(result.calls, '')
  assert.match(result.message, /Local configuration is invalid/)
})
test('remote Docker override cannot bypass the local reset boundary', async () => {
  const result = await refusal({ DOCKER_HOST: 'tcp://secret-value:2376' }, 'loopmark-dx-fixture')
  assert.match(result.message, /local.*(?:Docker|socket)|(?:Docker|socket).*local/i)
})

test('remote active Docker context is refused even without a host override', async () => {
  const result = await refusal({}, 'loopmark-dx-fixture', 'ssh://remote.invalid')
  assert.match(result.message, /local.*(?:Docker|socket)|(?:Docker|socket).*local/i)
  assert.match(result.calls, /context inspect/)
  assert.doesNotMatch(result.calls, /info/)
})
