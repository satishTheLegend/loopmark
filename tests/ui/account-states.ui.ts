import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
test('account code form has a durable resend cooldown and named fields', async ({ page }) => {
  await page.goto('/tests/ui/index.html?scenario=account')
  await page.getByLabel('Email address', { exact: true }).fill('maker@example.test')
  await page.getByRole('button', { name: 'Send sign-in code' }).click()
  await expect(page.getByRole('button', { name: /Resend in/ })).toBeDisabled()
  await page.getByLabel('Sign-in code', { exact: true }).fill('123456')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByLabel('Action result')).toContainText('verified-code-ui-only')
})
test('remove device copy needs a distinct explicit discard decision', async ({ page }) => {
  await page.goto('/tests/ui/index.html?scenario=signout')
  await expect(page.getByRole('radio', { name: /Keep on this device/ })).toBeChecked()
  await page.getByRole('radio', { name: /Remove device copy/ }).check()
  await expect(page.getByRole('button', { name: 'Sign out and remove copy' })).toBeDisabled()
  await page.getByRole('checkbox', { name: /Discard the unsent/ }).check()
  await page.getByRole('button', { name: 'Sign out and remove copy' }).click()
  await expect(page.getByLabel('Action result')).toContainText('"discardUniqueWork":true')
})
test('conflict changes require refreshed review and an explicit merge baseline', async ({
  page,
}) => {
  await page.goto('/tests/ui/index.html?scenario=conflict-stale')
  await expect(page.getByRole('button', { name: 'Keep this device’s changes' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Refresh versions' }).click()
  await page.getByRole('button', { name: 'Edit a merged version' }).click()
  await expect(page.getByLabel('Project name', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Start from cloud' }).click()
  await page.getByLabel('Project name', { exact: true }).fill('Reviewed merged cardigan')
  await page.getByRole('button', { name: 'Save merged version' }).click()
  await expect(page.getByLabel('Action result')).toContainText('Reviewed merged cardigan')
})
test('account decisions reflow and expose accessible labels across widths', async ({
  page,
}, testInfo) => {
  for (const scenario of ['account', 'signout', 'connection', 'conflict']) {
    await page.goto(`/tests/ui/index.html?scenario=${scenario}`)
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      const dialog = page.getByRole('dialog')
      if (await dialog.count())
        expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    }
    await page.evaluate(async () => {
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished.catch(() => {})),
      )
    })
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
    if (testInfo.project.name === 'chromium')
      await page.screenshot({
        path: `docs/evidence/expansion/I09-components/${scenario}-1440.png`,
        fullPage: true,
      })
    if (testInfo.project.name === 'webkit-mobile') {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.screenshot({
        path: `docs/evidence/expansion/I09-components/${scenario}-390.png`,
        fullPage: true,
      })
    }
  }
})
test('keyboard can cancel a destructive review without committing it', async ({
  page,
  browserName,
}) => {
  await page.goto('/tests/ui/index.html?scenario=signout')
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Action result')).toHaveText('')
})
