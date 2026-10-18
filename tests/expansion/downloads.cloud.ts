import { test, expect } from '@playwright/test'
import { signIn, chooseAccount, createProject } from '../cloud/helpers'
const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
)

test('whole-project offline files can be downloaded, explicitly removed, and fetched again without changing the cloud photo', async ({
  browser,
}) => {
  test.setTimeout(150000)
  const author = await browser.newContext(),
    reader = await browser.newContext(),
    fresh = await browser.newContext()
  let releaseDownload: (() => void) | undefined
  try {
    const a = await author.newPage(),
      b = await reader.newPage(),
      c = await fresh.newPage()
    const email = `loopmark-downloads-${crypto.randomUUID()}@example.invalid`,
      name = 'Offline-ready scarf'
    await signIn(a, email)
    await chooseAccount(a)
    await createProject(a, name)
    await a.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
    await a.getByLabel('What will you do next?').fill('Use the photo to continue the border.')
    await a
      .getByLabel('Add checkpoint photo')
      .setInputFiles({ name: 'border.png', mimeType: 'image/png', buffer: photo })
    await expect(a.getByAltText('Checkpoint photo preview')).toBeVisible()
    await a.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
    await expect(a.getByRole('dialog')).toHaveCount(0)
    const original = a.locator('.detail-photo > img')
    await expect(original).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
    const bytes = await original.getAttribute('src')
    await expect(a.locator('.sync-status')).toContainText('Synced to your account', {
      timeout: 20000,
    })
    await a.waitForTimeout(5100)
    await signIn(b, email)
    await chooseAccount(b)
    // Opening the latest checkpoint automatically fetches its photo. Observe
    // before navigation, and hold the real request until the whole-project
    // action joins it; otherwise a fast automatic fetch escapes the listener
    // or disables the button before the test can exercise it.
    const attempts: string[] = []
    b.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/functions/v1/media-download'))
        attempts.push(request.postDataJSON().mediaId)
    })
    let downloadGate = new Promise<void>((resolve) => {
      releaseDownload = resolve
    })
    await b.route('**/functions/v1/media-download', async (route) => {
      await downloadGate
      await route.continue()
    })
    await b.getByRole('button', { name: /^Open Offline-ready scarf\./ }).click()
    const panel = b.getByRole('region', { name: 'Project files' })
    await expect(panel).toContainText('1 attachment needs downloading on this device.')
    await expect(b.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
      'Use the photo to continue the border.',
    )
    const nextStepBox = await b.locator('.next-instruction').boundingBox()
    const filesBox = await panel.boundingBox()
    expect(nextStepBox!.y).toBeLessThan(filesBox!.y)
    await panel.getByRole('button', { name: 'Download project files', exact: true }).click()
    releaseDownload!()
    await expect(panel).toContainText('Available offline on this device')
    await expect(b.locator('.detail-photo > img')).toHaveAttribute('src', bytes!)
    expect(attempts.length).toBeGreaterThanOrEqual(1)
    expect(new Set(attempts).size).toBe(1)
    await panel.getByRole('button', { name: 'Remove downloads', exact: true }).click()
    let confirmation = b.getByRole('dialog', { name: 'Remove downloads from this device?' })
    await expect(confirmation).toContainText('cloud attachments will stay unchanged')
    await confirmation.getByRole('button', { name: 'Keep downloads', exact: true }).click()
    await expect(panel).toContainText('Available offline on this device')
    await panel.getByRole('button', { name: 'Remove downloads', exact: true }).click()
    confirmation = b.getByRole('dialog', { name: 'Remove downloads from this device?' })
    await confirmation.getByRole('button', { name: 'Remove downloaded files', exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(panel).toContainText('1 download removed from this device.')
    await expect(panel).toContainText('1 attachment needs downloading on this device.')
    await expect(b.locator('.detail-photo > img')).toHaveCount(0)
    const attemptsBeforeOffline = attempts.length
    await reader.setOffline(true)
    await expect(
      panel.getByRole('button', { name: 'Download project files', exact: true }),
    ).toBeDisabled()
    await expect(b.locator('.attachment-photo')).toContainText('Connect to download this photo.')
    expect(attempts).toHaveLength(attemptsBeforeOffline)
    downloadGate = new Promise<void>((resolve) => {
      releaseDownload = resolve
    })
    await reader.setOffline(false)
    await expect(
      panel.getByRole('button', { name: 'Download project files', exact: true }),
    ).toBeEnabled()
    await panel.getByRole('button', { name: 'Download project files', exact: true }).click()
    releaseDownload!()
    await expect(panel).toContainText('Available offline on this device')
    await expect(b.locator('.detail-photo > img')).toHaveAttribute('src', bytes!)
    // Reconnect also resumes the visible checkpoint's automatic fetch. An aborted
    // request may retry; scoped serialization and cancellation are asserted in
    // media-service tests. This journey verifies refetch, exact bytes and no
    // requests while offline, rather than treating network attempts as effects.
    expect(attempts.length).toBeGreaterThan(attemptsBeforeOffline)
    expect(new Set(attempts).size).toBe(1)
    await b.reload()
    await expect(b.getByRole('region', { name: 'Project files' })).toContainText(
      'Available offline on this device',
    )
    await expect(b.locator('.detail-photo > img')).toHaveAttribute('src', bytes!)
    await b.waitForTimeout(5100)
    await signIn(c, email)
    await chooseAccount(c)
    await c.getByRole('button', { name: /^Open Offline-ready scarf\./ }).click()
    const last = c.getByRole('region', { name: 'Project files' })
    // This independent device's visible latest photo downloads automatically.
    // The explicit whole-project action was exercised above against real I/O.
    await expect(last).toContainText('Available offline on this device')
    await expect(c.locator('.detail-photo > img')).toHaveAttribute('src', bytes!)
    await expect(c.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
      'Use the photo to continue the border.',
    )
  } finally {
    releaseDownload?.()
    await author.close()
    await reader.close()
    await fresh.close()
  }
})
