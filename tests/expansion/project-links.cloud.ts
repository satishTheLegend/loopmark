import { test, expect } from '@playwright/test'
import { signIn, chooseAccount, createProject, origin } from '../cloud/helpers'

test('a fresh bag link survives reload and OTP, opens only the explicitly selected owned project, and supports cached legacy access', async ({
  browser,
}) => {
  test.setTimeout(120000)
  const owner = await browser.newContext(),
    fresh = await browser.newContext(),
    stranger = await browser.newContext()
  const email = `loopmark-link-${crypto.randomUUID()}@example.invalid`
  const title = `Owned label ${crypto.randomUUID()}`
  const next = 'Use the saved blue hook and start row nineteen'
  try {
    const a = await owner.newPage(),
      b = await fresh.newPage(),
      c = await stranger.newPage()
    await signIn(a, email)
    await chooseAccount(a)
    await createProject(a, title)
    const projectId = decodeURIComponent(new URL(a.url()).hash.slice('#project='.length))
    expect(projectId).toMatch(/^[A-Za-z0-9_-]{1,80}$/)
    await a.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
    await a.getByLabel('What will you do next?').fill(next)
    await a.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
    await expect(a.getByRole('dialog')).toHaveCount(0)
    await expect(a.locator('.sync-status > span:not(.sr-only)')).toHaveText('Synced to your account', {
      timeout: 20000,
    })

    await b.goto(`${origin}/p/${projectId}`)
    await expect(
      b.getByRole('heading', { name: 'Open saved project link', exact: true }),
    ).toBeVisible()
    await expect(b.getByText(title, { exact: true })).toHaveCount(0)
    await b.reload()
    await expect(
      b.getByRole('heading', { name: 'Open saved project link', exact: true }),
    ).toBeVisible()
    await a.waitForTimeout(5100) // Respect the real local Auth code-request frequency.
    await signIn(b, email)
    await expect(b.locator('.collection-heading')).toContainText('Personal projects')
    await expect(
      b.getByRole('heading', { name: 'Open saved project link', exact: true }),
    ).toBeVisible()
    await chooseAccount(b)
    await b.goto(origin + '/#account')
    await b.getByRole('button', { name: 'Open in selected collection', exact: true }).click()
    await expect(b.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible()
    await expect(b.getByRole('region', { name: 'Latest checkpoint' })).toContainText(next)
    expect(await b.locator('body').innerText()).not.toContain(
      'This saved link is no longer available',
    )

    // A different account can try the same public project code without learning its contents.
    await c.goto(`${origin}/p/${projectId}`)
    await expect(
      c.getByRole('heading', { name: 'Open saved project link', exact: true }),
    ).toBeVisible()
    await signIn(c, `loopmark-link-other-${crypto.randomUUID()}@example.invalid`)
    await chooseAccount(c)
    await c.goto(origin + '/#account')
    await c.getByRole('button', { name: 'Open in selected collection', exact: true }).click()
    await expect(
      c.getByRole('button', { name: 'Open in selected collection', exact: true }),
    ).toBeEnabled()
    await expect(
      c.getByRole('heading', { name: 'Open saved project link', exact: true }),
    ).toBeVisible()
    expect(await c.locator('body').innerText()).not.toContain(title)
    expect(await c.locator('body').innerText()).not.toContain(next)
    expect(await c.locator('body').innerText()).not.toContain(email)
    await c.reload()
    await expect(
      c.getByRole('heading', { name: 'Open saved project link', exact: true }),
    ).toBeVisible()
    await c.getByRole('button', { name: 'Dismiss saved link', exact: true }).click()
    await expect(
      c.getByRole('heading', { name: 'Open saved project link', exact: true }),
    ).toHaveCount(0)

    // Existing legacy bag labels remain usable from the selected owned cache without a network.
    await b.goto(origin + '/#account')
    await fresh.setOffline(true)
    await b.evaluate((id) => {
      location.hash = `project=${encodeURIComponent(id)}`
    }, projectId)
    await expect(b.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible()
    await expect(b.getByRole('region', { name: 'Latest checkpoint' })).toContainText(next)
    await fresh.setOffline(false)
    await b.goto(`${origin}/#project=${projectId}`)
    await expect(b.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible()
    await expect(
      b.getByRole('heading', { name: 'Open saved project link', exact: true }),
    ).toHaveCount(0)
  } finally {
    await owner.close()
    await fresh.close()
    await stranger.close()
  }
})
