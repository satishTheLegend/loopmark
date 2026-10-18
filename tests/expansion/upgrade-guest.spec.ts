import { test, expect } from '@playwright/test'

test('a fourth-project gate durably keeps the draft while an unconfigured upgrade stays honest', async ({
  page,
}) => {
  await page.goto('/')
  for (const name of ['Cardigan', 'Blanket', 'Scarf']) {
    await page.goto('/#projects')
    await page.getByRole('button', { name: 'New project', exact: true }).click()
    await page.getByLabel('Project name', { exact: true }).fill(name)
    await page.getByRole('button', { name: 'Create project', exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible()
  }
  await page.goto('/#projects')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name', { exact: true }).fill('Fourth project kept safely')
  await page.getByLabel('Project notes').fill('Use the smaller hook for the border.')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await page.getByRole('button', { name: 'Keep draft and see upgrade', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Account & device', exact: true })).toBeVisible()
  await expect(
    page.getByText('Your new-project draft is kept in this collection.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByText('Purchases are unavailable in this copy of Loopmark.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Upgrade for/ })).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByText('Your new-project draft is kept in this collection.', { exact: false }),
  ).toBeVisible()
  await page.goto('/#projects')
  await expect(
    page.getByRole('button', { name: /^Open Fourth project kept safely\./ }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(
    'Fourth project kept safely',
  )
  await expect(page.getByLabel('Project notes')).toHaveValue('Use the smaller hook for the border.')
})

test('invalid payment return is scrubbed immediately and never grants access', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr')
      requests.push(request.url())
  })
  await page.goto('/purchase/return?razorpay_signature=untrusted&upgraded=true#paid')
  await expect(page).toHaveURL(/\/#account$/)
  await expect(page.getByRole('heading', { name: 'Account & device', exact: true })).toBeVisible()
  await expect(page.getByText('Your upgrade is active.', { exact: true })).toHaveCount(0)
  expect(
    requests.some((url) => url.includes('razorpay_signature') || url.includes('upgraded=true')),
  ).toBe(false)
})
