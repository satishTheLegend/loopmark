import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
const image =
  'node:26.8.2-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868'
export async function configureBillingFixture(context, args) {
  const marker = resolve(context.runtime, 'billing-fixture.enabled')
  await mkdir(context.runtime, { recursive: true, mode: 0o700 })
  if (args.includes('--billing-fixture')) await writeFile(marker, 'enabled\n', { mode: 0o600 })
  if (args.includes('--no-billing-fixture')) await rm(marker, { force: true })
}
export async function fixtureEnvironment(context) {
  if (
    (await readFile(resolve(context.runtime, 'billing-fixture.enabled'), 'utf8').catch(
      () => null,
    )) !== 'enabled\n'
  )
    return ''
  const file = resolve(context.runtime, 'billing-fixture.key')
  let key = await readFile(file, 'utf8').catch(() => null)
  if (!key) {
    key = randomBytes(32).toString('hex')
    await writeFile(file, key, { mode: 0o600, flag: 'wx' })
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid local fixture credential')
  await writeFile(
    resolve(context.runtime, 'billing-fixture.env'),
    `LOOPMARK_BILLING_FIXTURE_KEY=${key}\n`,
    { mode: 0o600 },
  )
  return `LOOPMARK_BILLING_FIXTURE_ENABLED=true\nLOOPMARK_BILLING_FIXTURE_URL=http://billing-fixture:8788\nLOOPMARK_RAZORPAY_ENROLLED=true\nLOOPMARK_REVENUECAT_ENROLLED=true\nLOOPMARK_PAYMENT_ENVIRONMENT=sandbox\nLOOPMARK_REVENUECAT_PROJECT_ID=projSynthetic1234\nRAZORPAY_KEY_ID=rzp_test_fixture\nRAZORPAY_KEY_SECRET=fixture_${key}\nRAZORPAY_WEBHOOK_SECRET=fixture_${key}\nREVENUECAT_SECRET_API_KEY=fixture_${key}\nREVENUECAT_WEBHOOK_SECRET=fixture_${key}\nLOOPMARK_REVENUECAT_IOS_KEY=appl_syntheticfixture0000\nLOOPMARK_REVENUECAT_ANDROID_KEY=goog_syntheticfixture0000\nLOOPMARK_REVENUECAT_IOS_PRODUCTS=loopmark.lifetime.ios\nLOOPMARK_REVENUECAT_ANDROID_PRODUCTS=loopmark.lifetime.android\n`
}
export async function startBillingFixture(context, execute) {
  const enabled =
      (await readFile(resolve(context.runtime, 'billing-fixture.enabled'), 'utf8').catch(
        () => null,
      )) === 'enabled\n',
    name = `loopmark_billing_fixture_${context.config.projectId}`
  const found = await execute('docker', [
    'inspect',
    '--format',
    '{{index .Config.Labels "loopmark.fixture.project"}} {{index .Config.Labels "loopmark.fixture.source"}}',
    name,
  ])
  if (!found.code) {
    if (!found.stdout.startsWith(context.config.projectId + ' '))
      throw new Error('Fixture container owner mismatch')
    if (!enabled) {
      await execute('docker', ['rm', '-f', name])
      return
    }
  }
  if (!enabled) return
  const source = resolve(context.config.worktree, 'supabase/billing-fixture/server.mjs'),
    hash = createHash('sha256')
      .update(await readFile(source))
      .digest('hex')
  if (!found.code && found.stdout.trim().endsWith(hash)) {
    const started = await execute('docker', ['start', name])
    if (started.code) throw new Error('Fixture start failed')
    return
  }
  if (!found.code) await execute('docker', ['rm', '-f', name])
  const started = await execute('docker', [
    'run',
    '-d',
    '--name',
    name,
    '--label',
    `loopmark.fixture.project=${context.config.projectId}`,
    '--label',
    `loopmark.fixture.source=${hash}`,
    '--network',
    context.network,
    '--network-alias',
    'billing-fixture',
    '--memory',
    '96m',
    '--cpus',
    '0.5',
    '--read-only',
    '--security-opt',
    'no-new-privileges',
    '--cap-drop',
    'ALL',
    '--env-file',
    resolve(context.runtime, 'billing-fixture.env'),
    '--mount',
    `type=bind,source=${source},target=/app/server.mjs,readonly`,
    image,
    'node',
    '/app/server.mjs',
  ])
  if (started.code) throw new Error('Local synthetic provider fixture failed to start')
}

export async function stopBillingFixture(context, execute) {
  const name = `loopmark_billing_fixture_${context.config.projectId}`
  const found = await execute('docker', [
    'inspect',
    '--format',
    '{{index .Config.Labels "loopmark.fixture.project"}}',
    name,
  ])
  if (!found.code && found.stdout.trim() === context.config.projectId) {
    const stopped = await execute('docker', ['stop', name])
    if (stopped.code) throw new Error('Local fixture stop failed')
  }
}
