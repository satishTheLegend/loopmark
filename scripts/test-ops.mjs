import { spawn } from 'node:child_process'
const child = spawn(
  process.execPath,
  [
    '--test',
    'tests/ops/grammar.test.mjs',
    'tests/ops/alerts.test.mjs',
    'tests/ops/commands.test.mjs',
  ],
  {
    stdio: 'inherit',
  },
)
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
