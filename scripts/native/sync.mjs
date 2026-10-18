import { run } from './process.mjs'
// CI=1 is deliberately set for every invocation: Capacitor 8.5.3 suppresses telemetry
// when its terminal reports CI, without writing user-global configuration.
await run(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', 'sync'])
