import { defineConfig, devices } from '@playwright/test'

const desktopViewport = { width: 1440, height: 1000 }
const testPort = Number(process.env.LOOPMARK_TEST_PORT ?? 4173)
if (!Number.isSafeInteger(testPort) || testPort < 1024 || testPort > 65535)
  throw new Error('LOOPMARK_TEST_PORT must be an integer from 1024 to 65535')
const testOrigin = `http://127.0.0.1:${testPort}`
const chromiumMedia = {
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: testOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: desktopViewport,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: desktopViewport,
        launchOptions: chromiumMedia,
      },
    },
    {
      name: 'firefox',
      grepInvert: /@chromium-media/,
      use: { ...devices['Desktop Firefox'], viewport: desktopViewport },
    },
    {
      name: 'webkit',
      grepInvert: /@chromium-media/,
      use: { ...devices['Desktop Safari'], viewport: desktopViewport },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'], launchOptions: chromiumMedia },
    },
    {
      name: 'webkit-mobile',
      grepInvert: /@chromium-media/,
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${testPort} --strictPort`,
    url: testOrigin,
    reuseExistingServer: !process.env.CI && !process.env.LOOPMARK_TEST_PORT,
    timeout: 30_000,
  },
})
