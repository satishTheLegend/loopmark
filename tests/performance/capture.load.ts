import { expect, test } from '@playwright/test'
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chooseAccount, createProject, signIn } from '../cloud/helpers'

// Explicit operator-run observer. It never creates backend load or modifies a
// provider configuration. The separate load runner owns its own workload.
test('connected local capture remains durable during the independently timed service load', async ({
  page,
}, info) => {
  test.setTimeout(720000)
  page.setDefaultTimeout(30000)
  const duration = Number(process.env.LOOPMARK_LOAD_OBSERVER_MS ?? 600000)
  if (!Number.isInteger(duration) || duration < 30000 || duration > 600000)
    throw new Error('LOOPMARK_LOAD_OBSERVER_MS must be an integer from 30000 to 600000')
  const directory = resolve('.gstack/load-capture')
  await mkdir(directory, { recursive: true })
  const runId = crypto.randomUUID()
  const stopPath = resolve(directory, `${runId}.stop`)
  const journalPath = resolve(directory, `${runId}.jsonl`)
  const samples: Array<{ startedAt: string; committedAt: string; saveMs: number }> = []
  const failures: string[] = []
  const responses: Record<string, number> = {}
  page.on('pageerror', () => failures.push('PAGE_ERROR'))
  page.on('response', (response) => {
    if (!response.url().includes('/functions/v1/')) return
    const status = String(response.status())
    responses[status] = (responses[status] ?? 0) + 1
  })
  await signIn(page, `load-observer-${runId}@example.invalid`)
  await chooseAccount(page)
  await createProject(page, 'Load observer shawl')
  await expect(page.locator('.sync-status')).toContainText('Synced to your account', {
    timeout: 30000,
  })
  const readyAt = new Date().toISOString()
  const ready = {
    runId,
    readyAt,
    stopPath,
    source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    journalPath,
  }
  await appendFile(journalPath, JSON.stringify({ phase: 'ready', ...ready }) + '\n')
  await writeFile(resolve(directory, 'ready.json'), JSON.stringify(ready, null, 2) + '\n')
  console.log('LOOPMARK_CAPTURE_READY ' + JSON.stringify(ready))
  const deadline = Date.now() + duration
  while (Date.now() < deadline && samples.length < 500) {
    if (
      samples.length >= 3 &&
      (await access(stopPath).then(
        () => true,
        () => false,
      ))
    )
      break
    await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
    const nextStep = `Load observer checkpoint ${samples.length + 1}: continue the next row.`
    await page.getByLabel('What will you do next?').fill(nextStep)
    await page.evaluate((expected) => {
      const state = window as typeof window & { loadCaptureMs?: number }
      delete state.loadCaptureMs
      document.addEventListener(
        'click',
        function started(event) {
          if (!(event.target instanceof Element) || !event.target.closest('dialog button.primary'))
            return
          document.removeEventListener('click', started, true)
          const start = performance.now()
          const observer = new MutationObserver(() => {
            if (
              document
                .querySelector('.resume-note .next-instruction')
                ?.textContent?.includes(expected)
            ) {
              state.loadCaptureMs = performance.now() - start
              observer.disconnect()
            }
          })
          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            characterData: true,
          })
        },
        true,
      )
    }, nextStep)
    const startedAt = new Date().toISOString()
    await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(nextStep)
    const saveMs = await page.evaluate(
      () => (window as typeof window & { loadCaptureMs?: number }).loadCaptureMs,
    )
    expect(saveMs).toBeDefined()
    samples.push({ startedAt, committedAt: new Date().toISOString(), saveMs: saveMs! })
    await appendFile(journalPath, JSON.stringify({ phase: 'saved', ...samples.at(-1) }) + '\n')
    await page.waitForTimeout(1000)
  }
  await appendFile(
    journalPath,
    JSON.stringify({ phase: 'reload', at: new Date().toISOString(), count: samples.length }) + '\n',
  )
  await page.reload()
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(
    `Load observer checkpoint ${samples.length}:`,
  )
  await page.getByRole('button', { name: 'Backup & restore', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Backup & restore', exact: true, level: 1 }),
  ).toBeVisible()
  await appendFile(
    journalPath,
    JSON.stringify({ phase: 'export', at: new Date().toISOString() }) + '\n',
  )
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download full backup', exact: true }).click()
  const file = await (await downloading).path()
  const backup = JSON.parse(await readFile(file!, 'utf8'))
  expect(backup.projects[0].checkpoints).toHaveLength(samples.length)
  expect(
    new Set(
      backup.projects[0].checkpoints.map((checkpoint: { nextStep: string }) => checkpoint.nextStep),
    ).size,
  ).toBe(samples.length)
  const report = {
    ...ready,
    finishedAt: new Date().toISOString(),
    samples,
    responses,
    failures,
    preservedCheckpoints: backup.projects[0].checkpoints.length,
    targetMs: 500,
    maxSaveMs: Math.max(...samples.map((sample) => sample.saveMs)),
    conditions:
      'Actual Chromium app connected to the selected loopback backend. Match sample timestamps against the separate workload phases; this report alone does not prove overlap or load size.',
  }
  await writeFile(resolve(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(
    resolve(directory, `${runId}.result.json`),
    JSON.stringify(report, null, 2) + '\n',
  )
  await info.attach('capture-under-load.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  })
  expect(failures).toEqual([])
  expect(samples.length).toBeGreaterThanOrEqual(3)
  expect(report.maxSaveMs).toBeLessThan(500)
})
