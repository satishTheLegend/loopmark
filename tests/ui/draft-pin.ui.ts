import { test, expect } from '@playwright/test'
test('a capture pin identifies exactly the draft version persisted before a concurrent edit', async ({
  page,
}) => {
  await page.goto('/tests/ui/draft-pin.html')
  await page.getByRole('button', { name: 'Pin capture source' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-writing', 'true')
  await page.getByLabel('Next step').fill('Later user edit')
  await page.getByRole('button', { name: 'Finish media persistence' }).click()
  await expect(page.getByLabel('Pinned source')).toContainText('Initial step')
  await expect(page.getByLabel('Pinned source')).not.toContainText('Later user edit')
  await page.getByRole('button', { name: 'Read saved draft' }).click()
  await expect(page.getByLabel('Saved draft')).toContainText('Later user edit')
  const pinned = JSON.parse(await page.getByLabel('Pinned source').innerText())
  const saved = JSON.parse(await page.getByLabel('Saved draft').innerText())
  expect(pinned.revision).not.toBe(saved.revision)
  expect(pinned.baseRevision).toBe('base')
})
