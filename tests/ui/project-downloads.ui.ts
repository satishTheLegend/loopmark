import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
const path = '/tests/ui/project-downloads.html'
test('offline state, explicit confirmation, retained files and protected errors stay independent of capture', async ({
  page,
}) => {
  await page.goto(path)
  const panel = page.getByRole('region', { name: 'Project files' })
  await expect(panel).toContainText('1 attachment needs downloading')
  await page.getByRole('button', { name: 'Toggle connection' }).click()
  await expect(panel.getByRole('button', { name: 'Download project files' })).toBeDisabled()
  await page.getByRole('button', { name: 'Toggle connection' }).click()
  await panel.getByRole('button', { name: 'Download project files' }).click()
  await expect(panel).toContainText('Available offline on this device')
  await expect(page.getByLabel('Refresh count')).toHaveText('1')
  await panel.getByRole('button', { name: 'Remove downloads', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep downloads' }).click()
  await expect(page.getByLabel('Refresh count')).toHaveText('1')
  await panel.getByRole('button', { name: 'Remove downloads', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove downloaded files', exact: true })
    .click()
  await expect(panel).toContainText('1 attachment was kept for local work or a backup in progress.')
  await expect(panel).toContainText('1 attachment needs downloading')
  await page.getByRole('button', { name: 'Protect files' }).click()
  await panel.getByRole('button', { name: 'Remove downloads', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove downloaded files', exact: true })
    .click()
  await expect(panel.getByRole('alert')).toContainText(
    'These attachments need to stay on this device.',
  )
  const results = await new AxeBuilder({ page }).include('[aria-label="Project files"]').analyze()
  expect(results.violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
test('cancel and unmount abort downloads; late inspection cannot replace a different project status', async ({
  page,
}) => {
  await page.goto(path)
  const panel = page.getByRole('region', { name: 'Project files' })
  await expect(panel).toContainText('1 attachment needs downloading')
  await page.getByRole('button', { name: 'Hold download' }).click()
  await panel.getByRole('button', { name: 'Download project files' }).click()
  await panel.getByRole('button', { name: 'Cancel download' }).click()
  await expect(panel).toContainText('Download cancelled.')
  await expect(panel).toContainText('1 attachment needs downloading')
  await page.getByRole('button', { name: 'Hold inspection' }).click()
  await page.getByRole('button', { name: 'Select other project' }).click()
  await expect(panel).toContainText('2 attachments need downloading')
  await page.getByRole('button', { name: 'Release inspection' }).click()
  await expect(panel).toContainText('2 attachments need downloading')
  await panel.getByRole('button', { name: 'Download project files' }).click()
  await page.getByRole('button', { name: 'Unmount panel' }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.getByLabel('Refresh count')).toHaveText('1')
})
test('text-only local projects show verified availability without download or removal controls', async ({
  page,
}) => {
  await page.goto(path)
  await page.getByRole('button', { name: 'Select local collection' }).click()
  await page.getByRole('button', { name: 'Select text project' }).click()
  const panel = page.getByRole('region', { name: 'Project files' })
  await expect(panel).toContainText('Available offline on this device')
  await expect(panel.getByRole('button')).toHaveCount(0)
  await expect(panel).toContainText('Export a complete backup')
})

test('own refresh may change revision without cancelling removal success or accepting a stale inspection', async ({
  page,
}) => {
  await page.goto(path + '?revision-refresh')
  const panel = page.getByRole('region', { name: 'Project files' })
  await expect(panel).toContainText('1 attachment needs downloading')
  // Hold the old partial state while the download/action refresh finishes.
  await page.getByRole('button', { name: 'Hold inspection' }).click()
  await panel.getByRole('button', { name: 'Download project files', exact: true }).click()
  await expect(panel).toContainText('Available offline on this device')
  await expect(page.getByLabel('Refresh count')).toHaveText('1')
  await page.getByRole('button', { name: 'Release inspection' }).click()
  await page.waitForTimeout(50)
  await expect(panel).toContainText('Available offline on this device')
  await panel.getByRole('button', { name: 'Remove downloads', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove downloaded files', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Refresh count')).toHaveText('2')
  await expect(panel).toContainText('1 download removed from this device.')
  await expect(panel).toContainText('1 attachment was kept for local work or a backup in progress.')
  await expect(panel).toContainText('1 attachment needs downloading')
  await page.getByRole('button', { name: 'Refresh project revision' }).click()
  await expect(panel).toContainText('1 download removed from this device.')
  await expect(
    panel.getByRole('button', { name: 'Download project files', exact: true }),
  ).toBeEnabled()
})

test('switching project identity still aborts a held download even though revision refresh does not', async ({
  page,
}) => {
  await page.goto(path + '?revision-refresh')
  const panel = page.getByRole('region', { name: 'Project files' })
  await expect(panel).toContainText('1 attachment needs downloading')
  await page.getByRole('button', { name: 'Hold download' }).click()
  await panel.getByRole('button', { name: 'Download project files', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Cancel download' })).toBeVisible()
  await page.getByRole('button', { name: 'Select other project' }).click()
  await expect(panel).toContainText('2 attachments need downloading')
  await expect(panel.getByRole('button', { name: 'Cancel download' })).toHaveCount(0)
  await expect(page.getByLabel('Refresh count')).toHaveText('0')
  await expect(page.getByLabel('Fixture action log')).toContainText('aborted')
  await expect(panel).not.toContainText('Download cancelled.')
})
