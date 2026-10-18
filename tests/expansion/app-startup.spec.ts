import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function create(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible()
}
test('production startup migrates legacy saved work and draft, then uses the normalized repository', async ({
  page,
}) => {
  await page.route('**/startup-fixture', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Fixture</title>' }),
  )
  await page.goto('/startup-fixture')
  await page.evaluate(async () => {
    const open = (name: string, upgrade: (db: IDBDatabase) => void) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1)
        request.onupgradeneeded = () => upgrade(request.result)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const now = '2026-01-01T00:00:00.000Z'
    const db = await open('loopmark', (db) => {
      db.createObjectStore('projects', { keyPath: 'id' }).createIndex('code', 'code', {
        unique: true,
      })
      db.createObjectStore('meta', { keyPath: 'key' })
    })
    const draft = await open('loopmark-drafts', (db) => {
      db.createObjectStore('drafts', { keyPath: 'key' })
    })
    for (const [database, store, value] of [
      [
        db,
        'projects',
        {
          id: 'legacy-scarf',
          code: 'LM-12345678',
          name: 'Legacy scarf',
          craft: 'Crochet',
          color: 'sage',
          toolSize: '4 mm',
          yarn: 'Wool',
          notes: '',
          status: 'active',
          createdAt: now,
          updatedAt: now,
          checkpoints: [
            {
              id: 'legacy-checkpoint',
              createdAt: now,
              nextStep: 'Turn and start row 9',
              position: 'Row 8',
              toolSize: '4 mm',
              notes: '',
            },
          ],
        },
      ],
      [
        draft,
        'drafts',
        {
          key: 'new',
          value: {
            name: 'Unfinished draft',
            craft: 'Knitting',
            color: 'clay',
            toolSize: '',
            yarn: '',
            notes: '',
          },
          revision: 'legacy-draft',
        },
      ],
    ] as const) {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(store, 'readwrite')
        tx.objectStore(store).put(value)
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error)
      })
    }
    db.close()
    draft.close()
  })
  await page.goto('/')
  await expect(page.locator('.collection-heading')).toContainText('Personal projects')
  await page.getByRole('button', { name: 'Open Legacy scarf' }).click()
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
    'Turn and start row 9',
  )
  await page.goto('/#projects')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Unfinished draft')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Unfinished draft' })).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const r = indexedDB.open('loopmark')
          r.onsuccess = () => {
            resolve(r.result.version)
            r.result.close()
          }
          r.onerror = () => reject(r.error)
        }),
    ),
  ).toBe(2)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Unfinished draft' })).toBeVisible()
})

test('complete backup restores separately and collection selection preserves source projects and drafts', async ({
  page,
}) => {
  await page.goto('/')
  await create(page, 'Original cardigan')
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page.getByLabel('What will you do next?').fill('Join the sleeves')
  await page.getByLabel('Add checkpoint photo').setInputFiles('public/icon-192.png')
  await expect(page.getByAltText('Checkpoint photo preview')).toBeVisible()
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/#backup')
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download full backup' }).click()
  const download = await event
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(backup.projects[0].checkpoints[0].photo).toMatch(/^data:image\/jpeg;base64,/)
  backup.projects[0].name = 'Restored cardigan'
  await page.goto('/#projects')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name', { exact: true }).fill('Source draft stays here')
  await expect(page.getByText('Draft kept on this device.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.goto('/#backup')
  await page.getByLabel('Restore backup file').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  await expect(page.getByRole('dialog')).toContainText('separate recovered collection')
  await page.getByRole('button', { name: 'Restore as separate collection' }).click()
  await expect(page.locator('.collection-heading')).toContainText('Restored')
  await page.goto('/#projects')
  await page.getByRole('button', { name: 'Open Restored cardigan' }).click()
  await expect(page.locator('.detail-photo img')).toBeVisible()
  await page.getByRole('button', { name: 'Change collection' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Personal projects/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Original cardigan', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(
    'Source draft stays here',
  )
})

test('unavailable storage shows recovery guidance without creating an empty workbasket', async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('Fixture failure', 'InvalidStateError')
    }
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your workbasket needs attention' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reopen Loopmark' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New project', exact: true })).toHaveCount(0)
})

test('delayed route focus preserves a field the maker has already focused', async ({ page }) => {
  await page.goto('/#guide')
  await expect(
    page.getByRole('heading', { name: 'Leave a note. Find your rhythm.', exact: true }),
  ).toBeVisible()
  await page.evaluate(() => {
    const original = window.requestAnimationFrame.bind(window)
    const queued: FrameRequestCallback[] = []
    window.requestAnimationFrame = (callback) => {
      queued.push(callback)
      return queued.length
    }
    Object.assign(window, {
      releaseRouteFrames: () => {
        window.requestAnimationFrame = original
        for (const callback of queued) callback(performance.now())
      },
    })
    location.hash = 'projects'
  })
  const search = page.getByRole('textbox', { name: 'Search projects' })
  await search.fill('Keep this input')
  await expect(search).toBeFocused()
  await page.evaluate(() =>
    (window as unknown as { releaseRouteFrames(): void }).releaseRouteFrames(),
  )
  await expect(search).toBeFocused()
  await expect(search).toHaveValue('Keep this input')
})
