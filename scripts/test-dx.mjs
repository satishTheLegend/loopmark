import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
const tests = (await readdir('tests/dx'))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => `tests/dx/${name}`)
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...tests], {
  stdio: 'inherit',
})
child.on('error', () => {
  console.error('DX runner could not start.')
  process.exitCode = 2
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
