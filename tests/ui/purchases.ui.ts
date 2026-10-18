import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
const path = '/tests/ui/purchases.html'
const price = 'Upgrade for ₹437.50'
const log = async (page: Page) =>
  JSON.parse((await page.getByLabel('Fixture action log').textContent()) ?? '[]') as Array<{
    action: string
    attemptId?: string
    collection?: { namespace: string }
  }>
const purchases = async (page: Page) =>
  (await log(page)).filter((item) => item.action === 'provider:purchase')
async function buy(page: Page) {
  await page.getByRole('button', { name: 'See upgrade price', exact: true }).click()
  await page.getByRole('button', { name: price, exact: true }).click()
}

test('actual catalog price, pending restart and explicit retry keep one immutable checkout', async ({
  page,
}) => {
  await page.goto(path)
  await expect(page.getByRole('button', { name: price })).toHaveCount(0)
  await expect(page.getByText('₹299')).toHaveCount(0)
  await buy(page)
  await expect(page.getByText('A purchase is unfinished.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: price })).toBeDisabled()
  const first = (await purchases(page))[0]
  expect(first.collection?.namespace).toContain('guest')
  await page.reload()
  await expect(page.getByText('A purchase is unfinished.', { exact: false })).toBeVisible()
  expect(await purchases(page)).toHaveLength(1)
  await page.getByRole('button', { name: 'Check this purchase', exact: true }).click()
  expect(await purchases(page)).toHaveLength(1)
  await page.getByRole('button', { name: 'Reopen this checkout', exact: true }).click()
  await expect.poll(async () => (await purchases(page)).length).toBe(2)
  expect((await purchases(page))[1].attemptId).toBe(first.attemptId)
})

test('explicit native cancellation permits a fresh intentional retry and retains cancellation copy', async ({
  page,
}) => {
  await page.goto(path + '?platform=ios')
  await page.getByRole('button', { name: 'Fixture: cancel next purchase' }).click()
  await buy(page)
  await expect(page.getByText('Status: Cancelled.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: price })).toBeEnabled()
  await expect(page.getByText('Status: Cancelled.', { exact: true })).toBeVisible()
  expect((await log(page)).some((item) => item.action === 'server:purchase-restore:cancel')).toBe(
    true,
  )
  const first = (await purchases(page))[0].attemptId
  await page.getByRole('button', { name: price }).click()
  await expect.poll(async () => (await purchases(page)).length).toBe(2)
  expect((await purchases(page))[1].attemptId).not.toBe(first)
})

test('free-limit guest draft survives optional login and resumes only after explicit continuation', async ({
  page,
}) => {
  await page.goto(path + '?scenario=draft')
  await page.getByLabel('Project name', { exact: true }).fill('Fourth unfinished scarf')
  await page.getByLabel('Hook or needle size', { exact: true }).fill('4.5 mm')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await page.getByRole('button', { name: 'Keep draft and see upgrade' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Your new-project draft is kept', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Fixture: sign in' }).click()
  await buy(page)
  await expect(page.getByLabel('Saved project count')).toHaveText('3')
  await page.getByRole('button', { name: 'Fixture: verify purchase' }).click()
  await expect(page.getByRole('button', { name: 'Continue saved action' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Check this purchase', exact: true }).click()
  await expect(page.getByText('Your upgrade is active.', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await log(page)).filter((item) => item.action === 'project:save')).toHaveLength(1)
  await page.getByRole('button', { name: 'Continue saved action' }).click()
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(
    'Fourth unfinished scarf',
  )
  await expect(page.getByLabel('Hook or needle size', { exact: true })).toHaveValue('4.5 mm')
  await expect(page.getByLabel('Saved project count')).toHaveText('3')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Saved project count')).toHaveText('4')
})

test('an unverified paid return is only a status request and never an access grant', async ({
  page,
}) => {
  await page.goto(path)
  await buy(page)
  await page.getByRole('button', { name: 'Fixture: unverified paid return' }).click()
  await expect
    .poll(async () => (await log(page)).some((item) => item.action === 'server:checkout:verify'))
    .toBe(true)
  await expect(page.getByText('Your upgrade is active.', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue saved action' })).toHaveCount(0)
  await expect(page.getByLabel('Saved project count')).toHaveText('3')
})

test('pending recovery keeps its local key unexported until confirmation, then exports the same key safely', async ({
  page,
}) => {
  await page.goto(path)
  await page.getByText('Purchase recovery and recovery key', { exact: true }).click()
  await page.getByRole('button', { name: 'Send recovery verification code' }).click()
  await page.getByLabel('Fresh email code', { exact: true }).fill('123456')
  await page.getByLabel('Payment or original transaction ID', { exact: true }).fill('pay_synthetic')
  await page.getByRole('button', { name: 'Request purchase recovery', exact: true }).click()
  await expect(page.getByText('Recovery is pending review.', { exact: false })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Export latest recovery key from this device' }),
  ).toHaveCount(0)
  await expect(page.getByLabel('Fresh email code', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: 'Fixture: approve recovery' }).click()
  await page.getByRole('button', { name: 'Check recovery request' }).click()
  await expect(page.getByText('Purchase recovered.', { exact: false })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export latest recovery key from this device' }).click()
  const downloaded = await download
  expect(downloaded.suggestedFilename()).toBe('loopmark-purchase-recovery.json')
  const contents = JSON.parse(await readFile((await downloaded.path())!, 'utf8'))
  expect(contents.recoveryKey).toMatch(/^[a-f0-9]{64}$/)
  expect(contents).not.toHaveProperty('accountId')
  await expect(page.getByRole('main')).not.toContainText(contents.recoveryKey)
})

test('failed recovery-key setup remains retryable with the saved local key', async ({ page }) => {
  await page.goto(path)
  await page.getByText('Purchase recovery and recovery key', { exact: true }).click()
  await page.getByLabel('Fresh email code', { exact: true }).fill('123456')
  await page.getByRole('button', { name: 'Fixture: toggle offline' }).click()
  await page.getByRole('button', { name: 'Create recovery key', exact: true }).click()
  await expect(page.getByText('Unfinished key setup from', { exact: false })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Export latest recovery key from this device' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Fixture: toggle offline' }).click()
  await page.getByRole('button', { name: 'Create recovery key', exact: true }).click()
  await expect(page.getByText('Recovery key saved.', { exact: false })).toBeVisible()
  await expect(page.getByText('Unfinished key setup from', { exact: false })).toHaveCount(0)
  expect(
    (await log(page)).filter((item) => item.action === 'server:purchase-recovery:set-key'),
  ).toHaveLength(1)
})

test('a key replaced elsewhere is clearly labelled and cannot be exported as current', async ({
  page,
}) => {
  await page.goto(path)
  await page.getByText('Purchase recovery and recovery key', { exact: true }).click()
  await page.getByLabel('Fresh email code', { exact: true }).fill('123456')
  await page.getByRole('button', { name: 'Create recovery key', exact: true }).click()
  await expect(
    page.getByText("This device's recovery key was confirmed current", { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Replace recovery key', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Export latest recovery key from this device' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Fixture: rotate key elsewhere' }).click()
  await page.getByRole('button', { name: 'Check current recovery key', exact: true }).click()
  await expect(
    page.getByText('A recovery key saved on this device has been replaced.', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Export latest recovery key from this device' }),
  ).toHaveCount(0)
  await expect(
    page.getByText("This device's recovery key was confirmed current", { exact: false }),
  ).toHaveCount(0)
})

test('offline key status retains a timestamped last result and explicit export', async ({
  page,
}) => {
  await page.goto(path)
  await page.getByText('Purchase recovery and recovery key', { exact: true }).click()
  await page.getByLabel('Fresh email code', { exact: true }).fill('123456')
  await page.getByRole('button', { name: 'Create recovery key', exact: true }).click()
  await expect(
    page.getByText("This device's recovery key was confirmed current on", { exact: false }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Fixture: toggle offline' }).click()
  await page.getByRole('button', { name: 'Check current recovery key', exact: true }).click()
  await expect(
    page.getByText('The current recovery key could not be checked.', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByText("This device's recovery key was confirmed current on", { exact: false }),
  ).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export latest recovery key from this device' }).click()
  expect((await downloaded).suggestedFilename()).toBe('loopmark-purchase-recovery.json')
})

test('purchase and recovery controls reflow, pass axe and support keyboard activation', async ({
  page,
  browserName,
}, testInfo) => {
  await page.goto(path)
  const show = page.getByRole('button', { name: 'See upgrade price', exact: true })
  await show.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: price })).toBeVisible()
  const summary = page.getByText('Purchase recovery and recovery key', { exact: true })
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Fresh email code', { exact: true })).toBeVisible()
  await page.getByLabel('Fresh email code', { exact: true }).focus()
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
  await expect(
    page.getByRole('button', { name: 'Check current recovery key', exact: true }),
  ).toBeFocused()
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 950 })
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})))
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    if (testInfo.project.name === 'chromium')
      await page.screenshot({
        path: testInfo.outputPath(`purchase-recovery-${width}.png`),
        fullPage: true,
      })
  }
  if (testInfo.project.name === 'chromium')
    await page.screenshot({ path: '/tmp/loopmark-purchases-ui.png', fullPage: true })
})
