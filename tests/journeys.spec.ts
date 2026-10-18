import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
)

async function createProject(page: Page, name = 'Sunday cardigan') {
  const newProject = page.getByRole('button', { name: 'New project', exact: true })
  // The shelf mounts after IndexedDB opens; fonts.ready before that point only
  // covers the loading screen. Settle the real control before one native click.
  await expect(newProject).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await newProject.scrollIntoViewIfNeeded()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  await newProject.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByLabel('Hook or needle size').fill('5 mm hook')
  await dialog.getByLabel('Yarn or material').fill('Soft cotton, terracotta')
  await dialog.getByLabel('Project notes').fill('Pattern kept in the blue folder.')
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/#project=/)
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible()
}

async function checkpoint(
  page: Page,
  nextStep: string,
  position = 'Row 23 complete',
  photo = false,
  notes?: string,
) {
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('What will you do next?').fill(nextStep)
  await dialog.getByLabel('Current row or repeat').fill(position)
  if (notes) await dialog.getByLabel('Anything else to remember?').fill(notes)
  if (photo) {
    await dialog
      .getByLabel('Add checkpoint photo')
      .setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: tinyPng })
    await expect(dialog.getByAltText('Checkpoint photo preview')).toBeVisible()
  }
  await dialog.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.history-row').filter({ hasText: nextStep })).toHaveCount(1)
}

async function backup(page: Page) {
  await page.goto('/#backup')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download full backup' }).click()
  const download = await downloading
  const path = await download.path()
  expect(path).toBeTruthy()
  return JSON.parse(await readFile(path!, 'utf8'))
}

async function uploadBackup(page: Page, value: unknown) {
  await page.getByLabel('Restore backup file').setInputFiles({
    name: 'loopmark-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  })
}

test('create, edit, capture photo, resume latest, browse immutable history, finish, reopen and delete', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByText('Let’s keep your place.')).toBeVisible()
  await expect(page.locator('.project-card').getByRole('button', { name: /^Open / })).toHaveCount(0)
  await createProject(page)
  const code = await page.locator('.project-code').innerText()
  const projectUrl = page.url()
  await page.getByRole('button', { name: 'Edit project details' }).click()
  await page.getByRole('dialog').getByLabel('Project name').fill('Sunday cardigan, for Mum')
  await page.getByRole('button', { name: 'Save details', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sunday cardigan, for Mum' })).toBeVisible()
  await expect(page.locator('.project-code')).toHaveText(code)
  await checkpoint(page, 'Chain 2, turn, work the first shell.', 'Row 23 complete', true)
  const firstPhoto = await page.locator('.detail-photo img').getAttribute('src')
  expect(firstPhoto).toMatch(/^data:image\/jpeg;base64,/)
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Current row or repeat')).toHaveValue('Row 23 complete')
  await expect(dialog.getByLabel('Hook or needle size')).toHaveValue('5 mm hook')
  await expect(dialog.getByRole('button', { name: 'Save checkpoint', exact: true })).toBeDisabled()
  await dialog
    .getByLabel('What will you do next?')
    .fill('Join the shoulders, then weave in the ends.')
  await dialog.getByLabel('Current row or repeat').fill('Body complete')
  await dialog.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
    'Join the shoulders',
  )
  await expect(page.locator('.history-row')).toHaveCount(2)
  await page.getByRole('button', { name: /Row 23 complete/ }).click()
  await expect(page.getByRole('region', { name: 'Earlier checkpoint' })).toContainText(
    'Chain 2, turn',
  )
  await expect(page.locator('.detail-photo img')).toHaveAttribute('src', firstPhoto!)
  await page.getByRole('button', { name: 'Back to latest checkpoint' }).click()
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
    'Join the shoulders',
  )
  await page.getByRole('button', { name: 'Mark as finished' }).click()
  await expect(page.getByRole('button', { name: 'Save a checkpoint', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Back to your projects' }).click()
  await expect(page.getByRole('heading', { name: 'The finished collection' })).toBeVisible()
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Sunday cardigan, for Mum', exact: true }) })
    .getByRole('button')
    .click()
  await page.getByRole('button', { name: 'Bring back to my projects' }).click()
  await expect(page.getByRole('button', { name: 'Save a checkpoint', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Delete project', exact: true }).click()
  await page.getByRole('button', { name: 'Keep project' }).click()
  await expect(page.getByRole('heading', { name: 'Sunday cardigan, for Mum' })).toBeVisible()
  await page.getByRole('button', { name: 'Delete project', exact: true }).click()
  await page.getByRole('button', { name: 'Delete permanently' }).click()
  await expect(page.getByText('Let’s keep your place.')).toBeVisible()
  await page.goto(projectUrl)
  await expect(
    page.getByRole('heading', { name: 'This project isn’t available in this collection' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore a backup' })).toBeVisible()
})

test('search, craft filter and no-results recovery operate on opt-in samples', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Take a look with sample projects' }).click()
  await expect(page.locator('.project-card')).toHaveCount(3)
  await expect(page.locator('.sample-tag')).toHaveCount(3)
  await page.getByRole('button', { name: 'Knitting', exact: true }).click()
  expect(await page.locator('.project-card').count()).toBeGreaterThan(0)
  await expect(page.locator('.project-card .badge')).toHaveText(['Knitting'])
  await page.getByLabel('Search projects').fill('no such yarn anywhere')
  await expect(page.getByRole('heading', { name: 'No projects in this basket' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.locator('.project-card')).toHaveCount(3)
  await page.getByLabel('Search projects').fill('LM-')
  await expect(page.locator('.project-card')).toHaveCount(3)
})

test('@chromium-media simulated microphone recording and photo survive a full export and isolated-browser restore', async ({
  page,
  browser,
}) => {
  await page.context().grantPermissions(['microphone'])
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints)
      ;(window as unknown as { testAudioStream: MediaStream }).testAudioStream = stream
      return stream
    }
  })
  await page.goto('/')
  await createProject(page, 'Audio and photo blanket')
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('What will you do next?').fill('Continue with the blue yarn.')
  await dialog
    .getByLabel('Add checkpoint photo')
    .setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: tinyPng })
  await expect(dialog.getByAltText('Checkpoint photo preview')).toBeVisible()
  await dialog.getByRole('button', { name: 'Record a quick note' }).click()
  await expect(dialog.getByRole('button', { name: /Stop recording/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save checkpoint', exact: true })).toBeDisabled()
  // Chromium's fake audio device drives the real MediaRecorder. This is not physical-microphone evidence.
  await page.waitForTimeout(500)
  await dialog.getByRole('button', { name: /Stop recording/ }).click()
  await expect(dialog.locator('audio')).toHaveAttribute('src', /^data:audio\//)
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { testAudioStream: MediaStream }).testAudioStream
          .getTracks()
          .every((track) => track.readyState === 'ended'),
      ),
    )
    .toBe(true)
  await dialog.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
    'Continue with the blue yarn.',
  )
  const exported = await backup(page)
  expect(exported.projects[0].checkpoints[0].photo).toMatch(/^data:image\/jpeg;base64,/)
  expect(exported.projects[0].checkpoints[0].voice).toMatch(/^data:audio\/webm/)
  const context = await browser.newContext()
  const other = await context.newPage()
  await other.goto(`${new URL(page.url()).origin}/#backup`)
  await uploadBackup(other, exported)
  await expect(other.getByRole('dialog')).toContainText('1 projects · 1 checkpoints')
  await other.getByRole('button', { name: 'Restore as separate collection' }).click()
  await expect(other.getByRole('dialog')).toHaveCount(0)
  await other.goto(`${new URL(page.url()).origin}/#project=${exported.projects[0].id}`)
  await expect(other.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
    'Continue with the blue yarn.',
  )
  await expect(other.locator('.detail-photo img')).toHaveAttribute(
    'src',
    exported.projects[0].checkpoints[0].photo,
  )
  await expect(other.locator('audio')).toHaveAttribute(
    'src',
    exported.projects[0].checkpoints[0].voice,
  )
  const restored = await backup(other)
  const withoutRevision = (projects: Array<Record<string, unknown>>) =>
    projects.map(({ updatedAt: _updatedAt, ...project }) => project)
  expect(withoutRevision(restored.projects)).toEqual(withoutRevision(exported.projects))
  expect(restored.projects[0].updatedAt).toBe(exported.projects[0].updatedAt)
  await context.close()
})

test('invalid imports preserve current data; valid restore is confirmed into a separate collection', async ({
  page,
}) => {
  await page.goto('/')
  await createProject(page, 'Keep this project')
  await checkpoint(page, 'Keep this checkpoint too.')
  const original = await backup(page)
  const remoteMedia = structuredClone(original)
  remoteMedia.projects[0].checkpoints[0].photo = 'https://example.invalid/stolen-photo.jpg'
  const duplicates = structuredClone(original)
  duplicates.projects.push(structuredClone(duplicates.projects[0]))
  for (const invalid of [
    { ...original, version: 99 },
    remoteMedia,
    duplicates,
    { format: 'loopmark' },
  ]) {
    await uploadBackup(page, invalid)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await backup(page)).projects).toEqual(original.projects)
  }
  const replacement = { ...original, projects: [] }
  await uploadBackup(page, replacement)
  await expect(page.getByRole('dialog')).toContainText(
    'separate recovered collection on this device',
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await backup(page)).projects).toEqual(original.projects)
  await uploadBackup(page, replacement)
  await page.getByRole('button', { name: 'Restore as separate collection' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await backup(page)).projects).toEqual([])
  await page.getByRole('button', { name: 'Change collection' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Personal projects/ })
    .click()
  expect((await backup(page)).projects).toEqual(original.projects)
})

test('browser storage write failures retain form values and leave existing checkpoints intact', async ({
  page,
}) => {
  await page.goto('/')
  await createProject(page)
  await checkpoint(page, 'The safe original instruction.')
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page.getByLabel('What will you do next?').fill('Unsaved work must stay in the form.')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'loopmark-v2' && this.name === 'collections')
        throw new DOMException('Injected quota failure', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Your device storage is full',
  )
  await expect(page.getByLabel('What will you do next?')).toHaveValue(
    'Unsaved work must stay in the form.',
  )
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.reload()
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
    'The safe original instruction.',
  )
  await expect(page.locator('.history-row')).toHaveCount(1)
})

test('failed restore rolls back the entire transaction', async ({ page }) => {
  await page.goto('/')
  await createProject(page, 'Original collection')
  const original = await backup(page)
  const replacement = structuredClone(original)
  replacement.projects[0].name = 'Replacement collection'
  await uploadBackup(page, replacement)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'loopmark-v2' && this.name === 'collections')
        throw new DOMException('Injected restore quota failure', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await page.getByRole('button', { name: 'Restore as separate collection' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Your device storage is full',
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.reload()
  expect((await backup(page)).projects).toEqual(original.projects)
})

test('two tabs retain concurrent checkpoints and reject stale detail edits', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await createProject(page)
  const other = await context.newPage()
  await other.goto(page.url())
  await page.getByRole('button', { name: 'Edit project details' }).click()
  await page.getByLabel('Project name').fill('A stale edit')
  await other.getByRole('button', { name: 'Edit project details' }).click()
  await other.getByLabel('Project name').fill('The fresh edit')
  await other.getByRole('button', { name: 'Save details', exact: true }).click()
  await expect(other.getByRole('heading', { name: 'The fresh edit' })).toBeVisible()
  await page.getByRole('button', { name: 'Save details', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('changed elsewhere')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await Promise.all([
    checkpoint(page, 'Saved from the first tab.'),
    checkpoint(other, 'Saved from the second tab.'),
  ])
  await expect(page.locator('.history-row')).toHaveCount(2)
  await expect(other.locator('.history-row')).toHaveCount(2)
  const result = await backup(page)
  expect(result.projects[0].name).toBe('The fresh edit')
  expect(result.projects[0].checkpoints.map((item: { nextStep: string }) => item.nextStep)).toEqual(
    expect.arrayContaining(['Saved from the first tab.', 'Saved from the second tab.']),
  )
})

test('bag label renders QR and print-only content, then opens the saved local project', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await createProject(page, 'Labelled shawl')
  await checkpoint(page, 'Work the border in moss stitch.')
  const url = page.url()
  await page.getByRole('button', { name: 'Make a bag label' }).click()
  await expect(page.getByAltText('QR code to this project on this site')).toHaveAttribute(
    'src',
    /^data:image\/png;base64,/,
  )
  const qrData = await page.getByAltText('QR code to this project on this site').getAttribute('src')
  const png = PNG.sync.read(Buffer.from(qrData!.split(',')[1], 'base64'))
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
  expect(decoded?.data).toBe(new URL(`/p/${new URL(url).hash.slice('#project='.length)}`, url).href)
  await expect(page.locator('.bag-label')).toContainText('Labelled shawl')
  await expect(page.locator('.bag-label')).toContainText('Row 23 complete')
  await expect(page.locator('.bag-label')).toContainText('Work the border in moss stitch.')
  await expect(page.getByRole('dialog')).toContainText(
    'A localhost link works only on its original computer.',
  )
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printRequested = 'yes'
    }
  })
  await page.getByRole('button', { name: 'Print bag label' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-print-requested', 'yes')
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.bag-label')).toBeVisible()
  await expect(page.locator('.sidebar')).not.toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('bag-label-print.png'), fullPage: true })
  await page.emulateMedia({ media: 'screen' })
  await page.goto(decoded!.data)
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
    'Work the border in moss stitch.',
  )
})

test('production cache permits offline reload, capture, and later reload without remote requests', async ({
  page,
  context,
}, testInfo) => {
  const remoteRequests: string[] = []
  page.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== new URL(String(testInfo.project.use.baseURL)).origin
    )
      remoteRequests.push(request.url())
  })
  await page.goto('/')
  await createProject(page, 'Offline socks')
  const worker = await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      )
    return {
      scriptURL: navigator.serviceWorker.controller?.scriptURL,
      state: navigator.serviceWorker.controller?.state,
      caches: await caches.keys(),
    }
  })
  await testInfo.attach('offline-cache.json', {
    body: JSON.stringify(
      { project: testInfo.project.name, browser: context.browser()?.version(), ...worker },
      null,
      2,
    ),
    contentType: 'application/json',
  })
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Offline socks' })).toBeVisible()
  await expect(
    page.getByText('You’re offline. Your projects and checkpoints still work on this device.'),
  ).toBeVisible()
  await checkpoint(page, 'Turn the heel on the next row.', 'Heel ready', true)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
    'Turn the heel',
  )
  await expect(page.locator('.detail-photo img')).toHaveAttribute('src', /^data:image\/jpeg/)
  expect(remoteRequests).toEqual([])
  await context.setOffline(false)
})

test('dialog traps keyboard focus and returns it to the opener', async ({ page }) => {
  await page.goto('/')
  const opener = page.getByRole('button', { name: 'New project', exact: true })
  await opener.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Project name')).toBeFocused()
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < 16; index++) {
      await page.keyboard.press(key)
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(
        true,
      )
    }
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('microphone permission denial and invalid photo have actionable recovery', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.getPrototypeOf(navigator.mediaDevices).getUserMedia = () =>
      Promise.reject(new DOMException('Denied for test', 'NotAllowedError'))
  })
  await page.goto('/')
  await createProject(page)
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page.getByRole('button', { name: 'Record a quick note' }).click()
  await expect(page.getByRole('alert')).toContainText('Microphone permission was declined')
  await page.getByLabel('Add checkpoint photo').setInputFiles({
    name: 'invalid.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  })
  await expect(
    page.getByRole('alert').filter({ hasText: 'This photo could not be opened' }),
  ).toBeVisible()
  await page.getByLabel('What will you do next?').fill('Written notes still work.')
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
    'Written notes still work.',
  )
})

test('a large photo is resized to the documented bound before saving', async ({ page }) => {
  const source = new PNG({ width: 2000, height: 1200 })
  source.data.fill(180)
  for (let offset = 3; offset < source.data.length; offset += 4) source.data[offset] = 255
  await page.goto('/')
  await createProject(page)
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page.getByLabel('What will you do next?').fill('Use the photo to match the next stitch.')
  await page.getByLabel('Add checkpoint photo').setInputFiles({
    name: 'large-photo.png',
    mimeType: 'image/png',
    buffer: PNG.sync.write(source),
  })
  const preview = page.getByAltText('Checkpoint photo preview')
  await expect(preview).toBeVisible()
  expect(
    await preview.evaluate((image) => ({
      width: (image as HTMLImageElement).naturalWidth,
      height: (image as HTMLImageElement).naturalHeight,
    })),
  ).toEqual({ width: 1600, height: 960 })
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.detail-photo img')).toHaveAttribute(
    'src',
    /^data:image\/jpeg;base64,/,
  )
})

test('@chromium-media voice capture stops at the simulated time limit, removes audio, and releases tracks on close', async ({
  page,
}) => {
  await page.context().grantPermissions(['microphone'])
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints)
      ;(window as unknown as { testAudioStream: MediaStream }).testAudioStream = stream
      return stream
    }
  })
  await page.goto('/')
  await createProject(page)
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page.clock.install()
  await page.getByRole('button', { name: 'Record a quick note' }).click()
  await expect(page.getByRole('button', { name: /Stop recording/ })).toBeVisible()
  // Advance interval callbacks, rather than skipping directly past them.
  await page.clock.runFor(120_000)
  await expect(page.getByRole('button', { name: /Stop recording/ })).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { testAudioStream: MediaStream }).testAudioStream
          .getTracks()
          .every((track) => track.readyState === 'ended'),
      ),
    )
    .toBe(true)
  await expect(page.locator('dialog audio')).toBeVisible()
  await page.getByRole('button', { name: 'Remove voice note' }).click()
  await expect(page.locator('dialog audio')).toHaveCount(0)
  await page.getByRole('button', { name: 'Record a quick note' }).click()
  await expect(page.getByRole('button', { name: /Stop recording/ })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { testAudioStream: MediaStream }).testAudioStream
          .getTracks()
          .every((track) => track.readyState === 'ended'),
      ),
    )
    .toBe(true)
})

test('blocked storage shows recovery instead of claiming a saved collection', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new DOMException('Storage blocked by browser', 'SecurityError')
    }
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your workbasket needs attention' })).toBeVisible()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('Keep the app’s stored data', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reopen Loopmark' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New project', exact: true })).toHaveCount(0)
})

test('imported markup remains literal text and cannot execute scripts', async ({ page }) => {
  await page.goto('/')
  await createProject(page)
  await checkpoint(page, 'Original note')
  const value = await backup(page)
  const hostile = '<img src=x onerror="window.loopmarkXss=true">'
  value.projects[0].name = hostile
  value.projects[0].checkpoints[0].nextStep = '<script>window.loopmarkXss=true</script>'
  await uploadBackup(page, value)
  await page.getByRole('button', { name: 'Restore as separate collection' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto(`/#project=${value.projects[0].id}`)
  await expect(page.getByRole('heading', { name: hostile, exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
    '<script>window.loopmarkXss=true</script>',
  )
  expect(
    await page.evaluate(() => (window as unknown as { loopmarkXss?: boolean }).loopmarkXss),
  ).toBeUndefined()
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
})

for (const width of [320, 390]) {
  test(`mobile ${width}px has no horizontal overflow in shelf, detail, forms, backup and navigation`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    const checkWidth = async () =>
      expect(
        await page.evaluate(async () => {
          await document.fonts.ready
          return document.documentElement.scrollWidth <= innerWidth
        }),
      ).toBe(true)
    await page.goto('/')
    await checkWidth()
    const samples = page.getByRole('button', { name: 'Take a look with sample projects' })
    await samples.scrollIntoViewIfNeeded()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    await samples.click()
    await expect(page.locator('.project-card')).toHaveCount(3)
    await page.locator('.project-card-main').first().click()
    await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toBeVisible()
    await checkWidth()
    await page.getByRole('button', { name: 'Mark as finished' }).click()
    await expect(page.getByRole('button', { name: 'Bring back to my projects' })).toBeVisible()
    await page.getByRole('button', { name: 'Back to your projects' }).click()
    await createProject(page, 'A long project name for a small phone screen')
    await checkWidth()
    await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
    await checkWidth()
    await page.getByLabel('What will you do next?').fill('One small stitch, then another.')
    await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
    await checkWidth()
    await page.screenshot({ path: testInfo.outputPath(`mobile-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    await checkWidth()
    if (width === 390) {
      for (let index = 0; index < 12; index++) {
        await page.keyboard.press('Tab')
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest('main')))).toBe(
          false,
        )
      }
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused()
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Backup & restore', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Keep your making safe.' })).toBeVisible()
    await checkWidth()
  })
}

test('axe WCAG 2.2 AA scan covers eight core screens and dialogs', async ({ page }, testInfo) => {
  const scan = async (state: string) => {
    await page.evaluate(async () => {
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished.catch(() => {})),
      )
    })
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    await testInfo.attach(`axe-${state}.json`, {
      body: JSON.stringify(result.violations, null, 2),
      contentType: 'application/json',
    })
    expect
      .soft(
        result.violations.map((violation) => ({
          rule: violation.id,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            failure: node.failureSummary,
          })),
        })),
        state,
      )
      .toEqual([])
  }
  await page.goto('/')
  await scan('empty')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await scan('project-form')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await createProject(page)
  await checkpoint(page, 'Take your next small step.')
  await scan('project-detail')
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await scan('checkpoint-form')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.getByRole('button', { name: 'Make a bag label' }).click()
  await expect(page.getByAltText('QR code to this project on this site')).toBeVisible()
  await scan('bag-label')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.getByRole('button', { name: 'Back to your projects' }).click()
  await scan('populated-shelf')
  await page.goto('/#backup')
  await scan('backup')
  await page.goto('/#guide')
  await scan('guide')
})

for (const missingApi of ['MediaRecorder', 'mediaDevices'] as const) {
  test(`missing ${missingApi} offers a written-note fallback without blocking a checkpoint`, async ({
    page,
  }) => {
    await page.addInitScript((api) => {
      if (api === 'MediaRecorder')
        Object.defineProperty(window, 'MediaRecorder', { value: undefined, configurable: true })
      else
        Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    }, missingApi)
    await page.goto('/')
    await createProject(page)
    await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
    await page.getByRole('button', { name: 'Record a quick note' }).click()
    await expect(page.getByRole('alert')).toContainText('Voice recording is unavailable here')
    await expect(page.getByRole('alert')).toContainText('written note')
    await page.getByLabel('What will you do next?').fill('Continue from the written instructions.')
    await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
      'Continue from the written instructions.',
    )
  })
}

async function installSynthesizedAudio(page: Page) {
  await page.addInitScript(() => {
    Object.getPrototypeOf(navigator.mediaDevices).getUserMedia = async () => {
      const audio = new AudioContext()
      const tone = audio.createOscillator()
      const destination = audio.createMediaStreamDestination()
      tone.connect(destination)
      tone.start()
      await audio.resume()
      ;(window as unknown as { synthesizedStream: MediaStream }).synthesizedStream =
        destination.stream
      destination.stream.getTracks().forEach((track) => {
        const stop = track.stop.bind(track)
        track.stop = () => {
          stop()
          tone.stop()
          void audio.close()
        }
      })
      return destination.stream
    }
  })
}

test('native recorder accepts a synthesized audio stream and restores its playable output', async ({
  page,
  browser,
}, testInfo) => {
  // Exercises each engine's real MediaRecorder/container without claiming microphone hardware coverage.
  // Only getUserMedia is replaced; the app owns recording, encoding, persistence and restoration.
  await installSynthesizedAudio(page)
  await page.goto('/')
  await createProject(page, 'Native recorder project')
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page.getByLabel('What will you do next?').fill('Listen to the recorded reminder.')
  await page.getByRole('button', { name: 'Record a quick note' }).click()
  await expect(page.getByRole('button', { name: /Stop recording/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save checkpoint', exact: true })).toBeDisabled()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: /Stop recording/ }).click()
  const audio = page.locator('dialog audio')
  await expect(audio).toHaveAttribute('src', /^data:audio\/(webm|mp4|ogg)/)
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { synthesizedStream: MediaStream }).synthesizedStream
          .getTracks()
          .every((track) => track.readyState === 'ended'),
      ),
    )
    .toBe(true)
  const voice = await audio.getAttribute('src')
  await testInfo.attach('recorded-container.txt', {
    body: voice!.slice(0, voice!.indexOf(',')),
    contentType: 'text/plain',
  })
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const exported = await backup(page)
  expect(exported.projects[0].checkpoints[0].voice).toBe(voice)
  const otherContext = await browser.newContext()
  try {
    const other = await otherContext.newPage()
    await other.goto(`${new URL(page.url()).origin}/#backup`)
    await uploadBackup(other, exported)
    await other.getByRole('button', { name: 'Restore as separate collection' }).click()
    await expect(other.getByRole('dialog')).toHaveCount(0)
    await other.goto(`${new URL(page.url()).origin}/#project=${exported.projects[0].id}`)
    const restoredAudio = other.locator('audio')
    await expect(restoredAudio).toHaveAttribute('src', voice!)
    // Playback evidence checks actual decoder acceptance and progress, beyond a data URL existing.
    await restoredAudio.evaluate(async (element) => {
      const media = element as HTMLAudioElement
      await media.play()
    })
    await expect
      .poll(() => restoredAudio.evaluate((element) => (element as HTMLAudioElement).currentTime))
      .toBeGreaterThan(0)
    expect(
      await restoredAudio.evaluate((element) => (element as HTMLAudioElement).error),
    ).toBeNull()
  } finally {
    await otherContext.close()
  }
})

test('maximum-length unbroken fields reflow at 320px and reduced motion suppresses transitions', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  const name = 'N'.repeat(100)
  const tool = 'T'.repeat(80)
  const yarn = 'Y'.repeat(200)
  const notes = 'P'.repeat(2000)
  const nextStep = 'S'.repeat(1000)
  const checkpointNotes = 'C'.repeat(2000)
  const position = 'R'.repeat(100)
  await page.getByLabel('Project name').fill(name)
  await page.getByLabel('Hook or needle size').fill(tool)
  await page.getByLabel('Yarn or material').fill(yarn)
  await page.getByLabel('Project notes').fill(notes)
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await checkpoint(page, nextStep, position, false, checkpointNotes)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(nextStep)
  const checkReflow = async (state: string) => {
    await page.evaluate(() => document.fonts.ready)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `${state} content must fit the viewport`,
    ).toBeLessThanOrEqual(320)
    expect(
      await page.evaluate(
        () =>
          document.getAnimations().filter((animation) => animation.playState === 'running').length,
      ),
      `${state} must respect reduced motion`,
    ).toBe(0)
  }
  await checkReflow('detail')
  await page.getByRole('button', { name: 'Make a bag label' }).click()
  await expect(page.getByAltText('QR code to this project on this site')).toBeVisible()
  await checkReflow('bag label')
  await page.screenshot({ path: testInfo.outputPath('long-fields-320.png'), fullPage: true })
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.getByRole('button', { name: 'Back to your projects' }).click()
  await checkReflow('shelf')
  const exported = await backup(page)
  expect(exported.projects[0]).toMatchObject({ name, toolSize: tool, yarn, notes })
  expect(exported.projects[0].checkpoints[0]).toMatchObject({
    nextStep,
    position,
    toolSize: tool,
    notes: checkpointNotes,
  })
})

test('navigation waits for delayed voice conversion and recovers the completed voice draft', async ({
  page,
}) => {
  await installSynthesizedAudio(page)
  await page.goto('/')
  await createProject(page, 'Voice conversion recovery')
  const projectUrl = page.url()
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page
    .getByLabel('What will you do next?')
    .fill('Keep this voice reminder through navigation.')
  await page.getByRole('button', { name: 'Record a quick note' }).click()
  await expect(page.getByRole('button', { name: /Stop recording/ })).toBeVisible()
  await page.waitForTimeout(700)
  await page.evaluate(() => {
    const read = FileReader.prototype.readAsDataURL
    FileReader.prototype.readAsDataURL = function (blob) {
      if (!blob.type.startsWith('audio/')) return read.call(this, blob)
      // Hold the real FileReader, then add 500 ms latency after release. The gate makes
      // assertions deterministic even when CI is slow; no media result is fabricated.
      const reader = this
      ;(window as unknown as { releaseVoiceRead: () => void }).releaseVoiceRead = () => {
        setTimeout(() => read.call(reader, blob), 500)
      }
    }
  })
  await page.getByRole('button', { name: /Stop recording/ }).click()
  const processing = page.getByRole('button', { name: 'Preparing voice note…' })
  await expect(processing).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save checkpoint', exact: true })).toBeDisabled()
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof (window as unknown as { releaseVoiceRead?: unknown }).releaseVoiceRead,
      ),
    )
    .toBe('function')
  await page.evaluate(() => {
    location.hash = 'guide'
  })
  await expect(
    page.getByRole('heading', { name: 'Voice conversion recovery', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Leave a note. Find your rhythm.' })).toHaveCount(
    0,
  )
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(processing).toBeDisabled()
  await page.evaluate(() =>
    (window as unknown as { releaseVoiceRead: () => void }).releaseVoiceRead(),
  )
  await expect(page).toHaveURL(/#guide$/)
  await expect(page.getByRole('heading', { name: 'Leave a note. Find your rhythm.' })).toBeVisible()
  await page.goto(projectUrl)
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await expect(page.getByLabel('What will you do next?')).toHaveValue(
    'Keep this voice reminder through navigation.',
  )
  await expect(page.locator('dialog audio')).toHaveAttribute('src', /^data:audio\/(webm|mp4|ogg)/)
  const voice = await page.locator('dialog audio').getAttribute('src')
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('audio')).toHaveAttribute('src', voice!)
})
