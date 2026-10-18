import { expect, test } from '@playwright/test'

test('a late initial saved-link lookup cannot close a newly opened checkpoint form', async ({
  page,
}) => {
  await page.goto('/tests/ui/app-navigation.html?scenario=initial-link')
  await expect(page.getByRole('heading', { name: 'Navigation scarf', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.navigationFixture.linkCalls)).toBe(2)
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page.getByLabel('What will you do next?').fill('Keep my newly opened form')
  await page.evaluate(() => window.navigationFixture.releaseLinks())
  await expect(page.getByLabel('What will you do next?')).toHaveValue('Keep my newly opened form')
})

test('a newer form takes priority over a pending platform project link', async ({ page }) => {
  await page.goto('/tests/ui/app-navigation.html')
  await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeVisible()
  await page.evaluate(() => window.navigationFixture.emitLink())
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name').fill('Keep the new project draft')
  await page.evaluate(() => window.navigationFixture.releaseLinks())
  await expect(page.getByLabel('Project name')).toHaveValue('Keep the new project draft')
  await expect(page).not.toHaveURL(/#project=/)
})

test('delayed equivalent and obsolete hash events do not dismiss a new project form', async ({
  page,
}) => {
  await page.goto('/tests/ui/app-navigation.html')
  await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeVisible()
  await page.evaluate(() => {
    window.navigationFixture.holdHashes()
    location.hash = 'guide'
  })
  await expect.poll(() => page.evaluate(() => window.navigationFixture.heldHashes)).toBe(1)
  await page.evaluate(() => {
    location.hash = 'projects'
  })
  await expect.poll(() => page.evaluate(() => window.navigationFixture.heldHashes)).toBe(2)
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name').fill('Still working here')
  await page.evaluate(() => window.navigationFixture.releaseHashes())
  await expect(page.getByLabel('Project name')).toHaveValue('Still working here')
})

test('a current project link still opens its project when no newer interaction supersedes it', async ({
  page,
}) => {
  await page.goto('/tests/ui/app-navigation.html')
  await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeVisible()
  await page.evaluate(() => window.navigationFixture.emitLink())
  await page.evaluate(() => window.navigationFixture.releaseLinks())
  await expect(page.getByRole('heading', { name: 'Navigation scarf', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#project=/)
})
