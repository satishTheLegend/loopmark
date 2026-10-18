import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseOperatorConfig } from '../../scripts/lib/config.mjs'
import { assertLocalDocker } from '../../scripts/local.mjs'
import { createProject, deliveredCode, origin } from '../cloud/helpers'

const execute = promisify(execFile)
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
      : `do $$
        declare affected integer;
        begin
          update auth.users
            set confirmation_sent_at=clock_timestamp()+interval '1 minute',
                recovery_sent_at=clock_timestamp()+interval '1 minute'
            where email='${email}';
          get diagnostics affected = row_count;
          if affected <> 1 then raise exception 'Expected one synthetic Auth fixture'; end if;
        end $$;`
  await execute('docker', [
    'exec',
    `supabase_db_${config.projectId}`,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    statement,
  ])
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
}) => {
  test.setTimeout(60000)
  const email = `loopmark-auth-${crypto.randomUUID()}@example.invalid`
  await page.goto(origin + '/#account')
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await deliveredCode(email, () => page.getByRole('button', { name: 'Send sign-in code' }).click())
  await expect(page.getByRole('button', { name: /Resend in/ })).toBeDisabled()
  await page.reload()
  await page.getByLabel('Email address', { exact: true }).fill(email)
  // Reload/typing can outlast the local server's five-second interval under load.
  // Pin only this user's last-send marker at the outgoing POST boundary. The
  // controlled window exceeds the test's remaining total budget; this tests
  // real server rejection and UI handling, not browser wall-clock speed.
  await page.route('**/auth/v1/otp', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    if (route.request().postDataJSON()?.email !== email)
      throw new Error('Unexpected user in the synthetic resend request')
    await prepareFixtureAuth(email, 'throttled')
    await route.continue()
  })
  const limited = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/auth/v1/otp' && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Send sign-in code' }).click()
  expect((await limited).status()).toBe(429)
  await expect(page.getByRole('alert')).toContainText('RATE_LIMITED')
  await expect(page.getByRole('button', { name: /Try again in/ })).toBeDisabled()
  await expect(page.locator('.account-identity')).toHaveCount(0)
})
