import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
const child = spawn(
  process.execPath,
  [
    resolve('node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    'tests/examples/vitest.config.ts',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
)
child.on('error', () => {
  console.error('Executable examples require npm ci.')
  process.exitCode = 2
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
