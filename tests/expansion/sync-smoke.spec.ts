import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import type * as Harness from './sync-smoke-harness'
import { parseOperatorConfig } from '../../scripts/lib/config.mjs'
declare global {
  interface Window {
    LoopmarkSyncHarness: typeof Harness
  }
}
let bundle = '',
  environment: Record<string, string>,
  mailpit: string,
  origin: string
test.beforeAll(async () => {
  const file = process.env.LOOPMARK_SYNC_PUBLIC_ENV
  if (!file)
    throw new Error(
      'UNVERIFIED: set LOOPMARK_SYNC_PUBLIC_ENV to the explicitly authorized local stack public environment file',
    )
  const source = await readFile(file, 'utf8')
  environment = {}
  for (const key of [
    'VITE_LOOPMARK_APP_ORIGIN',
    'VITE_LOOPMARK_SUPABASE_URL',
    'VITE_LOOPMARK_SUPABASE_ANON_KEY',
  ]) {
    const line = source.split('\n').find((line) => line.startsWith(key + '='))
    if (!line) throw new Error('Missing local public configuration')
    environment[key] = line.slice(key.length + 1).replace(/^['"]|['"]$/g, '')
  }
  const config = parseOperatorConfig(process.env, process.cwd())
  origin = config.appOrigin
  if (
    environment.VITE_LOOPMARK_APP_ORIGIN !== origin ||
    environment.VITE_LOOPMARK_SUPABASE_URL !== config.backendUrl
  )
    throw new Error(
      'Refusing public configuration that does not match the explicitly selected local profile',
    )
  mailpit = `http://127.0.0.1:${config.ports.mail}`
  const output = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('./sync-smoke-harness.ts', import.meta.url)),
        name: 'LoopmarkSyncHarness',
        formats: ['iife'],
      },
    },
  })
  for (const result of Array.isArray(output) ? output : [output])
    if ('output' in result)
      for (const chunk of result.output) if (chunk.type === 'chunk') bundle += chunk.code
})
async function page(context: BrowserContext) {
  const p = await context.newPage()
  await p.goto(origin)
  await p.addScriptTag({ content: bundle })
  await p.evaluate((env) => window.LoopmarkSyncHarness.start(env), environment)
  return p
}
async function emailCode(email: string, request: () => Promise<unknown>) {
  const before = await (await fetch(mailpit + '/api/v1/messages')).json(),
    existing = new Set(before.messages.map((m: { ID: string }) => m.ID))
  await request()
  let code = ''
  await expect
    .poll(
      async () => {
        const result = await (await fetch(mailpit + '/api/v1/messages')).json()
        const match = result.messages.find(
          (m: { ID: string; To: Array<{ Address: string }> }) =>
            !existing.has(m.ID) && m.To.some((to) => to.Address === email),
        )
        if (!match) return false
        const detail = await (await fetch(mailpit + '/api/v1/message/' + match.ID)).json()
        code = String(detail.Text).match(/\b\d{6}\b/)?.[0] ?? ''
        return Boolean(code)
      },
      { timeout: 15000, intervals: [250, 500, 1000] },
    )
    .toBe(true)
  return code
}
async function login(p: Page, email: string) {
  const code = await emailCode(email, () =>
    p.evaluate((email) => window.LoopmarkSyncHarness.requestCode(email), email),
  )
  await p.evaluate(({ email, code }) => window.LoopmarkSyncHarness.verifyCode(email, code), {
    email,
    code,
  })
  expect(await p.evaluate(() => window.LoopmarkSyncHarness.state().view?.info.kind)).toBe('guest')
  await p.evaluate(() => window.LoopmarkSyncHarness.selectAccount())
}
test('actual OTP plus two browser devices converge text and retain a real concurrent checkpoint conflict', async ({
  browser,
}) => {
  test.setTimeout(90000)
  const first = await browser.newContext(),
    second = await browser.newContext(),
    other = await browser.newContext(),
    email = `loopmark-client-${crypto.randomUUID()}@example.invalid`
  try {
    const a = await page(first),
      b = await page(second),
      unrelated = await page(other)
    await login(a, email)
    const created = await a.evaluate(() => window.LoopmarkSyncHarness.createProject())
    const start = Date.now()
    await a.evaluate(() => window.LoopmarkSyncHarness.sync())
    const initialPushMs = Date.now() - start
    expect(initialPushMs).toBeLessThan(5000)
    // Local Auth deliberately has a five-second code-request frequency, independent of app retry copy.
    await new Promise((resolve) => setTimeout(resolve, 5100))
    await login(b, email)
    expect(
      (await b.evaluate(() => window.LoopmarkSyncHarness.projects())).map((p) => p.id),
    ).toEqual([created.id])
    await Promise.all([
      a.evaluate(
        (id) => window.LoopmarkSyncHarness.checkpoint(id, 'device-a', 'Turn from A'),
        created.id,
      ),
      b.evaluate(
        (id) => window.LoopmarkSyncHarness.checkpoint(id, 'device-b', 'Turn from B'),
        created.id,
      ),
    ])
    await a.evaluate(() => window.LoopmarkSyncHarness.sync())
    await b.evaluate(() => window.LoopmarkSyncHarness.sync())
    const localB = await b.evaluate(() => window.LoopmarkSyncHarness.state())
    expect(localB.view?.checkpoints.map((c) => c.nextStep).sort()).toEqual([
      'Turn from A',
      'Turn from B',
    ])
    expect(localB.view?.pending).toHaveLength(1)
    expect(localB.view?.pending[0].state).toBe('conflict')
    await b.evaluate(() => window.LoopmarkSyncHarness.keepDeviceConflict())
    await a.evaluate(() => window.LoopmarkSyncHarness.sync())
    for (const device of [a, b]) {
      const converged = await device.evaluate(() => window.LoopmarkSyncHarness.state())
      expect(converged.view?.pending).toEqual([])
      expect(converged.view?.checkpoints.map((c) => c.nextStep).sort()).toEqual([
        'Turn from A',
        'Turn from B',
      ])
    }
    await login(unrelated, `loopmark-client-other-${crypto.randomUUID()}@example.invalid`)
    expect(await unrelated.evaluate(() => window.LoopmarkSyncHarness.projects())).toEqual([])
    const identities = await Promise.all([
      a.evaluate(() => window.LoopmarkSyncHarness.state().account?.accountId),
      unrelated.evaluate(() => window.LoopmarkSyncHarness.state().account?.accountId),
    ])
    test.info().annotations.push(
      { type: 'synthetic-owned-account-ids', description: JSON.stringify(identities) },
      {
        type: 'fixture',
        description: `loopback HTTP; initial text push ${initialPushMs}ms; OTP frequency wait included in total ${Date.now() - start}ms`,
      },
    )
  } finally {
    for (const context of [first, second, other]) await context.close()
  }
})

test('actual local photo candidate remains private until confirmed, restores bytes, and retains them through account deletion', async ({
  browser,
}) => {
  test.setTimeout(90000)
  const context = await browser.newContext(),
    email = `loopmark-client-candidate-${crypto.randomUUID()}@example.invalid`
  try {
    const p = await page(context)
    const project = await p.evaluate(() => window.LoopmarkSyncHarness.createProject())
    const photo = await p.evaluate(
      (id) => window.LoopmarkSyncHarness.photoCheckpoint(id),
      project.id,
    )
    await login(p, email)
    expect(await p.evaluate(() => window.LoopmarkSyncHarness.projects())).toEqual([])
    let sentPrepare = 0
    p.on('request', (request) => {
      if (request.url().endsWith('/collection-attach')) sentPrepare++
    })
    const preview = await p.evaluate(() => window.LoopmarkSyncHarness.previewGuest())
    expect(sentPrepare).toBe(0)
    await p.evaluate((preview) => window.LoopmarkSyncHarness.confirm(preview), preview)
    expect(sentPrepare).toBeGreaterThan(0)
    const connected = await p.evaluate(() => window.LoopmarkSyncHarness.state())
    expect(connected.view?.info.kind).toBe('connected')
    expect(connected.view?.pending).toEqual([])
    expect(connected.view?.projects).toHaveLength(1)
    expect(connected.scope?.key.epoch).not.toBe(preview.destination.key.epoch)
    expect(
      (await p.evaluate(() => window.LoopmarkSyncHarness.backup())).projects[0].checkpoints[0]
        .photo,
    ).toBe(photo)
    await new Promise((resolve) => setTimeout(resolve, 5100))
    const code = await emailCode(email, () =>
      p.evaluate(() => window.LoopmarkSyncHarness.deletionCode()),
    )
    expect((await p.evaluate(() => window.LoopmarkSyncHarness.review())).missingAttachments).toBe(0)
    const deleted = await p.evaluate((code) => window.LoopmarkSyncHarness.deleteAccount(code), code)
    expect(deleted.receipt.status).toMatch(/pending|live-data-removed|complete/)
    expect(deleted.saved[0].localOutcome).toBe('kept')
    const local = await p.evaluate(() => window.LoopmarkSyncHarness.state())
    expect(local.account).toBeNull()
    expect(local.view?.info.kind).toBe('retained')
    expect(
      (await p.evaluate(() => window.LoopmarkSyncHarness.backup())).projects[0].checkpoints[0]
        .photo,
    ).toBe(photo)
  } finally {
    await context.close()
  }
})

test('actual checkpoint text and attachment finalization survive restart and complete export on a second device', async ({
  browser,
}) => {
  test.setTimeout(90000)
  const first = await browser.newContext(),
    second = await browser.newContext(),
    email = `loopmark-client-media-${crypto.randomUUID()}@example.invalid`
  try {
    const a = await page(first)
    await login(a, email)
    const project = await a.evaluate(() => window.LoopmarkSyncHarness.createProject())
    await a.evaluate(() => window.LoopmarkSyncHarness.sync())
    const photo = await a.evaluate(
      (id) => window.LoopmarkSyncHarness.photoCheckpoint(id),
      project.id,
    )
    await a.evaluate(() => window.LoopmarkSyncHarness.sync())
    expect((await a.evaluate(() => window.LoopmarkSyncHarness.state())).sync).toMatchObject({
      pending: 0,
      pendingAttachments: 0,
      failedAttachments: 0,
      state: 'idle',
    })
    await new Promise((resolve) => setTimeout(resolve, 5100))
    const b = await page(second)
    await login(b, email)
    const exported = await b.evaluate(() => window.LoopmarkSyncHarness.backup())
    expect(exported.projects[0].checkpoints[0].photo).toBe(photo)
    await a.reload()
    await a.addScriptTag({ content: bundle })
    await a.evaluate((env) => window.LoopmarkSyncHarness.start(env), environment)
    await a.evaluate(() => window.LoopmarkSyncHarness.sync())
    expect(
      (await a.evaluate(() => window.LoopmarkSyncHarness.backup())).projects[0].checkpoints,
    ).toHaveLength(1)
  } finally {
    await first.close()
    await second.close()
  }
})
