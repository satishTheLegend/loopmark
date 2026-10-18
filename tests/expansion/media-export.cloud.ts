import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { signIn, chooseAccount, createProject, origin } from '../cloud/helpers'

const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
)

test('actual complete export names the missing checkpoint and retries only its absent bytes', async ({
  browser,
}) => {
  test.setTimeout(120000)
  const first = await browser.newContext(),
    second = await browser.newContext()
  try {
    const a = await first.newPage(),
      b = await second.newPage()
    const email = `loopmark-media-retry-${crypto.randomUUID()}@example.invalid`
    await signIn(a, email)
    await chooseAccount(a)
    await createProject(a, 'Two-photo blanket')
    const photos: string[] = []
    for (const [index, colour] of [
      [0, [255, 0, 0, 255]],
      [1, [0, 0, 255, 255]],
    ] as const) {
      const png = new PNG({ width: 2, height: 2 })
      for (let pixel = 0; pixel < 4; pixel++) png.data.set(colour, pixel * 4)
      await a.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
      await a.getByLabel('What will you do next?').fill(`Follow photo ${index + 1}`)
      await a.getByLabel('Current row or repeat').fill(`Row ${index + 1}`)
      await a.getByLabel('Add checkpoint photo').setInputFiles({
        name: `photo-${index}.png`,
        mimeType: 'image/png',
        buffer: PNG.sync.write(png),
      })
      await expect(a.getByAltText('Checkpoint photo preview')).toBeVisible()
      await a.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
      await expect(a.getByRole('dialog')).toHaveCount(0)
      await expect(a.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
        `Follow photo ${index + 1}`,
      )
      await expect(a.locator('.detail-photo img')).toHaveAttribute(
        'src',
        /^data:image\/jpeg;base64,/,
      )
      if (photos.length)
        await expect(a.locator('.detail-photo img')).not.toHaveAttribute('src', photos[0])
      photos.push((await a.locator('.detail-photo img').getAttribute('src'))!)
      await expect(a.locator('.sync-status')).toContainText('Synced to your account', {
        timeout: 20000,
      })
    }
    expect(new Set(photos).size).toBe(2)
    await a.waitForTimeout(5100)
    await signIn(b, email)
    await chooseAccount(b)
    await expect(b.getByRole('button', { name: /^Open Two-photo blanket\./ })).toBeVisible()
    await b.goto(origin + '/#backup')
    const attempts: string[] = [],
      files: string[] = []
    let failedId = ''
    await b.route('**/functions/v1/media-download', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const id = route.request().postDataJSON().mediaId as string
      attempts.push(id)
      if (!failedId) failedId = id
      if (id === failedId)
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
      await route.continue()
    })
    b.on('download', (download) => files.push(download.suggestedFilename()))
    await b.getByRole('button', { name: 'Download full backup', exact: true }).click()
    const missing = b.getByRole('region', { name: 'Attachments still needed' })
    await expect(missing).toContainText('1 attachment is still unavailable')
    await expect(missing.locator('li')).toHaveCount(1)
    await expect(missing.locator('li')).toContainText('Two-photo blanket')
    await expect(missing.locator('li')).toContainText('Photo')
    await expect(missing.locator('li')).toContainText(/Row [12]/)
    expect(files).toEqual([])
    expect(new Set(attempts).size).toBe(2)
    await b.unroute('**/functions/v1/media-download')
    const retryIds: string[] = []
    await b.route('**/functions/v1/media-download', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      retryIds.push(route.request().postDataJSON().mediaId)
      await route.continue()
    })
    const downloading = b.waitForEvent('download')
    await missing.getByRole('button', { name: 'Retry complete export' }).click()
    const backup = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'))
    expect(retryIds).toEqual([failedId])
    expect(backup.projects[0].checkpoints.map((cp: { photo: string }) => cp.photo).sort()).toEqual(
      photos.sort(),
    )
    expect(backup.projects[0].checkpoints).toHaveLength(2)
  } finally {
    await first.close()
    await second.close()
  }
})
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
