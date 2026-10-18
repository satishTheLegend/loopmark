import { expect, test } from '@playwright/test'
import { createProject, signIn, chooseAccount, origin } from '../cloud/helpers'
import { capturedReturn } from '../cloud/billing-fixture'

test('actual app keeps the fourth guest draft through hosted checkout and verifies it before explicit continuation', async ({
  page,
}) => {
  test.setTimeout(90000)
  let attemptId = ''
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/functions/v1/checkout')) {
      const body = request.postDataJSON()
      if (body?.action === 'prepare') attemptId = body.attemptId
    }
  })
  // No provider traffic leaves this test. The synthetic server fixture supplies provider truth.
  await page.route('https://rzp.io/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Synthetic hosted payment</title><p>Local fixture only</p>',
    }),
  )
  for (const name of ['Autumn cardigan', 'Winter blanket', 'Small scarf']) {
    await page.goto(origin + '/#projects')
    await createProject(page, name)
  }
  await page.goto(origin + '/#projects')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name', { exact: true }).fill('Fourth local shawl')
  await page.getByLabel('Project notes').fill('Keep this local until I choose to connect it.')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await page.getByRole('button', { name: 'Keep draft and see upgrade', exact: true }).click()
  await signIn(page, `loopmark-purchase-ui-${crypto.randomUUID()}@example.invalid`)
  await expect(page.locator('.collection-heading')).toContainText('Personal projects')
  await page.getByRole('button', { name: 'See upgrade price', exact: true }).click()
  await page.getByRole('button', { name: 'Upgrade for ₹499.00', exact: true }).click()
  await expect(page).toHaveURL(/^https:\/\/rzp\.io\//)
  await expect.poll(() => attemptId).toMatch(/^[a-f0-9-]{36}$/)
  await page.goto(await capturedReturn(attemptId))
  await expect(page).toHaveURL(new RegExp(origin.replaceAll('.', '\\.') + '/#account$'))
  await expect(page.getByText('Your upgrade is active.', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Your upgrade is active.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue saved action', exact: true }).click()
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Fourth local shawl')
  await expect(page.getByLabel('Project notes')).toHaveValue(
    'Keep this local until I choose to connect it.',
  )
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Fourth local shawl', exact: true, level: 1 }),
  ).toBeVisible()
  await chooseAccount(page)
  await expect(page.getByRole('button', { name: /^Open Fourth local shawl\./ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Change collection' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Personal projects/ })
    .click()
  await expect(page.getByRole('button', { name: /^Open Fourth local shawl\./ })).toBeVisible()
})
