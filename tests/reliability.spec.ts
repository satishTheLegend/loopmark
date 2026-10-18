import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// Regression contracts for the recovery and restore hardening added during completion QA.
// Report: docs/cross-browser-review.md. Fixtures stay in isolated browser contexts.
async function createProject(page: Page, name = 'Reliable cardigan') {
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name').fill(name)
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/#project=/)
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible()
}

async function saveCheckpoint(page: Page, nextStep: string) {
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page.getByLabel('What will you do next?').fill(nextStep)
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(nextStep)
}

async function downloadBackup(page: Page) {
  await page.goto('/#backup')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download full backup' }).click()
  const path = await (await downloading).path()
  expect(path).toBeTruthy()
  return JSON.parse(await readFile(path!, 'utf8'))
}

test('a recovered edit draft cannot overwrite details saved later in another tab', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await createProject(page)
  const projectUrl = page.url()
  await page.getByRole('button', { name: 'Edit project details' }).click()
  await page.getByLabel('Project name').fill('Recovered older edit')
  await expect(page.getByText('Draft kept on this device.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Edit project details' }).click()
  await expect(page.getByLabel('Project name')).toHaveValue('Recovered older edit')
  await expect(page.getByText('Draft recovered on this device.', { exact: false })).toBeVisible()
  const other = await context.newPage()
  await other.goto(projectUrl)
  await other.getByRole('button', { name: 'Edit project details' }).click()
  await other.getByLabel('Project name').fill('Newer committed details')
  await other.getByRole('button', { name: 'Save details', exact: true }).click()
  await expect(other.getByRole('heading', { name: 'Newer committed details' })).toBeVisible()
  await page.getByRole('button', { name: 'Save details', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('changed elsewhere')
  await expect(page.getByLabel('Project name')).toHaveValue('Recovered older edit')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Newer committed details' })).toBeVisible()
})

test('competing tabs preserve the first stored draft and warn before losing the second input', async ({
  page,
  context,
}) => {
  await page.goto('/')
  const other = await context.newPage()
  await other.goto('/')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await other.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByLabel('Project name')).toBeEnabled()
  await expect(other.getByLabel('Project name')).toBeEnabled()
  await page.getByLabel('Project name').fill('First tab draft')
  await expect(page.getByText('Draft kept on this device.', { exact: false })).toBeVisible()
  await other.getByLabel('Project name').fill('Second tab input')
  await expect(other.getByRole('alert')).toContainText('information changed elsewhere')
  await expect(other.getByLabel('Project name')).toHaveValue('Second tab input')
  const warning = other.waitForEvent('dialog')
  const closing = other.getByRole('button', { name: 'Close dialog' }).click()
  const confirmation = await warning
  expect(confirmation.type()).toBe('confirm')
  expect(confirmation.message()).toContain('lose your latest unsaved changes')
  await confirmation.dismiss()
  await closing
  await expect(other.getByLabel('Project name')).toHaveValue('Second tab input')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.reload()
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByLabel('Project name')).toHaveValue('First tab draft')
})

test('draft write failure reports the loss of recovery while a normal project save still commits', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByLabel('Project name')).toBeEnabled()
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'loopmark-v2' && this.name === 'drafts')
        throw new DOMException('Injected draft quota failure', 'QuotaExceededError')
      return put.apply(this, args)
    }
  })
  await page.getByLabel('Project name').fill('Save despite draft failure')
  await expect(page.getByRole('alert')).toContainText('device storage is full')
  await expect(page.getByText('Draft kept on this device.', { exact: false })).toHaveCount(0)
  await expect(page.getByLabel('Project name')).toHaveValue('Save despite draft failure')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Save despite draft failure' })).toBeVisible()
})

test('a committed checkpoint is not duplicated when its draft cannot be deleted and is saved again', async ({
  page,
}) => {
  await page.goto('/')
  await createProject(page)
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  const nextStep = 'Commit this checkpoint exactly once.'
  await page.getByLabel('What will you do next?').fill(nextStep)
  await expect(page.getByText('Draft kept on this device.', { exact: false })).toBeVisible()
  await page.evaluate(() => {
    const remove = IDBObjectStore.prototype.delete
    IDBObjectStore.prototype.delete = function (...args) {
      if (this.transaction.db.name === 'loopmark-v2' && this.name === 'drafts')
        throw new DOMException('Injected draft cleanup failure', 'UnknownError')
      return remove.apply(this, args)
    }
  })
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByText('Checkpoint saved, but the draft could not be cleared.', { exact: false }),
  ).toBeVisible()
  await expect(page.locator('.history-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await expect(page.getByLabel('What will you do next?')).toHaveValue(nextStep)
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.history-row')).toHaveCount(1)
  // Reload also removes the injected fault. The receipt must survive in durable storage.
  await page.reload()
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await expect(page.getByLabel('What will you do next?')).toHaveValue(nextStep)
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.history-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await expect(page.getByLabel('What will you do next?')).toHaveValue('')
})

test('already-persistent storage is shown as protected without asking again', async ({ page }) => {
  await page.addInitScript(() => {
    Object.getPrototypeOf(navigator.storage).persisted = async () => true
    Object.getPrototypeOf(navigator.storage).persist = async () => {
      throw new Error('The app should not request permission when storage is already protected')
    }
  })
  await page.goto('/#backup')
  await expect(page.getByRole('button', { name: 'Storage protection enabled' })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Storage protection enabled' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Ask to keep this device’s data' })).toHaveCount(0)
})

test('a separate restore preserves work saved after its preview in the original collection', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await createProject(page, 'Current collection')
  const projectUrl = page.url()
  const replacement = await downloadBackup(page)
  replacement.projects[0].name = 'Confirmed recovered copy'
  await page.getByLabel('Restore backup file').setInputFiles({
    name: 'replacement.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(replacement)),
  })
  await expect(page.getByRole('dialog')).toContainText(
    'Current collection: 1 projects · 0 checkpoints.',
  )
  const other = await context.newPage()
  await other.goto(projectUrl)
  await saveCheckpoint(other, 'Newer work remains in the source collection.')
  await page.getByRole('button', { name: 'Restore as separate collection' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto(projectUrl)
  await expect(page.getByRole('heading', { name: 'Confirmed recovered copy' })).toBeVisible()
  await expect(page.locator('.history-row')).toHaveCount(0)
  await page.getByRole('button', { name: 'Change collection' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Personal projects/ })
    .click()
  await page.goto(projectUrl)
  await expect(page.getByRole('heading', { name: 'Current collection', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
    'Newer work remains in the source collection.',
  )
  await expect(page.locator('.history-row')).toHaveCount(1)
})

test('a storage-status check failure stays visible and permits a later protection request', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.getPrototypeOf(navigator.storage).persisted = async () => {
      throw new Error('Injected storage status failure')
    }
    Object.getPrototypeOf(navigator.storage).persist = async () => true
  })
  await page.goto('/#backup')
  await expect(page.getByRole('status').filter({ hasText: 'could not be checked' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Storage protection enabled' })).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  const requestProtection = page.getByRole('button', { name: 'Ask to keep this device’s data' })
  await requestProtection.scrollIntoViewIfNeeded()
  // WebKit may deliver down/up to different targets during its first scroll paint.
  // Settle that paint before one native click; never retry a missed application action.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  await requestProtection.click()
  await expect(page.getByRole('button', { name: 'Storage protection enabled' })).toBeDisabled()
  await expect(page.getByRole('status').filter({ hasText: 'could not be checked' })).toHaveCount(0)
})

test('unsupported storage protection explains the backup fallback without claiming protection', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persisted: undefined, persist: undefined },
    })
  })
  await page.goto('/#backup')
  await expect(
    page.getByRole('status').filter({ hasText: 'does not support storage protection' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask to keep this device’s data' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Storage protection enabled' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Download full backup' })).toBeEnabled()
})

test('declined storage protection remains visible and a backup can still be downloaded', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.getPrototypeOf(navigator.storage).persisted = async () => false
    Object.getPrototypeOf(navigator.storage).persist = async () => false
  })
  await page.goto('/#backup')
  await page.getByRole('button', { name: 'Ask to keep this device’s data' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'did not grant storage protection' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Storage protection enabled' })).toHaveCount(0)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download full backup' }).click()
  expect((await downloading).suggestedFilename()).toMatch(/^loopmark-backup-.*\.json$/)
  await expect(
    page.getByRole('status').filter({ hasText: 'did not grant storage protection' }),
  ).toBeVisible()
})
