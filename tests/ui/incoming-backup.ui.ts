import { expect, test } from '@playwright/test'
test('received backup opens a validated preview only on review and retains its durable token after cancellation', async ({
  page,
}) => {
  await page.goto('/tests/ui/incoming-backup.html')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Restore result')).toHaveText('No restore')
  await page.getByRole('button', { name: 'Review received backup' }).click()
  await expect(page.getByRole('dialog')).toContainText('separate recovered collection')
  await expect(page.getByLabel('Restore result')).toHaveText('No restore')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Review received backup' }).click()
  await page.getByRole('button', { name: 'Restore as separate collection', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Restore result')).toContainText(
    '6ca923e0-61b7-4dda-8c56-37ee045fe368',
  )
})
test('invalid received JSON leaves restore unavailable and never invokes the restore callback', async ({
  page,
}) => {
  await page.goto('/tests/ui/incoming-backup.html?invalid')
  await page.getByRole('button', { name: 'Review received backup' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Restore as separate collection', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByLabel('Restore result')).toHaveText('No restore')
})
