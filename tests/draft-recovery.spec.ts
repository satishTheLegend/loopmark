import { expect, test } from '@playwright/test'
// Regression: interrupted forms previously lost all text and media.
// Found during completion QA, 2026-10-18. Report: docs/completion-review.md

test('new project and checkpoint drafts survive dismissal and reload, and clear after save', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name').fill('Recovered cardigan')
  await expect(page.getByText('Draft kept on this device.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.reload()
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByLabel('Project name')).toHaveValue('Recovered cardigan')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page.getByLabel('What will you do next?').fill('Join the next square')
  await page.getByLabel('Current row or repeat').fill('Round 14')
  await page.getByLabel('Add checkpoint photo').setInputFiles('public/icon-192.png')
  await expect(page.getByAltText('Checkpoint photo preview')).toBeVisible()
  await expect(page.getByText('Draft kept on this device.', { exact: false })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await expect(page.getByLabel('What will you do next?')).toHaveValue('Join the next square')
  await expect(page.getByLabel('Current row or repeat')).toHaveValue('Round 14')
  await expect(page.getByAltText('Checkpoint photo preview')).toBeVisible()
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await expect(page.getByLabel('What will you do next?')).toHaveValue('')
})

test('a recovered draft can be discarded without creating a project', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name').fill('Discard me')
  await expect(page.getByText('Draft kept on this device.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Discard draft' }).click()
  await expect(page.getByLabel('Project name')).toHaveValue('')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.reload()
  await expect(page.getByText('Let’s keep your place.')).toBeVisible()
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByLabel('Project name')).toHaveValue('')
})

test('failed draft persistence guards hash navigation and keeps text when leaving is declined', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name').fill('Keep this visible')
  await expect(page.getByText('Draft kept on this device.', { exact: false })).toBeVisible()
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'loopmark-drafts')
        throw new DOMException('Fixture quota', 'QuotaExceededError')
      return original.apply(this, args as Parameters<typeof original>)
    }
  })
  await page.getByLabel('Project name').fill('Latest unsaved words')
  await expect(page.getByRole('alert')).toBeVisible()
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.evaluate(() => {
    location.hash = 'guide'
  })
  await expect(page).toHaveURL(/#projects$/)
  await expect(page.getByLabel('Project name')).toHaveValue('Latest unsaved words')
  page.once('dialog', (dialog) => dialog.accept())
  await page.evaluate(() => {
    location.hash = 'guide'
  })
  await expect(page.getByRole('heading', { name: 'Leave a note. Find your rhythm.' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('discard serializes against further typing and save until draft storage finishes', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name').fill('Old draft')
  await expect(page.getByText('Draft kept on this device.', { exact: false })).toBeVisible()
  await page.evaluate(() => {
    const original = IDBFactory.prototype.open
    IDBFactory.prototype.open = function (...args) {
      const request = original.apply(this, args as Parameters<typeof original>)
      if (args[0] === 'loopmark-drafts') {
        const descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!
        Object.defineProperty(request, 'onsuccess', {
          set(callback) {
            descriptor.set!.call(request, (event: Event) =>
              setTimeout(() => callback.call(request, event), 500),
            )
          },
        })
      }
      return request
    }
  })
  await page.getByRole('button', { name: 'Discard draft' }).click()
  await expect(page.getByLabel('Project name')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Create project', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Project name')).toHaveValue('')
  await expect(page.getByLabel('Project name')).toBeEnabled()
  await page.getByLabel('Project name').fill('A fresh edit')
  await expect(page.getByText('Draft kept on this device.', { exact: false })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByLabel('Project name')).toHaveValue('A fresh edit')
})
