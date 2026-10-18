import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'
import base from '../../playwright.ui.config'
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'purchases.ui.ts',
  outputDir: resolve(import.meta.dirname, '../../test-results-ui'),
  use: { ...base.use, baseURL: 'http://127.0.0.1:4185' },
  webServer: {
    cwd: resolve(import.meta.dirname, '../..'),
    command: 'npx vite --host 127.0.0.1 --port 4185 --strictPort',
    url: 'http://127.0.0.1:4185/tests/ui/purchases.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
