import { expect, test } from '@playwright/test'
test('unexpected UI errors expose a support code without raw private text; cancelled native sharing makes no saved claim', async ({
  page,
}) => {
  await page.goto('/tests/ui/diagnostics.html')
  await page.getByRole('button', { name: 'Inject unexpected error' }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Diagnostic code: UNEXPECTED')
  await expect(alert).toContainText('support#diagnostics')
  await expect(alert).not.toContainText('private@example.invalid')
  await expect(alert).not.toContainText('Bearer secret')
  await expect(alert).not.toContainText('https://private.invalid')
  await page.getByRole('button', { name: 'Preview native sharing' }).click()
  await page.getByRole('button', { name: 'Share diagnostic file' }).click()
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Sharing cancelled.')
})
