import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'

test('actual app previews the exact diagnostic bytes before explicit local download without including craft content', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name', { exact: true }).fill('Private cardigan sentinel')
  await page
    .getByLabel('Project notes')
    .fill('private-maker@example.invalid secret craft instruction')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/#account')
  const sent: string[] = [],
    downloads: string[] = []
  page.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType())) sent.push(request.url())
  })
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  const button = page.getByRole('button', { name: 'Preview diagnostic report' })
  await button.click()
  const dialog = page.getByRole('dialog', { name: 'Diagnostic preview' })
  const text = await dialog.getByLabel('Diagnostic JSON').inputValue()
  const report = JSON.parse(text)
  expect(report).toMatchObject({
    format: 'loopmark-diagnostics',
    version: 1,
    platform: 'web',
    queue: { total: 0 },
  })
  expect(text).not.toMatch(/Private cardigan|private-maker|secret craft/)
  expect(downloads).toEqual([])
  expect(sent).toEqual([])
  expect(
    (
      await new AxeBuilder({ page })
        .include('dialog')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([])
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download diagnostic file' }).click()
  expect(await readFile((await (await downloading).path())!, 'utf8')).toBe(text)
  expect(sent).toEqual([])
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(button).toBeFocused()
})
