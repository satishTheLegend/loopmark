import { test, expect, type Page, type Request } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseOperatorConfig } from '../../scripts/lib/config.mjs'
import { assertLocalDocker } from '../../scripts/local.mjs'
import type { Command } from '../../src/domain/contracts'
import { canonicalJson } from '../../src/domain/canonical-json'
import { signIn, chooseAccount, createProject, origin } from '../cloud/helpers'

const execute = promisify(execFile)
const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
)
type Trigger = 'retired' | 'cursor'

/** Age only one generated fixture. The actual session/pull/push endpoints remain the authorities. */
async function fixtureSql(email: string, command: Command, action: Trigger | 'inspect') {
  if (
    !/^loopmark-rebase-(retired|cursor)-[a-f0-9-]{36}@example\.invalid$/.test(email) ||
    ![command.deviceId, command.collectionId, command.operationId].every((value) =>
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value),
    )
  )
    throw new Error('Only generated local rebase fixtures may be read or aged')
  const config = parseOperatorConfig(process.env, process.cwd())
  await assertLocalDocker()
  const owner = `(select id from auth.users where email='${email}')`
  const mutate =
    action === 'retired'
      ? `update loopmark_private.devices set retired_at=now(),last_seen=now()-interval '91 days' where owner_id=${owner} and id='${command.deviceId}';`
      : action === 'cursor'
        ? `update loopmark_private.collections set compacted_cursor=next_cursor where owner_id=${owner} and id='${command.collectionId}';
           delete from loopmark_private.change_feed where owner_id=${owner} and collection_id='${command.collectionId}' and cursor<=(select compacted_cursor from loopmark_private.collections where owner_id=${owner} and id='${command.collectionId}');
           update loopmark_private.devices set sequence_floor=max_sequence where owner_id=${owner} and id='${command.deviceId}';`
        : ''
  const statement = `begin;
    do $$ begin
      if not exists(select 1 from loopmark_private.devices d join loopmark_private.collections c on c.owner_id=d.owner_id where d.owner_id=${owner} and d.id='${command.deviceId}' and c.id='${command.collectionId}') then raise exception 'Fixture not found'; end if;
    end $$;
    ${mutate}
    select json_build_object('generation',d.generation,'floor',d.sequence_floor::text,'max',d.max_sequence::text,
      'compactedCursor',(select compacted_cursor::text from loopmark_private.collections where owner_id=d.owner_id and id='${command.collectionId}'),
      'oldReceiptCount',(select count(*) from loopmark_private.operation_receipts where owner_id=d.owner_id and operation_id='${command.operationId}'),
      'checkpointCount',(select count(*) from loopmark_private.checkpoints where owner_id=d.owner_id and collection_id='${command.collectionId}' and deleted_at is null))
      from loopmark_private.devices d where d.owner_id=${owner} and d.id='${command.deviceId}';
    commit;`
  const { stdout } = await execute('docker', [
    'exec',
    `supabase_db_${config.projectId}`,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-X',
    '-q',
    '-A',
    '-t',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    statement,
  ])
  return JSON.parse(stdout.trim()) as {
    generation: string
    floor: string
    max: string
    compactedCursor: string
    oldReceiptCount: number
    checkpointCount: number
  }
}
async function openProject(page: Page, title: string) {
  await page.goto(origin + '/#projects')
  await page.getByRole('button', { name: new RegExp(`^Open ${title}\\.`) }).click()
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible()
}
async function saveCheckpoint(page: Page, step: string, withPhoto = false) {
  await page.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
  await page.getByLabel('What will you do next?').fill(step)
  await page.getByLabel('Current row or repeat').fill('Row 19')
  if (withPhoto) {
    await page
      .getByLabel('Add checkpoint photo')
      .setInputFiles({ name: 'kept-photo.png', mimeType: 'image/png', buffer: photo })
    await expect(page.getByAltText('Checkpoint photo preview')).toBeVisible()
  }
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Latest checkpoint' })).toContainText(step)
}

for (const trigger of ['retired', 'cursor'] as const)
  test(`actual ${trigger === 'retired' ? 'retired-device' : 'expired-feed-cursor'} recovery keeps attempted checkpoint, photo and draft without replay, then accepts a fresh command`, async ({
    browser,
  }) => {
    test.setTimeout(150000)
    const first = await browser.newContext(),
      reader = await browser.newContext()
    const email = `loopmark-rebase-${trigger}-${crypto.randomUUID()}@example.invalid`
    const title = `Rebase ${trigger} scarf`,
      localStep = 'Keep the unsent photo checkpoint on this device',
      draftStep = 'Unfinished draft after the paused checkpoint'
    let release!: () => void
    let closing = false
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      const a = await first.newPage(),
        b = await reader.newPage()
      await signIn(a, email)
      await chooseAccount(a)
      await createProject(a, title)
      await expect(a.locator('.sync-status')).toContainText('Synced to your account', {
        timeout: 20000,
      })
      let attempted: Command | undefined
      const sent: Command[] = []
      a.on('request', (request) => {
        if (
          new URL(request.url()).pathname === '/functions/v1/sync-push' &&
          request.method() === 'POST'
        )
          sent.push(request.postDataJSON() as Command)
      })
      const observedResponses = new Map<
        Request,
        {
          operationId: string
          sha256: string
          status: number
          body: { error: { code: string } }
        }
      >()
      await a.route('**/functions/v1/sync-push', async (route) => {
        if (route.request().method() === 'POST') {
          const command = route.request().postDataJSON() as Command
          if (!attempted && command.kind === 'checkpoint.create') attempted = command
          if (attempted && command.operationId === attempted.operationId) {
            // Every immutable retry must remain behind the same barrier. The client's
            // real request deadline can expire while the second device signs in.
            expect(command.sha256).toBe(attempted.sha256)
            expect(canonicalJson(command)).toBe(canonicalJson(attempted))
            await held
            if (closing || route.request().failure()) {
              await route.abort().catch(() => {})
              return
            }
            // Capture the real endpoint response before delivering identical bytes
            // to the browser. CDP can lose an aborted response body after headers.
            const actual = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 })
            try {
              const bytes = await actual.body()
              expect(bytes.byteLength).toBeLessThanOrEqual(512 * 1024)
              observedResponses.set(route.request(), {
                operationId: command.operationId,
                sha256: command.sha256,
                status: actual.status(),
                body: JSON.parse(bytes.toString('utf8')) as { error: { code: string } },
              })
              await route.fulfill({ response: actual, body: bytes }).catch((error) => {
                if (!closing && !route.request().failure()) throw error
              })
            } finally {
              await actual.dispose()
            }
            return
          }
        }
        await route.continue().catch(() => {}) // Closing a failed fixture can abort a request.
      })
      await saveCheckpoint(a, localStep, true)
      await expect(a.locator('.detail-photo img')).toHaveAttribute(
        'src',
        /^data:image\/jpeg;base64,/,
      )
      const savedPhoto = (await a.locator('.detail-photo img').getAttribute('src'))!
      await expect.poll(() => attempted?.operationId, { timeout: 20000 }).toBeTruthy()
      const original = attempted!
      // This is a real outgoing request: markAttempt already ran, but the server has not seen it yet.
      await a.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
      await a.getByLabel('What will you do next?').fill(draftStep)
      await a.getByRole('button', { name: 'Close dialog', exact: true }).click()

      if (trigger === 'cursor') {
        await a.waitForTimeout(5100)
        await signIn(b, email)
        await chooseAccount(b)
        await openProject(b, title)
        await b.getByRole('button', { name: 'Edit project details' }).click()
        await b
          .getByLabel('Project notes')
          .fill('Account detail changed while the first device was paused')
        await b.getByRole('button', { name: 'Save details', exact: true }).click()
        await expect(b.getByRole('dialog')).toHaveCount(0)
        await expect(b.locator('.sync-status')).toContainText('Synced to your account', {
          timeout: 20000,
        })
      }
      const aged = await fixtureSql(email, original, trigger)
      expect(aged.oldReceiptCount).toBe(0)
      const pullErrors: string[] = []
      a.on('response', (response) => {
        if (
          new URL(response.url()).pathname === '/functions/v1/sync-pull' &&
          response.status() === 409
        )
          void response
            .json()
            .then((body) => pullErrors.push(body.error.code))
            .catch(() => {})
      })
      const denied = a.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/functions/v1/sync-push' &&
          response.request().method() === 'POST' &&
          response.request().postDataJSON().operationId === original.operationId,
      )
      release()
      const response = await denied
      expect(response.status()).toBe(409)
      const observed = observedResponses.get(response.request())
      expect(observed).toBeTruthy()
      expect(observed!.operationId).toBe(original.operationId)
      expect(observed!.sha256).toBe(original.sha256)
      expect(observed!.status).toBe(response.status())
      expect(observed!.body.error.code).toBe(
        trigger === 'retired' ? 'SYNC_REBASE_REQUIRED' : 'REVISION_CONFLICT',
      )
      await a.unroute('**/functions/v1/sync-push')
      if (trigger === 'cursor') {
        await a.reload()
        await expect.poll(() => pullErrors).toContain('SYNC_REBASE_REQUIRED')
      } else {
        // Cold restart exercises cached identity with auth='expired'; recovery still requires verified re-registration.
        await a.reload()
      }
      await a.getByRole('button', { name: 'Sync details', exact: true }).click()
      await a.getByRole('button', { name: 'Refresh account projects', exact: true }).click()
      const review = a.getByRole('dialog', { name: 'Refresh this account safely', exact: true })
      await expect(
        review.getByText('Saved checkpoints', { exact: true }).locator('..'),
      ).toContainText('1')
      await expect(review.getByText('Drafts to keep', { exact: true }).locator('..')).toContainText(
        '1',
      )
      await expect(
        review.getByText('Unsent changes to keep', { exact: true }).locator('..'),
      ).toContainText('1')
      const pushCountBeforeRecovery = sent.filter(
        (command) => command.operationId === original.operationId,
      ).length
      await review
        .getByRole('button', { name: 'Keep device copy and refresh account', exact: true })
        .click()
      await expect(review).toHaveCount(0)
      await expect(a.locator('.collection-heading')).toContainText('Account projects')
      await openProject(a, title)
      expect(await a.locator('body').innerText()).not.toContain(localStep)
      await expect(a.locator('.detail-photo img[src^="data:"]')).toHaveCount(0)
      const after = await fixtureSql(email, original, 'inspect')
      expect(after.oldReceiptCount).toBe(0)
      expect(after.checkpointCount).toBe(0)
      if (trigger === 'retired') expect(after.generation).not.toBe(original.deviceGeneration)
      else expect(after.generation).toBe(original.deviceGeneration)

      await a.getByRole('button', { name: 'Change collection', exact: true }).click()
      await a
        .getByRole('dialog')
        .getByRole('button', { name: /Recovered before account refresh/ })
        .click()
      await openProject(a, title)
      await expect(a.getByRole('region', { name: 'Latest checkpoint' })).toContainText(localStep)
      await expect(a.locator('.detail-photo img')).toHaveAttribute('src', savedPhoto)
      await a.reload()
      await expect(a.getByRole('region', { name: 'Latest checkpoint' })).toContainText(localStep)
      await expect(a.locator('.detail-photo img')).toHaveAttribute('src', savedPhoto)
      await a.getByRole('button', { name: 'Save a checkpoint', exact: true }).click()
      await expect(a.getByLabel('What will you do next?')).toHaveValue(draftStep)
      await a.getByRole('button', { name: 'Close dialog', exact: true }).click()

      if (trigger === 'retired') {
        await signIn(b, email)
        await chooseAccount(b)
      } else await b.reload()
      await openProject(b, title)
      expect(await b.locator('body').innerText()).not.toContain(localStep)
      await expect(b.locator('.detail-photo img[src^="data:"]')).toHaveCount(0)
      await chooseAccount(a)
      await openProject(a, title)
      const newStep = 'Fresh account checkpoint after recovery'
      await saveCheckpoint(a, newStep)
      await expect(a.locator('.sync-status')).toContainText('Synced to your account', {
        timeout: 20000,
      })
      const freshCommand = sent.find(
        (command) =>
          command.kind === 'checkpoint.create' && command.payload.checkpoint.nextStep === newStep,
      )!
      expect(freshCommand).toBeTruthy()
      expect(freshCommand.operationId).not.toBe(original.operationId)
      expect(freshCommand.deviceGeneration).toBe(after.generation)
      expect(BigInt(freshCommand.sequence)).toBeGreaterThan(BigInt(after.floor))
      if (trigger === 'cursor')
        expect(BigInt(freshCommand.sequence)).toBeGreaterThan(BigInt(original.sequence))
      expect(sent.filter((command) => command.operationId === original.operationId)).toHaveLength(
        pushCountBeforeRecovery,
      )
      await b.reload()
      await openProject(b, title)
      await expect(b.getByRole('region', { name: 'Latest checkpoint' })).toContainText(newStep)
      expect(await b.locator('body').innerText()).not.toContain(localStep)
      const complete = await fixtureSql(email, original, 'inspect')
      expect(complete.oldReceiptCount).toBe(0)
      expect(complete.checkpointCount).toBe(1)
    } finally {
      closing = true
      release()
      await first.close()
      await reader.close()
    }
  })
