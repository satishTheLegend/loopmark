import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { context } from './ops/common.mjs'
const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--accounts' || !['100', '1000'].includes(args[1])) {
  console.error('Use --accounts 100|1000 for the exact isolated local stack.')
  process.exit(2)
}
await context()
await mkdir('.gstack/load', { recursive: true })
const config = resolve('.gstack/load/vitest.config.mjs')
await writeFile(
  config,
  "export default {test:{include:['tests/load/**/*.test.ts'],environment:'node',testTimeout:1800000,hookTimeout:60000,fileParallelism:false,pool:'forks'}}\n",
)
const child = spawn(resolve('node_modules/.bin/vitest'), ['run', '--config', config], {
  stdio: 'inherit',
  env: {
    ...process.env,
    LOOPMARK_LOAD_ACCOUNTS: args[1],
    SUPABASE_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
  },
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
