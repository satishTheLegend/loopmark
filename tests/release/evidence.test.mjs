import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { evaluateRelease, requiredGates } from '../../scripts/release/evidence.mjs'
const sha256 = createHash('sha256').update('synthetic evidence').digest('hex')
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'loopmark-release-'))
  try {
    await mkdir(join(root, 'docs/evidence'), { recursive: true })
    await writeFile(join(root, 'docs/evidence/check.txt'), 'synthetic evidence')
    const file = { path: 'docs/evidence/check.txt', sha256 },
      revision = 'a'.repeat(40)
    const manifest = {
      schemaVersion: 1,
      environment: 'staging',
      platform: 'web',
      revision,
      artifacts: [file],
      gates: requiredGates('staging', 'web').map((id) => ({
        id,
        status: 'pass',
        evidence: [file],
      })),
    }
    await run({ root, manifest, environment: 'staging', platform: 'web', revision, clean: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
test('complete matching synthetic evidence is explicitly not a deployment or authorization', () =>
  fixture(async (input) => {
    const report = await evaluateRelease(input)
    assert.equal(report.status, 'evidence-complete')
    assert.equal(report.performedRelease, false)
  }))
test('missing, blocked, failed, duplicate and unknown gates cannot pass', () =>
  fixture(async (input) => {
    for (const gates of [
      input.manifest.gates.slice(1),
      input.manifest.gates.map((g, i) => (i ? g : { ...g, status: 'blocked' })),
      input.manifest.gates.map((g, i) => (i ? g : { ...g, status: 'fail' })),
      [...input.manifest.gates, input.manifest.gates[0]],
      [...input.manifest.gates, { id: 'fake', status: 'pass', evidence: [] }],
    ]) {
      assert.equal(
        (await evaluateRelease({ ...input, manifest: { ...input.manifest, gates } })).status,
        'blocked',
      )
    }
  }))
test('dirty source, mismatched artifact and changed evidence bytes invalidate a record', () =>
  fixture(async (input) => {
    assert.equal((await evaluateRelease({ ...input, clean: false })).status, 'blocked')
    assert.equal((await evaluateRelease({ ...input, revision: 'b'.repeat(40) })).status, 'blocked')
    await writeFile(join(input.root, 'docs/evidence/check.txt'), 'changed')
    assert.equal((await evaluateRelease(input)).status, 'blocked')
  }))
test('symlink escape and malformed shape fail closed', () =>
  fixture(async (input) => {
    await symlink('/etc/hosts', join(input.root, 'docs/evidence/outside'))
    input.manifest.artifacts = [{ path: 'docs/evidence/outside', sha256 }]
    assert.equal((await evaluateRelease(input)).status, 'blocked')
    assert.equal(
      (await evaluateRelease({ ...input, manifest: { ...input.manifest, grant: true } })).status,
      'blocked',
    )
  }))
test('platform-specific and production gates cannot disappear', () => {
  for (const platform of ['ios', 'android'])
    for (const id of ['physical-device', 'store-sandbox', 'signing', 'deep-links'])
      assert.ok(requiredGates('staging', platform).includes(id))
  assert.ok(requiredGates('production', 'web').includes('pilot-decision'))
  assert.throws(() => requiredGates('local', 'web'))
})

test('evidence paths cannot traverse or symlink elsewhere inside the checkout', () =>
  fixture(async (input) => {
    await writeFile(join(input.root, 'unreviewed.txt'), 'synthetic evidence')
    await symlink('../../unreviewed.txt', join(input.root, 'docs/evidence/alias'))
    for (const path of ['docs/evidence/../../unreviewed.txt', 'docs/evidence/alias']) {
      const gates = input.manifest.gates.map((gate) => ({
        ...gate,
        evidence: [{ path, sha256 }],
      }))
      const report = await evaluateRelease({ ...input, manifest: { ...input.manifest, gates } })
      assert.equal(report.status, 'blocked')
      assert.equal(report.checks.find((check) => check.id === 'regression').status, 'blocked')
    }
  }))
test('a symlink to evidence within an allowed directory still verifies its actual bytes', () =>
  fixture(async (input) => {
    await symlink('check.txt', join(input.root, 'docs/evidence/alias'))
    input.manifest.gates[0].evidence = [{ path: 'docs/evidence/alias', sha256 }]
    assert.equal((await evaluateRelease(input)).status, 'evidence-complete')
  }))
