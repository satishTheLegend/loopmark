import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir } from 'node:fs/promises'

test('account refresh requires a separate missing-file acknowledgment and restores focus', async ({
  page,
}, info) => {
  await page.goto('/tests/ui/sync-recovery.html?mode=missing')
  await page.getByRole('button', { name: 'Review account refresh' }).click()
  const dialog = page.getByRole('dialog', { name: 'Refresh this account safely' })
  await expect(dialog.getByRole('heading', { name: 'Refresh this account safely' })).toBeFocused()
  await expect(dialog).toContainText('2 saved attachments are missing')
  const proceed = dialog.getByRole('button', {
    name: 'Keep device copy and refresh account',
    exact: true,
  })
  await expect(proceed).toBeDisabled()
  await expect(page.getByLabel('Action result')).toHaveText('No action')
  const scan = await new AxeBuilder({ page }).include('dialog').analyze()
  expect(scan.violations).toEqual([])
  if (['chromium', 'chromium-mobile'].includes(info.project.name)) {
    await mkdir('docs/evidence/expansion/I09-components', { recursive: true })
    await page.screenshot({
      path: `docs/evidence/expansion/I09-components/sync-recovery-${page.viewportSize()?.width}.png`,
      fullPage: true,
    })
  }
  await dialog.getByRole('checkbox').check()
  const box = await proceed.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(44)
  await proceed.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByLabel('Action result')).toHaveText('{"allowMissingAttachments":true}')
  await expect(page.getByRole('button', { name: 'Review account refresh' })).toBeFocused()
})

test('stale and unknown recovery reviews require refresh before an account action', async ({
  page,
}) => {
  for (const mode of ['stale', 'unknown']) {
    await page.goto('/tests/ui/sync-recovery.html?mode=' + mode)
    await page.getByRole('button', { name: 'Review account refresh' }).click()
    await expect(
      page.getByRole('button', { name: 'Keep device copy and refresh account', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Refresh recovery review' }).click()
    await page
      .getByRole('button', { name: 'Keep device copy and refresh account', exact: true })
      .click()
    await expect(page.getByLabel('Action result')).toHaveText('{"allowMissingAttachments":false}')
  }
})

test('unfinished replacement routes to its existing review and cancellation performs no recovery', async ({
  page,
}) => {
  await page.goto('/tests/ui/sync-recovery.html?mode=blocked')
  await page.getByRole('button', { name: 'Review account refresh' }).click()
  await expect(
    page.getByRole('button', { name: 'Keep device copy and refresh account', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByLabel('Action result')).toHaveText('No action')
  await page.getByRole('button', { name: 'Review account refresh' }).click()
  await page.getByRole('button', { name: 'Review unfinished connection' }).click()
  await expect(page.getByLabel('Action result')).toHaveText('Existing request review')
})
