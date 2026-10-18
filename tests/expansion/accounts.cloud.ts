import { test, expect, type Page, type Route } from '@playwright/test'
import type { Command, PullPage, Receipt } from '../../src/domain/contracts'
import { readFile } from 'node:fs/promises'
import { signIn, chooseAccount, createProject, deliveredCode, origin } from '../cloud/helpers'

// A previous empty-account cycle can still say "Synced" just after a local save.
// Hold this exact mutation until its waiting state is visible, then require its
// receipt to pass through pull before the caller relies on a settled review.
async function holdProjectPush(page: Page, name: string) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let submitted!: (command: Command) => void
  const commandReady = new Promise<Command>((resolve) => {
    submitted = resolve
  })
  const pattern = '**/functions/v1/sync-push'
  const hold = async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const command = route.request().postDataJSON() as Command
    if (command.kind === 'project.create' && command.payload.project.name === name) {
      submitted(command)
      await gate
    }
    await route.continue()
  }
  await page.route(pattern, hold)
  return async () => {
    try {
      const syncLabel = page.locator('.sync-status > span:not(.sr-only)')
      await expect(syncLabel).toBeVisible({ timeout: 20000 })
      await expect(syncLabel).toHaveText(/waiting to sync|Syncing with your account/, {
        timeout: 20000,
      })
      const command = await commandReady
      const pushed = page.waitForResponse(
        (response) =>
          response.url().endsWith('/functions/v1/sync-push') &&
          response.request().method() === 'POST' &&
          response.request().postDataJSON()?.operationId === command.operationId,
        { timeout: 20000 },
      )
      const pulled = page.waitForResponse(
        async (response) => {
          if (!response.url().endsWith('/functions/v1/sync-pull') || !response.ok()) return false
          const body = (await response.json()) as PullPage
          return (
            body.collectionId === command.collectionId &&
            body.epoch === command.epoch &&
            body.entries.some((entry) => entry.operationId === command.operationId)
          )
        },
        { timeout: 20000 },
      )
      release()
      const [pushResponse, pullResponse] = await Promise.all([pushed, pulled])
      expect(pushResponse.ok()).toBe(true)
      const receipt = (await pushResponse.json()) as Receipt
      const pageResult = (await pullResponse.json()) as PullPage
      expect(pageResult.entries.find((entry) => entry.operationId === command.operationId)).toEqual(
        receipt,
      )
      expect(BigInt(pageResult.nextCursor)).toBeGreaterThanOrEqual(BigInt(receipt.cursor))
      await expect(syncLabel).toBeVisible({ timeout: 20000 })
      await expect(syncLabel).toHaveText('Synced to your account', { timeout: 20000 })
    } finally {
      release()
      await page.unroute(pattern, hold)
    }
  }
}

test('actual deletion removes the selected account copy only after explicit unique-work discard and preserves separate guest work', async ({
  page,
}) => {
  test.setTimeout(90000)
  const email = `loopmark-delete-remove-${crypto.randomUUID()}@example.invalid`
  await page.goto(origin)
  await createProject(page, 'Separate personal scarf')
  await signIn(page, email)
  await chooseAccount(page)
  const finishProjectSync = await holdProjectPush(page, 'Account copy to remove')
  await createProject(page, 'Account copy to remove')
  await finishProjectSync()
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page.getByLabel('What will you do next?').fill('Unsent draft explicitly discarded')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.goto(origin + '/#account')
  await page.getByRole('button', { name: 'Review account deletion' }).click()
  await page.getByRole('radio', { name: /Remove this account’s device copy/ }).check()
  await page.waitForTimeout(5100)
  const code = await deliveredCode(email, () =>
    page.getByRole('button', { name: 'Send deletion code' }).click(),
  )
  await page.getByLabel('Deletion code', { exact: true }).fill(code)
  await page.getByRole('checkbox', { name: /Delete this cloud account/ }).check()
  await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: /Discard the unsent/ }).check()
  await page.getByRole('button', { name: 'Delete account', exact: true }).click()
  const receipt = page.getByRole('region', { name: 'Account deletion receipt' })
  await expect(receipt).toContainText('request is accepted', { timeout: 30000 })
  await expect(receipt).toContainText('device copies were removed')
  await page.reload()
  await expect(receipt).toContainText('device copies were removed')
  await page.goto(origin + '/#projects')
  await expect(page.getByRole('button', { name: /^Open Separate personal scarf\./ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Open Account copy to remove\./ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Change collection' }).click()
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: /Account projects|Recovered|Kept on this device/ }),
  ).toHaveCount(0)
})

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
  const finishProjectSync = await holdProjectPush(page, 'Keep after deleting cloud account')
  await createProject(page, 'Keep after deleting cloud account')
  await page.goto(origin + '/#account')
  await page.getByRole('button', { name: 'Review account deletion' }).click()
  await expect(page.getByRole('radio', { name: /Keep a separate local copy/ })).toBeChecked()
  await finishProjectSync()
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
