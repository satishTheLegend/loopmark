import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,200}$/.test(value)
const origin = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password
  } catch {
    return false
  }
}
const equalSet = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  [...a].sort().every((value, index) => value === [...b].sort()[index])
const platforms = ['web', 'ios', 'android']

export function validateConfig(value, platform) {
  if (
    !platforms.includes(platform) ||
    !value ||
    value.schemaVersion !== 1 ||
    value.platform !== platform ||
    value.environment !== 'sandbox'
  )
    return false
  if (
    !identifier(value.authorizationReference) ||
    !/^[a-f0-9]{40}$/.test(value.sourceCommit ?? '') ||
    !origin(value.appOrigin) ||
    !origin(value.supabaseUrl)
  )
    return false
  if (
    !value.artifact ||
    typeof value.artifact.path !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.artifact.sha256 ?? '')
  )
    return false
  if (platform === 'web') return /^rzp_test_[A-Za-z0-9]+$/.test(value.razorpayKeyId ?? '')
  return (
    identifier(value.applicationId) &&
    identifier(value.revenueCatProjectId) &&
    identifier(value.revenueCatAppId) &&
    (platform === 'ios' ? /^appl_[A-Za-z0-9]+$/ : /^goog_[A-Za-z0-9]+$/).test(
      value.publicSdkKey ?? '',
    ) &&
    Array.isArray(value.productIds) &&
    value.productIds.length > 0 &&
    value.productIds.length <= 10 &&
    value.productIds.every(identifier) &&
    new Set(value.productIds).size === value.productIds.length
  )
}

async function boundedJson(response) {
  if (!response.ok || !response.body) throw new Error('Unavailable')
  const reader = response.body.getReader()
  let length = 0
  const chunks = []
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > 128 * 1024) throw new Error('Oversized')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function preflight(platform, configPath, options = {}) {
  const env = options.env ?? process.env
  const fetcher = options.fetch ?? fetch
  const report = {
    schemaVersion: 1,
    status: 'blocked',
    platform,
    checks: [],
    performedTransactions: false,
  }
  const add = (id, pass, message) =>
    report.checks.push({ id, status: pass ? 'pass' : 'blocked', message })
  let config
  try {
    if (!configPath || (await stat(configPath)).size > 64 * 1024) throw new Error('Missing')
    config = JSON.parse(await readFile(configPath, 'utf8'))
    if (!validateConfig(config, platform)) throw new Error('Invalid')
    report.sourceCommit = config.sourceCommit
    report.artifactSha256 = config.artifact.sha256
    report.providerEnvironment = 'sandbox'
    add('configuration', true, 'Explicit sandbox target and authorization reference validated.')
  } catch {
    add(
      'configuration',
      false,
      'Provide --config with a valid sandbox-only qualification configuration; see docs/release/qualification.md.',
    )
    return report
  }
  try {
    const file = resolve(dirname(resolve(configPath)), config.artifact.path)
    if (!(await stat(file)).isFile()) throw new Error('Not a file')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    if (hash.digest('hex') !== config.artifact.sha256) throw new Error('Mismatch')
    add(
      'artifact',
      true,
      'Supplied artifact bytes match the declared SHA-256; signing is a separate gate.',
    )
  } catch {
    add('artifact', false, 'Artifact is absent, unreadable or differs from the declared SHA-256.')
  }
  const secrets =
    platform === 'web'
      ? env.RAZORPAY_KEY_ID === config.razorpayKeyId &&
        !!env.RAZORPAY_KEY_SECRET &&
        !!env.RAZORPAY_WEBHOOK_SECRET
      : env.LOOPMARK_REVENUECAT_PROJECT_ID === config.revenueCatProjectId &&
        !!env.REVENUECAT_SECRET_API_KEY &&
        !!env.REVENUECAT_WEBHOOK_SECRET &&
        !!env.LOOPMARK_SANDBOX_ACCOUNT_TOKEN &&
        !!env.VITE_LOOPMARK_SUPABASE_ANON_KEY
  add(
    'credentials',
    !!secrets,
    secrets
      ? 'Required sandbox/operator credentials are present; values are never reported.'
      : 'Required sandbox credentials are absent or do not match the selected provider project.',
  )
  add(
    'sandbox-mode',
    env.LOOPMARK_PAYMENT_ENVIRONMENT === 'sandbox' && env.LOOPMARK_ENVIRONMENT === 'staging',
    'Require staging application infrastructure and explicit sandbox payment mode.',
  )
  if (!options.probe) {
    add(
      'read-only-provider-probes',
      false,
      'Re-run with --probe to authorize read-only target/provider checks. No purchase, refund or publication is performed.',
    )
    return report
  }
  if (report.checks.some((check) => check.status === 'blocked')) return report
  const request = (url, init = {}) =>
    fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) })
  try {
    const response = await request(config.appOrigin, { method: 'HEAD' })
    if (!response.ok) throw new Error('Unavailable')
    add('application-reachable', true, 'Selected HTTPS application responds without a redirect.')
  } catch {
    add(
      'application-reachable',
      false,
      'Selected application is unavailable or redirected; no credentials were sent.',
    )
  }
  if (platform === 'web') {
    try {
      const response = await request('https://api.razorpay.com/v1/payments?count=1', {
        headers: {
          authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
        },
      })
      if (!response.ok) throw new Error('Unavailable')
      await response.body?.cancel()
      add(
        'razorpay-test-credentials',
        true,
        'Fixed Razorpay read endpoint accepted the selected test-mode credential; response content was discarded.',
      )
    } catch {
      add(
        'razorpay-test-credentials',
        false,
        'Razorpay test credential probe failed. No provider response or secret is included.',
      )
    }
  } else {
    try {
      const app = await boundedJson(
        await request(
          `https://api.revenuecat.com/v2/projects/${encodeURIComponent(config.revenueCatProjectId)}/apps/${encodeURIComponent(config.revenueCatAppId)}`,
          {
            headers: { authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}` },
          },
        ),
      )
      const match =
        app.id === config.revenueCatAppId &&
        app.project_id === config.revenueCatProjectId &&
        (platform === 'ios'
          ? app.type === 'app_store' && app.app_store?.bundle_id === config.applicationId
          : app.type === 'play_store' && app.play_store?.package_name === config.applicationId)
      if (!match) throw new Error('Mismatch')
      add(
        'revenuecat-application',
        true,
        'RevenueCat returned the exact selected platform application and project.',
      )
    } catch {
      add(
        'revenuecat-application',
        false,
        'RevenueCat application identity could not be verified. Test Store and another app cannot qualify this gate.',
      )
    }
    try {
      const billing = await boundedJson(
        await request(`${config.supabaseUrl}/functions/v1/billing-config`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.LOOPMARK_SANDBOX_ACCOUNT_TOKEN}`,
            apikey: env.VITE_LOOPMARK_SUPABASE_ANON_KEY,
            'content-type': 'application/json',
            origin: platform === 'ios' ? 'capacitor://localhost' : 'https://localhost',
          },
          body: JSON.stringify({ platform }),
        }),
      )
      if (
        billing.platform !== platform ||
        billing.environment !== 'sandbox' ||
        billing.publicSdkKey !== config.publicSdkKey ||
        !equalSet(billing.productIds, config.productIds)
      )
        throw new Error('Mismatch')
      add(
        'enrolled-billing-configuration',
        true,
        'Authenticated server configuration matches the exact approved sandbox products and platform key.',
      )
    } catch {
      add(
        'enrolled-billing-configuration',
        false,
        'Authenticated enrolled sandbox billing configuration is unavailable or mismatched.',
      )
    }
  }
  if (report.checks.every((check) => check.status === 'pass')) report.status = 'ready-for-operator'
  return report
}

export async function main(platform, args = process.argv.slice(2)) {
  const index = args.indexOf('--config')
  if (
    args.some((arg, i) => arg !== '--probe' && arg !== '--config' && i !== index + 1) ||
    index < 0 ||
    !args[index + 1]
  ) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          status: 'blocked',
          platform,
          checks: [
            {
              id: 'arguments',
              status: 'blocked',
              message:
                'Usage: node scripts/sandbox/PLATFORM.mjs --config <private-config.json> [--probe]',
            },
          ],
          performedTransactions: false,
        },
        null,
        2,
      ),
    )
    process.exitCode = 2
    return
  }
  const report = await preflight(platform, args[index + 1], { probe: args.includes('--probe') })
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.status === 'ready-for-operator' ? 0 : 2
}
