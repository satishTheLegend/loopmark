import { test, expect, type Page } from '@playwright/test'
import { signIn, chooseAccount, createProject, origin } from '../cloud/helpers'

async function edit(page: Page, name: string, notes: string, tool: string) {
  await page.getByRole('button', { name: 'Edit project details' }).click()
  await page.getByLabel('Project name', { exact: true }).fill(name)
  await page.getByLabel('Project notes').fill(notes)
  await page.getByLabel('Hook or needle size').fill(tool)
  await page.getByRole('button', { name: 'Save details', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
test('actual two-device conflict requires a fresh review, preserves device recovery, and converges after explicit cloud choice', async ({
  browser,
}) => {
  test.setTimeout(120000)
  const first = await browser.newContext(),
    second = await browser.newContext(),
    fresh = await browser.newContext()
  try {
    const a = await first.newPage(),
      b = await second.newPage(),
      c = await fresh.newPage()
    const email = `loopmark-conflict-ui-${crypto.randomUUID()}@example.invalid`
    await signIn(a, email)
    await chooseAccount(a)
    await createProject(a, 'Original cardigan')
    await expect(a.locator('.sync-status')).toContainText('Synced to your account', {
      timeout: 20000,
    })
    await a.waitForTimeout(5100)
    await signIn(b, email)
    await chooseAccount(b)
    await b.getByRole('button', { name: /^Open Original cardigan\./ }).click()
    await first.setOffline(true)
    await edit(
      a,
      'Device cardigan',
      'Keep the two extra shoulder repeats from this device.',
      '4 mm',
    )
    await edit(
      b,
      'Cloud cardigan',
      'Use the revised shoulder repeat from the other device.',
      '5 mm',
    )
    await expect(b.locator('.sync-status')).toContainText('Synced to your account', {
      timeout: 20000,
    })
    await first.setOffline(false)
    await expect(a.locator('.sync-status')).toContainText('Changes need your review', {
      timeout: 25000,
    })
    await a.getByRole('button', { name: 'Sync details', exact: true }).click()
    await a.getByRole('button', { name: 'Review versions', exact: true }).click()
    const review = a.getByRole('dialog', { name: 'Review these versions' })
    await expect(review.getByRole('region', { name: 'This device version' })).toContainText(
      'Keep the two extra shoulder repeats from this device.',
    )
    await expect(review.getByRole('region', { name: 'This device version' })).toContainText('4 mm')
    await expect(review.getByRole('region', { name: 'Cloud version' })).toContainText(
      'Use the revised shoulder repeat from the other device.',
    )
    await expect(review.getByRole('region', { name: 'Cloud version' })).toContainText('5 mm')
    await edit(
      b,
      'Reviewed cloud cardigan',
      'The other device revised the sleeve again while this review was open.',
      '5.5 mm',
    )
    await expect(b.locator('.sync-status')).toContainText('Synced to your account', {
      timeout: 20000,
    })
    await expect(review.getByRole('alert')).toContainText(
      'New changes arrived while this review was open.',
      { timeout: 60000 },
    )
    await expect(
      review.getByRole('button', { name: 'Use cloud version', exact: true }),
    ).toHaveCount(0)
    await review.getByRole('button', { name: 'Refresh versions', exact: true }).click()
    await expect(review.getByRole('alert')).toHaveCount(0)
    await expect(review.getByRole('region', { name: 'Cloud version' })).toContainText(
      'The other device revised the sleeve again while this review was open.',
    )
    await expect(review.getByRole('region', { name: 'Cloud version' })).toContainText('5.5 mm')
    await expect(review.getByRole('region', { name: 'This device version' })).toContainText(
      'Keep the two extra shoulder repeats from this device.',
    )
    await review.getByRole('button', { name: 'Use cloud version', exact: true }).click()
    await expect(review).toHaveCount(0)
    await expect(
      a.getByRole('heading', { name: 'Reviewed cloud cardigan', exact: true, level: 1 }),
    ).toBeVisible()
    await a.getByRole('button', { name: 'Change collection' }).click()
    await a
      .getByRole('dialog')
      .getByRole('button', { name: /Recovered Account projects/ })
      .click()
    await a.goto(origin + '/#projects')
    await a.getByRole('button', { name: /^Open Device cardigan\./ }).click()
    await expect(
      a.getByText('Keep the two extra shoulder repeats from this device.', { exact: true }),
    ).toBeVisible()
    await a.reload()
    await expect(
      a.getByRole('heading', { name: 'Device cardigan', exact: true, level: 1 }),
    ).toBeVisible()
    await signIn(c, email)
    await chooseAccount(c)
    await c.getByRole('button', { name: /^Open Reviewed cloud cardigan\./ }).click()
    await expect(
      c.getByText('The other device revised the sleeve again while this review was open.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(c.getByRole('heading', { name: 'Device cardigan', exact: true })).toHaveCount(0)
  } finally {
    await first.close()
    await second.close()
    await fresh.close()
  }
})
