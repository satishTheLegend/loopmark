import test from 'node:test'
import assert from 'node:assert/strict'
import { parseArguments, alerts } from '../../scripts/ops.mjs'
const base = ['status', '--environment', 'local', '--target', 'all', '--json']
test('operator grammar is explicit, bounded and defaults to a dry run', () => {
  assert.equal(parseArguments(base).execute, false)
  assert.equal(parseArguments(base).limit, 20)
  assert.equal(parseArguments([...base, '--execute', '--limit', '100']).execute, true)
  for (const extra of [
    ['--limit', '0'],
    ['--limit', '101'],
    ['--limit', '1.5'],
    ['--limit', '20', '--limit', '1'],
    ['--unknown'],
    ['--execute', '--execute'],
  ])
    assert.throws(() => parseArguments([...base, ...extra]))
  assert.throws(() => parseArguments(['status', '--environment', 'production', '--target', 'all']))
  assert.throws(() =>
    parseArguments(['restore-check', '--environment', 'local', '--target', 'all']),
  )
  assert.throws(() =>
    parseArguments(['backup-snapshot', '--environment', 'local', '--target', '../../other']),
  )
})
