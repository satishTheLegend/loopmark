import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const pages = [
  ['/privacy', 'Your projects, your choice'],
  ['/support', 'A little help getting back to it'],
  ['/delete-account', 'Leave with your work in hand'],
] as const

test('public help is complete without JavaScript and has no private metadata', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL })
  try {
    const page = await context.newPage()
    for (const [path, heading] of pages) {
      const response = await page.goto(path)
      expect(response?.ok()).toBe(true)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
      await expect(page.locator('meta[name=robots]')).toHaveAttribute(
        'content',
        'noindex, nofollow',
      )
      await expect(page.locator('script')).toHaveCount(0)
      await expect(
        page.getByRole('navigation', { name: 'Help and privacy' }).getByRole('link'),
      ).toHaveCount(3)
    }
    const response = await page.goto('/#account')
    expect(await response?.text()).toContain('noindex, nofollow')
    const robots = await context.request.get('/robots.txt')
    expect(await robots.text()).toContain('Disallow: /')
  } finally {
    await context.close()
  }
})

test('public help reflows, remains keyboard accessible and passes axe', async ({
  page,
  browserName,
}, testInfo) => {
  for (const [path, heading] of pages) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 960 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    // WebKit's macOS default skips links with plain Tab; Option+Tab traverses all controls.
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/privacy')
  await page.screenshot({ path: testInfo.outputPath('privacy-390.png'), fullPage: true })
  await page.goto('/support')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: testInfo.outputPath('support-1440.png'), fullPage: true })
})

test('offline help is cached while account API responses cannot be served from cache', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  // Poison the app cache deliberately. The worker must still bypass all API paths.
  await page.evaluate(async () => {
    const key = (await caches.keys()).find((name) => name.startsWith('loopmark-'))!
    const cache = await caches.open(key)
    await cache.put('/api/private', new Response('private-cache-sentinel'))
    await cache.put('/functions/v1/account-session', new Response('private-cache-sentinel'))
  })
  await context.setOffline(true)
  for (const [path, heading] of pages) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
  }
  for (const path of ['/api/private', '/functions/v1/account-session']) {
    const result = await page.evaluate(async (url) => {
      try {
        return await (await fetch(url)).text()
      } catch {
        return 'network-unavailable'
      }
    }, path)
    expect(result).toBe('network-unavailable')
  }
  await context.setOffline(false)
})
