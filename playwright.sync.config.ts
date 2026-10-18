import { defineConfig } from '@playwright/test'
import base from './playwright.config'
import { parseOperatorConfig } from './scripts/lib/config.mjs'
const config = parseOperatorConfig(process.env, process.cwd())
export default defineConfig(base, {
  testDir: './tests/expansion',
  testMatch: 'sync-smoke.spec.ts',
  testIgnore: [],
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results-sync',
  use: { baseURL: config.appOrigin },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${config.ports.app} --strictPort`,
    url: config.appOrigin,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
