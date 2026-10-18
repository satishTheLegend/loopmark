import { defineConfig } from '@playwright/test'
import base from './playwright.config'
export default defineConfig(base, {
  testDir: './tests/ui',
  testMatch: '**/*.ui.ts',
  reporter: [['list']],
  timeout: 90_000,
  retries: 0,
  outputDir: 'test-results-ui',
  use: { baseURL: 'http://127.0.0.1:4184' },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 4184 --strictPort',
    url: 'http://127.0.0.1:4184/tests/ui/index.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
