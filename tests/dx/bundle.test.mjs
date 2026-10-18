import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { root } from './fixtures.mjs'
const execute = promisify(execFile)
test(
  'production browser assets exclude server/provider secret environment values',
  { timeout: 120000 },
  async () => {
    const output = await mkdtemp(resolve(tmpdir(), 'loopmark-dx-bundle-'))
    const secret = `DX_SECRET_${crypto.randomUUID()}`
    try {
      await execute(
        process.execPath,
        [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', output],
        {
          cwd: root,
          timeout: 90000,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            VITE_LOOPMARK_SUPABASE_URL: '',
            VITE_LOOPMARK_SUPABASE_ANON_KEY: '',
            SUPABASE_SERVICE_ROLE_KEY: secret,
            RAZORPAY_KEY_SECRET: secret,
            RAZORPAY_WEBHOOK_SECRET: secret,
            REVENUECAT_SECRET_API_KEY: secret,
            LOOPMARK_ERASURE_LEDGER_KEY: secret,
          },
        },
      ).catch(() => {
        throw new Error('Production bundle probe failed; raw subprocess output suppressed.')
      })
      let files = 0
      async function scan(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = resolve(directory, entry.name)
          if (entry.isDirectory()) await scan(path)
          else {
            assert.equal((await readFile(path)).includes(Buffer.from(secret)), false)
            files++
          }
        }
      }
      await scan(output)
      assert.ok(files > 0, 'No production assets were inspected')
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)
