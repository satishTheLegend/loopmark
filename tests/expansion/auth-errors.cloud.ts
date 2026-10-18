import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseOperatorConfig } from '../../scripts/lib/config.mjs'
import { assertLocalDocker } from '../../scripts/local.mjs'
import { createProject, deliveredCode, origin } from '../cloud/helpers'

const execute = promisify(execFile)
interface FixtureSendMarker {
  sentAt: string
  observedAt: string
  sqlStartedAt: number
  sqlFinishedAt: number
}
async function prepareFixtureAuth(email: string, state: 'expired' | 'throttled') {
  if (
    !/^loopmark-auth-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}@example\.invalid$/.test(
      email,
    )
  )
    throw new Error('Only a generated local Auth fixture may be changed')
  const config = parseOperatorConfig(process.env, process.cwd())
  await assertLocalDocker()
  // Auth's real HTTP endpoints remain the expiry and throttling authority.
  const statement =
    state === 'expired'
      ? `begin;
        update auth.users set confirmation_sent_at=now()-interval '1 day',recovery_sent_at=now()-interval '1 day' where email='${email}';
        update auth.one_time_tokens set created_at=now()-interval '1 day' where user_id in (select id from auth.users where email='${email}');
        commit;`
      : `begin;
        do $$
        declare affected integer; sent_at timestamptz := clock_timestamp();
        begin
          update auth.users
            set confirmation_sent_at=sent_at, recovery_sent_at=sent_at
            where email='${email}';
          get diagnostics affected = row_count;
          if affected <> 1 then raise exception 'Expected one synthetic Auth fixture'; end if;
        end $$;
        select json_build_object('sentAt', confirmation_sent_at, 'observedAt', clock_timestamp())
          from auth.users where email='${email}';
        commit;`
  const sqlStartedAt = performance.now()
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
    '-t',
    '-A',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    statement,
  ])
  const sqlFinishedAt = performance.now()
  if (state === 'expired') return null
  const marker = JSON.parse(stdout.trim()) as Pick<FixtureSendMarker, 'sentAt' | 'observedAt'>
  if (
    !Number.isFinite(Date.parse(marker.sentAt)) ||
    !Number.isFinite(Date.parse(marker.observedAt))
  )
    throw new Error('Synthetic Auth timestamp was not returned')
  return { ...marker, sqlStartedAt, sqlFinishedAt }
}

test('expired delivered code is rejected by actual Auth and a fresh code restores access without uploading guest work', async ({
  page,
}) => {
  test.setTimeout(60000)
  const email = `loopmark-auth-${crypto.randomUUID()}@example.invalid`
  await page.goto(origin)
  await createProject(page, 'Guest shawl before sign-in')
  await page.goto(origin + '/#account')
  await page.getByLabel('Email address', { exact: true }).fill(email)
  const oldCode = await deliveredCode(email, () =>
    page.getByRole('button', { name: 'Send sign-in code' }).click(),
  )
  await prepareFixtureAuth(email, 'expired')
  await page.getByLabel('Sign-in code', { exact: true }).fill(oldCode)
  const rejected = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/auth/v1/verify' &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  expect((await rejected).status()).toBe(403)
  await expect(page.getByRole('alert')).toContainText('That code cannot be used.')
  await expect(page.getByRole('alert')).toContainText('AUTH_CODE_EXPIRED')
  await expect(page.locator('.account-identity')).toHaveCount(0)
  await page.reload()
  await page.getByLabel('Email address', { exact: true }).fill(email)
  const freshCode = await deliveredCode(email, () =>
    page.getByRole('button', { name: 'Send sign-in code' }).click(),
  )
  await page.getByLabel('Sign-in code', { exact: true }).fill(freshCode)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.locator('.account-identity')).toContainText(email)
  await expect(page.locator('.collection-heading')).toContainText('Personal projects')
  await page.goto(origin + '/#projects')
  await expect(
    page.getByRole('button', { name: /^Open Guest shawl before sign-in\./ }),
  ).toBeVisible()
})

test('reload cannot bypass actual Auth resend throttling and the UI offers a timed remedy', async ({
  page,
}, testInfo) => {
  test.setTimeout(60000)
  const email = `loopmark-auth-${crypto.randomUUID()}@example.invalid`
  await page.goto(origin + '/#account')
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await deliveredCode(email, () => page.getByRole('button', { name: 'Send sign-in code' }).click())
  await expect(page.getByRole('button', { name: /Resend in/ })).toBeDisabled()
  await page.reload()
  await page.getByLabel('Email address', { exact: true }).fill(email)
  // Reload/typing can outlast the local server's five-second interval under load.
  // Set only this user's marker to current database time at the POST boundary,
  // then immediately forward the real request. Record a missed timing
  // precondition separately instead of diagnosing it as a throttle bypass.
  let marker: FixtureSendMarker | null = null
  await page.route('**/auth/v1/otp', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    if (route.request().postDataJSON()?.email !== email)
      throw new Error('Unexpected user in the synthetic resend request')
    marker = await prepareFixtureAuth(email, 'throttled')
    await route.continue()
  })
  const limited = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/auth/v1/otp' && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Send sign-in code' }).click()
  const response = await limited
  const responseAt = performance.now()
  const captured = marker as FixtureSendMarker | null
  if (!captured) throw new Error('Synthetic resend fixture was not prepared')
  const databaseAge = Date.parse(captured.observedAt) - Date.parse(captured.sentAt)
  const ageLowerBoundMs = databaseAge + responseAt - captured.sqlFinishedAt
  const ageUpperBoundMs = databaseAge + responseAt - captured.sqlStartedAt
  const requestTiming = response.request().timing()
  await testInfo.attach('resend-throttle-window', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        sentAt: captured.sentAt,
        observedAt: captured.observedAt,
        sqlStartedAt: captured.sqlStartedAt,
        sqlFinishedAt: captured.sqlFinishedAt,
        responseAt,
        ageLowerBoundMs,
        ageUpperBoundMs,
        configuredWindowMs: 5000,
        request: {
          startTime: requestTiming.startTime,
          requestStart: requestTiming.requestStart,
          responseStart: requestTiming.responseStart,
        },
        status: response.status(),
      },
      null,
      2,
    ),
  })
  if (response.status() !== 429 && ageUpperBoundMs >= 5000)
    throw new Error(
      'Fixture precondition expired or unproven: resend was not observed inside the five-second window',
    )
  expect(response.status()).toBe(429)
  await expect(page.getByRole('alert')).toContainText('RATE_LIMITED')
  await expect(page.getByRole('button', { name: /Try again in/ })).toBeDisabled()
  await expect(page.locator('.account-identity')).toHaveCount(0)
})
