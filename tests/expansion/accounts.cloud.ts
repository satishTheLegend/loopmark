import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { signIn, chooseAccount, createProject, deliveredCode, origin } from '../cloud/helpers'

test('actual app explicitly connects a local collection, syncs between two devices, and keeps a separate copy on sign-out', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const first = await browser.newContext(),
    second = await browser.newContext()
  const email = `loopmark-ui-${crypto.randomUUID()}@example.invalid`
  try {
    const a = await first.newPage(),
      b = await second.newPage()
    await a.goto(origin)
    await createProject(a, 'Local cardigan to connect')
    await signIn(a, email)
    await expect(a.locator('.collection-heading')).toContainText('Personal projects')
    await chooseAccount(a)
    await expect(a.getByRole('button', { name: /Open Local cardigan/ })).toHaveCount(0)
    await a.getByRole('button', { name: 'Change collection' }).click()
    await a
      .getByRole('dialog')
      .getByRole('button', { name: /Personal projects/ })
      .click()
    await expect(a.getByRole('button', { name: /Open Local cardigan/ })).toBeVisible()
    await a.goto(origin + '/#account')
    const preparation: string[] = []
    a.on('request', (request) => {
      if (/\/functions\/v1\/collection-attach$/.test(request.url()) && request.method() === 'POST')
        preparation.push(request.postData() ?? '')
    })
    await a.getByRole('button', { name: 'Review connection', exact: true }).click()
    await expect(a.getByRole('dialog')).toContainText('Nothing is uploaded until you confirm')
    expect(preparation).toEqual([])
    await a.getByRole('button', { name: 'Confirm connection' }).click()
    await expect(a.locator('.collection-heading')).toContainText('Account projects')
    await expect(a.getByRole('button', { name: /Open Local cardigan/ })).toBeVisible()
    expect(preparation.some((body) => JSON.parse(body).action === 'prepare')).toBe(true)
    // Respect the isolated local Auth service's actual five-second code-request frequency.
    await a.waitForTimeout(5100)
    await signIn(b, email)
    await chooseAccount(b)
    await b.getByRole('button', { name: /Open Local cardigan/ }).click()
    await b.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
    await b.getByLabel('What will you do next?').fill('Start the sleeves on the other device')
    await b.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
    await expect(b.getByRole('dialog')).toHaveCount(0)
    await a.getByRole('button', { name: /Open Local cardigan/ }).click()
    await expect(a.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
      'Start the sleeves on the other device',
      { timeout: 20_000 },
    )
    await a.goto(origin + '/#account')
    await a.getByRole('button', { name: 'Check account usage' }).click()
    await expect(
      a.getByRole('region', { name: 'Project capacity and account storage' }),
    ).toContainText('Cloud files present')
    await a.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(a.getByRole('radio', { name: /Keep on this device/ })).toBeChecked()
    await a.getByRole('button', { name: 'Sign out and keep copy' }).click()
    await expect(a.locator('.collection-heading')).toContainText('Kept on this device')
    await expect(a.getByLabel('Email address', { exact: true })).toBeVisible()
    await a.goto(origin)
    await a.getByRole('button', { name: /Open Local cardigan/ }).click()
    await expect(a.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
      'Start the sleeves on the other device',
    )
  } finally {
    await first.close()
    await second.close()
  }
})

test('actual account deletion retains reviewed work and a private status receipt after sign-out and reload', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const email = `loopmark-delete-ui-${crypto.randomUUID()}@example.invalid`
  await signIn(page, email)
  await chooseAccount(page)
  let releasePush!: () => void
  const pushGate = new Promise<void>((resolve) => {
    releasePush = resolve
  })
  await page.route('**/functions/v1/sync-push', async (route) => {
    await pushGate
    await route.continue()
  })
  await createProject(page, 'Keep after deleting cloud account')
  await page.goto(origin + '/#account')
  await page.getByRole('button', { name: 'Review account deletion' }).click()
  await expect(page.getByRole('radio', { name: /Keep a separate local copy/ })).toBeChecked()
  releasePush()
  await expect(page.getByText('Synced to your account', { exact: true })).toBeVisible()
  await page.waitForTimeout(5100)
  const code = await deliveredCode(email, () =>
    page.getByRole('button', { name: 'Send deletion code' }).click(),
  )
  await page.getByLabel('Deletion code', { exact: true }).fill(code)
  await page.getByRole('checkbox', { name: /Delete this cloud account/ }).check()
  await page.getByRole('button', { name: 'Delete account', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('changed elsewhere')
  await page.getByRole('button', { name: 'Review device copies again' }).click()
  await expect(page.getByRole('checkbox', { name: /Delete this cloud account/ })).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: /Delete this cloud account/ }).check()
  await page.getByRole('button', { name: 'Delete account', exact: true }).click()
  const receipt = page.getByRole('region', { name: 'Account deletion receipt' })
  await expect(receipt).toContainText('request is accepted', { timeout: 30_000 })
  await expect(receipt).toContainText('were kept as separate local collections')
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible()
  await page.reload()
  await expect(receipt).toContainText('request is accepted')
  await receipt.getByRole('button', { name: 'Check deletion status' }).click()
  await expect(receipt.getByRole('alert')).toHaveCount(0)
  const downloading = page.waitForEvent('download')
  await receipt.getByRole('button', { name: 'Save deletion receipt' }).click()
  const file = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'))
  expect(file.receiptToken).toMatch(/^[a-f0-9]{64}$/)
  expect(file.localOutcome).toBe('kept')
  expect(file).not.toHaveProperty('accountId')
  await page.goto(origin)
  await expect(
    page.getByRole('button', { name: /Open Keep after deleting cloud account/ }),
  ).toBeVisible()
})
