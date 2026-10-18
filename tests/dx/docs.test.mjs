import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateDocs, developerDocs } from '../../scripts/test-docs.mjs'
import { fixture } from './fixtures.mjs'
test('documentation validator catches a missing script, broken local link and misspelled setting', async () => {
  const f = await fixture()
  try {
    await f.write(
      'package.json',
      JSON.stringify({ scripts: { 'test:examples': 'x', 'test:docs': 'x', 'test:dx': 'x' } }),
    )
    await f.write('.env.example', 'VITE_LOOPMARK_APP_ORIGIN=\n')
    for (const name of developerDocs) await f.write(name, '# Synthetic\n')
    await f.write('CONTRIBUTING.md', 'npm run typo\n[link](missing.md)\nVITE_LOOPMARK_TYPO\n')
    const issues = await validateDocs(f.directory)
    assert.equal(issues.length, 3)
    assert.ok(issues.some((issue) => issue.includes('script target typo')))
    assert.ok(issues.some((issue) => issue.includes('missing link missing.md')))
    assert.ok(issues.some((issue) => issue.includes('unknown configuration VITE_LOOPMARK_TYPO')))
  } finally {
    await f.cleanup()
  }
})
