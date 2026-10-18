#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
for (const args of [
  ['vitest', 'run', '--config=vitest.compat.config.ts'],
  [
    'vitest',
    'run',
    'src/repositories/browser/migration.test.ts',
    'src/domain/contracts.test.ts',
    'src/services/backup-service.test.ts',
  ],
]) {
  const result = spawnSync('npx', args, { stdio: 'inherit', env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log(
  'Compatibility: portable v1, previous browser migration/old-writer fence, future-local-schema preservation and unsupported wire rejection. There was no pre-expansion cloud wire release; native migration remains separately qualified on its actual runtime.',
)
