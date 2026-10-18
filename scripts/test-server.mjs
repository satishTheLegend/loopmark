import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { localContext, status } from './local.mjs'
const suiteIndex = process.argv.indexOf('--suite'),
  suite = suiteIndex === -1 ? 'all' : process.argv[suiteIndex + 1]
const suites = {
  schema: [
    'tests/server/schema.test.ts',
    'tests/server/sync-ordering.test.ts',
    'tests/server/boundaries.test.ts',
    'tests/server/review-regressions.test.ts',
  ],
  media: ['tests/server/media.test.ts'],
  replacement: ['tests/server/replacement.test.ts'],
  deletion: ['tests/server/deletion.test.ts'],
  billing: ['tests/server/billing.test.ts'],
  recovery: ['tests/server/recovery.test.ts'],
  all: ['tests/server'],
}
if (!Object.hasOwn(suites, suite)) {
  console.error('Use --suite schema|media|replacement|deletion|billing|recovery|all')
  process.exit(2)
}
try {
  const context = await localContext()
  await status(context)
  console.log(
    `Server tests: real isolated local services for ${context.config.projectId}; suite ${suite}.`,
  )
} catch {
  console.error(
    'Local backend unavailable. Run local:up in this worktree. No fake fallback or skipped PASS.',
  )
  process.exit(3)
}
const child = spawn(
  resolve('node_modules/.bin/vitest'),
  ['run', '--config', 'vitest.server.config.ts', ...suites[suite]],
  {
    stdio: 'inherit',
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
  },
)
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
