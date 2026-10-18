import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
const path = '/tests/ui/native-backup.html'
const calls = async (page: Page) =>
  JSON.parse((await page.getByLabel('Inbox calls').textContent()) ?? '[]') as Array<{
    action: string
    scope?: { generation: number; key: { collectionId: string } }
    outcome?: { state: string }
  }>
test('receiving a backup only shows metadata; review explicitly binds and reads once with its original operation token', async ({
  page,
}) => {
  await page.goto(path)
  const notice = page.getByRole('region', { name: 'Incoming backup file' })
  await expect(notice).toContainText('my-scarf-backup.json')
  await expect(notice).toContainText('24 bytes')
  await expect(notice).toContainText('Nothing has been imported or uploaded')
  expect(await calls(page)).toEqual([])
  await notice.getByRole('button', { name: 'Review backup file', exact: true }).click()
  await expect(page.getByLabel('Review count')).toHaveText('1')
  expect((await calls(page)).map((call) => call.action)).toEqual(['bind', 'read', 'review'])
  expect(
    JSON.parse((await page.getByLabel('Reviewed source').textContent()) ?? '{}'),
  ).toMatchObject({
    source: { generation: 1, key: { collectionId: 'personal' } },
    operationToken: '11111111-1111-4111-8111-111111111111',
    type: 'application/json',
  })
  expect(
    (await new AxeBuilder({ page }).include('[aria-label="Incoming backup file"]').analyze())
      .violations,
  ).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
test('already-handled deliveries cannot read or import again and can be explicitly dismissed', async ({
  page,
}) => {
  await page.goto(path + '?scenario=duplicate')
  const notice = page.getByRole('region', { name: 'Incoming backup file' })
  await expect(notice).toContainText('Receiving it again has not imported another copy.')
  await expect(notice.getByRole('button', { name: 'Review backup file' })).toHaveCount(0)
  expect(await calls(page)).toEqual([])
  await notice.getByRole('button', { name: 'Dismiss backup file' }).click()
  await expect(notice).toHaveCount(0)
  expect((await calls(page)).map((call) => call.action)).toEqual(['finish'])
  expect((await calls(page))[0].outcome).toEqual({ state: 'dismissed' })
  await expect(page.getByLabel('Review count')).toHaveText('0')
})
test('a failed intake shows safe help and dismissal reveals the original waiting backup without reading it', async ({
  page,
}) => {
  await page.goto(path + '?scenario=failed')
  const notice = page.getByRole('region', { name: 'Incoming backup file' })
  await expect(notice.getByRole('alert')).toContainText('Check the highlighted information.')
  await expect(notice.getByRole('button', { name: 'Review backup file' })).toHaveCount(0)
  await notice.getByRole('button', { name: 'Dismiss backup file' }).click()
  await expect(notice).toContainText('my-scarf-backup.json')
  await expect(notice.getByRole('button', { name: 'Review backup file' })).toBeEnabled()
  expect((await calls(page)).map((call) => call.action)).toEqual(['finish'])
  await expect(page.getByLabel('Review count')).toHaveText('0')
})
test('another collection cannot review a bound file but can dismiss; the same collection may re-review after restart', async ({
  page,
}) => {
  await page.goto(path + '?scenario=other')
  const notice = page.getByRole('region', { name: 'Incoming backup file' })
  await expect(notice).toContainText('Return to that collection to continue')
  await expect(notice.getByRole('button', { name: 'Review backup file' })).toBeDisabled()
  await notice.getByRole('button', { name: 'Dismiss backup file' }).click()
  expect((await calls(page))[0]).toMatchObject({
    action: 'finish',
    scope: { key: { collectionId: 'personal' } },
    outcome: { state: 'dismissed' },
  })
  await page.goto(path + '?scenario=generation')
  await notice.getByRole('button', { name: 'Review backup file' }).click()
  await expect(page.getByLabel('Review count')).toHaveText('1')
  expect((await calls(page)).find((call) => call.action === 'bind')?.scope?.generation).toBe(1)
})
for (const action of ['Unmount notice', 'Switch collection', 'Receive newer file'] as const) {
  test(`a late file read cannot open review after ${action}`, async ({ page }) => {
    await page.goto(path + '?scenario=late')
    await page.getByRole('button', { name: 'Review backup file', exact: true }).click()
    await expect
      .poll(async () => (await calls(page)).some((call) => call.action === 'read'))
      .toBe(true)
    await page.getByRole('button', { name: action, exact: true }).click()
    await page.getByRole('button', { name: 'Release file read' }).click()
    await page.waitForTimeout(50)
    await expect(page.getByLabel('Review count')).toHaveText('0')
    expect((await calls(page)).filter((call) => call.action === 'review')).toEqual([])
    if (action === 'Receive newer file')
      await expect(page.getByRole('region', { name: 'Incoming backup file' })).toContainText(
        'newer-backup.json',
      )
  })
}
