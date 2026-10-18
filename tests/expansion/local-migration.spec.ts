import { expect, test } from '@playwright/test'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import type * as Harness from './local-migration-harness'

declare global {
  interface Window {
    LoopmarkMigrationHarness: typeof Harness
  }
}
let bundle = ''
test.beforeAll(async () => {
  const output = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('./local-migration-harness.ts', import.meta.url)),
        name: 'LoopmarkMigrationHarness',
        formats: ['iife'],
      },
    },
  })
  const results = Array.isArray(output) ? output : [output]
  for (const result of results)
    if ('output' in result)
      for (const chunk of result.output) if (chunk.type === 'chunk') bundle += chunk.code
  if (!bundle) throw new Error('Browser repository harness build produced no JavaScript')
})
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.addScriptTag({ content: bundle })
  await page.evaluate(async () => {
    const h = window.LoopmarkMigrationHarness
    const create = (name: string, stores: string[], rows: Record<string, unknown[]>) =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open(name, 1)
        r.onupgradeneeded = () => {
          for (const name of stores)
            r.result.createObjectStore(name, { keyPath: name === 'projects' ? 'id' : 'key' })
        }
        r.onerror = () => reject(r.error)
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(stores, 'readwrite')
          for (const name of stores) for (const row of rows[name]) tx.objectStore(name).put(row)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
    const { revision: _revision, ...p } = h.project()
    await create('migration-source', ['projects', 'meta'], {
      projects: [
        {
          ...p,
          checkpoints: [
            {
              id: 'checkpoint',
              createdAt: h.now,
              position: 'Row 4',
              toolSize: '4 mm',
              nextStep: 'Turn',
              notes: '',
              photo: h.png,
              voice: h.wav,
            },
          ],
        },
      ],
      meta: [{ key: 'library', revision: 'source-revision' }],
    })
    await create('migration-drafts', ['drafts'], {
      drafts: [
        {
          key: 'checkpoint:project',
          revision: 'draft-revision',
          value: {
            position: '',
            toolSize: '4 mm',
            nextStep: '',
            notes: 'Still typing',
            photo: undefined,
            voice: h.wav,
          },
        },
      ],
    })
  })
})
test('copies and hashes actual browser IndexedDB media and unsaved drafts before switching readers', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.LoopmarkMigrationHarness,
      repository = await h.openBrowserRepository({ databaseName: 'migration-target' })
    const sourceNames = { projects: 'migration-source', drafts: 'migration-drafts' },
      before = await h.readLegacySnapshot(indexedDB, sourceNames)
    const receipt = await h.migrateLegacy({
      repository,
      sourceNames,
      destination: h.info(),
      generation: 1,
      device: { id: 'device', generation: 'gen' },
    })
    const copied = await h.portableProjects(repository, h.info().key),
      draft = await h.readMigratedDraft(repository, h.info().key, 'checkpoint:project')
    const after = await h.readLegacySnapshot(indexedDB, sourceNames),
      selection = await h.readMigrationSelection(repository)
    await repository.close()
    const fresh = await h.openBrowserRepository({ databaseName: 'migration-target' }),
      freshSelection = await h.readMigrationSelection(fresh)
    await fresh.close()
    return { receipt, copied, before, after, draft, selection, freshSelection }
  })
  expect(result.receipt.status).toBe('selected')
  expect(result.receipt.media).toHaveLength(2)
  expect(result.copied).toEqual(result.before.projects)
  expect(result.draft).toEqual(result.before.drafts[0])
  expect(result.after.projects).toEqual(result.before.projects)
  expect(result.after.drafts).toEqual(result.before.drafts)
  expect(result.freshSelection).toEqual(result.selection)
})
test('an old open connection blocks the switch; old-version writes fail after it closes', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.LoopmarkMigrationHarness,
      repository = await h.openBrowserRepository({ databaseName: 'migration-target' })
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('migration-source', 1)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const args = {
      repository,
      sourceNames: { projects: 'migration-source', drafts: 'migration-drafts' },
      destination: h.info(),
      generation: 1,
      device: { id: 'device', generation: 'gen' },
    }
    let blocked = false
    try {
      await h.migrateLegacy(args)
    } catch {
      blocked = true
    }
    const selectionBefore = await h.readMigrationSelection(repository)
    held.close()
    await new Promise((resolve) => setTimeout(resolve, 25))
    const receipt = await h.migrateLegacy(args)
    const oldWriter = await new Promise<string>((resolve) => {
      const r = indexedDB.open('migration-source', 1)
      r.onsuccess = () => {
        r.result.close()
        resolve('opened')
      }
      r.onerror = () => resolve(r.error?.name ?? 'unknown')
    })
    await repository.close()
    return { blocked, selectionBefore, receipt, oldWriter }
  })
  expect(result.blocked).toBe(true)
  expect(result.selectionBefore).toBeNull()
  expect(result.receipt.status).toBe('selected')
  expect(result.oldWriter).toBe('VersionError')
})
test('a poisoned source date fails migration while source bytes and old reader selection survive', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.LoopmarkMigrationHarness,
      repository = await h.openBrowserRepository({ databaseName: 'migration-target' })
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('migration-source', 1)
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction('projects', 'readwrite'),
          q = tx.objectStore('projects').get('project')
        q.onsuccess = () =>
          tx.objectStore('projects').put({ ...q.result, updatedAt: '+275760-09-13T00:00:00.000Z' })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
    let rejected = false
    try {
      await h.migrateLegacy({
        repository,
        sourceNames: { projects: 'migration-source', drafts: 'migration-drafts' },
        destination: h.info(),
        generation: 1,
        device: { id: 'device', generation: 'gen' },
      })
    } catch {
      rejected = true
    }
    const selection = await h.readMigrationSelection(repository),
      collections = await repository.listCollections()
    const raw = await new Promise<string>((resolve) => {
      const r = indexedDB.open('migration-source')
      r.onsuccess = () => {
        const db = r.result,
          q = db.transaction('projects').objectStore('projects').get('project')
        q.onsuccess = () => {
          db.close()
          resolve(q.result.updatedAt)
        }
      }
    })
    await repository.close()
    return { rejected, selection, collections, raw }
  })
  expect(result).toEqual({
    rejected: true,
    selection: null,
    collections: [],
    raw: '+275760-09-13T00:00:00.000Z',
  })
})

test('an idle old tab cannot create an absent legacy database after the new reader is selected', async ({
  page,
  context,
}) => {
  const idle = await context.newPage()
  await idle.goto('/')
  const result = await page.evaluate(async () => {
    const h = window.LoopmarkMigrationHarness,
      repository = await h.openBrowserRepository({ databaseName: 'absent-target' })
    const receipt = await h.migrateLegacy({
      repository,
      sourceNames: { projects: 'absent-projects', drafts: 'absent-drafts' },
      destination: h.info(),
      generation: 1,
      device: { id: 'device', generation: 'gen' },
    })
    const legacyAccess = (await repository.readView(h.info().key)).info.legacyAccess
    await repository.close()
    return { originalSources: receipt.originalSources, legacyAccess }
  })
  const oldWriter = await idle.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const r = indexedDB.open('absent-projects', 1)
        r.onupgradeneeded = () => {
          r.result.createObjectStore('projects', { keyPath: 'id' })
        }
        r.onsuccess = () => {
          r.result.close()
          resolve('opened')
        }
        r.onerror = () => resolve(r.error?.name ?? 'unknown')
      }),
  )
  expect(result).toEqual({ originalSources: { projects: null, drafts: null }, legacyAccess: false })
  expect(oldWriter).toBe('VersionError')
})
