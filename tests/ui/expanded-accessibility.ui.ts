import { expect, test, type Page } from '@playwright/test'

test('sync announces each actionable transition once without repeating polling updates', async ({
  page,
}) => {
  await page.goto('/tests/ui/index.html?scenario=sync-announcement')
  const live = page.locator('.sync-status [role=status]')
  await expect(live).toHaveAttribute('aria-live', 'polite')
  await expect(live).toHaveText('')
  await live.evaluate((node) => {
    const state = window as typeof window & { announcements?: string[] }
    state.announcements = []
    new MutationObserver(() => {
      if (node.textContent) state.announcements!.push(node.textContent)
    }).observe(node, { subtree: true, characterData: true, childList: true })
  })
  await page.getByRole('button', { name: 'Receive failure' }).click()
  await expect(live).toHaveText('Sync needs your attention')
  for (let i = 0; i < 3; i++)
    await page.getByRole('button', { name: 'Repeat status update' }).click()
  expect(
    await page.evaluate(
      () => (window as typeof window & { announcements: string[] }).announcements,
    ),
  ).toEqual(['Sync needs your attention'])
  await page.getByRole('button', { name: 'Start sync' }).click()
  await expect(live).toHaveText('')
  await page.getByRole('button', { name: 'Receive failure' }).click()
  await expect(live).toHaveText('Sync needs your attention')
  expect(
    await page.evaluate(
      () => (window as typeof window & { announcements: string[] }).announcements,
    ),
  ).toEqual(['Sync needs your attention', 'Sync needs your attention'])
})

async function fit(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  )
  for (const dialog of await page.getByRole('dialog').all())
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
}
async function doubleText(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    const sizes = [...document.querySelectorAll<HTMLElement>('body *')].map((el) => ({
      el,
      px: parseFloat(getComputedStyle(el).fontSize),
    }))
    for (const { el, px } of sizes) el.style.fontSize = `${px * 2}px`
  })
}
test('account, conflict, recovery and long localized prices remain usable at 200 percent text and zoom reflow', async ({
  page,
}, info) => {
  for (const scenario of ['account', 'conflict', 'recovery', 'purchase']) {
    for (const mode of ['zoom', 'text']) {
      await page.setViewportSize({
        width: info.project.name.includes('mobile') ? 390 : mode === 'zoom' ? 640 : 1280,
        height: 950,
      })
      const path =
        scenario === 'purchase'
          ? '/tests/ui/purchases.html?price=long'
          : scenario === 'recovery'
            ? '/tests/ui/sync-recovery.html?mode=missing'
            : `/tests/ui/index.html?scenario=${scenario}`
      await page.goto(path)
      if (scenario === 'purchase') {
        await page.getByRole('button', { name: 'See upgrade price', exact: true }).click()
        await page.getByText('Purchase recovery and recovery key', { exact: true }).click()
      }
      if (scenario === 'recovery')
        await page.getByRole('button', { name: 'Review account refresh' }).click()
      if (mode === 'text') await doubleText(page)
      await fit(page)
      if (scenario === 'account') {
        await page.getByLabel('Email address', { exact: true }).fill('maker@example.test')
        await page.getByRole('button', { name: 'Send sign-in code' }).click()
        await expect(page.getByLabel('Sign-in code', { exact: true })).toBeVisible()
      } else if (scenario === 'conflict') {
        await page.getByRole('button', { name: 'Use cloud version', exact: true }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
      } else if (scenario === 'recovery') {
        await page.getByRole('checkbox').check()
        await page
          .getByRole('button', { name: 'Keep device copy and refresh account', exact: true })
          .click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
      } else {
        const purchase = page.getByRole('button', {
          name: 'Upgrade for CHF 1’234’567’890.00 (inkl. Mehrwertsteuer)',
          exact: true,
        })
        await expect(purchase).toBeVisible()
        await purchase.click()
        await expect(page.getByText('A purchase is unfinished.', { exact: false })).toBeVisible()
        await page.evaluate(() => {
          sessionStorage.clear()
          indexedDB.deleteDatabase('loopmark-purchases-ui')
        })
      }
    }
  }
})
