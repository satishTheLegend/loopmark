import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { cpus, platform, arch } from 'node:os'
import { PNG } from 'pngjs'
import type { Backup } from '../src/types'

const date = '2026-10-01T12:00:00.000Z'

function library(projects: number, checkpoints: number, media = false): Backup {
  const png = new PNG({ width: 240, height: 160 })
  for (let i = 0; i < png.data.length; i += 4) {
    const pixel = i / 4
    png.data[i] = (pixel * 17 + Math.floor(pixel / 240) * 13) % 256
    png.data[i + 1] = (pixel * 31) % 256
    png.data[i + 2] = (pixel * 43) % 256
    png.data[i + 3] = 255
  }
  const photos = media
    ? Array.from({ length: projects * checkpoints }, (_, index) => {
        // Distinct, valid images exercise every decode; repeating one payload would
        // only exercise the importer's intentional unique-photo decode once.
        png.data[0] = index % 256
        png.data[1] = Math.floor(index / 256)
        return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
      })
    : []
  // Real, one-second, 8 kHz mono PCM WAV. Synthetic silence, not a microphone claim.
  const wav = Buffer.alloc(44 + 16000)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(16000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(16000, 40)
  const voice = `data:audio/wav;base64,${wav.toString('base64')}`
  return {
    format: 'loopmark',
    version: 1,
    exportedAt: date,
    projects: Array.from({ length: projects }, (_, p) => ({
      id: `scale-project-${p}`,
      code: `SCALE-${String(p).padStart(3, '0')}`,
      name: `Scale project ${String(p).padStart(3, '0')}`,
      craft: p % 2 ? 'Knitting' : 'Crochet',
      color: p % 2 ? 'sage' : 'clay',
      yarn: 'Cotton yarn, warm terracotta, with a second skein in the project bag.',
      toolSize: '5 mm hook',
      notes: 'Pattern page 4. The stitch marker indicates the beginning of the next repeat.',
      status: 'active',
      createdAt: date,
      updatedAt: '2026-10-02T12:00:00.000Z',
      checkpoints: Array.from({ length: checkpoints }, (_, c) => ({
        id: `scale-checkpoint-${p}-${c}`,
        createdAt: new Date(Date.parse(date) + (checkpoints - c) * 60000).toISOString(),
        position: `Row ${checkpoints - c} complete`,
        toolSize: '5 mm hook',
        nextStep: `Resume project ${p} at row ${checkpoints - c + 1}. Chain two, turn, and work the first shell into the corner space.`,
        notes: 'Keep the turning chain loose. The reference pattern is in the blue folder.',
        ...(media ? { photo: photos[p * checkpoints + c], voice } : {}),
      })),
    })),
  }
}

async function importLibrary(page: Page, value: Backup) {
  await page.goto('/#backup')
  await page.getByLabel('Restore backup file').setInputFiles({
    name: 'scale-library.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  })
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Replace and restore', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function exported(page: Page): Promise<Backup> {
  await page.goto('/#backup')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download full backup', exact: true }).click()
  const path = await (await downloading).path()
  expect(path).toBeTruthy()
  return JSON.parse(await readFile(path!, 'utf8')) as Backup
}

// Measure in the page from the real DOM event to the rendered result. Playwright
// setup, actionability waiting and protocol roundtrips are outside this interval.
async function startMeasurement(
  page: Page,
  event: 'click' | 'input' | 'change',
  trigger: string,
  result: string,
  text: string,
  count = 1,
) {
  await page.evaluate(
    ({ event, trigger, result, text, count }) => {
      const state = window as typeof window & { scaleMeasurement?: number }
      delete state.scaleMeasurement
      const onStart = (e: Event) => {
        if (!(e.target instanceof Element) || !e.target.closest(trigger)) return
        document.removeEventListener(event, onStart, true)
        const start = performance.now()
        const observer = new MutationObserver(() => {
          const matches = [...document.querySelectorAll(result)]
          if (matches.length === count && matches.every((el) => el.textContent?.includes(text))) {
            state.scaleMeasurement = performance.now() - start
            observer.disconnect()
          }
        })
        observer.observe(document.documentElement, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        })
      }
      document.addEventListener(event, onStart, true)
    },
    { event, trigger, result, text, count },
  )
}

async function measurement(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { scaleMeasurement?: number }).scaleMeasurement,
      ),
    )
    .not.toBeUndefined()
  return page.evaluate(
    () => (window as typeof window & { scaleMeasurement: number }).scaleMeasurement,
  )
}

async function record(page: Page, info: TestInfo, metrics: Record<string, unknown>) {
  const browser = page.context().browser()
  const workerSource = await (await page.request.get('/sw.js')).text()
  const report = {
    project: info.project.name,
    browser: browser?.version(),
    workerCache: /const CACHE='([^']+)'/.exec(workerSource)?.[1],
    workers: info.config.workers,
    calibratedBudget: info.project.name === 'chromium',
    platform: `${platform()} ${arch()}`,
    cpu: cpus()[0]?.model,
    conditions: 'Headless localhost, no CPU/network throttling; synthetic isolated library.',
    ...metrics,
  }
  console.log(`LOOPMARK_SCALE ${JSON.stringify(report)}`)
  await info.attach('scale-measurements.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  })
}

test.describe('Measured library budgets', () => {
  test('50 projects and 500 checkpoints remain searchable and reload intact', async ({
    page,
  }, info) => {
    const value = library(50, 10)
    await importLibrary(page, value)
    await page.goto('/')
    await expect(page.getByRole('article')).toHaveCount(50)
    await page.evaluate(() => document.fonts.ready)
    const searchMs: number[] = []
    for (const index of [49, 25, 0]) {
      await page.getByLabel('Search projects').fill('')
      await expect(page.getByRole('article')).toHaveCount(50)
      const name = `Scale project ${String(index).padStart(3, '0')}`
      await startMeasurement(page, 'input', 'input[aria-label="Search projects"]', 'article', name)
      await page.getByLabel('Search projects').fill(name)
      await expect(page.getByRole('article')).toHaveCount(1)
      searchMs.push(await measurement(page))
    }
    await page.addInitScript(() => {
      const state = window as typeof window & { scaleShelfReadyMs?: number }
      const observer = new MutationObserver(() => {
        if (document.querySelectorAll('article.project-card').length === 50) {
          state.scaleShelfReadyMs = performance.now()
          observer.disconnect()
        }
      })
      observer.observe(document, { subtree: true, childList: true })
    })
    await page.reload()
    await expect(page.getByRole('article')).toHaveCount(50)
    const shelfReloadMs = await page.evaluate(
      () => (window as typeof window & { scaleShelfReadyMs?: number }).scaleShelfReadyMs,
    )
    const after = await exported(page)
    expect(after.projects).toHaveLength(50)
    expect(after.projects.flatMap((p) => p.checkpoints)).toHaveLength(500)
    await record(page, info, {
      scenario: '50 projects / 500 text checkpoints',
      fixtureBytes: Buffer.byteLength(JSON.stringify(value)),
      searchMs,
      shelfReloadMs,
    })
    // A practical regression guard for the product's responsive-library target.
    // This is an explicit lab guard, not a field INP or low-end-device claim.
    if (info.project.name === 'chromium') expect(Math.max(...searchMs)).toBeLessThan(500)
  })

  test('20-project 200-checkpoint text saves render committed feedback and persist', async ({
    page,
  }, info) => {
    const value = library(20, 10)
    await importLibrary(page, value)
    await page.goto('/#project=scale-project-0')
    const saveMs: number[] = []
    for (const sample of [1, 2, 3]) {
      await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
      const next = `Measured save ${sample}: join the shoulders, then weave in the ends.`
      await page.getByRole('dialog').getByLabel('What will you do next?').fill(next)
      await startMeasurement(
        page,
        'click',
        'dialog button[type="submit"], dialog button.primary',
        '.resume-note .next-instruction',
        next,
      )
      await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(next)
      saveMs.push(await measurement(page))
    }
    await page.reload()
    await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
      'Measured save 3:',
    )
    const after = await exported(page)
    expect(after.projects.flatMap((p) => p.checkpoints)).toHaveLength(203)
    await record(page, info, {
      scenario: '20 projects / 200 initial text checkpoints; three additional saves',
      fixtureBytes: Buffer.byteLength(JSON.stringify(value)),
      saveMs,
      targetMs: 500,
    })
    if (info.project.name === 'chromium') expect(Math.max(...saveMs)).toBeLessThan(500)
  })

  test('10-project 100-checkpoint media backup validates, restores and roundtrips', async ({
    page,
  }, info) => {
    const value = library(10, 10, true)
    expect(new Set(value.projects.flatMap((p) => p.checkpoints.map((c) => c.photo))).size).toBe(100)
    await page.goto('/#backup')
    await startMeasurement(
      page,
      'change',
      'input[type="file"]',
      'dialog .restore-preview',
      '10 projects',
    )
    await page.getByLabel('Restore backup file').setInputFiles({
      name: 'scale-media-library.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(value)),
    })
    await expect(page.getByRole('dialog')).toBeVisible()
    const validationMs = await measurement(page)
    await startMeasurement(page, 'click', 'dialog button.primary', 'dialog', '', 0)
    await page.getByRole('button', { name: 'Replace and restore', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const commitMs = await measurement(page)
    await page.goto('/#project=scale-project-0')
    await expect(page.locator('.detail-photo img')).toBeVisible()
    expect(
      await page.locator('.detail-photo img').evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBe(240)
    await expect(page.locator('.checkpoint-voice audio')).toHaveJSProperty('readyState', 4)
    const after = await exported(page)
    const withoutRevision = (backup: Backup) =>
      backup.projects
        .map(({ updatedAt: _, ...project }) => project)
        .sort((a, b) => a.id.localeCompare(b.id))
    expect(withoutRevision(after)).toEqual(withoutRevision(value))
    const attachment = value.projects[0].checkpoints[0]
    const photoSizes = value.projects.flatMap((project) =>
      project.checkpoints.map(
        (checkpoint) => Buffer.from(checkpoint.photo!.split(',')[1], 'base64').length,
      ),
    )
    await record(page, info, {
      scenario:
        '10 projects / 100 checkpoints; 100 distinct 240x160 PNGs and one 1-second synthetic WAV per checkpoint',
      fixtureBytes: Buffer.byteLength(JSON.stringify(value)),
      distinctPhotos: new Set(value.projects.flatMap((p) => p.checkpoints.map((c) => c.photo)))
        .size,
      photoBytes: { min: Math.min(...photoSizes), max: Math.max(...photoSizes) },
      voiceBytes: Buffer.from(attachment.voice!.split(',')[1], 'base64').length,
      validationMs,
      commitMs,
      combinedWorkMs: validationMs + commitMs,
      targetMs: 5000,
      roundtrip:
        'Every project/checkpoint/media field equal except renewed project concurrency tokens.',
    })
    if (info.project.name === 'chromium') expect(validationMs + commitMs).toBeLessThan(5000)
  })
})

test('200% zoom reflow model and 200% text preserve shelf, capture and backup use', async ({
  page,
}, info) => {
  const mobile = info.project.name.includes('mobile')
  // Browser zoom halves the available CSS layout width. This models the reflow
  // part of 200% zoom on a 1280px desktop, not browser chrome or OS magnification.
  // Mobile profiles retain their device viewport for the independent 200% text test.
  if (!mobile) await page.setViewportSize({ width: 640, height: 500 })
  const value = library(2, 2)
  value.projects[0].name =
    'A long cardigan title with room for every stitch and the next careful turn'
  await importLibrary(page, value)
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  const fits = async () => {
    const size = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      overflow: [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .map((el) => `${el.tagName}.${el.className}: ${el.textContent?.trim().slice(0, 80)}`)
        .slice(0, 12),
    }))
    expect.soft(size.scroll, JSON.stringify(size.overflow)).toBeLessThanOrEqual(size.client + 1)
  }
  await fits()
  await page.getByRole('button', { name: /^Open A long cardigan title/ }).click()
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toBeVisible()
  await fits()
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByLabel('What will you do next?')
    .fill('An enlarged, readable next step.')
  await fits()
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
    'An enlarged, readable next step.',
  )
  // Separate text-only enlargement at the full width. Capture computed sizes
  // before applying any change so inherited fonts are not doubled repeatedly.
  const doubleText = async () => {
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => {
      const sizes = [...document.querySelectorAll<HTMLElement>('body *')].map((el) => ({
        el,
        px: Number.parseFloat(getComputedStyle(el).fontSize),
      }))
      for (const { el, px } of sizes) el.style.fontSize = `${px * 2}px`
    })
  }
  if (!mobile) await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/?scale-text=shelf')
  await expect(page.getByRole('article')).toHaveCount(2)
  await doubleText()
  await fits()
  await page.goto('/?scale-text=detail#project=scale-project-0')
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toBeVisible()
  await doubleText()
  await fits()
  await expect(
    page.getByRole('heading', { name: value.projects[0].name, exact: true }),
  ).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await doubleText()
  await page
    .getByRole('dialog')
    .getByLabel('What will you do next?')
    .fill('Readable at twice the text size.')
  await fits()
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/?scale-text=backup#backup')
  await expect(page.getByRole('heading', { name: 'Keep your making safe.' })).toBeVisible()
  await doubleText()
  await fits()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download full backup', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/^loopmark-backup-.*\.json$/)
})
