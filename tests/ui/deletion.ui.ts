import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
const url = '/tests/ui/index.html?scenario=deletion'
test('deletion keeps local copies by default and requires a fresh code, cloud confirmation and explicit missing-file choice', async ({
  page,
}) => {
  await page.goto(url)
  await expect(page.getByRole('radio', { name: /Keep a separate local copy/ })).toBeChecked()
  const submit = page.getByRole('button', { name: 'Delete account', exact: true })
  await expect(submit).toBeDisabled()
  await page.getByRole('button', { name: 'Send deletion code' }).click()
  await expect(page.getByRole('button', { name: /Resend in/ })).toBeDisabled()
  await page.getByLabel('Deletion code', { exact: true }).fill('123456')
  await page.getByRole('checkbox', { name: /Delete this cloud account/ }).check()
  await expect(submit).toBeDisabled()
  await page.getByRole('checkbox', { name: /I understand that 2 missing/ }).check()
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.getByLabel('Action result')).toContainText('"allowMissingAttachments":true')
  await expect(page.getByLabel('Action result')).toContainText('"keepLocal":true')
})
test('removing local copies requires a separate explicit choice to discard unique work', async ({
  page,
}) => {
  await page.goto(url)
  await page.getByRole('radio', { name: /Remove this account’s device copy/ }).check()
  await page.getByRole('button', { name: 'Send deletion code' }).click()
  await page.getByLabel('Deletion code', { exact: true }).fill('123456')
  await page.getByRole('checkbox', { name: /Delete this cloud account/ }).check()
  const submit = page.getByRole('button', { name: 'Delete account', exact: true })
  await expect(submit).toBeDisabled()
  await page.getByRole('checkbox', { name: /Discard the unsent/ }).check()
  await submit.click()
  await expect(page.getByLabel('Action result')).toContainText('"discardUniqueWork":true')
  await expect(page.getByLabel('Action result')).toContainText('"keepLocal":false')
})
test('unknown attachment availability fails closed for keeping copies, while an unknown receipt does not claim acceptance', async ({
  page,
}) => {
  await page.goto(url + '&missing=unknown')
  await page.getByRole('button', { name: 'Send deletion code' }).click()
  await page.getByLabel('Deletion code', { exact: true }).fill('123456')
  await page.getByRole('checkbox', { name: /Delete this cloud account/ }).check()
  await expect(page.getByRole('alert')).toContainText('could not be checked')
  await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toBeDisabled()
  await page.goto('/tests/ui/index.html?scenario=receipt&receipt=unknown')
  await expect(
    page.getByRole('region', { name: 'Account deletion receipt' }).getByRole('status'),
  ).toContainText('acceptance has not been confirmed')
  await expect(page.getByRole('region')).toContainText('cleanup has not been confirmed')
  await page.getByRole('button', { name: 'Check deletion status' }).click()
  await expect(page.getByLabel('Action result')).toHaveText('status-refreshed')
})
test('deletion and receipt remain accessible and reflow at phone and desktop widths', async ({
  page,
}) => {
  for (const scenario of ['deletion', 'receipt']) {
    await page.goto('/tests/ui/index.html?scenario=' + scenario)
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.all(
          document.getAnimations().map((animation) => animation.finished.catch(() => {})),
        )
      })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([])
    }
  }
})
