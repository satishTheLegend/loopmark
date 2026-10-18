import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { runDoctor } from '../../scripts/doctor.mjs'
import { fixture } from './fixtures.mjs'

test('missing Docker reports a prerequisite and leaves guest independent of provider secrets', async () => {
  const f = await fixture()
  try {
    const guest = await runDoctor({ worktree: f.directory, environment: f.environment })
    assert.equal(guest.exitCode, 0)
    const sync = await runDoctor({
      worktree: f.directory,
      environment: f.environment,
      capability: 'local-sync',
    })
    assert.equal(sync.exitCode, 2)
    assert.equal(sync.checks.find((c) => c.id === 'docker-context').status, 'missing')
    const provider = await runDoctor({
      worktree: f.directory,
      environment: f.environment,
      capability: 'provider-sandbox',
    })
    assert.equal(provider.exitCode, 2)
  } finally {
    await f.cleanup()
  }
})
test('occupied application port reports unhealthy and never closes the existing listener', async () => {
  const f = await fixture(),
    server = net.createServer()
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const report = await runDoctor({
      worktree: f.directory,
      environment: { ...f.environment, LOOPMARK_DEV_APP_PORT: String(server.address().port) },
    })
    assert.equal(report.exitCode, 3)
    assert.equal(report.checks.find((c) => c.id === 'app-port').status, 'unhealthy')
    assert.equal(server.listening, true)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await f.cleanup()
  }
})
test('wrong local project and remote Docker context fail read-only readiness without leaking values', async () => {
  const f = await fixture()
  try {
    await f.write(
      '.gstack/local/dx-fixture/supabase/config.toml',
      'project_id = "another-project"\n',
    )
    await f.write('bin/docker', '#!/bin/sh\necho \'"tcp://private.invalid:2376"\'\n', 0o700)
    const report = await runDoctor({
      worktree: f.directory,
      environment: { ...f.environment, SUPABASE_SERVICE_ROLE_KEY: 'DX_PRIVATE_SENTINEL' },
      capability: 'local-sync',
    })
    assert.equal(report.checks.find((c) => c.id === 'local-project').status, 'missing')
    assert.equal(report.checks.find((c) => c.id === 'docker-context').status, 'unhealthy')
    assert.doesNotMatch(JSON.stringify(report), /private\.invalid|DX_PRIVATE_SENTINEL/)
  } finally {
    await f.cleanup()
  }
})
