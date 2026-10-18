import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { preflight, validateConfig } from '../../scripts/sandbox/preflight.mjs'

const env = {
  LOOPMARK_ENVIRONMENT: 'staging',
  LOOPMARK_PAYMENT_ENVIRONMENT: 'sandbox',
  RAZORPAY_KEY_ID: 'rzp_test_fixture',
  RAZORPAY_KEY_SECRET: 'secret-fixture',
  RAZORPAY_WEBHOOK_SECRET: 'webhook-fixture',
  LOOPMARK_REVENUECAT_PROJECT_ID: 'proj_fixture',
  REVENUECAT_SECRET_API_KEY: 'rc-secret-fixture',
  REVENUECAT_WEBHOOK_SECRET: 'rc-webhook-fixture',
  LOOPMARK_SANDBOX_ACCOUNT_TOKEN: 'synthetic-token',
  VITE_LOOPMARK_SUPABASE_ANON_KEY: 'synthetic-public-key',
}
async function fixture(platform, action) {
  const dir = await mkdtemp(join(tmpdir(), 'loopmark-preflight-'))
  const config = {
    schemaVersion: 1,
    platform,
    environment: 'sandbox',
    authorizationReference: 'owner-approved-fixture',
    sourceCommit: 'a'.repeat(40),
    appOrigin: 'https://staging.example.test',
    supabaseUrl: 'https://backend.example.test',
    artifact: {
      path: 'artifact.zip',
      sha256: createHash('sha256').update('synthetic').digest('hex'),
    },
    razorpayKeyId: 'rzp_test_fixture',
    applicationId: 'app.loopmark.craft',
    revenueCatProjectId: 'proj_fixture',
    revenueCatAppId: 'app_fixture',
    publicSdkKey: platform === 'ios' ? 'appl_fixture' : 'goog_fixture',
    productIds: ['loopmark_lifetime'],
  }
  const path = join(dir, 'private-config.json')
  await writeFile(path, JSON.stringify(config))
  await writeFile(join(dir, 'artifact.zip'), 'synthetic')
  try {
    await action({ config, path, dir })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('missing configuration blocks every platform without any network or transaction', async () => {
  for (const platform of ['web', 'ios', 'android']) {
    const report = await preflight(platform, undefined, {
      probe: true,
      fetch: () => {
        throw new Error('must not call')
      },
    })
    assert.equal(report.status, 'blocked')
    assert.equal(report.performedTransactions, false)
  }
})
test('live mode, mismatched artifact and absent authorization cannot reach a provider', async () => {
  await fixture('web', async ({ config, path, dir }) => {
    assert.equal(validateConfig({ ...config, environment: 'production' }, 'web'), false)
    assert.equal(validateConfig({ ...config, authorizationReference: '' }, 'web'), false)
    assert.equal(validateConfig({ ...config, razorpayKeyId: 'rzp_live_fixture' }, 'web'), false)
    await writeFile(join(dir, 'artifact.zip'), 'different')
    const report = await preflight('web', path, {
      env: { ...env, LOOPMARK_PAYMENT_ENVIRONMENT: 'production' },
      probe: true,
      fetch: () => {
        throw new Error('must not call')
      },
    })
    assert.equal(report.status, 'blocked')
    assert.equal(report.checks.find((check) => check.id === 'artifact').status, 'blocked')
    assert.equal(report.checks.find((check) => check.id === 'sandbox-mode').status, 'blocked')
  })
})
test('read-only web probes can report readiness but never sandbox qualification; secrets stay out of reports', async () => {
  await fixture('web', async ({ path }) => {
    const requests = []
    const report = await preflight('web', path, {
      env,
      probe: true,
      fetch: async (url, init) => {
        requests.push({ url, method: init.method ?? 'GET', redirect: init.redirect })
        return new Response('{}', { status: 200 })
      },
    })
    assert.equal(report.status, 'ready-for-operator')
    assert.equal(report.performedTransactions, false)
    assert.deepEqual(
      requests.map((request) => request.method),
      ['HEAD', 'GET'],
    )
    assert.equal(requests[1].url, 'https://api.razorpay.com/v1/payments?count=1')
    assert.ok(requests.every((request) => request.redirect === 'error'))
    assert.ok(!JSON.stringify(report).includes(env.RAZORPAY_KEY_SECRET))
    assert.ok(!JSON.stringify(report).includes('qualified'))
  })
})
test('native readiness requires exact store app and authenticated sandbox catalog, never Test Store', async () => {
  await fixture('ios', async ({ path, config }) => {
    assert.equal(validateConfig({ ...config, publicSdkKey: 'test_fixture' }, 'ios'), false)
    const report = await preflight('ios', path, {
      env,
      probe: true,
      fetch: async (url) => {
        if (url.includes('api.revenuecat.com'))
          return Response.json({
            id: 'wrong-app',
            project_id: 'proj_fixture',
            type: 'app_store',
            app_store: { bundle_id: 'app.loopmark.craft' },
          })
        if (url.includes('billing-config'))
          return Response.json({
            platform: 'ios',
            publicSdkKey: 'appl_fixture',
            productIds: config.productIds,
            environment: 'production',
          })
        return new Response(null, { status: 200 })
      },
    })
    assert.equal(report.status, 'blocked')
    assert.equal(
      report.checks.find((check) => check.id === 'revenuecat-application').status,
      'blocked',
    )
    assert.equal(
      report.checks.find((check) => check.id === 'enrolled-billing-configuration').status,
      'blocked',
    )
  })
})
test('provider failures are redacted and an explicit probe flag is required', async () => {
  await fixture('android', async ({ path }) => {
    const withoutProbe = await preflight('android', path, {
      env,
      fetch: () => {
        throw new Error('must not call')
      },
    })
    assert.equal(withoutProbe.status, 'blocked')
    const report = await preflight('android', path, {
      env,
      probe: true,
      fetch: () => {
        throw new Error(env.REVENUECAT_SECRET_API_KEY)
      },
    })
    assert.equal(report.status, 'blocked')
    assert.ok(!JSON.stringify(report).includes(env.REVENUECAT_SECRET_API_KEY))
  })
})

test('native exact configuration reports only operator readiness using read-only provider API', async () => {
  for (const platform of ['ios', 'android'])
    await fixture(platform, async ({ path, config }) => {
      const requests = []
      const report = await preflight(platform, path, {
        env,
        probe: true,
        fetch: async (url, init) => {
          requests.push({ url, method: init.method ?? 'GET' })
          if (url.includes('api.revenuecat.com'))
            return Response.json({
              id: 'app_fixture',
              project_id: 'proj_fixture',
              type: platform === 'ios' ? 'app_store' : 'play_store',
              app_store: { bundle_id: 'app.loopmark.craft' },
              play_store: { package_name: 'app.loopmark.craft' },
            })
          if (url.includes('billing-config'))
            return Response.json({
              platform,
              publicSdkKey: config.publicSdkKey,
              productIds: config.productIds,
              environment: 'sandbox',
            })
          return new Response(null, { status: 200 })
        },
      })
      assert.equal(report.status, 'ready-for-operator')
      assert.equal(report.performedTransactions, false)
      assert.deepEqual(
        requests.map((request) => request.method),
        ['HEAD', 'GET', 'POST'],
      )
      assert.ok(requests[2].url.endsWith('/functions/v1/billing-config'))
    })
})
