import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { signIn, chooseAccount, createProject, origin } from '../cloud/helpers'

const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
)
test('actual fresh-device export downloads missing photo bytes, permits cancellation, then restores a complete separate copy', async ({
  browser,
}) => {
  test.setTimeout(120000)
  const first = await browser.newContext(),
    second = await browser.newContext()
  try {
    const a = await first.newPage(),
      b = await second.newPage(),
      email = `loopmark-media-ui-${crypto.randomUUID()}@example.invalid`
    await signIn(a, email)
    await chooseAccount(a)
    await createProject(a, 'Photo checkpoint cardigan')
    await a.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
    await a.getByLabel('What will you do next?').fill('Match the border in this photo.')
    await a
      .getByLabel('Add checkpoint photo')
      .setInputFiles({ name: 'checkpoint.png', mimeType: 'image/png', buffer: photo })
    await expect(a.getByAltText('Checkpoint photo preview')).toBeVisible()
    await a.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
    await expect(a.getByRole('dialog')).toHaveCount(0)
    await expect(a.locator('.detail-photo img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
    const savedPhoto = await a.locator('.detail-photo img').getAttribute('src')
    await expect(a.locator('.sync-status')).toContainText('Synced to your account', {
      timeout: 20000,
    })
    // Respect actual local Auth's request frequency for this same email.
    await a.waitForTimeout(5100)
    await signIn(b, email)
    await chooseAccount(b)
    await expect(b.getByRole('button', { name: /^Open Photo checkpoint cardigan\./ })).toBeVisible()
    await b.goto(origin + '/#backup')
    let requested = false
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await b.route('**/functions/v1/media-download', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      requested = true
      await held
      await route.continue().catch(() => {})
    })
    const downloads: string[] = []
    b.on('download', (download) => downloads.push(download.suggestedFilename()))
    await b.getByRole('button', { name: 'Download full backup', exact: true }).click()
    await expect.poll(() => requested).toBe(true)
    await expect(
      b.getByRole('status').filter({ hasText: 'Downloading missing attachments' }),
    ).toBeVisible()
    await b.getByRole('button', { name: 'Cancel export', exact: true }).click()
    release()
    await expect(
      b.getByText('Export cancelled. Your projects and saved checkpoints are unchanged.'),
    ).toBeVisible()
    expect(downloads).toEqual([])
    await b.unroute('**/functions/v1/media-download')
    const downloading = b.waitForEvent('download')
    await b.getByRole('button', { name: 'Download full backup', exact: true }).click()
    const download = await downloading,
      path = await download.path()
    const backup = JSON.parse(await readFile(path!, 'utf8'))
    expect(backup.projects).toHaveLength(1)
    expect(backup.projects[0].checkpoints[0].photo).toBe(savedPhoto)
    expect(backup.projects[0].checkpoints[0].nextStep).toBe('Match the border in this photo.')
    await b.goto(origin + '/#projects')
    await createProject(b, 'Old-only saved work')
    await expect(b.locator('.sync-status')).toContainText('Synced to your account', {
      timeout: 20000,
    })
    await b.goto(origin + '/#backup')
    await b.getByLabel('Restore backup file').setInputFiles({
      name: 'complete.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    })
    await b.getByRole('button', { name: 'Restore as separate collection', exact: true }).click()
    await expect(b.locator('.collection-heading')).toContainText('Restored')
    await b.goto(origin + '/#projects')
    await b.getByRole('button', { name: /^Open Photo checkpoint cardigan\./ }).click()
    await expect(b.locator('.detail-photo img')).toHaveAttribute('src', savedPhoto!)
    await b.goto(origin + '/#account')
    await b
      .getByRole('button', { name: 'Review replacing account from this copy', exact: true })
      .click()
    const review = b.getByRole('dialog')
    await expect(
      review.getByRole('button', { name: 'Confirm account replacement', exact: true }),
    ).toBeDisabled()
    await review.getByRole('checkbox').check()
    await review.getByRole('button', { name: 'Confirm account replacement', exact: true }).click()
    await expect(b.locator('.collection-heading')).toContainText('Account projects')
    await expect(b.getByRole('button', { name: /^Open Photo checkpoint cardigan\./ })).toBeVisible()
    await expect(b.getByRole('button', { name: /^Open Old-only saved work\./ })).toHaveCount(0)
    await b.getByRole('button', { name: 'Change collection' }).click()
    await b
      .getByRole('dialog')
      .getByRole('button', { name: /Previous Account projects/ })
      .click()
    await expect(b.getByRole('button', { name: /^Open Old-only saved work\./ })).toBeVisible()
  } finally {
    await first.close()
    await second.close()
  }
})
