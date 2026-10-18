import { defineConfig } from '@playwright/test'
import base from './playwright.sync.config'

export default defineConfig({
  ...base,
  testDir: './tests/performance',
  testMatch: 'capture.load.ts',
  outputDir: 'test-results-load-capture',
  workers: 1,
  projects: base.projects?.filter((project) => project.name === 'chromium'),
})
